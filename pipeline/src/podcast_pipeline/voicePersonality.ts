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
