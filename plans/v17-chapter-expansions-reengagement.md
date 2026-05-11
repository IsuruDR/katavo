# v17 — Chapter Expansions Re-engagement + Deep Dive Sunset Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-time-discovery coach-mark on parent podcast outro + scheduled re-engagement push notification 2 days after parent generation. Sunset the Deep Dive UI surface (entry points hidden; underlying code left in place).

**Architecture:** Pre-record one ~10s coach-mark MP3 per Gemini voice via a build script; audioProducer appends the matching MP3 when `hasUsedExpand=false` AND `parentPodcastId IS NULL`. Hourly setInterval in the Railway server queries eligible podcasts, picks a chapter via the skip-back-engagement heuristic (research-density fallback), and CAS-stamps `expansion_prompt_sent_at` before firing an Expo push. Deep Dive sunset = render-conditional hides on the two entry points.

**Tech Stack:** Gemini TTS via direct API (for coach-mark generation), ffmpeg + ffmpeg `loudnorm` for normalization, Hono on Railway, Expo Push API, supabase-js service-role client.

**Spec reference:** `docs/superpowers/specs/2026-05-12-chapter-expansions-design.md`

**Depends on:** v15 (server foundation — `has_used_expand`, `expansion_prompt_sent_at`, `playback_events` columns), v16 (mobile UX — the `?expand=N` deep-link handler must work).

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `pipeline/scripts/build-coachmark-audio.ts` | One-time script: generate 4 voice coach-mark MP3s + normalize loudness against a reference |
| `pipeline/coachmark_audio/coachmark_expand_Sulafat.mp3` | Pre-recorded asset (~10 sec, libmp3lame qscale=2, 24kHz mono) |
| `pipeline/coachmark_audio/coachmark_expand_Charon.mp3` | Same |
| `pipeline/coachmark_audio/coachmark_expand_Sadaltager.mp3` | Same |
| `pipeline/coachmark_audio/coachmark_expand_Achird.mp3` | Same |
| `pipeline/src/jobs/expansionPromptsScan.ts` | The hourly scan logic — eligibility query, chapter selection, push delivery, CAS stamp, token-revoke handling |
| `pipeline/src/routes/cronExpansionPrompts.ts` | Internal-auth-gated endpoint to invoke the scan manually (testing + future pg_cron migration target) |

### Modified files

| Path | What changes |
|---|---|
| `pipeline/src/podcast_pipeline/nodes/audioProducer.ts` | When `isParent && !hasUsedExpand`, append coachmark MP3 to concat list |
| `pipeline/src/podcast_pipeline/config.ts` | Add `COACHMARK_AUDIO_DIR` constant |
| `pipeline/src/server.ts` | Mount `/api/cron/expansion-prompts` route; setInterval kicks off the scan hourly |
| `mobile/app/player/[id].tsx` | Hide `<DiveBar />` (one-line render conditional or remove import) |
| `mobile/app/(tabs)/account.tsx` | Hide Deep Dive section (one-line render conditional) |

### Test files

| Path | What changes |
|---|---|
| `pipeline/tests/audioProducer.test.ts` | New tests: coach-mark conditional appendage; encoding contract verification (file exists + is valid mp3) |
| `pipeline/tests/expansionPromptsScan.test.ts` | New: eligibility query, chapter selection (skip-back signal vs research density), CAS atomicity, DeviceNotRegistered handling, chapter count < 3 skip |
| `pipeline/tests/integration/cronExpansionPrompts.test.ts` | New: endpoint integration |

---

## Chunk 1: Coach-mark assets

### Task 1: Build the audio-generation script

