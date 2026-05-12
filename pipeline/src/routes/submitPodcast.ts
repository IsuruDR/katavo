/**
 * POST /api/submit-podcast
 *
 * Validates credits, deducts one credit (CAS), creates podcast record,
 * enqueues pipeline run via job manager.
 *
 * Request body: { topic, clarifyingAnswers?, parentPodcastId?, sourceChapterTitle? }
 *   - parentPodcastId + sourceChapterTitle set: this is a chapter expansion.
 *     Server validates parent ownership, chapter existence, idempotency
 *     (one expansion per parent+chapter), and the parent has chapter_transcripts
 *     populated. Flips profiles.has_used_expand to true after successful submit.
 *
 * Response (new podcast): { podcastId, status: "queued" }
 * Response (existing expansion): 409 { podcastId, status: "exists" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";
import type { JobManager } from "../jobs/jobManager.js";

const route = new Hono();

/**
 * Must be called once at startup to inject the job manager dependency.
 * This avoids circular imports between routes and the job manager.
 */
let jobManager: JobManager;
export function setJobManager(jm: JobManager): void {
  jobManager = jm;
}

interface ParentContext {
  topic: string;
  chapter_markers: Array<{ timestampSeconds: number; title: string }>;
  chapter_transcripts: Record<string, string> | null;
  research_document: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchParentContext(
  serviceClient: any,
  parentId: string,
  userId: string,
): Promise<ParentContext | null> {
  const { data, error } = await serviceClient
    .from("podcasts")
    .select("user_id, topic, chapter_markers, chapter_transcripts, research_contexts(research_document)")
    .eq("id", parentId)
    .is("deleted_at", null)
    .single() as { data: any; error: any };
  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  const researchDoc =
    (Array.isArray(data.research_contexts)
      ? data.research_contexts[0]?.research_document
      : data.research_contexts?.research_document) ?? {};
  return {
    topic: data.topic,
    chapter_markers: data.chapter_markers ?? [],
    chapter_transcripts: data.chapter_transcripts ?? null,
    research_document: researchDoc,
  };
}

function buildResearchDigest(researchDocument: Record<string, unknown>): string {
  const sections = (researchDocument as any).sections;
  if (!Array.isArray(sections) || sections.length === 0) return "(no parent research available)";
  return sections
    .map((s: any) => {
      const title = String(s.title ?? "");
      const firstSentence = String(s.content ?? "")
        .split(/(?<=[.!?])\s/)[0]
        .slice(0, 240);
      return `- ${title}: ${firstSentence}`;
    })
    .join("\n");
}

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const topic = body.topic;
    const clarifyingAnswers = body.clarifyingAnswers ?? body.clarifying_answers ?? [];
    const parentPodcastId: string | undefined = body.parentPodcastId ?? body.parent_podcast_id;
    const sourceChapterTitle: string | undefined = body.sourceChapterTitle ?? body.source_chapter_title;
    const isExpansion = !!parentPodcastId;

