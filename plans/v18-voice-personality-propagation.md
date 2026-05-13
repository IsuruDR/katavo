# v18 — Voice Personality Propagation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread per-voice personality data into `briefBuilder`, `scriptWriter`, and `tagInjector` so the generated podcast actually *sounds* like Sulafat vs Charon vs Sadaltager vs Achird — not just renders in different timbres of the same generic prose.

**Architecture:** New `VOICE_PERSONALITIES` map keyed by `GeminiVoice`. Each personality has `summary`, `briefAngle`, `scriptStyle`. Strip generic "Voice rules" content out of the existing prompts; inject per-voice content via placeholders. Rewrite `tagInjector` prompt to a simpler Google-style framing with voice context. Expand audio tag set from 10 to ~200 in a separate `audioTags.ts` file.

**Tech Stack:** TypeScript, LangGraph.js, vitest. No new dependencies. No DB migration.

**Spec:** `docs/superpowers/specs/2026-05-13-voice-personality-propagation-design.md`

**Ships as:** Single PR to main. Railway redeploy. No feature flag. Greenfield, no users affected.

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `pipeline/src/podcast_pipeline/audioTags.ts` | The full ~200-tag set as `AUDIO_TAGS_DEFAULT`. Avoids bloating config.ts. |
| `pipeline/src/podcast_pipeline/voicePersonality.ts` | `VoicePersonality` interface, `VOICE_PERSONALITIES` map, `getVoicePersonality` helper. |
| `pipeline/tests/voicePersonality.test.ts` | Unit tests for the helper and the map. |

### Modified files

| Path | What changes |
|---|---|
| `pipeline/src/podcast_pipeline/config.ts` | Replace inline `AUDIO_TAGS_DEFAULT` with import from `audioTags.ts`. Refactor `SCRIPT_WRITER_PROMPT` (strip 8 bullets, keep 3, neutralize preamble, drop parenthetical, add `{voicePersonality}` slot). Same for `SCRIPT_WRITER_EXPANSION_PROMPT`. Add `Voice angle: {voiceAngle}` line to `BRIEF_BUILDER_PROMPT` and `BRIEF_BUILDER_EXPANSION_PROMPT`. |
| `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts` | Add `.replace("{voiceAngle}", voiceAngle)` substitution in both expansion and normal-mode branches. Import `getVoicePersonality`. |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | Add `.replace("{voicePersonality}", ...)` substitution to the existing chain. Import `getVoicePersonality`. |
| `pipeline/src/podcast_pipeline/nodes/tagInjector.ts` | Function signature: `(script, tags, voiceName, personality)`. Rewrite `TAG_INJECTOR_PROMPT` body to Google-style framing with voice context block. |
| `pipeline/tests/briefBuilder.test.ts` | Add personality injection assertions. Null-voice fallback case. |
| `pipeline/tests/scriptWriter.test.ts` | Add personality injection assertions. Assert old generic rules block is gone. |
| `pipeline/tests/tagInjector.test.ts` | Add personality injection assertions. Null-voice fallback case. |

### Unaffected files (keep working without changes)

- `pipeline/tests/audioTags.test.ts` — exercises `AUDIO_TAGS` env-var override behavior through `config.ts`. The Task 2 re-export preserves the constant's value and type, so existing assertions still pass.
- `pipeline/tests/expansionPromptsScan.test.ts` — no voice or prompt content. Untouched.
- `pipeline/src/podcast_pipeline/state.ts` — `voice: string | null` field already exists; no schema change.

---

## Chunk 1: Audio tags expansion

### Task 1: Create `audioTags.ts` with full 200-tag set

**Files:**
- Create: `pipeline/src/podcast_pipeline/audioTags.ts`

- [ ] **Step 1: Create the file with the full tag list**

Write the file with the array. Tags WITHOUT surrounding brackets (the bracket is added by the consumer when interpolating). One per line, alphabetical for diff-friendliness.

