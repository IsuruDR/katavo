# Voice Personality Propagation

**Goal:** When a user picks Sulafat (warm) vs Charon (informative), the generated podcast should *feel* different. Today only the TTS render reads `state.voice`; earlier nodes produce voice-blind output, so the same content read in different voices sounds generic. Fix: thread per-voice personality data into `briefBuilder`, `scriptWriter`, and `tagInjector`.

**Scope:** Pipeline-side only. No DB migration. No mobile changes. No feature flag.

**Status:** Brainstorm approved 2026-05-13.

---

## Why this exists

`state.voice` is currently consumed at exactly one place: `audioProducer` calls `GeminiTTS.synthesize(text, voice)`, which sets `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` on the Gemini TTS request. The voice picks **timbre** at render time. The script text being read is identical regardless of who's reading it.

That's why Sulafat doesn't sound like Sulafat. The text was written for a generic narrator. Gemini reads it in Sulafat's voice but the prose was never shaped to match the personality.

Five nodes write text, only one reads `state.voice`:

| Node | Currently reads `state.voice`? | Should it? |
|---|---|---|
| briefBuilder | No | Yes, lightly. Voice shapes what kind of answers research should produce. |
| planner / subagent / synthesizer | No | No. Decomposing research is voice-agnostic. |
| scriptWriter | No | Yes. Biggest leverage point. Prose style, sentence rhythm, humor. |
| tagInjector | No | Yes. Which tags to pick depends on the voice. |
| audioProducer / Gemini TTS | Yes | Yes, already correct. |

So three nodes get a new dependency on voice. Three new injection sites, one source of truth.

---

## Architecture

### Data model

New file: `pipeline/src/podcast_pipeline/voicePersonality.ts`.

```ts
import type { GeminiVoice } from "./config.js";

export interface VoicePersonality {
  /** One-line headline. Used in logs and as the prompt summary. */
  summary: string;

  /** Sentence-long nudge for briefBuilder. Shapes what kinds of
   *  answers the research stage should produce for this voice. */
  briefAngle: string;

  /** ~5 lines of prose guidance. Inserted into scriptWriter AND
   *  tagInjector as a "Voice context" block. Covers tone, sentence
   *  rhythm, humor, asides, closings. Everything the generic
   *  "Voice rules" used to cover, but per-voice. */
  scriptStyle: string;
}

export const VOICE_PERSONALITIES: Record<GeminiVoice, VoicePersonality> = {
  Sulafat: { /* see Section 4 */ },
  Charon: { /* see Section 4 */ },
  Sadaltager: { /* see Section 4 */ },
  Achird: { /* see Section 4 */ },
};

/** Falls back to Sulafat (the mobile default) when state.voice is null
 *  or doesn't match a known voice. The generic prompt path is removed
 *  in this refactor; every prompt always reads a real personality. */
export function getVoicePersonality(
  voice: string | null | undefined,
): VoicePersonality {
  if (voice && voice in VOICE_PERSONALITIES) {
    return VOICE_PERSONALITIES[voice as GeminiVoice];
  }
  return VOICE_PERSONALITIES.Sulafat;
}
```

`Record<GeminiVoice, VoicePersonality>` forces all four voices to be defined at compile time. TypeScript fails the build if any are missing.

### Diagrams

Data flow — which personality field reaches which node:

```mermaid
flowchart LR
  state[(PipelineState<br/>voice)] --> bb[briefBuilder]
  state --> sw[scriptWriter]
  state --> ti[tagInjector]
  state --> ap[audioProducer]

  vp[VOICE_PERSONALITIES] -.briefAngle.-> bb
  vp -.summary + scriptStyle.-> sw
  vp -.summary + scriptStyle.-> ti
  vp -.voice timbre.-> ap
```

Prompt-template surgery — what each prompt looks like before/after:

```mermaid
flowchart LR
  subgraph Before
    BB1["BRIEF_BUILDER_PROMPT<br/>(no voice slot)"]
    SW1["SCRIPT_WRITER_PROMPT<br/>11-bullet 'Voice rules:'<br/>+ Sulafat preamble"]
    TI1["TAG_INJECTOR_PROMPT(script, tags)<br/>~40 lines, voice-blind"]
  end
  subgraph After
    BB2["BRIEF_BUILDER_PROMPT<br/>+ '{voiceAngle}' slot"]
    SW2["SCRIPT_WRITER_PROMPT<br/>3-bullet 'Universal rules:'<br/>+ '{voicePersonality}' slot<br/>+ neutral preamble"]
    TI2["TAG_INJECTOR_PROMPT(script, tags, voiceName, personality)<br/>~22 lines, voice-aware"]
  end
  BB1 --> BB2
  SW1 --> SW2
  TI1 --> TI2
```