**Files:**
- Create: `pipeline/scripts/build-coachmark-audio.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * One-time build script. Generates a ~10-second coach-mark MP3 per Gemini
 * voice. Normalizes loudness to roughly match Gemini's TTS output so the
 * final libmp3lame re-encode at concat doesn't produce an audible level
 * shift at the join.
 *
 * Run via: cd pipeline && npx tsx scripts/build-coachmark-audio.ts
 * Output:  pipeline/coachmark_audio/coachmark_expand_<voice>.mp3 × 4
 *
 * The output files are checked into the repo (small, deterministic per
 * voice + script text). Re-run only when the coach-mark copy changes.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const COACHMARK_TEXT =
  "One more thing — those chapter markers you see? Tap any of them and I'll spin it into its own deeper episode. Just for the bits that grabbed you.";

const VOICES = ["Sulafat", "Charon", "Sadaltager", "Achird"] as const;
const OUTPUT_DIR = join(import.meta.dirname ?? __dirname, "..", "coachmark_audio");
const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";

async function generateOne(voice: string): Promise<void> {
  const outPath = join(OUTPUT_DIR, `coachmark_expand_${voice}.mp3`);

  console.log(`[build-coachmark] generating ${voice} → ${outPath}`);

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const response = await client.models.generateContent({
    model: GEMINI_TTS_MODEL,
    contents: COACHMARK_TEXT,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  } as any);

  const inlineData =
    ((response as any).candidates?.[0]?.content?.parts ?? []).find(
      (p: any) => p.inlineData?.data,
    )?.inlineData;

  if (!inlineData?.data) {
    throw new Error(`Gemini TTS returned no audio for voice ${voice}`);
  }

  const pcmBytes = Buffer.from(inlineData.data, "base64");
  const tmpPcm = join(OUTPUT_DIR, `.tmp_${voice}.pcm`);
  const tmpUnnormMp3 = join(OUTPUT_DIR, `.tmp_${voice}_unnorm.mp3`);

  writeFileSync(tmpPcm, pcmBytes);

  // 1. PCM → unnormalized MP3, same encoding as ttsGemini.ts so concat re-encode
  //    doesn't mismatch:
  //    -f s16le -ar 24000 -ac 1 -codec:a libmp3lame -qscale:a 2
  execSync(
    `ffmpeg -f s16le -ar 24000 -ac 1 -i "${tmpPcm}" -codec:a libmp3lame -qscale:a 2 "${tmpUnnormMp3}" -y`,
    { stdio: "pipe" },
  );

  // 2. Apply loudnorm to match Gemini's typical output level.
  //    Target: -16 LUFS integrated, true peak -1.5 dBTP, LRA 11.
  //    These match podcast-loudness norms and Gemini's typical output range.
  execSync(
    `ffmpeg -i "${tmpUnnormMp3}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -codec:a libmp3lame -qscale:a 2 "${outPath}" -y`,
    { stdio: "pipe" },
  );

  // 3. Cleanup temp files
  execSync(`rm "${tmpPcm}" "${tmpUnnormMp3}"`);

  console.log(`[build-coachmark] done: ${outPath}`);
}

async function main(): Promise<void> {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set — load it via .env");
  }
  for (const voice of VOICES) {
    await generateOne(voice);
  }
  console.log("[build-coachmark] all voices done");
}