```ts
/**
 * Audio tag vocabulary for the tagInjector node. Each tag becomes
 * `[tag]` when inserted into a script. The tagInjector LLM picks
 * from this set based on the script's emotional arc and the voice's
 * personality block.
 *
 * Kept here (not in config.ts) because the list is ~200 entries and
 * grows config.ts past comfortable scan length.
 *
 * Env var override: AUDIO_TAGS (comma-separated) still wins. See
 * config.ts for the env-var precedence.
 */
export const AUDIO_TAGS_DEFAULT = [
  "acceptance",
  "accomplishment",
  "achievement",
  "active",
  "admiration",
  "admonition",
  "adoration",
  "affection",
  "aggression",
  "agitation",
  "alarm",
  "amazement",
  "ambivalence",
  "amused",
  "amusement",
  "analysis",
  "anger",
  "animation",
  "annoyance",
  "anticipation",
  "anxiety",
  "apology",
  "appreciation",
  "apprehension",
  "approval",
  "arrogance",
  "assertion",
  "assertive",
  "assertiveness",
  "assurance",
  "astonishment",
  "aversion",
  "awareness",
  "awe",
  "awkwardness",
  "bargaining",
  "boredom",
  "caring",
  "caution",
  "cautious",
  "certainty",
  "challenging",
  "comfort",
  "compassion",
  "concentration",
  "concern",
  "confidence",
  "confident",
  "confusion",
  "contemplative",
  "contempt",
  "contentment",
  "conviction",
  "courage",
  "craving",
  "critical",
  "criticism",
  "curiosity",
  "decision",
  "defiance",
  "demonstration",
  "description",
  "descriptive",
  "desire",
  "despair",
  "desperation",
  "despondency",
  "determination",
  "determined",
  "devotion",
  "directness",
  "disagreement",
  "disappointment",
  "disapproval",
  "disbelief",
  "discernment",
  "discomfort",
  "disdain",
  "disgust",
  "disillusionment",
  "dislike",
  "dismissive",
  "distress",
  "doubt",
  "dread",
  "eagerness",
  "effervescence",
  "embarrassment",
  "embitterment",
  "embracement",
  "empathy",
  "emphasis",
  "enchantment",
  "encouraging",
  "energetic",
  "enjoyment",
  "enthusiasm",
  "enthusiastic",
  "excitement",
  "exhaustion",
  "explaining",
  "fascination",
  "fast",
  "fear",
  "focus",
  "fondness",
  "friendly",
  "frustration",
  "gratification",
  "gratitude",
  "grief",
  "guilt",
  "happy",
  "high energy",
  "hope",
  "horror",
  "humor",
  "hurt",
  "incredulity",
  "indifference",
  "indignation",
  "informative",
  "instruction",
  "interest",
  "intrigue",
  "invitation",
  "joy",
  "laughs",
  "logical reasoning",
  "long pause",
  "love",
  "low energy",
  "melancholy",
  "mixed",
  "negative",
  "negative surprise",
  "nervousness",
  "neutral",
  "nostalgia",
  "observation",
  "offense",
  "optimism",
  "pain",
  "panic",
  "passion",
  "passive",
  "pensive",
  "pessimism",
  "pity",
  "planning",
  "playful",
  "pleading",
  "pleased",
  "positive",
  "positive surprise",
  "praise",
  "pride",
  "realization",
  "recognition",
  "reflection",
  "regret",
  "relaxation",
  "relief",
  "reminiscence",
  "resignation",
  "sadness",
  "sarcasm",
  "satisfaction",
  "self-deprecation",
  "self-satisfaction",
  "sentimentality",
  "serenity",
  "seriousness",
  "shame",
  "shock",
  "short pause",
  "skepticism",
  "slight relief",
  "slow",
  "smitten",
  "solemnity",
  "speculation",
  "strategizing",
  "stress",
  "struggle",
  "success",
  "suffering",
  "suggestion",
  "summary",
  "surprise",
  "suspicion",
  "sympathy",
  "tension",
  "terror",
  "thanks",
  "thinking",
  "thrill",
  "tiredness",
  "triumph",
  "uncertainty",
  "unclear",
  "understanding",
  "unease",
  "urgency",
  "victory",
  "warning",
  "weariness",
  "whispers",
  "wisdom",
  "wistful",
  "worry",
  "yearning",
] as const;

export type AudioTag = (typeof AUDIO_TAGS_DEFAULT)[number];
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: `TypeScript compilation completed` with no errors.

### Task 2: Wire `audioTags.ts` into `config.ts`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts:225-228`

- [ ] **Step 1: Replace the inline `AUDIO_TAGS_DEFAULT` array with an import**

Find lines 225-228 in `config.ts`:

```ts
export const AUDIO_TAGS_DEFAULT = [
  "laughs", "whispers", "sighs", "chuckles", "curious",
  "thoughtful", "serious", "surprised", "exhales", "pauses",
] as const;
```

Replace with:

```ts
export { AUDIO_TAGS_DEFAULT } from "./audioTags.js";
```

Imports in config.ts are at the top; this is a re-export at the original location to preserve the constant's source-of-truth visibility. Existing consumers (`import { AUDIO_TAGS } from "../config.js"`) keep working unchanged because `AUDIO_TAGS` (line 231-232) references `AUDIO_TAGS_DEFAULT` which now flows through the re-export.

- [ ] **Step 2: Type-check + run the full test suite**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run --exclude tests/integration 2>&1 | tail -5
```

Expected: tsc clean, 194 tests pass (current baseline). The existing `tagInjector.test.ts` assertions about `[laughs]` and `[chuckles]` in the prompt still pass — both tags survive in the new 200-tag set. The existing `audioTags.test.ts` env-var override tests pass too because the re-export preserves the constant's type and value.

- [ ] **Step 3: Commit Chunk 1**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/audioTags.ts pipeline/src/podcast_pipeline/config.ts && git commit -m "feat(audio): expand AUDIO_TAGS_DEFAULT from 10 to ~200 tags in dedicated file"
```

---

## Chunk 2: Voice personality data model

### Task 3: Create `voicePersonality.ts` with the four personalities

**Files:**
- Create: `pipeline/src/podcast_pipeline/voicePersonality.ts`

- [ ] **Step 1: Create the file**

