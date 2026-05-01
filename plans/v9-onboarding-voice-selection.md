# v9 — Onboarding + Voice Selection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 3-screen post-signup onboarding (Welcome → Voice picker → First podcast), persist the user's voice choice, thread it through the audio pipeline, add an Account → Voice editor, and bump the free tier from 1 to 2 podcasts/month.

**Architecture:** Onboarding gate is `profiles.preferred_voice IS NOT NULL`. Voice is snapshotted onto each `podcasts` row at submit time so changing voice later doesn't retro-affect past episodes. Voice samples are pre-rendered mp3s bundled with the app. Push permission is asked contextually after first generation, not in onboarding.

**Tech Stack:** Supabase Postgres + Realtime, Hono + LangGraph.js pipeline, OpenAI gpt-4o-mini-tts, React Native + Expo Router + expo-av, vitest for server tests.

**Spec:** `docs/superpowers/specs/2026-05-01-onboarding-voice-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/00012_voice_selection.sql` | Adds `profiles.preferred_voice` + `podcasts.voice` columns; adds `profiles` to realtime publication. |
| Create | `supabase/migrations/00013_free_tier_credit_bump.sql` | Updates `handle_new_user()` to give 2 credits + backfills existing free-tier subscriptions. |
| Modify | `pipeline/src/podcast_pipeline/state.ts` | Adds `voice: string \| null` to PipelineState. |
| Modify | `pipeline/src/routes/submitPodcast.ts` | Reads `profiles.preferred_voice`, snapshots into `podcasts.voice`, passes through to job manager. |
| Modify | `pipeline/src/podcast_pipeline/nodes/audioProducer.ts` | Threads `state.voice` through to `tts.synthesize()`. |
| Modify | `pipeline/src/routes/revenuecatWebhook.ts` | EXPIRATION case bumps from 1 → 2 credits. |
| Create | `pipeline/scripts/build-voice-samples.ts` | Renders self-introducing samples for all 4 voices into `mobile/assets/voice-samples/`. |
| Create | `mobile/assets/voice-samples/{coral,sage,ash,ballad}.mp3` | Built artifacts, committed. |
| Modify | `mobile/src/types/database.ts` | Regen via Supabase MCP — adds `preferred_voice` and `voice` columns. |
| Create | `mobile/src/hooks/useProfile.ts` | Selects + caches profile, exposes `preferredVoice` + setter. |
| Create | `mobile/src/lib/voiceSamples.ts` | Voice metadata + sample mp3 `require()`s. |
| Create | `mobile/src/lib/podcastPlaceholders.ts` | Curated rotation list for first-podcast screen. |
| Create | `mobile/src/components/VoicePicker.tsx` | Reusable component used by onboarding + settings. |
| Create | `mobile/app/(onboarding)/_layout.tsx` | Stack layout, no tab bar. |
| Create | `mobile/app/(onboarding)/welcome.tsx` | Screen 1 — auto-advance on tap. |
| Create | `mobile/app/(onboarding)/voice.tsx` | Screen 2 — uses VoicePicker, writes preferred_voice. |
| Create | `mobile/app/(onboarding)/first-podcast.tsx` | Screen 3 — placeholder topic + Generate flow. |
| Modify | `mobile/app/_layout.tsx` | Routing decision tree (auth → onboarding → tabs). |
| Create | `mobile/app/voice-settings.tsx` | Account → Voice picker (with "future podcasts only" copy). |
| Modify | `mobile/app/(tabs)/account.tsx` | Adds "Voice" row → links to voice-settings. |
| Modify | `mobile/app/(tabs)/generate.tsx` | Updated post-Generate alert copy + push permission ask. |

---

## Chunk 1: Database

### Task 1: Migration 00012 — voice columns + realtime publication

**Files:**
- Create: `supabase/migrations/00012_voice_selection.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00012_voice_selection.sql`:

```sql
-- 00012_voice_selection.sql
-- Per-user voice preference (set during onboarding) + per-podcast voice snapshot
-- (so changes to preferred_voice never retro-affect past episodes).

ALTER TABLE public.profiles
  ADD COLUMN preferred_voice text;

COMMENT ON COLUMN public.profiles.preferred_voice IS
  'Voice ID (coral|sage|ash|ballad) the user picked during onboarding. NULL means onboarding has not been completed.';

ALTER TABLE public.podcasts
  ADD COLUMN voice text;

COMMENT ON COLUMN public.podcasts.voice IS
  'Voice this podcast was rendered with. Snapshot from profiles.preferred_voice at submit-podcast time. NULL on legacy rows = pipeline default (TTS_VOICE).';

-- Add profiles to the realtime publication so cross-device voice changes
-- propagate via the existing useProfile subscription pattern.
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `voice_selection` and the SQL body above (everything after the `-- 00012` comment).

- [ ] **Step 3: Verify columns exist**

Use `mcp__supabase__execute_sql` to run:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'podcasts')
  AND column_name IN ('preferred_voice', 'voice');
```

Expected: 2 rows, both `text`, both nullable (`YES`).

- [ ] **Step 4: Verify realtime publication**

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Expected: includes `profiles`, `podcasts`, `subscriptions`.

- [ ] **Step 5: Check security advisors**

Use `mcp__supabase__get_advisors` with `type: "security"`. Expected: no new warnings introduced. (Existing unrelated warnings like `auth_leaked_password_protection` are fine — not introduced by this migration.)

