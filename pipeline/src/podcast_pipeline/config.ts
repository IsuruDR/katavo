/**
 * Pipeline configuration — prompts, thresholds, and constants.
 */

// Quality gate
export const CREDIBILITY_THRESHOLD = 0.7;
export const MAX_RESEARCH_RETRIES = 2;

// Cost ceiling per tier (USD)
export const RESEARCH_COST_CEILING: Record<string, number> = {
  free: 3.0,
  plus: 3.0,
  pro: 5.0,
};

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

export const RESEARCH_PLANNER_PROMPT = `You are a research planner for a deep-dive podcast.
Given a research brief, produce a research plan.

Output a JSON object with:
- "queries": list of 3-5 specific search queries to execute
- "angles": different perspectives to explore
- "prioritySources": types of sources to prioritize (academic, news, expert blogs, etc.)
{retryContext}
`;

export const FACT_CHECKER_PROMPT = `You are a fact-checker for a podcast script.
Given a research document with claims and citations, assess credibility.

For each major claim, evaluate:
1. Is it supported by multiple independent sources?
2. Are the sources reliable and recent?
3. Are there contradictions in the evidence?

Output a JSON object with:
- "claims": list of {"claim": string, "confidence": number, "sourcesCount": number, "issues": string}
- "overallScore": number between 0 and 1
- "summary": brief text summary of credibility assessment
- "gaps": list of specific areas that need more research (empty if all clear)
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

Research document:
{researchDocument}
`;

export const AD_PRE_ROLL_MARKER = "[AD:PRE_ROLL]";
export const AD_MID_ROLL_MARKER = "[AD:MID_ROLL]";
