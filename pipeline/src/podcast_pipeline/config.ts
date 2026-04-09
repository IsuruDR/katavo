/**
 * Pipeline configuration — prompts, thresholds, and constants.
 */

// Quality gate
export const CREDIBILITY_THRESHOLD = 0.7;
export const MAX_RESEARCH_RETRIES = 2;
export const MIN_SOURCES_THRESHOLD = 3;

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
export const TARGET_WORD_COUNT = 1500; // ~10 minutes at 150 wpm
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

export const SCRIPT_WRITER_PROMPT = `You are a podcast script writer creating a single-narrator deep-dive episode.

Rules:
- Write ~{targetWords} words (~10 minutes at 150 wpm)
- Use a conversational, engaging tone — like explaining to a smart friend
- Include natural chapter breaks marked with [CHAPTER: Title]
- Start with a compelling hook, not "Welcome to..."
- Include specific data, examples, and citations from the research
- End with a thought-provoking takeaway, not a generic sign-off
- Do NOT include any harmful, misleading, or offensive content
{disclaimerContext}

After writing the script, output a JSON block with a chapter-to-research mapping.
For each [CHAPTER: Title] in the script, map the chapter title to:
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
export const TTS_VOICE = "coral";
export const TTS_VOICE_INSTRUCTIONS = `Speak like an engaging podcast host.
Use a warm, conversational tone — as if explaining to a smart friend.
Vary your pacing naturally. Emphasize key points.
Pause briefly at chapter transitions.`;