---

## Section 2: Prompt refactors per node

Approach: **strip voice content out of the generic prompts, inject per-voice content via placeholders.** Generic prompt holds structure and format only. Per-voice content holds tone and personality.

### Injection map

| Prompt | Placeholder | Filled from |
|---|---|---|
| BRIEF_BUILDER_PROMPT | `{voiceAngle}` | `personality.briefAngle` |
| BRIEF_BUILDER_EXPANSION_PROMPT | `{voiceAngle}` | `personality.briefAngle` |
| SCRIPT_WRITER_PROMPT | `{voicePersonality}` | `personality.summary + "\n\n" + personality.scriptStyle` |
| SCRIPT_WRITER_EXPANSION_PROMPT | `{voicePersonality}` | same as above |
| TAG_INJECTOR_PROMPT (function) | `{voiceName}`, `{summary}`, `{scriptStyle}` | passed as args |

### briefBuilder (both modes)

`BRIEF_BUILDER_PROMPT` and `BRIEF_BUILDER_EXPANSION_PROMPT` each gain one new line near the top:

```
Voice angle: {voiceAngle}
```

Where `{voiceAngle}` is `VOICE_PERSONALITIES[voice].briefAngle`.

**Wiring note:** `briefBuilder.ts` does not do template substitution today — it passes the prompt constant verbatim as the system message. Add a `.replace("{voiceAngle}", voiceAngle)` step before the `structured.invoke(...)` call, in both the expansion-mode and normal-mode branches. Without this, the literal string `{voiceAngle}` would land in the system message sent to gpt-4o.

### scriptWriter (both modes)

The generic `SCRIPT_WRITER_PROMPT` is not just one "Voice rules:" block — it has voice-flavored content in three places that all need handling:

**1. Preamble (line 104).** Currently: "You are writing a single-narrator podcast in the voice of a knowledgeable friend talking through a topic at a coffee table — think Acquired, Hard Fork, or Stratechery read aloud. Not NPR, not a TED talk, not a textbook."

The "knowledgeable friend at a coffee table" framing is Sulafat-flavored. Charon is more analyst, Sadaltager more historian. **Neutralize to:** "You are writing a single-narrator podcast script. Not NPR, not a TED talk, not a textbook." The personality block carries the speaker framing.

**2. Voice descriptor parenthetical (line 106).** Currently: "This script will be rendered as expressive audio by a TTS model with a chosen voice (warm, conversational, low-energy confident)."

The "(warm, conversational, low-energy confident)" parenthetical describes Sulafat. **Drop the parenthetical entirely.** Keep the rest of the sentence.

**3. "Voice rules:" 11-bullet list (lines 110-121).** Not all bullets are voice content. Split:

| Bullet | Content | Action |
|---|---|---|
| 1 | "Open IN the topic. First sentence should land on a specific stat..." | KEEP — structural cold-open rule, universal |
| 2 | "Talk like a person, not a presenter. 'you know'/'kinda'..." | STRIP — Sulafat/Achird-leaning casual register |
| 3 | "Audio rhythm matters as much as content. Short sentences land — Long sentences breathe..." | STRIP — voice-specific rhythm prescription |
| 4 | "Build in natural breath points. 30+ word sentence without a comma sounds winded" | KEEP — universal audio rule |
| 5 | "Sentence fragments work" | STRIP — voice-specific |
| 6 | "Use em-dash asides — like this —" | STRIP — voice-specific |
| 7 | "Restarts are conversational. 'Or rather—'..." | STRIP — Sulafat/Achird-leaning |
| 8 | "Dry humor lands on a beat of its own" | STRIP — Sulafat-leaning |
| 9 | "Vary sentence length aggressively" | STRIP — voice-specific advice |
| 10 | "Specific data, names, dates inline — fold sources into prose; never reference indices like '[Source 4]'" | KEEP — structural citation rule |
| 11 | "Use contractions naturally" | STRIP — voice-specific (Charon uses sparingly) |

After the strip: rename the block to "**Universal rules:**" and keep bullets 1, 4, 10 (three bullets total). Insert the `{voicePersonality}` placeholder block just below the renamed block. The self-check section, hard-avoids list, structure section, and `chapter_research_map` output format all stay verbatim.