    if (isExpansion && !sourceChapterTitle) {
      return c.json({ error: "sourceChapterTitle required when parentPodcastId set" }, 400);
    }

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check subscription exists
    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subscription) {
      return c.json(
        { error: "No credits remaining. Purchase more credits to continue." },
        402,
      );
    }

    // Pull preferred voice. Null means use pipeline default (TTS_VOICE).
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("preferred_voice")
      .eq("id", user.id)
      .single();
    const voice = profile?.preferred_voice ?? null;

    // Validate expansion: parent ownership, chapter existence, idempotency,
    // and transcript availability. Run before quota checks so a 409 (already
    // exists) never consumes a credit slot.
    let expansionContext: {
      parent: ParentContext;
      parentChapterTranscript: string;
      parentResearchDigest: string;
    } | null = null;

    if (isExpansion) {
      const parent = await fetchParentContext(serviceClient, parentPodcastId!, user.id);
      if (!parent) {
        return c.json({ error: "Parent podcast not found" }, 404);
      }

      const titles = parent.chapter_markers.map((m) => m.title);
      if (!titles.includes(sourceChapterTitle!)) {
        return c.json({ error: "Source chapter not found in parent" }, 400);
      }

      const { data: existing } = await serviceClient
        .from("podcasts")
        .select("id")
        .eq("parent_podcast_id", parentPodcastId!)
        .eq("source_chapter_title", sourceChapterTitle!)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        return c.json({ podcastId: existing.id, status: "exists" }, 409);
      }

      const chapterTranscript = parent.chapter_transcripts?.[sourceChapterTitle!];
      if (!chapterTranscript) {
        return c.json(
          { error: "This podcast can't be expanded — regenerate it to enable expansions." },
          400,
        );
      }

      expansionContext = {
        parent,
        parentChapterTranscript: chapterTranscript,
        parentResearchDigest: buildResearchDigest(parent.research_document),
      };
    }

    // Check concurrent generation limit
    const tierLimits: Record<string, number> = { free: 1, plus: 2, pro: 3 };
    const maxConcurrent = tierLimits[subscription.tier] || 1;

    const { count } = await serviceClient
      .from("podcasts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "researching", "fact_checking", "scripting", "generating_audio"]);

    if ((count || 0) >= maxConcurrent) {
      return c.json(
        {
          error: `Maximum ${maxConcurrent} concurrent generations allowed. Please wait for current podcasts to finish.`,
        },
        429,
      );
    }

    const hasAds = subscription.tier === "free";

    // CAS credit deduction
    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ credits_remaining: subscription.credits_remaining - 1 })
      .eq("user_id", user.id)
      .eq("credits_remaining", subscription.credits_remaining)
      .gt("credits_remaining", 0)
      .select("credits_remaining")
      .single();

    if (deductError && deductError.code !== "PGRST116") {
      throw deductError;
    }

    if (!updatedSub) {
      const { data: currentSub } = await serviceClient
        .from("subscriptions")
        .select("credits_remaining")
        .eq("user_id", user.id)
        .single();

      if (!currentSub || currentSub.credits_remaining <= 0) {
        return c.json(
          { error: "No credits remaining. Purchase more credits to continue." },
          402,
        );
      }

      return c.json({ error: "Credit deduction conflict. Please retry." }, 409);
    }

    // Create podcast record
    const { data: podcast, error: insertError } = await serviceClient
      .from("podcasts")
      .insert({
        user_id: user.id,
        topic: isExpansion ? `${expansionContext!.parent.topic}: ${sourceChapterTitle}` : topic,
        clarifying_answers: clarifyingAnswers || [],
        status: "queued",
        has_ads: hasAds,
        voice,
        parent_podcast_id: parentPodcastId ?? null,
        source_chapter_title: sourceChapterTitle ?? null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Record credit transaction
    await serviceClient.from("credit_transactions").insert({
      user_id: user.id,
      type: "deduction",
      amount: -1,
      podcast_id: podcast.id,
    });

    // Flip has_used_expand after first successful expansion (idempotent)
    if (isExpansion) {
      await serviceClient
        .from("profiles")
        .update({ has_used_expand: true })
        .eq("id", user.id)
        .eq("has_used_expand", false);
    }

    // Look up has_used_expand for the pipeline
    const { data: profileRow } = await serviceClient
      .from("profiles")
      .select("has_used_expand")
      .eq("id", user.id)
      .single();
    const hasUsedExpand = profileRow?.has_used_expand ?? false;

    // Enqueue pipeline run (replaces LangGraph HTTP dispatch)
    try {
      jobManager.enqueue(podcast.id, {
        podcastId: podcast.id,
        userId: user.id,
        topic: isExpansion ? expansionContext!.parent.topic : topic,
        clarifyingAnswers: clarifyingAnswers || [],
        hasAds,
        tier: subscription.tier,
        voice,
        parentPodcastId: parentPodcastId ?? null,
        sourceChapterTitle: sourceChapterTitle ?? null,
        parentResearchDigest: expansionContext?.parentResearchDigest ?? null,
        parentResearchDocument: expansionContext?.parent.research_document ?? null,
        parentChapterTranscript: expansionContext?.parentChapterTranscript ?? null,
        hasUsedExpand,
      });
    } catch (err) {
      // Job already enqueued (deduplication) — this is fine, return success
      const isDuplicate = err instanceof Error && err.message.includes("already enqueued");
      if (!isDuplicate) throw err;
    }

    return c.json({ podcastId: podcast.id, status: "queued" });
  } catch {
    return c.json({ error: "Failed to submit podcast" }, 500);
  }
});

export { route as submitPodcastRoute };
