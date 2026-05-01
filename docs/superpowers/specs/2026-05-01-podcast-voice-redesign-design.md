# Podcast voice redesign — script prompt + TTS instructions + voice swap

**Date:** 2026-05-01
**Status:** Draft
**Author:** Isuru + Claude

## Why this exists

The first two podcasts off the new pipeline (espresso machines, walking-and-calories) sound like read-aloud articles, not podcasts. Two problems landed in the same listen:

1. **The wording reads written.** Polished sentences, no asides, no disfluencies, predictable structure. The model occasionally falls into rhetorical self-Q&A ("Was it really that fast? Yep.") which is a classic LLM-podcast tic and the most ear-grating part.
2. **The voice delivery is even.** TTS hits announcer cadence and stays there — no warmth, no real micro-pauses, no shape on names or numbers.

We also undershoot the promised "~10 minute" duration: actual playback runs 6-7 min from ~970 words. The model is producing about 65% of the 1500-word target.

Goal: a single-narrator podcast that sounds like a knowledgeable friend at a coffee table — Acquired / Hard Fork / Stratechery vibe — and runs 9-12 minutes consistently.

## What we're changing

Three concrete changes, all in `pipeline/src/podcast_pipeline/config.ts`:

1. Rewrite `SCRIPT_WRITER_PROMPT` to bake in the conversational style, ban the rhetorical-Q&A and announcer tics, and treat the word count as a floor instead of a soft target.
2. Bump `TARGET_WORD_COUNT` from 1500 → 2200, since the model reliably underdelivers.
3. Rewrite `TTS_VOICE_INSTRUCTIONS` to give `gpt-4o-mini-tts` specific direction on pacing, em-dash asides, and disfluencies, plus an explicit anti-direction list.
4. A/B test 3 OpenAI voice candidates (sage, ash, ballad) against the current coral, pick the winner, update `TTS_VOICE`.

We are explicitly **not** doing two-host mode in this pass. That's a bigger refactor (audioProducer needs voice alternation per segment, prompt needs speaker turn markers, longer total audio) and worth its own spec when we're ready.

## New `SCRIPT_WRITER_PROMPT`

```
You are writing a single-narrator podcast in the voice of a knowledgeable
friend talking through a topic at a coffee table — think Acquired, Hard Fork,
or Stratechery read aloud. Not NPR, not a TED talk, not a textbook.

Length: aim for {targetWords} words (~12-14 minutes at 150 wpm). Hard floor:
1800 words. Going long is fine; going short is not. Better to be 12 minutes
of dense narrative than 7 minutes that feels rushed.

Voice rules:
- Open IN the topic. First sentence should land on a specific stat, moment,
  or person — never preamble. Examples that work: "Bezzera's first patent
  was filed on a Tuesday." / "There's a number that explains all of this:
  three." Examples that don't: "Today we'll explore...", "Imagine a world..."
- Talk like a person, not a presenter. A few "you know"s, "kinda"s,
  "I mean"s scattered through. An occasional "huh" or "anyway" between
  thoughts. Don't overdo it — once or twice per chapter.
- Use em-dash asides — like this — for the parts you'd lower your voice for.
- Vary sentence length aggressively. Short ones land. Long ones, with the
  texture of someone actually thinking through a sentence, breathe.
- Specific data, names, dates inline — fold sources into prose ("a 2019
  Stanford study found..."), never reference indices like "[Source 4]".
- Dry humor where it fits. Never punchlines or jokes — just the occasional
  amused observation.

Self-check before finalizing: count the words in the script body
(excluding [CHAPTER:] markers and the JSON map). If under 1800 words,
expand. The most common gap is thin middle chapters — each non-opening
chapter should have at least 350 words. Add concrete examples, named
people, dates, quoted source material. Do not pad with filler or repeat
yourself.

Hard avoids:
- Rhetorical self-Q&A. Never write "Was it that fast? Yep." or "Why does
  this matter? Because..." If a question helps the flow, leave it open and
  answer with statement, not "Yep" or "The answer is".
- "Welcome to", "Today we're going to", "In this episode", "Let's dive in",
  "Let's talk about", "Without further ado".
- Generic transitions: "moving on", "next up", "and now", "speaking of".
- Listicle scaffolding ("First... Second... Third..."). Use prose flow.
- Section signposting ("So that was X, now we'll cover Y").
- Theatrical openings ("Picture this", "Imagine for a moment").
- Sign-offs like "thanks for listening" or "until next time".

Structure:
- Mark chapter breaks inline with [CHAPTER: Title]. Chapters should feel
  like the natural turns of a conversation, not a syllabus. Title them as
  observations, not subjects: "The patent that changed everything", not
  "Bezzera's Patent".
- 4-6 chapters total, including a cold-open chapter and a closer.
- The closer doesn't summarize. It leaves the listener with one image,
  question, or sentence that lingers.

{disclaimerContext}

After the script, output the chapter-to-research mapping as before:
```chapter_research_map
{
  "Chapter Title": { "researchSections": [0, 1], "sourceIndexes": [0, 2] },
  ...
}
```

Research document:
{researchDocument}

Sources:
{sources}
```