main().catch((err) => {
  console.error("[build-coachmark] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsx scripts/build-coachmark-audio.ts
```

Expected: 4 MP3 files in `pipeline/coachmark_audio/`. Each ~10 sec, file size ~100KB.

- [ ] **Step 3: Verify audio**

```bash
ls -la pipeline/coachmark_audio/
ffprobe pipeline/coachmark_audio/coachmark_expand_Sulafat.mp3 2>&1 | grep -E "Duration|Audio:"
```

Expected: ~10-12 sec duration, "Audio: mp3, 24000 Hz, mono".

Manually listen to one of the files. Confirm:
- The script text is correctly spoken
- Audio is in the right voice
- Loudness is similar to a normal Gemini TTS output

- [ ] **Step 4: Commit assets + script**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/scripts/build-coachmark-audio.ts pipeline/coachmark_audio/ && git commit -m "$(cat <<'EOF'
audio: coach-mark per-voice MP3s + build script

Generates one ~10-second coach-mark MP3 per Gemini voice
(Sulafat/Charon/Sadaltager/Achird) explaining the expand-chapter feature.
Encoding pinned to match ttsGemini's per-chunk format (s16le 24kHz mono
→ libmp3lame qscale=2) so the audioProducer concat re-encode doesn't
produce audible joins.

loudnorm pass targets I=-16 LUFS, TP=-1.5, LRA=11 — podcast-loudness norms
that roughly match Gemini's typical TTS output level.

Files committed because they're small (<100KB each) and deterministic per
voice + script text. Re-run the script only when the coach-mark copy changes.
EOF
)"
```

---

## Chunk 2: audioProducer — append coach-mark

### Task 2: Conditional append in stitchAudio

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Add `COACHMARK_AUDIO_DIR` constant to config.ts**

```ts
export const COACHMARK_AUDIO_DIR =
  process.env.COACHMARK_AUDIO_DIR ?? "coachmark_audio";
```

(Path is relative to the pipeline process working directory in production. Override via env if needed.)

- [ ] **Step 2: Import + use in audioProducer**

In `audioProducer.ts`:

```ts
import {
  AD_PRE_ROLL_MARKER,
  AD_MID_ROLL_MARKER,
  COACHMARK_AUDIO_DIR, // NEW
  MAX_CHUNK_WPM,
  // …existing imports…
} from "../config.js";
```

In `stitchAudio`, after the existing parallel-synthesis loop completes and the `partFiles[]` array is being assembled (after the for-loop that interleaves ads + text parts but BEFORE the `if (partFiles.length === 0)` early-return), check whether to append the coach-mark:

```ts
// Coach-mark: only on parent podcasts where the user hasn't yet used expand.
// Pre-recorded asset, sits OUTSIDE the chunked-TTS validation path (no WPM
// check, no retry — it's a static file). Matches the live-chunk encoding
// (libmp3lame qscale=2, 24kHz mono) so the final concat re-encode produces
// a clean join.
if (showCoachMark && voiceForCoachMark) {
  const coachmarkPath = join(COACHMARK_AUDIO_DIR, `coachmark_expand_${voiceForCoachMark}.mp3`);
  try {
    readFileSync(coachmarkPath); // throws if missing
    partFiles.push(coachmarkPath);
  } catch {
    console.warn(`[audioProducer] coach-mark file missing for voice ${voiceForCoachMark}, skipping`);
  }
}
```

Where `showCoachMark` and `voiceForCoachMark` are derived earlier in the function (at the top of `stitchAudio`):

Actually, the coach-mark decision lives at the *audioProducer* level, not `stitchAudio` (which is a leaf concern). Move the wiring into the `audioProducer` orchestrator:

In the `audioProducer` function, pass two new args into `stitchAudio`:

```ts
const showCoachMark = !state.parentPodcastId && !state.hasUsedExpand;
const voiceForCoachMark = showCoachMark ? (state.voice ?? "Sulafat") : null;

const { audioBytes, durationSeconds } = await stitchAudio(
  segments,
  tts,
  state.voice,
  { coachmarkVoice: voiceForCoachMark }, // NEW arg
);
```

And update `stitchAudio` signature:

```ts
export async function stitchAudio(
  segments: ScriptSegment[],
  tts: TTSProvider,
  voice?: string | null,
  options?: { coachmarkVoice?: string | null },
): Promise<{ audioBytes: Buffer; durationSeconds: number }> {
  // …existing body…

  // Append coach-mark if requested (just before the empty-list early-return)
  if (options?.coachmarkVoice && partFiles.length > 0) {
    const coachmarkPath = join(COACHMARK_AUDIO_DIR, `coachmark_expand_${options.coachmarkVoice}.mp3`);
    try {
      readFileSync(coachmarkPath);
      partFiles.push(coachmarkPath);
    } catch {
      console.warn(`[audioProducer] coach-mark missing for ${options.coachmarkVoice}, skipping`);
    }
  }

  // …rest of stitchAudio (concat + ffprobe) unchanged…
}
```

- [ ] **Step 3: Add tests**

Append to `pipeline/tests/audioProducer.test.ts`:

```ts
describe("stitchAudio coach-mark appendage", () => {
  it("appends coach-mark when options.coachmarkVoice is set", async () => {
    execSyncMock.mockReset();
    // Mock the concat-time ffmpeg + ffprobe duration
    execSyncMock.mockReturnValueOnce(Buffer.from(""));
    execSyncMock.mockReturnValueOnce("60.0");

    // Override fs mock to allow the coach-mark path to "exist"
    const realFs = await import("node:fs");
    const readFileSpy = vi.spyOn(realFs, "readFileSync").mockImplementation((path: any) => {
      if (String(path).includes("coachmark_expand_")) return Buffer.from("coachmark-bytes");
      if (String(path).endsWith("output.mp3")) return Buffer.from("fake-concat-output");
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };
    const segments = [{ type: "text" as const, content: "Hello" }];

    await stitchAudio(segments, tts, "Sulafat", { coachmarkVoice: "Sulafat" });

    // Inspect the writeFileSync call for the concat list — should include the coach-mark path
    const listFileWrites = (await import("node:fs")).writeFileSync as any;
    const listCall = listFileWrites.mock.calls.find((c: any) => String(c[1]).includes("coachmark_expand_Sulafat"));
    expect(listCall).toBeDefined();

    readFileSpy.mockRestore();
  });

  it("does NOT append coach-mark when options.coachmarkVoice is null", async () => {
    execSyncMock.mockReset();
    execSyncMock.mockReturnValueOnce(Buffer.from(""));
    execSyncMock.mockReturnValueOnce("60.0");

    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };
    const segments = [{ type: "text" as const, content: "Hello" }];

    await stitchAudio(segments, tts, "Sulafat", { coachmarkVoice: null });

    const writes = (await import("node:fs")).writeFileSync as any;
    const listCall = writes.mock.calls.find((c: any) =>
      String(c[1]).includes("coachmark_expand_"),
    );
    expect(listCall).toBeUndefined();
  });
});

describe("audioProducer coach-mark gating", () => {
  it("sets coachmarkVoice when isParent && !hasUsedExpand", () => {
    // Test the gating logic in audioProducer — `state.parentPodcastId=null,
    // state.hasUsedExpand=false` → passes options.coachmarkVoice = state.voice
    // (or "Sulafat" default).
    // Spy on stitchAudio. Mock supabase storage. Assert the call args.
  });
  // …similar tests for the negative cases (hasUsedExpand=true, parentPodcastId set)…
});
```

- [ ] **Step 4: Type-check + run tests + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/audioProducer.test.ts 2>&1 | tail -15 && git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/audioProducer.ts pipeline/tests/audioProducer.test.ts && git commit -m "feat(audio): audioProducer appends coach-mark on first-time parent generations"
```