```ts
/**
 * Per-voice personality data. Threaded into briefBuilder, scriptWriter,
 * and tagInjector so the generated podcast actually sounds like the
 * picked voice — not just the same prose in a different timbre.
 *
 * Single source of truth. Mobile's voice picker descriptors live in
 * voiceSamples.ts and are intentionally written independently (different
 * audience: marketing copy vs LLM prompt content). Could converge later.
 */
import type { GeminiVoice } from "./config.js";

export interface VoicePersonality {
  /** One-line headline. Used in logs and as the prompt summary line. */
  summary: string;

  /** Sentence-long nudge for briefBuilder. Shapes what kind of
   *  answers the research stage should produce for this voice. */
  briefAngle: string;

  /** ~5 lines of prose guidance. Inserted into scriptWriter AND
   *  tagInjector as a "Voice context" block. Covers tone, sentence
   *  rhythm, humor, asides, closings. */
  scriptStyle: string;
}

export const VOICE_PERSONALITIES: Record<GeminiVoice, VoicePersonality> = {
  Sulafat: {
    summary:
      "Warm, conversational. The friendly-knowledgeable-friend voice. Dry humor on a beat, never performed.",
    briefAngle:
      "Lean toward questions that surface concrete scenes and lived experience, not just statistics. Answers should have texture.",
    scriptStyle: `Lead with curiosity, not authority. Sentences run a beat longer than necessary, like thinking out loud. Contractions natural; em-dash asides welcome.

Dry humor lands on a beat — a "huh" between two clauses, an aside parenthetical, a small under-statement. Never setup-and-punchline. Personal asides are appropriate: "and honestly", "the part that gets me", "here's the thing".

Treat the listener as a smart friend, not a student. Don't over-explain mechanisms; trust them to keep up. Closings linger — let the last sentence breathe instead of buttoning it up.`,
  },

  Charon: {
    summary:
      "Substance-forward, journalistic. The analyst voice. Cuts every word that doesn't carry information.",
    briefAngle:
      "Lean toward questions that produce specifics: numbers, dates, named cases, primary sources. Avoid abstract framings.",
    scriptStyle: `Cut every word that doesn't carry information. Sentences short by default, long only when the data demands it. Contractions sparingly.

State, don't gesture: "three hundred horsepower" not "around three hundred or so". Specifics, not vibes. No hedging language ("sort of", "kind of", "I guess") — confident verbs.

Asides are rare and pointed; if you write one, make sure it earns the digression. Closings are clean: state the takeaway and stop.`,
  },

  Sadaltager: {
    summary:
      "Thoughtful, lyrical. The dinner-party historian voice. Anchors abstractions in scenes and named people.",
    briefAngle:
      "Lean toward questions that surface tensions, irony, named individuals, and unresolved aspects. Answers should suggest the human stories behind the facts and include dates and specific places.",
    scriptStyle: `Open each chapter with a scene or anecdote before the abstraction: a person at a moment, a date and a place, a single object that carries the argument. Name a specific person within the first three sentences of every chapter. Favor past-tense narration over present-tense exposition — "in 1903, Bezzera filed..." not "Bezzera's design works by..."

Longer sentences than the others — the prose breathes. Em-dashes and parentheticals welcome. Contractions natural.

Reflective asides happen in retrospect: "what they didn't realize at the time", "what's interesting in hindsight", "the part historians still argue about". Allow the prose to wander, then return to the point.

Closings land on a quiet historical irony or an observation about what's still unresolved. Never a thesis statement.`,
  },

  Achird: {
    summary:
      "Casual, bright, energetic. The coffee-shop voice. Faster pacing, more restarts, genuine enthusiasm.",
    briefAngle:
      "Lean toward questions that lend themselves to direct examples and 'you know how' framings. Answers should translate into clear stories.",
    scriptStyle: `Faster pacing. Shorter sentences. More restarts, more contractions, more "yeah, so" connective tissue.

Sounds like someone excited to share, but doesn't perform — genuine enthusiasm, not theatrics. Direct address welcome: "you know how", "you'd think", "the thing is". Quick punches of humor are fine; keep them light, not biting.

Closings can be punchy. A one-liner is appropriate.`,
  },
};

/**
 * Falls back to Sulafat (the mobile default) when state.voice is null
 * or doesn't match a known voice. There is no "generic" prompt path
 * after this refactor — every prompt always reads a real personality.
 */
