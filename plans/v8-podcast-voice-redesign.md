# v8 — Podcast Voice Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "read-aloud article" feel of generated podcasts with a "knowledgeable friend at a coffee table" style (Acquired / Hard Fork / Stratechery), and reliably hit 9-12 min duration instead of the current 6-7 min.

**Architecture:** Three constants in `pipeline/src/podcast_pipeline/config.ts` carry all of the behavior we want to change — `SCRIPT_WRITER_PROMPT`, `TARGET_WORD_COUNT`, `TTS_VOICE_INSTRUCTIONS`, and `TTS_VOICE`. We rewrite the first three in one commit, then run a one-off voice A/B test and update `TTS_VOICE` based on the result. End-to-end validation is a single fresh podcast against the new pipeline.

**Tech Stack:** TypeScript, OpenAI gpt-4o (script) and gpt-4o-mini-tts (audio), Supabase for transcripts, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-01-podcast-voice-redesign-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `pipeline/src/podcast_pipeline/config.ts` | All four constants live here. One commit changes prompt + word count + TTS instructions. A second commit later updates `TTS_VOICE`. |
| Create | `pipeline/scripts/test-voices.ts` | One-off A/B utility. Pulls a transcript chapter from Supabase, renders 4 mp3s using different voices, writes them locally. Not part of the test suite. |

No code changes outside config.ts and the new script. No DB migrations. No mobile changes.

---

## Task 1 — Rewrite the script + TTS prompts

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`

This is the largest change in the plan and the one that produces user-visible improvement on its own. Three things move in lockstep: the script-writer prompt, the word-count target, and the TTS voice instructions.

- [ ] **Step 1: Read the current config.ts to confirm line numbers**

```bash
grep -n "TARGET_WORD_COUNT\|SCRIPT_WRITER_PROMPT\|TTS_VOICE_INSTRUCTIONS\|TTS_VOICE " pipeline/src/podcast_pipeline/config.ts
```

Expected: four `export const` lines. Note them — Task 2's edit replaces three of them and leaves `TTS_VOICE` for Task 5.

- [ ] **Step 2: Replace `TARGET_WORD_COUNT`**

Find:

```ts
export const TARGET_WORD_COUNT = 1500; // ~10 minutes at 150 wpm
```

Replace with:

```ts
export const TARGET_WORD_COUNT = 2200; // bumped from 1500 — model reliably undershoots; aim high to land ~1500
```

- [ ] **Step 3: Replace `SCRIPT_WRITER_PROMPT`**

Find the existing `export const SCRIPT_WRITER_PROMPT = \`...\`;` block and replace it with:

```ts
export const SCRIPT_WRITER_PROMPT = `You are writing a single-narrator podcast in the voice of a knowledgeable friend talking through a topic at a coffee table — think Acquired, Hard Fork, or Stratechery read aloud. Not NPR, not a TED talk, not a textbook.

Length: aim for {targetWords} words (~12-14 minutes at 150 wpm). Hard floor: 1800 words. Going long is fine; going short is not. Better to be 12 minutes of dense narrative than 7 minutes that feels rushed.

Voice rules:
- Open IN the topic. First sentence should land on a specific stat, moment, or person — never preamble. Examples that work: "Bezzera's first patent was filed on a Tuesday." / "There's a number that explains all of this: three." Examples that don't: "Today we'll explore...", "Imagine a world..."
- Talk like a person, not a presenter. A few "you know"s, "kinda"s, "I mean"s scattered through. An occasional "huh" or "anyway" between thoughts. Don't overdo it — once or twice per chapter.
- Use em-dash asides — like this — for the parts you'd lower your voice for.
- Vary sentence length aggressively. Short ones land. Long ones, with the texture of someone actually thinking through a sentence, breathe.
- Specific data, names, dates inline — fold sources into prose ("a 2019 Stanford study found..."), never reference indices like "[Source 4]".
- Dry humor where it fits. Never punchlines or jokes — just the occasional amused observation.