---

## Chunk 3: Expansion prompts scan logic

### Task 3: Eligibility query + chapter selection + push delivery

**Files:**
- Create: `pipeline/src/jobs/expansionPromptsScan.ts`
- Create: `pipeline/tests/expansionPromptsScan.test.ts`

- [ ] **Step 1: Write the scan module**

```ts
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
      research_contexts ( research_document ),
      profiles ( expo_push_token, has_used_expand )
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

  let sent = 0;
  let skipped = 0;

  for (const row of candidates) {
    const profile = Array.isArray((row as any).profiles)
      ? (row as any).profiles[0]
      : (row as any).profiles;
    if (!profile?.expo_push_token || profile.has_used_expand) {
      skipped++;
      continue;
    }
    // Check no existing expansion (the eligibility query above didn't gate this;
    // a separate query is simpler than NOT EXISTS in supabase-js)
    const { count: expansionCount } = await supabase
      .from("podcasts")
      .select("id", { count: "exact", head: true })
      .eq("parent_podcast_id", row.id)
      .is("deleted_at", null);
    if (expansionCount && expansionCount > 0) {
      skipped++;
      continue;
    }

    const researchDoc = Array.isArray((row as any).research_contexts)
      ? (row as any).research_contexts[0]?.research_document
      : (row as any).research_contexts?.research_document;

    const eligible: EligiblePodcast = {
      id: row.id,
      user_id: row.user_id,
      topic: row.topic,
      chapter_markers: row.chapter_markers ?? [],
      research_document: researchDoc ?? {},
      expo_push_token: profile.expo_push_token,
    };

    const pick = await pickChapter(supabase, eligible);
    if (pick === null) {
      skipped++;
      continue; // < 3 chapters or no good candidate
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
      // Someone else got there first; don't push
      skipped++;
      continue;
    }

    // Now fire the push
    const result = await sendExpansionPush(eligible, pick);
    if (result.status === "device_not_registered") {
      // Null out token so we stop trying for this user until re-register
      await supabase
        .from("profiles")
        .update({ expo_push_token: null })
        .eq("id", row.user_id);
    }
    sent++;
  }

  return { sent, skipped };
}

async function pickChapter(
  supabase: any,
  eligible: EligiblePodcast,
): Promise<{ index: number; title: string } | null> {
  // Precondition: must have ≥3 chapters to carve out a meaningful middle
  if (eligible.chapter_markers.length < MIN_CHAPTERS_FOR_PUSH) return null;

  // 1. Engagement signal — skip-back events per chapter (middle chapters only)
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

  // 2. Research density fallback
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

function chapterIndexForTimestamp(ts: number, markers: ChapterMarker[]): number {
  // Linear scan; small N. Returns the index of the chapter that contains ts.
  for (let i = markers.length - 1; i >= 0; i--) {
    if (ts >= markers[i].timestampSeconds) return i;
  }
  return 0;
}

async function sendExpansionPush(
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
```