**4. SCRIPT_WRITER_EXPANSION_PROMPT specifics.** Same three changes as above:
- Preamble line 167 has the same Sulafat parenthetical — drop the parenthetical.
- Single-line "Voice rules:" at line 194 — this whole line gets replaced with `{voicePersonality}`. (No 11-bullet split here; the expansion prompt was already a leaner version.)
- The "CRITICAL OPENING RULE" block at line 169 is structural (continuation callback) — keep verbatim.

**Wiring note:** `scriptWriter.ts` already does `.replace()` substitution. Add `.replace("{voicePersonality}", voicePersonality)` to the existing chain. Both prompts use the same chain.

### tagInjector

Two changes:

1. The function signature `TAG_INJECTOR_PROMPT(script, tags)` becomes `TAG_INJECTOR_PROMPT(script, tags, voiceName, personality)`.
2. The prompt itself shrinks substantially. Currently ~40 lines with bucket-categorized tag rules ("delivery tags freely, strong-emotion tags reserved"). New version follows Google's official tagging prompt pattern: simpler, with voice context.

New `TAG_INJECTOR_PROMPT`:

```
You are inserting audio tags into a podcast script that will be read
aloud by an expressive TTS model (Gemini's {voiceName} voice).

Voice context:
{summary}

{scriptStyle}

The script was written specifically for this voice. Pick tags that
reinforce its feel, not fight it.

Available tags: {tags}

Take the script and insert audio tags from the list above. Place each
tag immediately before the phrase or sentence it's meant to influence.
Ensure the tag matches the emotional arc of the narrative. Avoid
overusing tags. Place them where a natural change in tone or pace
would occur. One tag per sentence maximum.

Do NOT modify the script's text, only insert bracketed tags.
Preserve all [CHAPTER: ...] markers verbatim.
Preserve any [AD:PRE_ROLL] / [AD:MID_ROLL] markers verbatim.

Script:
{script}
```

### Asymmetry rationale

Why replace in scriptWriter, append in tagInjector?

`scriptWriter`'s "Voice rules" block IS voice content. It conflicts with per-voice prose guidance. Has to be replaced or both blocks fight.

`tagInjector`'s rules (insert before the phrase, one per sentence, match the arc, avoid overuse) are tag-vocabulary-agnostic. They describe HOW to tag, not WHAT feel. They survive the voice swap. The voice context just primes the model on which tags fit the personality.

---

## Section 3: Audio tag set expansion

Today `AUDIO_TAGS_DEFAULT` is 10 hand-picked tags (`laughs`, `whispers`, `sighs`, `chuckles`, `curious`, `thoughtful`, `serious`, `surprised`, `exhales`, `pauses`). The tagInjector prompt's selection rules enumerate these by name.

This refactor expands the set to ~200 tags covering granular emotions, energy levels, pacing, cognitive states, narrative markers, and reactions. Examples: `acceptance`, `admiration`, `anticipation`, `bargaining`, `concentration`, `contemplative`, `disillusionment`, `effervescence`, `incredulity`, `melancholy`, `nostalgia`, `pensive`, `recognition`, `reminiscence`, `self-deprecation`, `wistful`. Plus pacing tags `short pause`, `long pause`, `slow`, `fast`. Plus energy tags `high energy`, `low energy`, `active`, `passive`.

The full list (kept in a new file, `pipeline/src/podcast_pipeline/audioTags.ts`, to avoid bloating `config.ts`) is the one provided in the brainstorm.

The env var override (`process.env.AUDIO_TAGS`) stays. Default switches to the full list.

This is what motivated the tagInjector prompt rewrite. The old "delivery vs strong-emotion" categorization can't scale to 200 tags. The new prompt + voice context lets the model pick appropriately without us pre-categorizing.

---

## Section 4: Voice personality content

The four personality blocks. Each combines Gemini's official one-word descriptor with the mobile UI descriptor and project-specific tone direction.

### Sulafat (Gemini: Warm)

- **summary:** "Warm, conversational. The friendly-knowledgeable-friend voice. Dry humor on a beat, never performed."
- **briefAngle:** "Lean toward questions that surface concrete scenes and lived experience, not just statistics. Answers should have texture."
- **scriptStyle:**
  ```
  Lead with curiosity, not authority. Sentences run a beat longer than
  necessary, like thinking out loud. Contractions natural; em-dash
  asides welcome.

  Dry humor lands on a beat — a "huh" between two clauses, an aside
  parenthetical, a small under-statement. Never setup-and-punchline.
  Personal asides are appropriate: "and honestly", "the part that gets
  me", "here's the thing".

  Treat the listener as a smart friend, not a student. Don't over-
  explain mechanisms; trust them to keep up. Closings linger — let the
  last sentence breathe instead of buttoning it up.
  ```

