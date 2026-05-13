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

// Per-role maxTokens for OpenRouter. Sized to fit realistic output with
// 1.5-2x safety margin so output never truncates; OpenRouter reserves
// budget upfront against this number so unbounded caps trigger 402s
// when the account balance is tight. Bump only if Langfuse traces show
// `finish_reason: "length"` from one of these roles.
export const RESEARCH_MAX_TOKENS = {
  planner: 4096, // JSON list of 3-8 subagent tasks; actual ~1500-2500
  synthesizer: 16384, // Full research document with sections + sources; actual ~8000-12000
  subagent: 8192, // Focused findings for one question; actual ~2000-4000
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

// Per-chunk WPM validation — safety net for the cases where a 350-word
// chunk still happens to rush. After each synth we measure duration and
// compute WPM = words / duration * 60. If above MAX_CHUNK_WPM we retry
// once; if still rushed we sub-split the chunk in half (one recursion
// level, no further) and concat the resulting halves. Defense in depth;
// the primary fix is chunking, this catches edge cases.
export const MAX_CHUNK_WPM = 200;
export const MIN_SUB_SPLIT_WORDS = 60; // chunks smaller than this skip sub-split (halves would be too tiny)
export const MIN_WORDS_FOR_WPM_CHECK = 10; // tiny chunks have noisy WPM; skip validation
// Same retry budget tagInjector uses (~21s worst case) — Gemini 503 spikes
// recover in 5-15s; we'd rather wait than fail a podcast that has 5+ other
// chunks already synthesized successfully.
export const TTS_RETRY_ATTEMPTS = 3; // 1 try + 3 retries = 4 attempts total
export const TTS_RETRY_BASE_DELAY_MS = 3000; // 3s, 6s, 12s

// Prompts
export const BRIEF_BUILDER_PROMPT = `You are preparing a research brief for a podcast episode.
Given a topic and the user's answers to clarifying questions, produce a structured research brief.

Voice angle: {voiceAngle}

Output a JSON object with:
- "scope": what the podcast should cover
- "angle": the specific perspective or framing
- "depth": how technical/detailed (beginner, intermediate, expert)
- "keyQuestions": list of 3-5 specific questions the research should answer
`;

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

export const SCRIPT_WRITER_EXPANSION_PROMPT = `You are writing a CONTINUATION episode of a podcast series. The listener already heard the parent podcast and now wants more depth on a specific chapter.

This script will be rendered as expressive audio by a TTS model with a chosen voice (warm, conversational, low-energy confident). Write for the ear, not the eye.

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

Voice rules: same as the parent — short sentences land, long sentences breathe, contractions natural, em-dash asides, restarts conversational, dry humor on a beat. Read each chapter's opening aloud in your head.

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

import { AUDIO_TAGS_DEFAULT } from "./audioTags.js";
export { AUDIO_TAGS_DEFAULT };

const _audioTagsEnv = process.env.AUDIO_TAGS?.split(",").map((s) => s.trim()).filter(Boolean);
export const AUDIO_TAGS: readonly string[] =
  _audioTagsEnv && _audioTagsEnv.length > 0 ? _audioTagsEnv : [...AUDIO_TAGS_DEFAULT];