export function getVoicePersonality(
  voice: string | null | undefined,
): VoicePersonality {
  if (voice && voice in VOICE_PERSONALITIES) {
    return VOICE_PERSONALITIES[voice as GeminiVoice];
  }
  return VOICE_PERSONALITIES.Sulafat;
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean. The `Record<GeminiVoice, ...>` type forces all four voices defined; tsc fails if any are missing.

### Task 4: Test the helper + map

**Files:**
- Create: `pipeline/tests/voicePersonality.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  getVoicePersonality,
  VOICE_PERSONALITIES,
  type VoicePersonality,
} from "../src/podcast_pipeline/voicePersonality.js";
import { GEMINI_VOICES } from "../src/podcast_pipeline/config.js";

describe("getVoicePersonality", () => {
  it("returns the matching personality when voice is a known GeminiVoice", () => {
    expect(getVoicePersonality("Sulafat").summary).toContain("Warm");
    expect(getVoicePersonality("Charon").summary).toContain("Substance");
    expect(getVoicePersonality("Sadaltager").summary).toContain("historian");
    expect(getVoicePersonality("Achird").summary).toContain("Casual");
  });

  it("falls back to Sulafat when voice is null", () => {
    expect(getVoicePersonality(null)).toBe(VOICE_PERSONALITIES.Sulafat);
  });

  it("falls back to Sulafat when voice is undefined", () => {
    expect(getVoicePersonality(undefined)).toBe(VOICE_PERSONALITIES.Sulafat);
  });

  it("falls back to Sulafat when voice doesn't match a known voice", () => {
    expect(getVoicePersonality("Unknown")).toBe(VOICE_PERSONALITIES.Sulafat);
    expect(getVoicePersonality("")).toBe(VOICE_PERSONALITIES.Sulafat);
  });
});

describe("VOICE_PERSONALITIES", () => {
  it("covers every voice in GEMINI_VOICES with all three fields populated", () => {
    for (const voice of GEMINI_VOICES) {
      const personality: VoicePersonality = VOICE_PERSONALITIES[voice];
      expect(personality.summary.length, `${voice}.summary`).toBeGreaterThan(20);
      expect(personality.briefAngle.length, `${voice}.briefAngle`).toBeGreaterThan(20);
      expect(personality.scriptStyle.length, `${voice}.scriptStyle`).toBeGreaterThan(100);
    }
  });

  it("voices have meaningfully different summaries", () => {
    const summaries = Object.values(VOICE_PERSONALITIES).map((p) => p.summary);
    const unique = new Set(summaries);
    expect(unique.size).toBe(summaries.length);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/voicePersonality.test.ts 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit Chunk 2**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/voicePersonality.ts pipeline/tests/voicePersonality.test.ts && git commit -m "feat(voice): VOICE_PERSONALITIES map + getVoicePersonality helper"
```

---

## Chunk 3: briefBuilder integration

**TDD note for this and subsequent prompt-edit chunks:** Strict TDD (write failing test first, see it fail, then implement) doesn't fit prompt-template edits well — the "failure mode" is "literal `{voiceAngle}` lands in the LLM call", which is a static template assertion, not a behavior test. The tests at the end of each chunk verify the substitution lands correctly. Implement → test → run, in that order, per chunk.

### Task 5: Add `{voiceAngle}` slot to both briefBuilder prompts

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts:73-102`

- [ ] **Step 1: Update `BRIEF_BUILDER_PROMPT`**

Replace the existing constant at line 73 with:

```ts
export const BRIEF_BUILDER_PROMPT = `You are preparing a research brief for a podcast episode.
Given a topic and the user's answers to clarifying questions, produce a structured research brief.

Voice angle: {voiceAngle}

Output a JSON object with:
- "scope": what the podcast should cover
- "angle": the specific perspective or framing
- "depth": how technical/detailed (beginner, intermediate, expert)
- "keyQuestions": list of 3-5 specific questions the research should answer
`;
```

- [ ] **Step 2: Update `BRIEF_BUILDER_EXPANSION_PROMPT`**

Replace the constant at line 83. Insert the `Voice angle:` line just after the opening paragraph, before the `Inputs you'll receive:` block:

```ts
export const BRIEF_BUILDER_EXPANSION_PROMPT = `You are preparing a research brief for a CONTINUATION podcast episode that deepens a specific chapter of a parent podcast.

Voice angle: {voiceAngle}

Inputs you'll receive:
- The parent podcast's topic (broad subject)
- The source chapter title (what we're going deeper on)
- A digest of what the parent's research already covered (so you don't duplicate)
- The transcript of the source chapter (what was actually said)

Output a JSON object with:
- "scope": what THIS expansion should cover (narrowly: the chapter's specific territory)
- "angle": pick up from where the parent chapter ended — what wasn't fully answered?
- "depth": same as the parent (the listener wants more substance, not introductory framing)
- "keyQuestions": list of 3-5 specific questions to research that DEEPEN the chapter without repeating what the parent already covered

Avoid generic "what is X" questions. The listener already heard the parent's coverage. Drill into:
- Specific mechanisms the parent hand-waved
- Concrete case studies the parent gestured at
- Tensions or open questions the parent raised but didn't resolve
- Recent developments the parent might not have included
`;
```

### Task 6: Wire the substitution into `briefBuilder.ts`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts`

- [ ] **Step 1: Add the import**

At the top of the file, add to the existing imports:

```ts
import { getVoicePersonality } from "../voicePersonality.js";
```

- [ ] **Step 2: Add substitution in both branches**

The function has two branches: expansion mode (uses `BRIEF_BUILDER_EXPANSION_PROMPT`) and normal mode (uses `BRIEF_BUILDER_PROMPT`). Both currently use the prompt constant verbatim as the system message — they don't do `.replace()` substitution. Add it.

Just below the function signature (after `await persistStatus(...)`), derive the briefAngle once:

```ts
const { briefAngle } = getVoicePersonality(state.voice);
```

Then change the two `systemPrompt =` assignments. In the normal-mode branch, change exactly this line:

```ts
systemPrompt = BRIEF_BUILDER_PROMPT;
```

to:

```ts
systemPrompt = BRIEF_BUILDER_PROMPT.replace("{voiceAngle}", briefAngle);
```

In the expansion-mode branch, change exactly this line:

```ts
systemPrompt = BRIEF_BUILDER_EXPANSION_PROMPT;
```

to:

```ts
systemPrompt = BRIEF_BUILDER_EXPANSION_PROMPT.replace("{voiceAngle}", briefAngle);
```

The rest of each branch (answersText building, userContent building) stays untouched.

- [ ] **Step 3: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 7: Update `briefBuilder.test.ts` for personality injection

**Files:**
- Modify: `pipeline/tests/briefBuilder.test.ts`

- [ ] **Step 1: Add personality-injection tests inside the existing `describe("briefBuilder", ...)` block**

The existing test pattern uses `mockInvoke = vi.hoisted(...)` and reads `mockInvoke.mock.calls[0][0]` to inspect the messages array. Mirror that pattern. Append inside the existing describe (or alongside the existing expansion-mode describe — both work):

```ts
  it("injects voice angle for the chosen voice in normal mode", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "x",
      angle: "y",
      depth: "intermediate",
      keyQuestions: ["q1", "q2", "q3"],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "history of bmw",
      voice: "Charon",
      clarifyingAnswers: [{ q: "how technical?", a: "intermediate" }],
      parentPodcastId: null,
    } as any);

    const messages = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1][0];
    expect(messages[0].content).toContain("Voice angle:");
    expect(messages[0].content).toContain("specifics: numbers, dates");
    // Sulafat's briefAngle should NOT be present
    expect(messages[0].content).not.toContain("concrete scenes and lived experience");
  });

  it("falls back to Sulafat's voice angle when voice is null", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "x",
      angle: "y",
      depth: "intermediate",
      keyQuestions: ["q1", "q2", "q3"],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "x",
      voice: null,
      clarifyingAnswers: [],
      parentPodcastId: null,
    } as any);

    const messages = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1][0];
    expect(messages[0].content).toContain("concrete scenes and lived experience");
  });
```

- [ ] **Step 2: Run the test file**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/briefBuilder.test.ts 2>&1 | tail -10
```

Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: Commit Chunk 3**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/briefBuilder.ts pipeline/tests/briefBuilder.test.ts && git commit -m "feat(brief): inject voice angle into briefBuilder prompts"
```

---

## Chunk 4: scriptWriter integration

### Task 8: Refactor `SCRIPT_WRITER_PROMPT` per the spec's KEEP/STRIP table

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts:104-163`

- [ ] **Step 1: Replace `SCRIPT_WRITER_PROMPT` with the refactored version**

Three sub-changes within one constant rewrite:
1. **Preamble (line 104):** neutralize. Drop the "knowledgeable friend at a coffee table" framing.
2. **Voice descriptor parenthetical (line 106):** drop "(warm, conversational, low-energy confident)".
3. **Voice rules block (lines 110-121):** strip 8 bullets, keep 3 (cold-open, breath points, citation discipline), rename to "Universal rules:". Add `{voicePersonality}` placeholder block just below it.

Replace the entire constant at lines 104-163 with:

```ts
export const SCRIPT_WRITER_PROMPT = `You are writing a single-narrator podcast script. Not NPR, not a TED talk, not a textbook.

This script will be rendered as expressive audio by a TTS model. Write for the ear, not the eye. Every sentence should sound right read aloud — not just parse correctly on the page. A second pass will lightly insert audio cues like [chuckles] / [pauses] for delivery; your job is to write prose with the rhythm those cues will sit on top of.

Length: aim for {targetWords} words (~36-44 minutes at 150 wpm). Hard floor: 5400 words. Going long is fine; going short is not. Better to be 40 minutes of dense narrative than 25 minutes that feels rushed.

Universal rules:
- Open IN the topic. First sentence should land on a specific stat, moment, or person — never preamble. Examples that work: "Bezzera's first patent was filed on a Tuesday." / "There's a number that explains all of this: three." Examples that don't: "Today we'll explore...", "Imagine a world..."
- Build in natural breath points. A sentence that runs 30+ words without a comma will sound winded. Break it.
- Specific data, names, dates inline — fold sources into prose ("a 2019 Stanford study found..."), never reference indices like "[Source 4]".

{voicePersonality}

Self-check before finalizing:
- Count the words in the script body (excluding [CHAPTER:] markers and the JSON map). If under 5400 words, expand. The most common gap is thin middle chapters — each non-opening chapter should have at least 1050 words.
- Read each chapter's opening sentence aloud in your head. Does it grab a listener mid-thought? If not, find a sharper entry point.
- Read your last sentence aloud. If it doesn't feel like an ending, it isn't. Rewrite.
- Add concrete examples, named people, dates, quoted source material. Do not pad with filler or repeat yourself.

Hard avoids:
- Rhetorical self-Q&A. Never write "Was it that fast? Yep." or "Why does this matter? Because..." If a question helps the flow, leave it open and answer with a statement, not "Yep" or "The answer is".
- "Welcome to", "Today we're going to", "In this episode", "Let's dive in", "Let's talk about", "Without further ado".
- Generic transitions: "moving on", "next up", "and now", "speaking of".
- Listicle scaffolding ("First... Second... Third..."). Use prose flow.
- Section signposting ("So that was X, now we'll cover Y").
- Theatrical openings ("Picture this", "Imagine for a moment").
- Sign-offs like "thanks for listening" or "until next time".
- Inline audio tags. Do NOT write [chuckles] / [pauses] / etc. yourself — that's the next pass's job. Your output should be plain prose with [CHAPTER:] markers only.

Structure:
- Mark chapter breaks inline with [CHAPTER: Title]. Chapters should feel like the natural turns of a conversation, not a syllabus. Title them as observations, not subjects: "The patent that changed everything", not "Bezzera's Patent".
- 4-6 chapters total, including a cold-open chapter and a closer.
- The closer should land. One image, question, or observation the listener carries with them. Don't summarize — leave them with something to sit with.

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

### Task 9: Refactor `SCRIPT_WRITER_EXPANSION_PROMPT`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts:165-210`

- [ ] **Step 1: Replace `SCRIPT_WRITER_EXPANSION_PROMPT`**

Same three changes as the parent prompt:
1. Preamble — neutralize. Drop "(warm, conversational, low-energy confident)" from line 167.
2. Single-line "Voice rules:" at line 194 — replace with `{voicePersonality}` slot.
3. Keep `CRITICAL OPENING RULE` block verbatim (it's structural, not voice).

Replace the constant at lines 165-210 with:

```ts
export const SCRIPT_WRITER_EXPANSION_PROMPT = `You are writing a CONTINUATION episode of a podcast series. The listener already heard the parent podcast and now wants more depth on a specific chapter.

This script will be rendered as expressive audio by a TTS model. Write for the ear, not the eye.

CRITICAL OPENING RULE: your first chapter MUST open with a callback to the source chapter. Not "today we'll explore" or "imagine for a moment" — instead, sound like you're picking up a conversation: "Back in the chapter on \${sourceChapterTitle} we touched on X. Let's go deeper." Or: "Last time when I talked about \${sourceChapterTitle}, there was a moment where..." — make it feel like a continuation, not a restart.

Inputs:
- Source chapter title (the parent chapter being deepened)
- Source chapter transcript (what was actually said in the parent)
- The new research_document built specifically for this expansion (deeper, more specific)

What this script should do:
- Open with a clear callback to the source chapter (rule above)
- Pick up where the parent chapter ended in substance, not in time
- Add depth, specifics, mechanisms, cases — DON'T re-introduce material the parent already covered
- Build 4-6 chapters of your own depth (which can themselves be expanded later)
- Close in a way that lands the specific deepening — not "thanks for listening"

Hard avoids (same as parent):
- Rhetorical self-Q&A
- "Welcome to", "Today we're going to", "In this episode", "Let's dive in"
- Generic transitions
- Listicle scaffolding
- Section signposting
- Theatrical openings
- Inline audio tags (later pass handles these)

Length: aim for {targetWords} words. Hard floor: 5400 words. Going long is fine; going short is not.

{voicePersonality}

After the script, output the chapter_research_map JSON block (same format as the parent's pipeline).

{disclaimerContext}

Source chapter title: {sourceChapterTitle}

Source chapter transcript (what was said in the parent):
{parentChapterTranscript}

Research document (built for THIS expansion):
{researchDocument}

Sources:
{sources}
`;
```

### Task 10: Wire personality substitution into `scriptWriter.ts`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts`

- [ ] **Step 1: Add the import**

```ts
import { getVoicePersonality } from "../voicePersonality.js";
```

- [ ] **Step 2: Build the `voicePersonality` string and add it to the `.replace()` chain**

The existing `.replace()` chain in scriptWriter.ts lines 73-79 looks like this:

```ts
const prompt = promptTemplate
  .replace("{targetWords}", String(TARGET_WORD_COUNT))
  .replace("{researchDocument}", JSON.stringify(researchDocument))
  .replace("{sources}", JSON.stringify(sources))
  .replace("{disclaimerContext}", disclaimerContext)
  .replaceAll("{sourceChapterTitle}", state.sourceChapterTitle ?? "")
  .replace("{parentChapterTranscript}", state.parentChapterTranscript ?? "");
```

Just BEFORE the chain (before `const prompt = ...`), derive the personality string:

```ts
const personality = getVoicePersonality(state.voice);
const voicePersonality = `Voice personality:\n${personality.summary}\n\n${personality.scriptStyle}`;
```

Append `.replace("{voicePersonality}", voicePersonality)` to the chain. Order doesn't matter — append at the end is fine:

```ts
const prompt = promptTemplate
  .replace("{targetWords}", String(TARGET_WORD_COUNT))
  .replace("{researchDocument}", JSON.stringify(researchDocument))
  .replace("{sources}", JSON.stringify(sources))
  .replace("{disclaimerContext}", disclaimerContext)
  .replaceAll("{sourceChapterTitle}", state.sourceChapterTitle ?? "")
  .replace("{parentChapterTranscript}", state.parentChapterTranscript ?? "")
  .replace("{voicePersonality}", voicePersonality);
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 11: Update `scriptWriter.test.ts` for personality injection + assert old rules are gone

**Files:**
- Modify: `pipeline/tests/scriptWriter.test.ts`

- [ ] **Step 1: Add personality-injection tests**

Existing tests use the `__mockCreate` pattern. Mirror it. Append inside the existing `describe("scriptWriter", ...)` block:

```ts
  it("injects voice personality block for the chosen voice", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: A]\nNormal." } }],
    });
    mockModCreate.mockResolvedValue({ results: [{ flagged: false }] });

    await scriptWriter({
      podcastId: "p1",
      voice: "Sadaltager",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
      parentPodcastId: null,
    } as any);

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain("Voice personality:");
    // Sadaltager-specific content
    expect(systemPrompt).toContain("dinner-party historian");
    expect(systemPrompt).toContain("Name a specific person within the first three sentences");
    // Should NOT contain Sulafat-specific content
    expect(systemPrompt).not.toContain("friendly-knowledgeable-friend");
  });

  it("falls back to Sulafat's personality when voice is null", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: A]\nNormal." } }],
    });
    mockModCreate.mockResolvedValue({ results: [{ flagged: false }] });

    await scriptWriter({
      podcastId: "p1",
      voice: null,
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
      parentPodcastId: null,
    } as any);

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain("friendly-knowledgeable-friend");
  });

  it("does NOT contain the old generic 'Voice rules:' block", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: A]\nNormal." } }],
    });
    mockModCreate.mockResolvedValue({ results: [{ flagged: false }] });

    await scriptWriter({
      podcastId: "p1",
      voice: "Charon",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
      parentPodcastId: null,
    } as any);

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    // The stripped 11-bullet block had this distinctive bullet
    expect(systemPrompt).not.toMatch(/Talk like a person, not a presenter/);
    // And this one
    expect(systemPrompt).not.toMatch(/Restarts are conversational\./);
    // But the universal cold-open rule MUST survive
    expect(systemPrompt).toContain("Open IN the topic");
    // And the citation rule
    expect(systemPrompt).toContain("never reference indices like");
  });