- [ ] **Step 2: Write tests**

Create `pipeline/tests/expansionPromptsScan.test.ts`. Mock Supabase + fetch, exercise:

- Eligibility query filters: status=complete, not soft-deleted, parent_podcast_id null, no existing expansions, user has push token, has_used_expand=false, created_at > 2 days
- Chapter selection: skip-back engagement winner (≥2 events) vs research density fallback vs < 3 chapter skip
- CAS atomicity: if `update().is("expansion_prompt_sent_at", null)` returns no row, skip
- DeviceNotRegistered → token nulled
- Skipped counts increment correctly

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockCreateClient = vi.fn(() => ({ from: mockFrom }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.EXPO_ACCESS_TOKEN = "expo-token";
});

describe("runExpansionPromptsScan", () => {
  it("skips podcasts with fewer than 3 chapters", async () => {
    // …mock candidates with chapter_markers.length === 2…
    // …assert sent=0, skipped=1, no push…
  });

  it("picks the chapter with ≥2 skip-back events (engagement winner)", async () => {
    // …mock candidates with 5 chapters, playback_events showing 3 skip-backs in chapter 2…
    // …assert push payload contains chapter 2 title + deep-link expand=2…
  });

  it("falls back to research density when engagement signal is below threshold", async () => {
    // …mock candidates with 1 skip-back event (below threshold) and chapterResearchMap with chapter 3 densest…
    // …assert push payload contains chapter 3 title…
  });

  it("CAS-stamps before push; if stamp returns no row, push is not sent", async () => {
    // …mock update returning {data: null} (race lost)…
    // …assert fetch not called, sent counter stays 0…
  });

  it("nulls expo_push_token on DeviceNotRegistered response", async () => {
    // …mock fetch returning {data: {details: {error: "DeviceNotRegistered"}}}…
    // …assert profiles update sets expo_push_token to null…
  });

  it("skips podcasts with has_used_expand=true", async () => {
    // …mock profiles with has_used_expand=true…
    // …assert skipped+=1, push not sent…
  });
});
```

The mock setup is involved (multiple chained `.from().select().eq()…` calls). Mirror the supabase-mock pattern used in other pipeline tests.

- [ ] **Step 3: Type-check + run tests + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/expansionPromptsScan.test.ts 2>&1 | tail -10 && git add pipeline/src/jobs/expansionPromptsScan.ts pipeline/tests/expansionPromptsScan.test.ts && git commit -m "feat(jobs): expansionPromptsScan — eligibility + chapter selection + CAS-stamped push"
```

---

## Chunk 4: Cron endpoint + setInterval

### Task 4: Internal endpoint to invoke the scan

**Files:**
- Create: `pipeline/src/routes/cronExpansionPrompts.ts`
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Write the route**