- [ ] **Step 6: Commit the SQL file**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add supabase/migrations/00012_voice_selection.sql && git commit -m "$(cat <<'EOF'
feat(db): add voice columns + profiles realtime

profiles.preferred_voice gates the new onboarding flow (NULL = needs to
onboard). podcasts.voice is a snapshot at submit-podcast time so changing
preferred_voice later doesn't retro-affect past episodes.

profiles added to supabase_realtime publication so cross-device voice
changes propagate via the existing useProfile subscription pattern.
EOF
)"
```

---

### Task 2: Migration 00013 — free tier credit bump

**Files:**
- Create: `supabase/migrations/00013_free_tier_credit_bump.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00013_free_tier_credit_bump.sql`:

```sql
-- 00013_free_tier_credit_bump.sql
-- Free tier monthly allowance: 1 -> 2 podcasts. Updates the signup trigger
-- and backfills existing free-tier subscriptions (conservatively — only
-- bump users who haven't used their old allotment yet).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.subscriptions (user_id, tier, status, credits_per_month, credits_remaining)
  VALUES (NEW.id, 'free', 'active', 2, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Backfill: existing free-tier subscriptions get credits_per_month bumped to 2.
-- credits_remaining is bumped by 1 only if the user hasn't burned this month's
-- old credit (currently_remaining > 0). Users at 0 stay at 0 — they used the
-- old allotment, they get the new one at next renewal.
UPDATE public.subscriptions
SET credits_per_month = 2,
    credits_remaining = LEAST(2, credits_remaining + 1)
WHERE tier = 'free' AND status = 'active';
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `free_tier_credit_bump`.

- [ ] **Step 3: Verify trigger function definition**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace;
```

Expected: function body includes `credits_per_month, credits_remaining) VALUES (NEW.id, 'free', 'active', 2, 2)`.

- [ ] **Step 4: Verify backfill**

```sql
SELECT tier, credits_per_month, credits_remaining, COUNT(*)
FROM public.subscriptions
GROUP BY tier, credits_per_month, credits_remaining
ORDER BY tier;
```

Expected: any free-tier rows show `credits_per_month = 2`. Users previously at 1 are now at 2; users previously at 0 are still at 0.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add supabase/migrations/00013_free_tier_credit_bump.sql && git commit -m "$(cat <<'EOF'
feat(db): bump free tier monthly podcasts 1 -> 2

Doubles free value with a one-line trigger update. Backfills existing
free-tier users conservatively: anyone at 1 (unused this month) goes to
2; anyone at 0 (already burned the old credit) stays at 0 and gets the
new tier at next renewal.
EOF
)"
```

---

### Task 3: Regenerate mobile database types

**Files:**
- Modify: `mobile/src/types/database.ts`
- Modify: `pipeline/src/routes/revenuecatWebhook.ts`

- [ ] **Step 1: Regenerate types via Supabase MCP**

Use `mcp__supabase__generate_typescript_types`. Capture the output and overwrite `mobile/src/types/database.ts` with it.

- [ ] **Step 2: Verify the new columns appear**

```bash
grep -E "preferred_voice|voice:" "/Users/isuru/personal/AI Podcast App/mobile/src/types/database.ts" | head
```

Expected: `preferred_voice: string | null` (in profiles) and `voice: string | null` (in podcasts).

- [ ] **Step 3: Update RevenueCat EXPIRATION handler**

In `pipeline/src/routes/revenuecatWebhook.ts`, find the `EXPIRATION` case. Currently it sets free tier to:

```ts
credits_per_month: 1,
credits_remaining: 1,
```

Change both to `2`:

```ts
credits_per_month: 2,
credits_remaining: 2,
```

- [ ] **Step 4: Build + run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm run build && npm test 2>&1 | tail -8
```

Expected: clean build, all tests pass. (No test currently asserts on the EXPIRATION values; if a future test does, update it to match.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/types/database.ts pipeline/src/routes/revenuecatWebhook.ts && git commit -m "$(cat <<'EOF'
chore: regen mobile DB types + bump RevenueCat free tier expiration credits

Mobile types regenerated from Supabase to pick up profiles.preferred_voice
and podcasts.voice (added in 00012). RevenueCat webhook EXPIRATION case
now mirrors the new free-tier allowance (2 credits) instead of the old
hardcoded 1.
EOF
)"
```

---

## Chunk 2: Server pipeline — thread voice through

### Task 4: Add `voice` to PipelineState + thread through audioProducer

**Files:**
- Modify: `pipeline/src/podcast_pipeline/state.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`
- Test: `pipeline/tests/audioProducer.test.ts`

- [ ] **Step 1: Write a failing test that asserts voice flows to TTS**

Add this test to `pipeline/tests/audioProducer.test.ts`. The existing file already mocks `OpenAITTS`; add a new test that captures the `voiceName` argument:

```ts
it("threads state.voice through to tts.synthesize", async () => {
  const synthesizeSpy = vi.fn().mockResolvedValue(Buffer.from("mp3"));
  const tts = { synthesize: synthesizeSpy };

  // Use the exported stitchAudio with the new voice argument
  const segments = [{ type: "text" as const, content: "Hello." }];
  await stitchAudio(segments, tts, "ballad");

  expect(synthesizeSpy).toHaveBeenCalledWith("Hello.", "ballad");
});

it("passes undefined voice when state.voice is null", async () => {
  const synthesizeSpy = vi.fn().mockResolvedValue(Buffer.from("mp3"));
  const tts = { synthesize: synthesizeSpy };

  const segments = [{ type: "text" as const, content: "Hello." }];
  await stitchAudio(segments, tts, null);

  expect(synthesizeSpy).toHaveBeenCalledWith("Hello.", undefined);
});
```

(If `stitchAudio` isn't currently exported from `audioProducer.ts`, export it as part of Step 2.)

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/audioProducer.test.ts 2>&1 | tail -15
```

Expected: 2 new tests fail (TypeError because `stitchAudio` doesn't accept a 3rd arg yet, or the wrong arg is passed to synthesize).

- [ ] **Step 3: Add `voice` to PipelineState**

In `pipeline/src/podcast_pipeline/state.ts`:

Find the Annotation.Root block. After the existing fields (e.g. after `sources: Annotation<...>`), add:

```ts
voice: Annotation<string | null>,
```

In `makeInitialState`, add to the defaults object:

```ts
voice: null,
```

- [ ] **Step 4: Update audioProducer to pass voice through**

In `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`:

Update `stitchAudio` signature:

```ts
export async function stitchAudio(
  segments: ScriptSegment[],
  tts: TTSProvider,
  voice?: string | null,
): Promise<{ audioBytes: Buffer; durationSeconds: number }> {
```

Inside the loop, change:

```ts
const audioBytes = await tts.synthesize(segment.content);
```

to:

```ts
const audioBytes = await tts.synthesize(segment.content, voice ?? undefined);
```

In the `audioProducer` function (the node), update the call:

```ts
const { audioBytes, durationSeconds } = await stitchAudio(segments, tts, state.voice);
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm test 2>&1 | tail -8
```

Expected: all tests pass (66 total — was 64, +2 new).

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/state.ts pipeline/src/podcast_pipeline/nodes/audioProducer.ts pipeline/tests/audioProducer.test.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): thread voice through state -> audioProducer -> TTS

PipelineState gets a voice: string | null field. audioProducer's
stitchAudio passes it to tts.synthesize, which already falls back to
TTS_VOICE when undefined. Null state means "use the configured default"
— correct for legacy podcasts and any in-flight rows during migration.
EOF
)"
```

---

### Task 5: Update submitPodcast to read + snapshot voice

**Files:**
- Modify: `pipeline/src/routes/submitPodcast.ts`

- [ ] **Step 1: Read the current submitPodcast.ts to find the insertion points**

```bash
grep -n "subscription\|insert\|enqueue" "/Users/isuru/personal/AI Podcast App/pipeline/src/routes/submitPodcast.ts"
```

Note the line ranges for the subscription select, the podcast insert, and the jobManager.enqueue call.

- [ ] **Step 2: Add the voice read after the subscription check**

After the existing subscription check (where `if (!subscription) return c.json(...)` is), add:

```ts
// Pull preferred voice. Null means use pipeline default (TTS_VOICE).
const { data: profile } = await serviceClient
  .from("profiles")
  .select("preferred_voice")
  .eq("id", user.id)
  .single();
const voice = profile?.preferred_voice ?? null;
```

- [ ] **Step 3: Snapshot voice into the podcast insert**

In the `serviceClient.from("podcasts").insert({...})` call, add `voice` to the inserted object:

```ts
.insert({
  user_id: user.id,
  topic,
  clarifying_answers: clarifyingAnswers || [],
  status: "queued",
  has_ads: hasAds,
  voice,  // <- new
})
```

- [ ] **Step 4: Pass voice into the job manager input**

In the `jobManager.enqueue(podcast.id, { ... })` call, add `voice`:

```ts
jobManager.enqueue(podcast.id, {
  podcastId: podcast.id,
  userId: user.id,
  topic,
  clarifyingAnswers: clarifyingAnswers || [],
  hasAds,
  trustedSourceUrls,
  tier: subscription.tier,
  voice,  // <- new
});
```

- [ ] **Step 5: Build + run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm run build && npm test 2>&1 | tail -8
```

Expected: clean build, all tests pass. (Existing submitPodcast tests don't assert on voice, but they shouldn't fail either.)

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/submitPodcast.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): submit-podcast reads + snapshots voice

submit-podcast pulls profiles.preferred_voice, snapshots it into the
podcasts row (so future voice changes don't retro-affect this episode),
and passes it into the pipeline state for audioProducer.
EOF
)"
```

---

### Task 6: Deploy server changes to Railway

**Files:** none changed.

- [ ] **Step 1: Deploy via Railway MCP**

Use `mcp__Railway__deploy` with `workspacePath: "/Users/isuru/personal/AI Podcast App/pipeline"` and `ci: true`.

Expected: build succeeds (~60-90s), service redeploys.

- [ ] **Step 2: Smoke-check the deploy**

```bash
curl -sS -o /dev/null -w "health=%{http_code}\n" https://podcasts-production-3b07.up.railway.app/health
```

Expected: `health=200`.

- [ ] **Step 3: Sanity-test that submit still works for a user with NULL preferred_voice**

This is a regression check: existing user (Isuru) hasn't gone through onboarding yet, so `preferred_voice` is NULL. Generating a podcast should still succeed and use the configured default (`ballad`).

Submit a quick test podcast through the API (or wait until mobile work is done and test through the app). Verify the resulting `podcasts.voice` is NULL (since profile preference is NULL) and the audio renders with ballad.

```sql
SELECT id, voice FROM public.podcasts ORDER BY created_at DESC LIMIT 1;
```

Expected: most recent row has `voice = NULL` if the submitter has no preferred_voice yet.

---

## Chunk 3: Voice samples

### Task 7: Build voice samples + commit

**Files:**
- Create: `pipeline/scripts/build-voice-samples.ts`
- Create: `mobile/assets/voice-samples/{coral,sage,ash,ballad}.mp3` (4 files)

- [ ] **Step 1: Confirm the assets directory exists**

```bash
ls -d "/Users/isuru/personal/AI Podcast App/mobile/assets/voice-samples" 2>/dev/null && echo "exists" || mkdir -p "/Users/isuru/personal/AI Podcast App/mobile/assets/voice-samples" && echo "created"
```

- [ ] **Step 2: Write the build script**

Create `pipeline/scripts/build-voice-samples.ts`:

```ts
/**
 * Build script: renders the 4 self-introducing voice samples used by
 * the mobile onboarding voice picker. Run on demand when:
 *   - TTS_VOICE_INSTRUCTIONS in config.ts changes
 *   - The sample copy below changes
 *   - We add or remove a voice
 *
 * Output: mobile/assets/voice-samples/{voice}.mp3 (committed)
 *
 * Run: cd pipeline && npx tsx scripts/build-voice-samples.ts
 *
 * Env: OPENAI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { TTS_VOICE_INSTRUCTIONS } from "../src/podcast_pipeline/config.js";

const SAMPLES = [
  {
    voice: "coral",
    script: "I'm Coral. Warm, natural, easy to listen to. Like the friend who explains things over coffee without making you feel small.",
  },
  {
    voice: "sage",
    script: "I'm Sage. Thoughtful, contemplative. I take my time on the parts that matter.",
  },
  {
    voice: "ash",
    script: "I'm Ash. Calm, steady, low-key. I won't oversell anything to you.",
  },
  {
    voice: "ballad",
    script: "I'm Ballad. Expressive, a little theatrical. Good for stories that have shape.",
  },
] as const;

const OUT_DIR = resolve(__dirname, "../../mobile/assets/voice-samples");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const openai = new OpenAI();

  for (const { voice, script } of SAMPLES) {
    console.log(`Rendering ${voice}...`);
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: script,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const buf = Buffer.from(await response.arrayBuffer());
    const path = join(OUT_DIR, `${voice}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. 4 mp3s written to mobile/assets/voice-samples/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Type-check the script**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit scripts/build-voice-samples.ts 2>&1 | tail -5
```

Expected: clean exit. (Same import-extension convention as test-voices.ts — `.js` is required by ESM resolution.)

- [ ] **Step 4: Run the script**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && OPENAI_API_KEY="<key from Railway env>" npx tsx scripts/build-voice-samples.ts
```

Expected output: 4 lines like `-> /Users/isuru/personal/AI Podcast App/mobile/assets/voice-samples/coral.mp3 (NNNNN bytes)`. Total cost: ~$0.05.

- [ ] **Step 5: Verify the mp3s exist + look reasonable**

```bash
ls -la "/Users/isuru/personal/AI Podcast App/mobile/assets/voice-samples/"
```

Expected: 4 mp3 files, each between 30-100 KB.

Spot-check by playing one:

```bash
open "/Users/isuru/personal/AI Podcast App/mobile/assets/voice-samples/ballad.mp3"
```

Should hear "I'm Ballad. Expressive, a little theatrical..." in the voice you'd expect.

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/scripts/build-voice-samples.ts mobile/assets/voice-samples/ && git commit -m "$(cat <<'EOF'
chore: add voice sample build script + bundle 4 sample mp3s

Each voice introduces itself in its own ~5-sec sample, rendered through
gpt-4o-mini-tts with the current TTS_VOICE_INSTRUCTIONS. Output committed
to mobile/assets/voice-samples/ for require() at build time.

Re-run pipeline/scripts/build-voice-samples.ts when the sample copy or
TTS_VOICE_INSTRUCTIONS changes.
EOF
)"
```

---

## Chunk 4: Mobile foundation — hooks + libs

### Task 8: Verify expo-av + add useProfile + voice/placeholder libs

**Files:**
- Verify: `mobile/package.json` includes `expo-av`
- Create: `mobile/src/hooks/useProfile.ts`
- Create: `mobile/src/lib/voiceSamples.ts`
- Create: `mobile/src/lib/podcastPlaceholders.ts`

- [ ] **Step 1: Check whether expo-av is installed**

```bash
grep -E '"expo-av"' "/Users/isuru/personal/AI Podcast App/mobile/package.json" || echo "(not installed)"
```

If missing, install:

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && node node_modules/expo/bin/cli install expo-av
```

Note: if this is a new native module, the dev client on the iPhone will need a rebuild via EAS before audio playback works. Surface that immediately as a known followup if it's a new install.

- [ ] **Step 2: Create the voice samples library**

Create `mobile/src/lib/voiceSamples.ts`:

```ts
/**
 * Voice picker metadata + bundled sample audio.
 * Samples are pre-rendered by pipeline/scripts/build-voice-samples.ts.
 * Re-run that script when this metadata or the script copy changes.
 */

export interface VoiceMeta {
  id: string;
  name: string;
  descriptor: string;
  sample: number; // require() module ID
}

export const VOICES: readonly VoiceMeta[] = [
  {
    id: "coral",
    name: "Coral",
    descriptor: "Warm, natural, easy to listen to.",
    sample: require("../../assets/voice-samples/coral.mp3"),
  },
  {
    id: "sage",
    name: "Sage",
    descriptor: "Thoughtful, contemplative.",
    sample: require("../../assets/voice-samples/sage.mp3"),
  },
  {
    id: "ash",
    name: "Ash",
    descriptor: "Calm, steady, low-key.",
    sample: require("../../assets/voice-samples/ash.mp3"),
  },
  {
    id: "ballad",
    name: "Ballad",
    descriptor: "Expressive, a little theatrical.",
    sample: require("../../assets/voice-samples/ballad.mp3"),
  },
];
```

- [ ] **Step 3: Create the placeholder topics library**

Create `mobile/src/lib/podcastPlaceholders.ts`:

```ts
/**
 * Curated rotation of demo topics for the onboarding first-podcast screen.
 * Hand-picked because the model produces noticeably better output on these
 * (rich named entities, dates, real-world data the deep research can land on).
 */

export const ONBOARDING_PLACEHOLDERS = [
  "the rise of espresso machines in early 20th century Italy",
  "why sourdough starters work",
  "the design history of the Sony Walkman",
  "the 1973 oil crisis",
  "how mechanical watches keep time",
  "why Wikipedia works",
  "the science behind dreaming",
  "how money laundering schemes get caught",
  "why some languages have grammatical gender",
  "the history of canned food",
];

export function pickOnboardingPlaceholder(): string {
  return ONBOARDING_PLACEHOLDERS[
    Math.floor(Math.random() * ONBOARDING_PLACEHOLDERS.length)
  ];
}
```

- [ ] **Step 4: Create useProfile hook**

Create `mobile/src/hooks/useProfile.ts`:

```ts
/**
 * Selects + caches the signed-in user's profile row. Subscribes to Realtime
 * for cross-device sync (e.g., user changes voice on iPad, iPhone updates).
 *
 * Mirrors the pattern of useSubscription.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export interface Profile {
  id: string;
  displayName: string | null;
  preferredVoice: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  preferred_voice: string | null;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    preferredVoice: row.preferred_voice,
  };
}

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, preferred_voice")
      .eq("id", user.id)
      .single();
    if (!error && data) setProfile(toProfile(data as unknown as ProfileRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    fetch();

    if (!user) return;

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          setProfile(toProfile(payload.new as ProfileRow));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetch]);

  const setPreferredVoice = useCallback(
    async (voice: string) => {
      if (!user) return;
      // Optimistic update
      setProfile((prev) => (prev ? { ...prev, preferredVoice: voice } : prev));
      const { error } = await supabase
        .from("profiles")
        .update({ preferred_voice: voice })
        .eq("id", user.id);
      if (error) {
        // Roll back on failure
        await fetch();
        throw error;
      }
    },
    [user, fetch],
  );

  return { profile, loading, setPreferredVoice, refresh: fetch };
}
```

- [ ] **Step 5: Type-check via expo build (no runtime test for hooks)**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean exit, no TS errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/package.json mobile/package-lock.json mobile/src/hooks/useProfile.ts mobile/src/lib/voiceSamples.ts mobile/src/lib/podcastPlaceholders.ts && git commit -m "$(cat <<'EOF'
feat(mobile): useProfile hook + voice samples + placeholder libs

useProfile selects the signed-in user's profile and subscribes to Realtime
for cross-device sync (matching the useSubscription pattern). Exposes
preferredVoice + setPreferredVoice with optimistic updates.

voiceSamples.ts metadata for the picker (id, name, descriptor, bundled
sample mp3 require). podcastPlaceholders.ts ships 10 hand-picked demo
topics for the onboarding first-podcast screen, randomly rotated per
session.

If expo-av wasn't already installed, the dev client will need a rebuild.
EOF
)"
```

---

## Chunk 5: VoicePicker component

### Task 9: Build the reusable VoicePicker

**Files:**
- Create: `mobile/src/components/VoicePicker.tsx`

- [ ] **Step 1: Create the component**

Create `mobile/src/components/VoicePicker.tsx`:

```tsx
/**
 * VoicePicker — reusable voice selection UI. Used by:
 *   - Onboarding screen 2 (initial pick)
 *   - Account → Voice settings (edit)
 *
 * Plays bundled sample mp3 on tap. Calls onSelect with the voice ID
 * when the user taps the CTA. Caller handles persistence.
 */

import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Audio } from "expo-av";
import { VOICES, type VoiceMeta } from "../lib/voiceSamples";