### Charon (Gemini: Informative)

- **summary:** "Substance-forward, journalistic. The analyst voice. Cuts every word that doesn't carry information."
- **briefAngle:** "Lean toward questions that produce specifics: numbers, dates, named cases, primary sources. Avoid abstract framings."
- **scriptStyle:**
  ```
  Cut every word that doesn't carry information. Sentences short by
  default, long only when the data demands it. Contractions sparingly.

  State, don't gesture: "three hundred horsepower" not "around three
  hundred or so". Specifics, not vibes. No hedging language ("sort of",
  "kind of", "I guess") — confident verbs.

  Asides are rare and pointed; if you write one, make sure it earns the
  digression. Closings are clean: state the takeaway and stop.
  ```

### Sadaltager (Gemini: Knowledgeable)

- **summary:** "Thoughtful, lyrical. The dinner-party historian voice. Anchors abstractions in scenes and named people."
- **briefAngle:** "Lean toward questions that surface tensions, irony, named individuals, and unresolved aspects. Answers should suggest the human stories behind the facts and include dates and specific places."
- **scriptStyle:**
  ```
  Open each chapter with a scene or anecdote before the abstraction:
  a person at a moment, a date and a place, a single object that
  carries the argument. Name a specific person within the first three
  sentences of every chapter. Favor past-tense narration over
  present-tense exposition — "in 1903, Bezzera filed..." not
  "Bezzera's design works by..."

  Longer sentences than the others — the prose breathes. Em-dashes and
  parentheticals welcome. Contractions natural.

  Reflective asides happen in retrospect: "what they didn't realize at
  the time", "what's interesting in hindsight", "the part historians
  still argue about". Allow the prose to wander, then return to the
  point.

  Closings land on a quiet historical irony or an observation about
  what's still unresolved. Never a thesis statement.
  ```

### Achird (Gemini: Friendly)

- **summary:** "Casual, bright, energetic. The coffee-shop voice. Faster pacing, more restarts, genuine enthusiasm."
- **briefAngle:** "Lean toward questions that lend themselves to direct examples and 'you know how' framings. Answers should translate into clear stories."
- **scriptStyle:**
  ```
  Faster pacing. Shorter sentences. More restarts, more contractions,
  more "yeah, so" connective tissue.

  Sounds like someone excited to share, but doesn't perform — genuine
  enthusiasm, not theatrics. Direct address welcome: "you know how",
  "you'd think", "the thing is". Quick punches of humor are fine; keep
  them light, not biting.

  Closings can be punchy. A one-liner is appropriate.
  ```

Note: em-dashes within `scriptStyle` are intentional. They're LLM prompt content that informs prose rhythm and TTS prosody. They're not human-facing copy.

---

## Section 5: Null-voice fallback