Biggest deltas vs the current prompt: a long hard-avoids list (the read-along feel mostly comes from these tics), explicit instructions to talk like a person with concrete examples, an explicit ban on rhetorical self-Q&A, and chapter titles framed as observations rather than subjects.

## New `TTS_VOICE_INSTRUCTIONS`

```
Speak like a knowledgeable friend recording a podcast at a coffee table —
not a presenter, not a narrator. Tone: warm, slightly amused, low-energy
confident.

Pacing: moderate. Take micro-pauses before complex names, numbers, or
dates so they land. Take longer breaths at chapter transitions and after
big ideas. Don't rush.

Emphasis: lift specific data, names, and dates lightly. Never theatrical
— this isn't a movie trailer. Lean into the natural stress of a sentence,
not engineered punchlines.

Em-dash asides — like this — should drop slightly in pitch and pick up
in pace, then return to the main line. They're throwaway thoughts, not
announcements.

Disfluencies like "you know," "kinda," "I mean," "huh," "anyway" should
sound thrown away — quick and unstressed, not deliberate. Don't perform
them.

Avoid: announcer cadence, evenly-spaced sentence rhythm, theatrical
sweeps, building to false drama, signpost intonation on chapter titles,
"podcast voice."
```

Why these changes work better than the current four-line block:
- Anchors on a specific scene ("coffee table") rather than an adjective ("engaging"). gpt-4o-mini-tts is much better at hitting tone when given a scene.
- Gives explicit treatment for em-dash asides and disfluencies. Without that, TTS would perform them as regular sentence material, which is what makes them feel forced.
- Anti-direction list. Telling the model what *not* to do is often more useful than telling it what to do.

## Voice swap A/B test

Test methodology, not a permanent capability:

1. Pull the transcript of an existing complete podcast (e.g. the espresso machine one) from Supabase.
2. Take chapter 1 only — about 250-350 words, ~75 sec of audio per voice.
3. Render that chapter four times using the **new** `TTS_VOICE_INSTRUCTIONS`:
   - `coral` (control — current voice)
   - `sage` (warm, contemplative — primary candidate)
   - `ash` (calmer, more masculine — alternative)
   - `ballad` (warmer, more melodic — alternative)
4. Save outputs locally as `voice-{name}.mp3`.
5. Listen back-to-back, pick winner.
6. Update `TTS_VOICE` constant in `config.ts`.

Implementation: a one-off `pipeline/scripts/test-voices.ts` script. Not adding to the test suite — it's manual A/B, not regression. Cost: ~$0.08 total. Time: 5 min plus listening.

## Acceptance criteria

After all three changes are in and a fresh podcast is generated end-to-end:

- Audio runs ≥ 9 min (vs the ~6.5 min we get today) — measured server-side from `duration_seconds`.
- Script body is ≥ 1800 words after marker stripping.
- No rhetorical self-Q&A in the transcript (spot-check by reading).
- Disfluencies appear and feel sprinkled, not performed (subjective listen).
- Voice swap winner picked and configured.
- Net "feels more like a podcast, less like a read-along" — taste call by Isuru.

If the result still feels off after all that, we revisit. The next levers worth pulling would be two-host mode or a different TTS model entirely.

## What we're not doing

These are real improvements but out of scope for this pass:

- **Two-host conversation mode.** Bigger refactor. Worth its own spec when we want it.
- **Per-chapter pacing analysis.** We compute chapter timestamps proportionally to script character count today (`metadataWriter.extractChapters`). Real per-segment durations from `ffprobe` would be more accurate but isn't blocking.
- **Adaptive length re-call loop.** If the model still underdelivers below 1800 words, we don't currently re-call to expand. We could add a length-check + re-prompt step, but only if the new prompt's word floor doesn't reliably hold.
- **Voice cloning / custom voices.** Out of scope at MVP.