```

- [ ] **Step 2: Run scriptWriter tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/scriptWriter.test.ts 2>&1 | tail -15
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit Chunk 4**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/scriptWriter.ts pipeline/tests/scriptWriter.test.ts && git commit -m "feat(script): strip generic voice rules, inject per-voice personality

SCRIPT_WRITER_PROMPT: drop 'knowledgeable friend' preamble, drop the
'(warm, conversational, low-energy confident)' parenthetical, strip 8
of 11 'Voice rules:' bullets (keep cold-open, breath points, citation
discipline as 'Universal rules:'), add {voicePersonality} slot.

SCRIPT_WRITER_EXPANSION_PROMPT: same parenthetical drop, replace the
single-line Voice rules with {voicePersonality} slot. CRITICAL OPENING
RULE stays verbatim — it's structural, not voice."
```

---

## Chunk 5: tagInjector integration

### Task 12: Rewrite `TAG_INJECTOR_PROMPT`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/tagInjector.ts:10-47`

- [ ] **Step 1: Replace the `TAG_INJECTOR_PROMPT` function with the new version**

Find the existing function (lines 10-47) and replace with:

```ts
const TAG_INJECTOR_PROMPT = (
  script: string,
  tags: readonly string[],
  voiceName: string,
  summary: string,
  scriptStyle: string,
) => `You are inserting audio tags into a podcast script that will be read aloud by an expressive TTS model (Gemini's ${voiceName} voice).

Voice context:
${summary}

${scriptStyle}

The script was written specifically for this voice. Pick tags that reinforce its feel, not fight it.

Available tags: ${tags.map((t) => `[${t}]`).join(", ")}

Take the script and insert audio tags from the list above. Place each tag immediately before the phrase or sentence it's meant to influence. Ensure the tag matches the emotional arc of the narrative. Avoid overusing tags. Place them where a natural change in tone or pace would occur. One tag per sentence maximum.

Do NOT modify the script's text, only insert bracketed tags.
Preserve all [CHAPTER: ...] markers verbatim.
Preserve any [AD:PRE_ROLL] / [AD:MID_ROLL] markers verbatim.

Script:
${script}
`;
```

Note: this is template-literal interpolation (the args land directly), not `.replace()` substitution. The function shape changes from `(script, tags) => string` to `(script, tags, voiceName, summary, scriptStyle) => string`.

The spec's Section 2 sketch passes `personality` as an object (4 args). Flattening to 5 args here is a deliberate choice — it removes a tiny layer of internal-field coupling and matches the template-literal interpolation pattern more cleanly. Functionally identical.

### Task 13: Wire voice + personality into `tagInjector`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/tagInjector.ts`

- [ ] **Step 1: Add the import**

At the top of the file:

```ts
import { getVoicePersonality } from "../voicePersonality.js";
```

- [ ] **Step 2: Update the call to `TAG_INJECTOR_PROMPT`**

Find the existing call (~line 70):

```ts
client.models.generateContent({
  model: GEMINI_TAG_INJECTOR_MODEL,
  contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS),
})
```

Just above it, derive the voice + personality:

```ts
const voiceName = state.voice ?? "Sulafat";
const { summary, scriptStyle } = getVoicePersonality(state.voice);
```

Update the call:

```ts
client.models.generateContent({
  model: GEMINI_TAG_INJECTOR_MODEL,
  contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS, voiceName, summary, scriptStyle),
})
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 14: Update `tagInjector.test.ts` for personality injection

**Files:**
- Modify: `pipeline/tests/tagInjector.test.ts`

- [ ] **Step 1: Add personality-injection tests inside the existing describe block**

Existing tests mock `getGeminiClient` and inspect `generateContent` calls. Mirror that pattern. Add:

```ts
  it("injects voice personality summary into the prompt for the chosen voice", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: "Charon",
    } as any);

    const call = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    expect(call.contents).toContain("Voice context:");
    expect(call.contents).toContain("Substance-forward");
    expect(call.contents).toContain("Gemini's Charon voice");
  });

  it("falls back to Sulafat when voice is null", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: null,
    } as any);

    const call = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    expect(call.contents).toContain("friendly-knowledgeable-friend");
    expect(call.contents).toContain("Gemini's Sulafat voice");
  });

  it("preserves the hard-constraint rules in the new simplified prompt", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: "Sulafat",
    } as any);

    const call = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    expect(call.contents).toContain("Place each tag immediately before");
    expect(call.contents).toContain("Preserve all [CHAPTER: ...] markers verbatim");
    expect(call.contents).toContain("[AD:PRE_ROLL]");
    expect(call.contents).toContain("[AD:MID_ROLL]");
    expect(call.contents).toMatch(/One tag per sentence maximum/);
  });