interface Props {
  initialValue?: string;
  onSelect: (voice: string) => void | Promise<void>;
  ctaLabel?: string;
  helperText?: string;
}

export function VoicePicker({
  initialValue,
  onSelect,
  ctaLabel = "Continue",
  helperText,
}: Props) {
  const [picked, setPicked] = useState<string | null>(initialValue ?? null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      soundRef.current?.unloadAsync();
    };
  }, []);

  const playSample = async (voice: VoiceMeta) => {
    try {
      // Stop any currently-playing sample
      await soundRef.current?.unloadAsync();
      soundRef.current = null;

      const { sound } = await Audio.Sound.createAsync(voice.sample, {
        shouldPlay: true,
      });
      soundRef.current = sound;
      setPlayingId(voice.id);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) setPlayingId(null);
      });
    } catch (err) {
      console.error("Sample playback failed:", err);
      setPlayingId(null);
    }
  };

  const handleSubmit = async () => {
    if (!picked || submitting) return;
    setSubmitting(true);
    try {
      await onSelect(picked);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        {VOICES.map((voice) => {
          const isPicked = picked === voice.id;
          const isPlaying = playingId === voice.id;
          return (
            <TouchableOpacity
              key={voice.id}
              style={[styles.card, isPicked && styles.cardPicked]}
              onPress={() => {
                setPicked(voice.id);
                playSample(voice);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.cardBody}>
                <Text style={styles.name}>{voice.name}</Text>
                <Text style={styles.descriptor}>{voice.descriptor}</Text>
              </View>
              <View style={styles.playBadge}>
                <Text style={styles.playBadgeText}>{isPlaying ? "▶︎" : "▶"}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {helperText && <Text style={styles.helper}>{helperText}</Text>}

      <TouchableOpacity
        style={[styles.cta, (!picked || submitting) && styles.ctaDisabled]}
        onPress={handleSubmit}
        disabled={!picked || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16 },
  list: { gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  cardPicked: { borderColor: "#6366f1", borderWidth: 2 },
  cardBody: { flex: 1 },
  name: { fontSize: 18, fontWeight: "600", color: "#fff", marginBottom: 4 },
  descriptor: { fontSize: 14, color: "#aaa" },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
  },
  playBadgeText: { color: "#fff", fontSize: 14 },
  helper: { fontSize: 13, color: "#888", textAlign: "center", marginTop: 8 },
  cta: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: "auto",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -8
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/components/VoicePicker.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): VoicePicker component

Reusable voice selection UI used by onboarding screen 2 + Account voice
settings. Tapping a voice card plays the bundled sample mp3 via expo-av;
tapping the CTA invokes onSelect (caller handles persistence).

Helper text slot lets the settings screen show "Future podcasts only"
copy while keeping the onboarding screen clean.
EOF
)"
```

---

## Chunk 6: Mobile onboarding screens

### Task 10: Onboarding stack layout + welcome screen

**Files:**
- Create: `mobile/app/(onboarding)/_layout.tsx`
- Create: `mobile/app/(onboarding)/welcome.tsx`

- [ ] **Step 1: Create the onboarding stack layout**

Create `mobile/app/(onboarding)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: "fade",
      }}
    />
  );
}
```

- [ ] **Step 2: Create welcome.tsx**

Create `mobile/app/(onboarding)/welcome.tsx`:

```tsx
import { View, Text, TouchableWithoutFeedback, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function Welcome() {
  const router = useRouter();

  const advance = () => router.push("/(onboarding)/voice");

  return (
    <TouchableWithoutFeedback onPress={advance}>
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.headline}>Pick a topic.</Text>
          <Text style={styles.headline}>Get a 10-minute podcast.</Text>
          <Text style={styles.subline}>No scripts, no editing.</Text>
        </View>
        <Text style={styles.tap}>Tap anywhere to start</Text>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 32 },
  center: { flex: 1, justifyContent: "center", gap: 8 },
  headline: { fontSize: 30, fontWeight: "700", color: "#fff", lineHeight: 38 },
  subline: { fontSize: 18, color: "#888", marginTop: 12 },
  tap: { textAlign: "center", color: "#666", fontSize: 13, marginBottom: 32 },
});
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/\(onboarding\)/_layout.tsx mobile/app/\(onboarding\)/welcome.tsx && git commit -m "feat(mobile): onboarding stack + welcome screen"
```

---

### Task 11: Voice screen

**Files:**
- Create: `mobile/app/(onboarding)/voice.tsx`

- [ ] **Step 1: Create the screen**

Create `mobile/app/(onboarding)/voice.tsx`:

```tsx
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { VoicePicker } from "../../src/components/VoicePicker";
import { useProfile } from "../../src/hooks/useProfile";