`state.voice` can be null today (when a user hasn't set a preference, or for legacy rows). `getVoicePersonality(null)` returns Sulafat's block. Sulafat is already the mobile default. No code path renders the "generic" prompt.

This is a deliberate trade-off. The generic prompt path is gone in this refactor. Every podcast generation runs against a real personality block. If we ever introduce a fifth voice we'd add it to `VOICE_PERSONALITIES` and `GEMINI_VOICES`; TypeScript would fail the build until both updates land.

---

## Section 6: Tests

### New: `pipeline/tests/voicePersonality.test.ts`

- `getVoicePersonality("Sulafat")` returns Sulafat
- `getVoicePersonality(null)` returns Sulafat
- `getVoicePersonality("unknown")` returns Sulafat
- Iterates `VOICE_PERSONALITIES` and asserts each entry has all three fields non-empty

### Modified: `pipeline/tests/tagInjector.test.ts`

The file already exists with 5 tests (88 lines) covering tag insertion, SDK-error fallthrough, empty-output fallthrough, chapter-marker-mismatch fallthrough, and `AUDIO_TAGS` presence. Mocking pattern is the existing `vi.mock("../src/podcast_pipeline/providers/gemini.js")`.

Add to the existing file:
- Assert personality summary text appears in the prompt for Sulafat.
- Assert a different personality summary appears when voice is Charon.
- Assert hard constraints survive: `[CHAPTER:`, `[AD:PRE_ROLL]`, `[AD:MID_ROLL]` preservation rules are present.
- Assert the new simplified rule block is present (e.g. `/Place each tag immediately before/`).
- Add a null-voice case asserting Sulafat's content appears (fallback).

### Edits to existing test files

- `briefBuilder.test.ts` — assert `briefAngle` content appears in the prompt when voice set. Cover null-voice fallback. Both normal and expansion modes.
- `scriptWriter.test.ts` — assert `summary + scriptStyle` content appears AND the old generic `Voice rules: short sentences` string is GONE. Both modes.

### Verification

- `npx tsc --noEmit` clean in pipeline
- `npx vitest run --exclude tests/integration` all green (193+ → 198+)
- Manual smoke test via mobile: generate a new podcast under each of the four voices, listen, look for personality drift between voices.

---

## Section 7: Rollout

Single PR. Deploys to Railway like any other pipeline change. No DB migration. No feature flag.

Old completed podcasts are unaffected; they're already in storage. The next pipeline run after deploy uses the new prompts.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Typo or self-contradiction inside one voice's `scriptStyle` makes that voice produce odd output | Low | `tts-eval --inject-tags` lets us iterate fast on the tagInjector personality block; Langfuse traces show the rendered prompt per generation |
| New 200-tag set produces too many or too few tags in practice | Medium | Tunable in one line ("avoid overusing" can become "aim for roughly one tag per 2-3 sentences" if density drifts wrong) |
| Voice personality block conflicts with `scriptWriter`'s structural rules | Low | Replacement strategy (not append) avoids the conflict; structural rules stay voice-agnostic |
| 200-tag list inflates tagInjector prompt token cost | Low | ~190 extra input tokens per call on gemini-2.5-flash, roughly $0.0001 incremental per podcast. Negligible. |
| In-flight podcasts during deploy see mixed-version prompts | None | LangGraph pipeline runs are not resumable across deploys today; each pipeline instance is in-memory only. A Railway restart aborts in-flight runs and `recoverStuckJobs` re-enqueues from scratch with the new prompts. |
| Reverting requires a redeploy | Low | ~1 minute via `npm run deploy` to Railway |

### Out of scope

- **Langfuse migration of prompts.** Considered and parked. We can revisit once personality content stabilises. The current setup edits via redeploy; Langfuse would let us edit at runtime. Not urgent.
- **Per-voice full prompt variants.** Considered and rejected. Maintaining four parallel copies of `SCRIPT_WRITER_PROMPT` diverges fast.
- **Voice-aware metadata generation (titles, descriptions).** Smaller leverage; not part of this pass.
- **Custom user-defined voices.** Not on the roadmap yet.
- **Converging mobile picker descriptors and pipeline summaries.** The mobile `voiceSamples.ts` descriptors (UI marketing copy) and the pipeline `summary` fields (LLM prompt content) describe the same voices for different audiences. Intentionally written independently for now. If they drift, we can converge later by having mobile read the pipeline-side summaries.

---

## File summary

### New

| Path | Purpose |
|---|---|
| `pipeline/src/podcast_pipeline/voicePersonality.ts` | `VoicePersonality` interface, `VOICE_PERSONALITIES` map, `getVoicePersonality` helper |
| `pipeline/src/podcast_pipeline/audioTags.ts` | Full 200-tag set; imported by `config.ts` for backward compat |
| `pipeline/tests/voicePersonality.test.ts` | Unit tests for the helper and the map |

### Modified

| Path | What changes |
|---|---|
| `pipeline/src/podcast_pipeline/config.ts` | Strip "Voice rules" from `SCRIPT_WRITER_PROMPT` and `SCRIPT_WRITER_EXPANSION_PROMPT`, add `{voicePersonality}` slot; add `{voiceAngle}` slot to `BRIEF_BUILDER_PROMPT` and `BRIEF_BUILDER_EXPANSION_PROMPT`. Replace `AUDIO_TAGS_DEFAULT` array with import from `audioTags.ts` |
| `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts` | Build `voiceAngle` from `getVoicePersonality(state.voice).briefAngle`; pass to prompt fill |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | Build `voicePersonality` from `summary + scriptStyle`; pass to prompt fill |
| `pipeline/src/podcast_pipeline/nodes/tagInjector.ts` | Change `TAG_INJECTOR_PROMPT` signature to take voice + personality; rewrite to simpler Google-style prompt with voice context block |
| `pipeline/tests/briefBuilder.test.ts` | Add personality-injection assertions; null-voice fallback case |
| `pipeline/tests/scriptWriter.test.ts` | Add personality-injection assertions; assert old generic block is gone |
| `pipeline/tests/tagInjector.test.ts` | Add personality-injection assertions; null-voice fallback case |