```

The existing test name "includes AUDIO_TAGS values in the prompt" still passes (the new prompt still has `Available tags: ${tags.map(...)}`). The existing mock is hoisted at the top of the file as `const mockGenerateContent = vi.hoisted(() => vi.fn());` — use that name directly.

- [ ] **Step 2: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/tagInjector.test.ts 2>&1 | tail -10
```

Expected: existing 5 tests pass + 3 new = 8 total.

- [ ] **Step 3: Commit Chunk 5**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/podcast_pipeline/nodes/tagInjector.ts pipeline/tests/tagInjector.test.ts && git commit -m "feat(tags): rewrite tagInjector prompt with voice context + Google-style framing

Signature: (script, tags) → (script, tags, voiceName, summary, scriptStyle).
Prompt shrinks from ~40 lines (bucket-categorized tag rules) to ~22
lines (simple insertion rules + voice context block). Hard constraints
(preserve markers, no text modification, one tag per sentence) stay."
```

---

## Chunk 6: End-to-end verification

### Task 15: Run the full pipeline test suite + tsc

**Files:** none modified.

- [ ] **Step 1: Pipeline tsc**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 2: Mobile tsc** (sanity — no mobile changes expected)

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Full unit test suite**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run --exclude tests/integration 2>&1 | tail -5
```