export default function VoiceOnboarding() {
  const router = useRouter();
  const { setPreferredVoice } = useProfile();

  const handleSelect = async (voice: string) => {
    await setPreferredVoice(voice);
    router.push("/(onboarding)/first-podcast");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick your voice</Text>
      <Text style={styles.subtitle}>
        Tap a voice to hear a sample. You can change this later in your account.
      </Text>
      <VoicePicker onSelect={handleSelect} ctaLabel="Continue" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#aaa", marginBottom: 12 },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/\(onboarding\)/voice.tsx && git commit -m "feat(mobile): onboarding voice picker screen"
```

---

### Task 12: First-podcast screen

**Files:**
- Create: `mobile/app/(onboarding)/first-podcast.tsx`

- [ ] **Step 1: Create the screen**

Create `mobile/app/(onboarding)/first-podcast.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { generateQuestions, submitPodcast } from "../../src/services/podcast";
import { ClarifyingChat } from "../../src/components/ClarifyingChat";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { pickOnboardingPlaceholder } from "../../src/lib/podcastPlaceholders";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function FirstPodcast() {
  const [topic, setTopic] = useState(pickOnboardingPlaceholder());
  const [phase, setPhase] = useState<Phase>("input");
  const [questions, setQuestions] = useState<string[]>([]);
  const router = useRouter();

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setPhase("loading-questions");
    try {
      const qs = await generateQuestions(topic.trim());
      setQuestions(qs);
      setPhase("clarifying");
    } catch (err: any) {
      Alert.alert("Error", err.message);
      setPhase("input");
    }
  };

  const handleClarifyingComplete = async (answers: Array<{ q: string; a: string }>) => {
    setPhase("submitting");
    try {
      await submitPodcast(topic.trim(), answers);
      Alert.alert(
        "Researching now",
        "This usually takes about 15 minutes. We'll send you a notification when your podcast is ready.",
        [
          {
            text: "OK",
            onPress: async () => {
              await Notifications.requestPermissionsAsync().catch(() => {});
              router.replace("/(tabs)");
            },
          },
        ],
      );
    } catch (err: any) {
      Alert.alert("Error", err.message);
      setPhase("input");
    }
  };

  if (phase === "loading-questions") return <LoadingOverlay message="Preparing questions..." />;
  if (phase === "submitting") return <LoadingOverlay message="Starting generation..." />;

  if (phase === "clarifying") {
    return (
      <View style={styles.container}>
        <ClarifyingChat
          questions={questions}
          onComplete={handleClarifyingComplete}
          onCancel={() => setPhase("input")}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your first podcast</Text>
      <Text style={styles.subtitle}>
        Here's a topic to start with — or write your own.
      </Text>
      <TextInput
        style={styles.topicInput}
        value={topic}
        onChangeText={setTopic}
        placeholder="What do you want to learn about?"
        placeholderTextColor="#666"
        multiline
      />
      <TouchableOpacity
        style={[styles.generateButton, !topic.trim() && styles.disabled]}
        onPress={handleGenerate}
        disabled={!topic.trim()}
      >
        <Text style={styles.generateText}>Generate Podcast (1 credit)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#aaa", marginBottom: 4 },
  topicInput: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#333",
  },
  generateButton: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
  generateText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/\(onboarding\)/first-podcast.tsx && git commit -m "feat(mobile): onboarding first-podcast screen"
```

---

## Chunk 7: Routing + Account integration

### Task 13: Root layout onboarding gate

**Files:**
- Modify: `mobile/app/_layout.tsx`

- [ ] **Step 1: Read the current root layout**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/app/_layout.tsx"
```

The existing layout likely has `useAuth` redirecting between `(auth)` and `(tabs)`. Add the onboarding redirect alongside.

- [ ] **Step 2: Add the onboarding gate**

The auth check pattern should now be:

```tsx
import { Slot, Redirect } from "expo-router";
import { useAuth } from "../src/hooks/useAuth";
import { useProfile } from "../src/hooks/useProfile";
import { LoadingOverlay } from "../src/components/LoadingOverlay";

// ...inside the layout component:
const { user, loading: authLoading } = useAuth();
const { profile, loading: profileLoading } = useProfile();

if (authLoading || (user && profileLoading)) return <LoadingOverlay message="Loading..." />;
if (!user) return <Redirect href="/(auth)/sign-in" />;
if (!profile?.preferredVoice) return <Redirect href="/(onboarding)/welcome" />;
return <Slot />;
```

(Adapt to the existing layout structure. The key invariant: profile loading must not trigger the onboarding redirect — only profile *loaded with null voice* should.)

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/_layout.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): root layout onboarding gate

Redirect rules: signed out -> sign-in, signed in + voice null -> onboarding,
signed in + voice set -> tabs. The (authLoading || profileLoading) guard
avoids a wrong-screen flash on cold start.
EOF
)"
```

---

### Task 14: Voice settings screen + Account row

**Files:**
- Create: `mobile/app/voice-settings.tsx`
- Modify: `mobile/app/(tabs)/account.tsx`

- [ ] **Step 1: Create voice-settings.tsx**

Create `mobile/app/voice-settings.tsx`:

```tsx
import { View, Text, StyleSheet, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { VoicePicker } from "../src/components/VoicePicker";
import { useProfile } from "../src/hooks/useProfile";
import { LoadingOverlay } from "../src/components/LoadingOverlay";

export default function VoiceSettings() {
  const router = useRouter();
  const { profile, loading, setPreferredVoice } = useProfile();

  if (loading) return <LoadingOverlay message="Loading..." />;

  const handleSelect = async (voice: string) => {
    try {
      await setPreferredVoice(voice);
      router.back();
    } catch (err: any) {
      Alert.alert("Couldn't save", err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Voice", headerTintColor: "#fff", headerStyle: { backgroundColor: "#0a0a0a" } }} />
      <Text style={styles.title}>Choose your voice</Text>
      <VoicePicker
        initialValue={profile?.preferredVoice ?? undefined}
        onSelect={handleSelect}
        ctaLabel="Save"
        helperText="Future podcasts only — existing podcasts keep their original voice."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
});
```

- [ ] **Step 2: Add the Voice row to account.tsx**

In `mobile/app/(tabs)/account.tsx`, add a new TouchableOpacity that links to `/voice-settings`. Place it above the "Buy Extra Credit" button.

```tsx
// Add import:
import { useRouter } from "expo-router";
import { useProfile } from "../../src/hooks/useProfile";

// Inside the component:
const router = useRouter();
const { profile } = useProfile();

// Inside the JSX, before <TouchableOpacity style={styles.buyButton} ...>:
<TouchableOpacity style={styles.voiceRow} onPress={() => router.push("/voice-settings")}>
  <Text style={styles.voiceLabel}>Voice</Text>
  <Text style={styles.voiceValue}>
    {profile?.preferredVoice
      ? profile.preferredVoice.charAt(0).toUpperCase() + profile.preferredVoice.slice(1)
      : "—"}
  </Text>
</TouchableOpacity>

// Add to the styles object:
voiceRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: "#1a1a1a",
  borderRadius: 12,
  padding: 16,
  borderWidth: 1,
  borderColor: "#2a2a2a",
},
voiceLabel: { fontSize: 16, color: "#fff" },
voiceValue: { fontSize: 16, color: "#888" },
```

- [ ] **Step 3: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/voice-settings.tsx mobile/app/\(tabs\)/account.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): Account voice row + voice-settings screen

Adds a Voice row in Account that links to voice-settings.tsx — same
VoicePicker as onboarding, with "Future podcasts only" helper copy
explicitly. router.back on save.
EOF
)"
```

---

### Task 15: Generate flow alert copy + push permission

**Files:**
- Modify: `mobile/app/(tabs)/generate.tsx`

- [ ] **Step 1: Update the post-Generate alert**

In `mobile/app/(tabs)/generate.tsx`, find the existing `Alert.alert("Podcast Generating", "We'll notify you when it's ready!", ...)` and replace with the new copy + push permission ask:

```tsx
// Add import at the top:
import * as Notifications from "expo-notifications";

// Replace the alert in handleClarifyingComplete:
Alert.alert(
  "Researching now",
  "This usually takes about 15 minutes. We'll send you a notification when your podcast is ready.",
  [
    {
      text: "OK",
      onPress: async () => {
        await Notifications.requestPermissionsAsync().catch(() => {});
        setPhase("input");
        setTopic("");
        router.push("/(tabs)");
      },
    },
  ],
);
```

- [ ] **Step 2: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/\(tabs\)/generate.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): updated generate alert + contextual push permission

Post-Generate alert now communicates the ~15 min wait and the upcoming
notification. iOS push permission prompt fires when the alert is
dismissed — best practice (user just consented to "we'll notify you,"
the OS dialog asks the same thing seconds later).

Notifications.requestPermissionsAsync is idempotent — if already
granted/denied, the OS ignores the call.
EOF
)"
```

---

## Chunk 8: End-to-end validation

### Task 16: Validate on device

**Files:** none changed.

- [ ] **Step 1: Reload Metro on the iPhone dev client**

Shake the device → Reload, or save any file in mobile/. Metro re-bundles, the new screens + assets ship.

If `expo-av` was newly installed in Task 8 and the dev client is on an older binary, this step requires an EAS build first:

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && eas build --profile development --platform ios --non-interactive --no-wait
```

Wait ~15 min for build to land. Install the new dev client. Then reload Metro.

- [ ] **Step 2: Reset Isuru's profile to trigger onboarding**

```sql
UPDATE public.profiles SET preferred_voice = NULL WHERE id = 'YOUR_USER_ID';
```

Use `mcp__supabase__execute_sql` and replace `YOUR_USER_ID` with Isuru's auth user ID.

- [ ] **Step 3: Force-quit + reopen the Katavo app**

You should now land on the welcome screen (`/(onboarding)/welcome`).

- [ ] **Step 4: Walk through the onboarding**

- Tap anywhere on welcome → voice screen.
- Tap each voice → bundled mp3 plays. Different voices sound audibly different.
- Pick one → tap Continue → first-podcast screen.
- Topic field shows a placeholder from the rotation. Edit or accept.
- Tap Generate → clarifying questions appear → answer them → submit.
- "Researching now" alert appears. Dismiss it.
- iOS native push permission prompt fires.
- Land in tabs.

- [ ] **Step 5: Verify DB state**

```sql
SELECT id, preferred_voice FROM public.profiles WHERE id = 'YOUR_USER_ID';
SELECT id, voice, status FROM public.podcasts ORDER BY created_at DESC LIMIT 1;
```

Expected:
- `preferred_voice` is set (whatever you picked).
- The new podcast row has `voice` matching your pick.
- `status` is `queued` or `researching`.

- [ ] **Step 6: Test re-entry**

- Force-quit the app and reopen → should land in tabs (not onboarding).
- Verify with `select preferred_voice from profiles ...` that voice is still set.

- [ ] **Step 7: Test Account → Voice editing**

- Open Account tab → tap Voice row → voice-settings screen.
- Pick a different voice → tap Save.
- Verify "Future podcasts only" helper text appeared.
- Pull-to-refresh Account → Voice row shows new value.
- Verify `select preferred_voice from profiles` reflects the change.

- [ ] **Step 8: Verify pipeline output uses the picked voice**

Wait for the podcast from Step 4 to complete (~10-15 min). Listen to it — should sound like the voice you picked during onboarding.

```sql
SELECT id, voice, audio_url, duration_seconds FROM public.podcasts ORDER BY created_at DESC LIMIT 1;
```

Expected: voice is set, audio_url populated, duration ≥ 9 min (per v8 acceptance — the v8 prompt changes are still active).

- [ ] **Step 9: Test the free tier credit bump**

```sql
SELECT user_id, tier, credits_per_month, credits_remaining
FROM public.subscriptions
WHERE user_id = 'YOUR_USER_ID';
```

Expected: free tier shows credits_per_month = 2.

- [ ] **Step 10: Final commit (notes only)**

If any tweaks landed during validation, they should already be committed in their respective tasks. If not:

```bash
cd "/Users/isuru/personal/AI Podcast App" && git push origin main
```

Done.

---

## Open follow-ups (deliberately not in this plan)

- **expo-av rebuild via EAS** if it wasn't already installed. Surface as the first risk during execution.
- **Per-podcast voice override on Generate.** Out of scope — see spec.
- **Custom instructions for podcast tone.** Real future feature, lives in Settings or per-Generate when prioritized.
- **Voice tier gating.** All tiers all voices for now.
- **Two-host mode.** Already parked from v8.