```ts
/**
 * POST /api/cron/expansion-prompts
 *
 * Internal endpoint to invoke the expansion-prompts scan. Used for:
 *   - Manual testing (curl with PIPELINE_CALLBACK_SECRET)
 *   - Future pg_cron migration target (when we scale beyond 1 Railway instance)
 *
 * Auth: internalAuth middleware (PIPELINE_CALLBACK_SECRET)
 */
import { Hono } from "hono";
import { internalAuth } from "../middleware/auth.js";
import { runExpansionPromptsScan } from "../jobs/expansionPromptsScan.js";

const route = new Hono();

route.post("/", internalAuth, async (c) => {
  try {
    const result = await runExpansionPromptsScan();
    return c.json(result);
  } catch (err) {
    console.error("[cron-expansion-prompts] scan failed:", err);
    return c.json({ error: "Scan failed" }, 500);
  }
});

export { route as cronExpansionPromptsRoute };
```

- [ ] **Step 2: Mount the route in `server.ts`**

```ts
import { cronExpansionPromptsRoute } from "./routes/cronExpansionPrompts.js";
// …after other route mounts:
app.route("/api/cron/expansion-prompts", cronExpansionPromptsRoute);
```

- [ ] **Step 3: Wire setInterval in `server.ts`**

After the server starts listening, kick off the hourly scan:

```ts
import { runExpansionPromptsScan } from "./jobs/expansionPromptsScan.js";

const HOUR_MS = 60 * 60 * 1000;
setInterval(async () => {
  try {
    const result = await runExpansionPromptsScan();
    if (result.sent > 0 || result.skipped > 0) {
      console.log(`[expansion-prompts cron] sent=${result.sent} skipped=${result.skipped}`);
    }
  } catch (err) {
    console.error("[expansion-prompts cron] failed:", err);
  }
}, HOUR_MS);
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add pipeline/src/routes/cronExpansionPrompts.ts pipeline/src/server.ts && git commit -m "feat(cron): expansion-prompts hourly setInterval + internal-auth endpoint"
```

### Task 5: Integration test for the endpoint

**Files:**
- Create: `pipeline/tests/integration/cronExpansionPrompts.test.ts`

- [ ] **Step 1: Test the endpoint**

```ts
import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.PIPELINE_CALLBACK_SECRET;

describe("POST /api/cron/expansion-prompts", () => {
  it("returns 401 without internal auth header", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/expansion-prompts`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid internal auth", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/expansion-prompts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.sent).toBe("number");
    expect(typeof json.skipped).toBe("number");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/integration/cronExpansionPrompts.test.ts 2>&1 | tail -10 && git add pipeline/tests/integration/cronExpansionPrompts.test.ts && git commit -m "test(integration): cron expansion-prompts endpoint"
```

---

## Chunk 5: Deep Dive UI sunset

### Task 6: Hide DiveBar from the player

**Files:**
- Modify: `mobile/app/player/[id].tsx`

- [ ] **Step 1: Comment out the DiveBar render**

Find the `<DiveBar />` (or `<DiveBar ... />`) in the JSX. Wrap in a feature-flag-style false conditional, with a comment explaining:

```tsx
{/* Deep Dive UI sunset — feature replaced by chapter expansions (v15-v17).
    Component file + route + hook + ElevenLabs deps all preserved in the
    codebase for future revival. To re-enable: change `false` to `true`
    (or remove the conditional entirely). See spec at
    docs/superpowers/specs/2026-05-12-chapter-expansions-design.md. */}
{false && <DiveBar /* …existing props… */ />}
```

This keeps the import in place — TypeScript doesn't complain about an unused-then-removed import — and reverting is one character.

- [ ] **Step 2: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5 && git add mobile/app/player/\[id\].tsx && git commit -m "ui(mobile): hide DiveBar from player (Deep Dive sunset)"
```

### Task 7: Hide Deep Dive section from account screen

**Files:**
- Modify: `mobile/app/(tabs)/account.tsx`

- [ ] **Step 1: Hide the "Deep Dive" Section block**

Find the section that renders Deep Dive minutes. Wrap in the same `{false && (` pattern:

```tsx
{/* Deep Dive UI sunset — minutes-remaining display hidden. Underlying
    subscription columns (deep_dive_minutes_*) and RC webhook deep-dive
    minute allocation logic remain in place for future revival. */}
{false && hasDeepDive && subscription && (
  <Section eyebrow="Deep Dive">
    {/* …existing render… */}
  </Section>
)}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/app/\(tabs\)/account.tsx && git commit -m "ui(mobile): hide Deep Dive section from account screen (sunset)"
```