Expected: ~208 tests pass (baseline 194, +6 voicePersonality, +2 briefBuilder, +3 scriptWriter, +3 tagInjector). 0 failures.

### Task 16: Surface deploy + manual smoke-test plan to the user

**Files:** none modified.

- [ ] **Step 1: STOP — do NOT deploy autonomously**

This task hands off to the user. The implementer surfaces the deploy instructions and smoke-test plan; the user runs the Railway deploy. Do not attempt `railway up`, `mcp__Railway__deploy`, or similar from the implementer agent.

Surface this to the user:

> "Implementation complete on branch `<branch>`. Ready for deploy. Run `mcp__Railway__deploy --workspacePath /Users/isuru/personal/AI Podcast App/pipeline --service podcasts --ci true` or your usual Railway workflow. After deploy, run the smoke-test plan below on the mobile app."

- [ ] **Step 2: Manual smoke test plan for the user**

User-side verification, not automatable:

1. Generate a fresh podcast with each of the four voices on the same topic. Suggested topic: "history of espresso machines in Italy".
2. Listen to a chapter from each. Check for personality drift:
   - **Sulafat**: contractions, em-dash asides, dry "huh" moments, lingering closing
   - **Charon**: short sentences, named cases, no hedging, clean takeaway closer
   - **Sadaltager**: longer sentences, scene-first chapter openings, past-tense narration, named historical figures within first three sentences
   - **Achird**: faster pacing, "yeah, so" connective tissue, punchy one-liner closing