Self-check before finalizing: count the words in the script body (excluding [CHAPTER:] markers and the JSON map). If under 1800 words, expand. The most common gap is thin middle chapters — each non-opening chapter should have at least 350 words. Add concrete examples, named people, dates, quoted source material. Do not pad with filler or repeat yourself.

Hard avoids:
- Rhetorical self-Q&A. Never write "Was it that fast? Yep." or "Why does this matter? Because..." If a question helps the flow, leave it open and answer with statement, not "Yep" or "The answer is".
- "Welcome to", "Today we're going to", "In this episode", "Let's dive in", "Let's talk about", "Without further ado".
- Generic transitions: "moving on", "next up", "and now", "speaking of".
- Listicle scaffolding ("First... Second... Third..."). Use prose flow.
- Section signposting ("So that was X, now we'll cover Y").
- Theatrical openings ("Picture this", "Imagine for a moment").
- Sign-offs like "thanks for listening" or "until next time".

Structure:
- Mark chapter breaks inline with [CHAPTER: Title]. Chapters should feel like the natural turns of a conversation, not a syllabus. Title them as observations, not subjects: "The patent that changed everything", not "Bezzera's Patent".
- 4-6 chapters total, including a cold-open chapter and a closer.
- The closer doesn't summarize. It leaves the listener with one image, question, or sentence that lingers.

{disclaimerContext}

After writing the script, output a JSON block with a chapter-to-research mapping. For each [CHAPTER: Title] in the script, map the chapter title to:
- "researchSections": indexes into the research document sections array that this chapter draws from
- "sourceIndexes": indexes into the sources array that this chapter references

