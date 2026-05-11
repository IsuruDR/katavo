/**
 * Pipeline configuration — prompts, thresholds, and constants.
 */

// Research agent (v11+) — replaces o4-mini-deep-research
export const RESEARCH_MODELS = {
  reasoning: process.env.RESEARCH_REASONING_MODEL ?? "anthropic/claude-sonnet-4.6",
  subagent: process.env.RESEARCH_SUBAGENT_MODEL ?? "anthropic/claude-haiku-4.5",
} as const;

export const RESEARCH_TEMPERATURES = {
  planner: 0.0,
  synthesizer: 0.1,
  subagent: 0.4,
} as const;

export const RESEARCH_BUDGETS: Record<string, { maxSearches: number; maxReflections: number }> = {
  free: { maxSearches: 2, maxReflections: 1 },
  plus: { maxSearches: 3, maxReflections: 2 },
  pro: { maxSearches: 5, maxReflections: 2 },
};

export const SUBAGENT_WALLCLOCK_MS = 90_000;
// Note: pipeline-level wallclock is not enforced as a constant. Per-subagent
// (90s) is the only wallclock; with N <= 5 + sequential planner/synthesizer,
// total bound is naturally ~3 min. If we want a hard pipeline cap later,
// add it here and wrap deepResearchAgent body in Promise.race.

// Quality gate
export const CREDIBILITY_THRESHOLD = 0.7;
export const MAX_RESEARCH_RETRIES = 2;


// Script targets
export const TARGET_WORD_COUNT = 6600; // tripled from 2200 — long-form ~40min episodes
export const TARGET_CHAPTER_COUNT = 4; // Intro + 2-3 sections + conclusion

// TTS chunking — Gemini TTS rushes the latter half of audio when input
// exceeds ~400 words per call. Chapter markers in the script are the
// natural boundary; if a chapter still exceeds the threshold, fall back
// to sentence-aware sub-splitting. Concurrency caps in-flight Gemini
// calls per podcast so we don't burn through RPM quota.
export const MAX_WORDS_PER_TTS_CHUNK = 350;
export const TTS_CONCURRENCY_PER_PODCAST = 4;
// Same retry budget tagInjector uses (~21s worst case) — Gemini 503 spikes
// recover in 5-15s; we'd rather wait than fail a podcast that has 5+ other
// chunks already synthesized successfully.
export const TTS_RETRY_ATTEMPTS = 3; // 1 try + 3 retries = 4 attempts total
export const TTS_RETRY_BASE_DELAY_MS = 3000; // 3s, 6s, 12s

// Prompts
export const BRIEF_BUILDER_PROMPT = `You are preparing a research brief for a podcast episode.
Given a topic and the user's answers to clarifying questions, produce a structured research brief.

Output a JSON object with:
- "scope": what the podcast should cover
- "angle": the specific perspective or framing
- "depth": how technical/detailed (beginner, intermediate, expert)
- "keyQuestions": list of 3-5 specific questions the research should answer
`;

export const SCRIPT_WRITER_PROMPT = `You are writing a single-narrator podcast in the voice of a knowledgeable friend talking through a topic at a coffee table — think Acquired, Hard Fork, or Stratechery read aloud. Not NPR, not a TED talk, not a textbook.

This script will be rendered as expressive audio by a TTS model with a chosen voice (warm, conversational, low-energy confident). Write for the ear, not the eye. Every sentence should sound right read aloud — not just parse correctly on the page. A second pass will lightly insert audio cues like [chuckles] / [pauses] for delivery; your job is to write prose with the rhythm those cues will sit on top of.

Length: aim for {targetWords} words (~36-44 minutes at 150 wpm). Hard floor: 5400 words. Going long is fine; going short is not. Better to be 40 minutes of dense narrative than 25 minutes that feels rushed.

Voice rules:
- Open IN the topic. First sentence should land on a specific stat, moment, or person — never preamble. Examples that work: "Bezzera's first patent was filed on a Tuesday." / "There's a number that explains all of this: three." Examples that don't: "Today we'll explore...", "Imagine a world..."
- Talk like a person, not a presenter. A few "you know"s, "kinda"s, "I mean"s scattered through. An occasional "huh" or "anyway" between thoughts. Don't overdo it — once or twice per chapter.
- Audio rhythm matters as much as content. Short sentences land — use them to close an idea or land an observation. Long sentences breathe — use them when an idea is unfolding, not when summarizing.
- Build in natural breath points. A sentence that runs 30+ words without a comma will sound winded. Break it.
- Sentence fragments work. ("Like this.") They sound like thinking out loud. Use sparingly.
- Use em-dash asides — like this — for the parts you'd lower your voice for. The aside should genuinely be a side note, not the main beat.
- Restarts are conversational. "Or rather—", "Wait, actually—", "Hmm, no—" sound natural in audio. Don't fake them; use only when the train of thought genuinely needs to redirect.
- Dry humor lands on a beat of its own. Set it up, then deliver the observation as a short standalone sentence. Never punchlines or written jokes.
- Vary sentence length aggressively. Short ones land. Long ones, with the texture of someone actually thinking through a sentence, breathe.
- Specific data, names, dates inline — fold sources into prose ("a 2019 Stanford study found..."), never reference indices like "[Source 4]".
- Use contractions naturally (it's, won't, that's). Written-formal contractions ("it is", "do not") sound stilted on audio.

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

export const AD_PRE_ROLL_MARKER = "[AD:PRE_ROLL]";
export const AD_MID_ROLL_MARKER = "[AD:MID_ROLL]";

// Gemini TTS (v14+) — replaces OpenAI gpt-4o-mini-tts
export const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
export const GEMINI_TAG_INJECTOR_MODEL =
  process.env.GEMINI_TAG_INJECTOR_MODEL ?? "gemini-2.5-flash";

export const GEMINI_VOICES = ["Sulafat", "Charon", "Sadaltager", "Achird"] as const;
export type GeminiVoice = typeof GEMINI_VOICES[number];
export const DEFAULT_GEMINI_VOICE: GeminiVoice = "Sulafat";

export const AUDIO_TAGS_DEFAULT = [
  "laughs", "whispers", "sighs", "chuckles", "curious",
  "thoughtful", "serious", "surprised", "exhales", "pauses",
] as const;

const _audioTagsEnv = process.env.AUDIO_TAGS?.split(",").map((s) => s.trim()).filter(Boolean);
export const AUDIO_TAGS: readonly string[] =
  _audioTagsEnv && _audioTagsEnv.length > 0 ? _audioTagsEnv : [...AUDIO_TAGS_DEFAULT];