3. If Sulafat and Sadaltager still sound too similar, sharpen Sadaltager's `scriptStyle` further (more specific mechanical tics — e.g., require dates in chapter openings).
4. If tag density drifts (too few or too many tags per chapter), tune the "Avoid overusing tags" line in `TAG_INJECTOR_PROMPT`. The spec calls out this risk.

---

## Phase exit criteria

Before declaring v18 done:

- `npx vitest run --exclude tests/integration` in pipeline: all green (~200+ tests).
- `npx tsc --noEmit` in pipeline + mobile: both clean.
- Manual smoke test (Task 16, Step 2) confirms perceptible personality difference between at least two voices when listened side-by-side on the same topic.
- No remaining `TODO` / `FIXME` markers in the modified files.

## Reverting

Single PR, no DB migration. Revert path is `git revert <merge-commit>` followed by Railway redeploy. ~5 minutes. Old completed podcasts unaffected.

## What ships

- Four voices now sound meaningfully different on the same content.
- Audio tag vocabulary expanded from 10 to ~200; tagInjector picks contextually based on voice personality.
- Generic "Voice rules" content removed from scriptWriter prompts; replaced with per-voice blocks.
- briefBuilder shapes research questions based on voice's natural angle.
- No mobile changes. No DB migration. No new env vars.