---

## Chunk 6: End-to-end smoke test

### Task 8: Verify coach-mark + push delivery

**Files:** none modified.

- [ ] **Step 1: Coach-mark on first parent**

Sign in as a fresh test user (`profile.has_used_expand=false`). Generate a parent podcast. After completion, listen to the very end of the audio — the coach-mark should play after the closing chapter:

> "One more thing — those chapter markers you see? Tap any of them and I'll spin it into its own deeper episode. Just for the bits that grabbed you."

In the user's chosen voice.

- [ ] **Step 2: Coach-mark NOT on expansion**

Expand a chapter of that podcast. Listen to the end of the expansion. Coach-mark must NOT play (expansion is not a parent).

- [ ] **Step 3: Coach-mark NOT on second parent after expanding**

Verify in DB:

```sql
SELECT has_used_expand FROM profiles WHERE id = '<user>';
```

Expected: `true`. Generate another new podcast. Listen to the end — coach-mark must NOT play.

- [ ] **Step 4: Push delivery — manually trigger the scan**

For a podcast that's been complete for >2 days with no expansion, fire the cron endpoint:

```bash
curl -X POST "https://podcasts-production-3b07.up.railway.app/api/cron/expansion-prompts" \
  -H "Authorization: Bearer $PIPELINE_CALLBACK_SECRET"
```

Expected: `{ sent: N, skipped: M }`.

Verify push arrived on a test device. Tap it → app opens, player loads, ExpandActionSheet auto-opens on the suggested chapter.

- [ ] **Step 5: Idempotency — fire again**

```bash
curl -X POST "..." -H "Authorization: Bearer $PIPELINE_CALLBACK_SECRET"
```

Expected: `{ sent: 0, ... }`. The previously-pushed podcast now has `expansion_prompt_sent_at` set, ineligible.

- [ ] **Step 6: Chapter selection — verify engagement signal wins**

For a parent podcast eligible for push, manually insert 3 skip-back events on chapter 2:

```sql
INSERT INTO playback_events (user_id, podcast_id, event_type, timestamp_seconds)
SELECT user_id, id, 'skip_back', 120 FROM podcasts WHERE id = '<parent_id>';
-- (Run 3 times or use INSERT … VALUES with 3 rows. Adjust timestamp_seconds to fall within chapter 2's range.)
```

Reset the podcast's prompt state:

```sql
UPDATE podcasts SET expansion_prompt_sent_at = NULL WHERE id = '<parent_id>';
```

Trigger scan. Verify the push deep-link references chapter 2, not the research-density winner.

- [ ] **Step 7: Verify Deep Dive UI is gone**

Open player on iPhone — no DiveBar visible. Open Account screen — no Deep Dive section visible.

---

## What ships at the end of v17

- First-time users hear the coach-mark on their parent podcast's outro until they expand any chapter
- Re-engagement push fires 2 days after parent generation for users who haven't expanded yet
- Chapter selection prefers playback-engagement signal, falls back to research density
- Deep Dive UI surface is hidden; underlying code/schema/deps intact

## Phase exit criteria

- `npx vitest run` in pipeline: all green
- `npx tsc --noEmit` in pipeline + mobile: both clean
- Coach-mark audio files committed (`pipeline/coachmark_audio/coachmark_expand_*.mp3` × 4)
- Smoke test (Chunk 6) passes end-to-end
- Push notification deep-link successfully opens ExpandActionSheet on the suggested chapter
- Engagement signal correctly outweighs research density when skip-back events present
- Deep Dive entry points (DiveBar in player, Deep Dive section in account) not visible

## Post-v17: the full feature is live

After v17 ships:
- Parents stay unchanged in shape
- Expansion is the new paid-tier wedge
- Recursion works (expand a chapter of an expansion)
- Free users have two-path bottom sheet (buy credit OR upgrade)
- Coach-mark explains the feature to first-time users
- Push notifications drive return engagement
- Deep Dive is dormant in code, invisible in UI

The roadmap doc `docs/roadmap/gemini-live-deep-dive-migration.md` covers the future Deep Dive revival via Gemini Live API when the trigger conditions hit. Not part of v17.
