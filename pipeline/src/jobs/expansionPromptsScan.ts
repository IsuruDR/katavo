/**
 * Hourly scan: for every parent podcast that's eligible for a re-engagement
 * push (>= 2 days old, no expansion yet, user has never used expand,
 * has push token), pick a chapter via the engagement+research heuristic,
 * CAS-stamp expansion_prompt_sent_at, then fire an Expo push. On the
 * stamp-then-push ordering see the spec: missed pushes are recoverable
 * via in-app discovery; duplicates are not.
 */
import { createClient } from "@supabase/supabase-js";

const SCAN_BATCH_LIMIT = 50;
const MIN_CHAPTERS_FOR_PUSH = 3;
const SKIP_BACK_THRESHOLD = 2; // chapter needs ≥ N skip-backs to win on engagement signal

interface ChapterMarker {
  timestampSeconds: number;
  title: string;
}

interface EligiblePodcast {
  id: string;
  user_id: string;
  topic: string;
  chapter_markers: ChapterMarker[];
  research_document: Record<string, unknown>;
  expo_push_token: string;
}

export async function runExpansionPromptsScan(): Promise<{ sent: number; skipped: number }> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: candidates, error } = await supabase
    .from("podcasts")
    .select(`
      id, user_id, topic, chapter_markers,
      research_contexts ( research_document )
    `)
    .eq("status", "complete")
    .is("parent_podcast_id", null)
    .is("deleted_at", null)
    .is("expansion_prompt_sent_at", null)
    .lt("created_at", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
    .limit(SCAN_BATCH_LIMIT);

  if (error) {
    console.error("[expansionPromptsScan] eligibility query failed:", error);
    return { sent: 0, skipped: 0 };
  }
  if (!candidates?.length) return { sent: 0, skipped: 0 };

  // profiles and podcasts both reference auth.users separately, so PostgREST
  // can't embed profiles into the podcasts query. Fetch profiles in a single
  // batch lookup and join client-side.
  const userIds = Array.from(new Set(candidates.map((r) => r.user_id)));
  const { data: profilesRows } = await supabase
    .from("profiles")
    .select("id, expo_push_token, has_used_expand")
    .in("id", userIds);
  const profileByUserId = new Map<string, { expo_push_token: string | null; has_used_expand: boolean }>();
  for (const p of profilesRows ?? []) {
    profileByUserId.set(p.id, { expo_push_token: p.expo_push_token, has_used_expand: p.has_used_expand });
  }

  let sent = 0;
  let skipped = 0;

  for (const row of candidates) {
    const profile = profileByUserId.get(row.user_id);
    if (!profile?.expo_push_token || profile.has_used_expand) {
      skipped++;
      continue;
    }

    const { count: expansionCount } = await supabase
      .from("podcasts")
      .select("id", { count: "exact", head: true })
      .eq("parent_podcast_id", row.id)
      .is("deleted_at", null);
    if (expansionCount && expansionCount > 0) {
      skipped++;
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const researchDoc = Array.isArray((row as any).research_contexts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (row as any).research_contexts[0]?.research_document
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (row as any).research_contexts?.research_document;

    const eligible: EligiblePodcast = {
      id: row.id,
      user_id: row.user_id,
      topic: row.topic,
      chapter_markers: (row.chapter_markers as ChapterMarker[]) ?? [],
      research_document: researchDoc ?? {},
      expo_push_token: profile.expo_push_token,
    };

    const pick = await pickChapter(supabase, eligible);
    if (pick === null) {
      skipped++;
      continue;
    }

    // CAS stamp BEFORE push so concurrent instances can't double-send
    const { data: stampWinner } = await supabase
      .from("podcasts")
      .update({ expansion_prompt_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("expansion_prompt_sent_at", null)
      .select("id")
      .maybeSingle();

    if (!stampWinner) {
      skipped++;
      continue;
    }

    const result = await sendExpansionPush(eligible, pick);
    if (result.status === "device_not_registered") {
      await supabase
        .from("profiles")
        .update({ expo_push_token: null })
        .eq("id", row.user_id);
    }
    sent++;
  }

  return { sent, skipped };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pickChapter(supabase: any, eligible: EligiblePodcast): Promise<{ index: number; title: string } | null> {
  if (eligible.chapter_markers.length < MIN_CHAPTERS_FOR_PUSH) return null;

  const { data: events } = await supabase
    .from("playback_events")
    .select("timestamp_seconds")
    .eq("podcast_id", eligible.id)
    .eq("event_type", "skip_back");

  const countsByChapter: Record<number, number> = {};
  for (const ev of events ?? []) {
    const idx = chapterIndexForTimestamp(ev.timestamp_seconds, eligible.chapter_markers);
    if (idx > 0 && idx < eligible.chapter_markers.length - 1) {
      countsByChapter[idx] = (countsByChapter[idx] ?? 0) + 1;
    }
  }

  const topEngagement = Object.entries(countsByChapter)
    .map(([k, v]) => ({ index: parseInt(k, 10), count: v }))
    .sort((a, b) => b.count - a.count)[0];

  if (topEngagement && topEngagement.count >= SKIP_BACK_THRESHOLD) {
    return {
      index: topEngagement.index,
      title: eligible.chapter_markers[topEngagement.index].title,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = (eligible.research_document as any)?.chapterResearchMap as
    | Record<string, { sourceIndexes?: number[] }>
    | undefined;

  const candidates = eligible.chapter_markers
    .map((m, i) => ({
      title: m.title,
      index: i,
      score: map?.[m.title]?.sourceIndexes?.length ?? 0,
    }))
    .filter((c) => c.index > 0 && c.index < eligible.chapter_markers.length - 1)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;
  return { index: candidates[0].index, title: candidates[0].title };
}

export function chapterIndexForTimestamp(ts: number, markers: ChapterMarker[]): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    if (ts >= markers[i].timestampSeconds) return i;
  }
  return 0;
}

export async function sendExpansionPush(
  eligible: EligiblePodcast,
  pick: { index: number; title: string },
): Promise<{ status: "ok" | "device_not_registered" | "error" }> {
  const payload = {
    to: eligible.expo_push_token,
    title: `Going deeper on chapter ${pick.index}?`,
    body: `${pick.title}. Tap to expand.`,
    data: {
      deepLink: `/player/${eligible.id}?expand=${pick.index}`,
      podcastId: eligible.id,
    },
    sound: "default",
  };

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { data?: { status: string; details?: { error?: string } } };
    if (json.data?.details?.error === "DeviceNotRegistered") {
      return { status: "device_not_registered" };
    }
    return { status: "ok" };
  } catch (err) {
    console.error("[expansionPromptsScan] push send failed:", err);
    return { status: "error" };
  }
}
