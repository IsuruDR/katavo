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

// Deep research
export const MAX_TOOL_CALLS: Record<string, number> = {
  free: 20,
  plus: 20,
  pro: 40,
};
export const DEEP_RESEARCH_POLL_INTERVAL = 10_000; // 10s between polls
export const DEEP_RESEARCH_TIMEOUT = 900_000; // 15 minutes

export const DEEP_RESEARCH_PROMPT = `You are conducting deep research for a podcast episode.
Given a research brief, produce a comprehensive, well-cited research document.

Structure your output as a JSON object with:
- "sections": list of {{"title": string, "content": string}} — 3-6 sections covering the topic thoroughly with inline citations
- "sources": list of {{"url": string, "title": string}} — all sources referenced

Requirements:
- Every factual claim must cite at least one source
- Cover the topic from multiple angles
- Prioritize recent, authoritative sources
- Include specific data, statistics, and expert quotes where available
{trustedSourceContext}
{retryContext}

Research brief:
{researchBrief}
`;

// Script targets
export const TARGET_WORD_COUNT = 2200; // bumped from 1500 — model reliably undershoots; aim high to land ~1500
export const TARGET_CHAPTER_COUNT = 4; // Intro + 2-3 sections + conclusion

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

export const AD_PRE_ROLL_MARKER = "[AD:PRE_ROLL]";
export const AD_MID_ROLL_MARKER = "[AD:MID_ROLL]";

// TTS
export const TTS_VOICE = "ballad";
export const TTS_VOICE_INSTRUCTIONS = `Speak like a knowledgeable friend recording a podcast at a coffee table — not a presenter, not a narrator. Tone: warm, slightly amused, low-energy confident.

Pacing: moderate. Take micro-pauses before complex names, numbers, or dates so they land. Take longer breaths at chapter transitions and after big ideas. Don't rush.

Emphasis: lift specific data, names, and dates lightly. Never theatrical — this isn't a movie trailer. Lean into the natural stress of a sentence, not engineered punchlines.

Em-dash asides — like this — should drop slightly in pitch and pick up in pace, then return to the main line. They're throwaway thoughts, not announcements.

Disfluencies like "you know," "kinda," "I mean," "huh," "anyway" should sound thrown away — quick and unstressed, not deliberate. Don't perform them.

Avoid: announcer cadence, evenly-spaced sentence rhythm, theatrical sweeps, building to false drama, signpost intonation on chapter titles, "podcast voice."`;