Output the mapping as a fenced JSON block after the script:
\`\`\`chapter_research_map
{{
  "Chapter Title": {{ "researchSections": [0, 1], "sourceIndexes": [0, 2] }},
  ...
}}
\`\`\`

Research document:
{researchDocument}

Sources:
{sources}
`;
```

Note the `{{` and `}}` braces around the example JSON — those are intentional. `scriptWriter.ts` uses `String.prototype.replace` (not template literal interpolation), so the literal `{` is fine, but doubling the braces for the example block keeps the prompt visually consistent with how the existing prompt is written.

- [ ] **Step 4: Replace `TTS_VOICE_INSTRUCTIONS`**

Find:

```ts
export const TTS_VOICE_INSTRUCTIONS = `Speak like an engaging podcast host.
Use a warm, conversational tone — as if explaining to a smart friend.
Vary your pacing naturally. Emphasize key points.
Pause briefly at chapter transitions.`;
```

Replace with:

```ts
export const TTS_VOICE_INSTRUCTIONS = `Speak like a knowledgeable friend recording a podcast at a coffee table — not a presenter, not a narrator. Tone: warm, slightly amused, low-energy confident.

Pacing: moderate. Take micro-pauses before complex names, numbers, or dates so they land. Take longer breaths at chapter transitions and after big ideas. Don't rush.

Emphasis: lift specific data, names, and dates lightly. Never theatrical — this isn't a movie trailer. Lean into the natural stress of a sentence, not engineered punchlines.

Em-dash asides — like this — should drop slightly in pitch and pick up in pace, then return to the main line. They're throwaway thoughts, not announcements.

Disfluencies like "you know," "kinda," "I mean," "huh," "anyway" should sound thrown away — quick and unstressed, not deliberate. Don't perform them.

Avoid: announcer cadence, evenly-spaced sentence rhythm, theatrical sweeps, building to false drama, signpost intonation on chapter titles, "podcast voice."`;
```

- [ ] **Step 5: Build to confirm TypeScript compiles**

Run:

```bash
cd pipeline && npm run build
```

Expected: clean exit, no diagnostics.

- [ ] **Step 6: Run unit tests to confirm nothing regressed**

Run:

```bash
cd pipeline && npm test
```

Expected: 64 tests pass (same as before this change). The existing tests mock OpenAI and don't assert on the literal prompt content, so they should be unaffected.

If `scriptWriter.test.ts` fails with a parsing assertion, the most likely cause is a change in how the prompt's example chapter_research_map block renders after substitution. Inspect the assertion and adjust either the test or the prompt's example block until both work — but do not weaken the test.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): rewrite script + TTS prompts for natural podcast feel

The first two podcasts off the new pipeline read like written articles
and undershot the promised 10-min duration (actual ~6.5 min from ~970
words against a 1500 target). Three changes here:

- SCRIPT_WRITER_PROMPT: bake in coffee-table-friend style, ban rhetorical
  self-Q&A and announcer tics, treat word count as a floor with a
  per-chapter check.
- TARGET_WORD_COUNT: 1500 -> 2200 since the model reliably underdelivers
  by ~35%. Aiming for 2200 should land us in the 1500-1800 range.
- TTS_VOICE_INSTRUCTIONS: anchor on a coffee-table scene, give explicit
  treatment for em-dash asides and disfluencies, add anti-direction list.

Spec: docs/superpowers/specs/2026-05-01-podcast-voice-redesign-design.md
EOF
)"
```

---

## Task 2 — Build the voice A/B test script

**Files:**
- Create: `pipeline/scripts/test-voices.ts`

A one-off utility. Not added to the test suite, not added to package.json scripts (it's run on demand). Pulls a complete-status podcast's transcript from Supabase, takes the first chapter, renders that chapter with each candidate voice, writes mp3s locally so we can listen back-to-back.

- [ ] **Step 1: Confirm the scripts directory doesn't exist yet**

```bash
ls pipeline/scripts 2>/dev/null && echo "exists" || echo "create it"
```

Expected: `create it`. If it already exists for unrelated reasons, that's fine — keep it.

- [ ] **Step 2: Write the test-voices script**

Create `pipeline/scripts/test-voices.ts`:

```ts
/**
 * One-off voice A/B utility. Renders the first chapter of a completed
 * podcast through 4 candidate voices using the new TTS_VOICE_INSTRUCTIONS,
 * writes mp3s locally for side-by-side listening.
 *
 * Run: npx tsx scripts/test-voices.ts
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { TTS_VOICE_INSTRUCTIONS } from "../src/podcast_pipeline/config.js";

const VOICES = ["coral", "sage", "ash", "ballad"] as const;
const OUT_DIR = "voice-test";

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: podcasts, error } = await supabase
    .from("podcasts")
    .select("id, topic, transcript")
    .eq("status", "complete")
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !podcasts || podcasts.length === 0) {
    throw new Error(`No complete podcast found: ${error?.message ?? "empty result"}`);
  }

  const { id, topic, transcript } = podcasts[0];
  if (!transcript) throw new Error(`Podcast ${id} has null transcript`);

  // Take the first ~280 words — roughly one chapter, ~75-90s of audio.
  const words = transcript.split(/\s+/).slice(0, 280);
  const chapter = words.join(" ");

  console.log(`Source podcast: ${id}`);
  console.log(`Topic: ${topic}`);
  console.log(`Chapter sample: ${words.length} words, ${chapter.length} chars`);

  mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI();
  for (const voice of VOICES) {
    console.log(`Rendering ${voice}...`);
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: chapter,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const buf = Buffer.from(await response.arrayBuffer());
    const path = join(OUT_DIR, `voice-${voice}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. Listen with:");
  for (const voice of VOICES) {
    console.log(`  open ${OUT_DIR}/voice-${voice}.mp3`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Type-check the script**

Run:

```bash
cd pipeline && npx tsc --noEmit scripts/test-voices.ts
```

Expected: clean exit. If `--noEmit` fails because the script imports from `../src/podcast_pipeline/config.js` (the .js extension is required for ESM but TypeScript may resolve it differently), confirm the import path matches the way the rest of the codebase imports — every node file in this project uses `.js` extensions even when importing TypeScript files (it's the published-build convention). Keep the `.js` extension.

- [ ] **Step 4: Add `voice-test/` to .gitignore**

The script writes mp3s into `pipeline/voice-test/` — those shouldn't be committed.

Append to `pipeline/.gitignore` (creating it if it doesn't exist):

```
voice-test/
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/scripts/test-voices.ts pipeline/.gitignore
git commit -m "$(cat <<'EOF'
chore(pipeline): add one-off TTS voice A/B utility

Renders the first chapter of a recent completed podcast through 4
candidate voices (coral, sage, ash, ballad) using the new TTS instructions
so we can pick a winner by ear. Writes mp3s into pipeline/voice-test/
(gitignored).

Run: cd pipeline && npx tsx scripts/test-voices.ts
EOF
)"
```

---

## Task 3 — Run the voice test and pick a winner

**Files:** none changed in this task. This is a manual judgment step.

- [ ] **Step 1: Confirm there's a recent completed podcast in the database**

```bash
psql "$DATABASE_URL" -c "SELECT id, topic, length(transcript) AS chars, duration_seconds FROM podcasts WHERE status = 'complete' AND transcript IS NOT NULL ORDER BY created_at DESC LIMIT 3;"
```

Or via the Supabase MCP `execute_sql`. Expected: at least one complete podcast, transcript over ~3000 chars. If there isn't one, generate one first by submitting a topic via the mobile app or the API.

- [ ] **Step 2: Run the script**

```bash
cd pipeline && npx tsx scripts/test-voices.ts
```

Expected output: source podcast id + topic, then four lines like `-> voice-test/voice-{name}.mp3 (NNNN bytes)`. Cost: ~$0.08 total against the OpenAI key.

- [ ] **Step 3: Listen to all four files back to back**

```bash
open pipeline/voice-test/voice-coral.mp3
open pipeline/voice-test/voice-sage.mp3
open pipeline/voice-test/voice-ash.mp3
open pipeline/voice-test/voice-ballad.mp3
```

Pick the voice that best matches "knowledgeable friend at a coffee table — Acquired/Hard Fork/Stratechery vibe." Tiebreakers: warmth on names + numbers, em-dash aside delivery, lack of announcer cadence.

- [ ] **Step 4: Record the choice**

Note which voice you picked. The next task uses this choice. If none of the candidates feel right, surface that — we may need to either widen the candidate set or accept that voice alone isn't enough and the script-level changes have to carry the load.

---

## Task 4 — Lock in the voice choice

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Update `TTS_VOICE`**

Find the existing line in `pipeline/src/podcast_pipeline/config.ts`:

```ts
export const TTS_VOICE = "coral";
```

Replace `coral` with the winning voice from Task 3 (e.g. `sage`):

```ts
export const TTS_VOICE = "sage";
```

- [ ] **Step 2: Build + run unit tests**

```bash
cd pipeline && npm run build && npm test
```

Expected: clean build, 64 tests pass.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): switch TTS voice to <chosen-voice>

A/B tested coral / sage / ash / ballad against the same chapter using
the new TTS_VOICE_INSTRUCTIONS. <chosen-voice> landed closest to the
"knowledgeable friend at a coffee table" target — warmer than coral on
names and numbers, em-dash asides drop in pitch correctly, no announcer
cadence.

Test methodology: pipeline/scripts/test-voices.ts.
EOF
)"
```

Replace `<chosen-voice>` in both the constant and the commit message with the actual winner from Task 3.

---

## Task 5 — Deploy to Railway

**Files:** none changed.

The pipeline runs on Railway in production (`podcasts-production-3b07.up.railway.app`). All the changes from Tasks 1 and 4 are in `pipeline/src/podcast_pipeline/config.ts` — they need to be deployed before the next podcast generation will use them.

- [ ] **Step 1: Deploy**

```bash
cd pipeline && eas build --no-wait || true
# Actually use Railway, not EAS:
cd pipeline && railway up
```

Or use the Railway MCP:

```
mcp__Railway__deploy { workspacePath: "<repo>/pipeline", ci: true }
```

Expected: successful build (60-90s), service redeployed.

- [ ] **Step 2: Confirm the service is healthy**

```bash
curl -sS -w "\n%{http_code}\n" https://podcasts-production-3b07.up.railway.app/health
```

Expected: `{"status":"ok"}` and `200`.

---

## Task 6 — Validate end-to-end

**Files:** none changed in this task. This is the acceptance test.

- [ ] **Step 1: Trigger a fresh generation**

Either via the mobile dev client (sign in, hit Generate, pick a topic, answer the questions, submit) or via the API directly using a JWT. Pick a moderately rich topic — e.g. "the design history of the Walkman" or "why sourdough starters work" — something with concrete data, named people, and dates so the script has material to lean on.

- [ ] **Step 2: Wait for the pipeline to finish**

The mobile library should now refresh in real-time (we added Realtime publication earlier). Wait until the status reaches `complete`. Realistic time: 8-12 min.

- [ ] **Step 3: Verify duration ≥ 9 minutes**

Query the new podcast's `duration_seconds` field via Supabase:

```sql
SELECT id, topic, duration_seconds, length(transcript) AS chars
FROM podcasts
ORDER BY created_at DESC LIMIT 1;
```

Expected: `duration_seconds` ≥ 540 (9 min). If it lands below 540, the prompt isn't holding the word floor and we'll want to add an adaptive re-call loop in a follow-up — but for now record the actual number.

- [ ] **Step 4: Spot-check the transcript for the banned patterns**

Pull the transcript and grep for the most likely offenders:

```bash
TRANSCRIPT_FILE=/tmp/transcript.txt  # paste the transcript content into this file
grep -E "Yep\.|Today we|Let's dive|Welcome to|next up|moving on|First[,.]|Second[,.]|Third[,.]" "$TRANSCRIPT_FILE" || echo "(no banned patterns found)"
```

Expected: `(no banned patterns found)`. If matches show up, capture which ones — we'll either tighten the prompt language or accept that those constructs slipped through this run.

- [ ] **Step 5: Listen end-to-end**

Play the mp3 from start to finish (or at least the first 5 min and the closer). Acceptance criteria, scored subjectively:

- Voice has more dynamics than the previous runs (warmth on names, micro-pauses on numbers, em-dash asides drop in pitch)
- Disfluencies appear and feel sprinkled, not performed
- No "Welcome to..." / "Let's dive in..." / rhetorical self-Q&A
- Net "feels more like a podcast, less like a read-along"

If 3 of 4 land cleanly, declare success. If less, the design got most of it right but we have more iteration to do — capture which criterion failed and surface it before changing anything else.

- [ ] **Step 6: Final commit (notes only)**

If any acceptance items required a tweak in Tasks 1-4, those tweaks should already be committed. If you made notes during validation that are worth keeping in the repo (e.g. "TTS still occasionally rushes long names"), add them as a one-line follow-up to the spec or open an issue.

If everything landed cleanly:

```bash
git push origin main
```

Done.

---

## Open follow-ups (deliberately not in this plan)

Captured here so they don't get lost:

- **Two-host conversation mode.** Bigger refactor — needs speaker turn markers in the prompt and per-segment voice alternation in `audioProducer.ts`. Worth its own spec when it becomes a priority.
- **Adaptive length re-call.** If Task 6 Step 3 shows duration still landing below 540s consistently across multiple runs, add a length-check + re-call step after `scriptWriter` to expand short scripts.
- **Per-segment chapter timing.** `metadataWriter.extractChapters` computes timestamps proportionally to character position. Real per-segment durations from `ffprobe` would be more accurate; matters if Deep Dive seeking ever feels off.
- **Voice cloning / custom voice.** Out of scope at MVP, would unlock a much stronger brand voice if we want to pursue it later.
