/**
 * Generates the podcast script from research, with content moderation.
 * Also extracts a chapter-to-research mapping from the LLM output.
 */

import { getObservedOpenAI } from "../providers/langfuseClient.js";
import { SCRIPT_WRITER_PROMPT, TARGET_WORD_COUNT } from "../config.js";
import type { PipelineStateType, ChapterResearchMap, ChapterResearchEntry } from "../state.js";

/**
 * Parse the chapter_research_map fenced JSON block from the LLM output.
 * Clamps out-of-bounds indexes. Returns null if block is missing or malformed.
 */
export function parseChapterResearchMap(
  text: string,
  sectionCount: number,
  sourceCount: number,
): ChapterResearchMap {
  const mapMatch = text.match(/```chapter_research_map\s*\n([\s\S]*?)```/);
  if (!mapMatch) return null;

  let parsed: Record<string, { researchSections?: number[]; sourceIndexes?: number[] }>;
  try {
    parsed = JSON.parse(mapMatch[1]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const result: Record<string, ChapterResearchEntry> = {};

  for (const [chapter, entry] of Object.entries(parsed)) {
    const clampedSections = (entry.researchSections ?? []).map((i) =>
      Math.min(Math.max(0, i), Math.max(0, sectionCount - 1)),
    );
    const clampedSources = (entry.sourceIndexes ?? []).map((i) =>
      Math.min(Math.max(0, i), Math.max(0, sourceCount - 1)),
    );
    result[chapter] = {
      researchSections: clampedSections,
      sourceIndexes: clampedSources,
    };
  }

  return result;
}

export async function scriptWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const openai = getObservedOpenAI();
  const { researchDocument, sources = [], needsDisclaimer = false } = state;

  let disclaimerContext = "";
  if (needsDisclaimer) {
    disclaimerContext =
      "\nIMPORTANT: Sources on this topic were limited or conflicting. " +
      "Include a brief disclaimer early in the script acknowledging this, " +
      "e.g., 'I should note that sources on this topic are still emerging...'";
  }

  const sectionCount = Array.isArray((researchDocument as any)?.sections)
    ? (researchDocument as any).sections.length
    : 0;

  const prompt = SCRIPT_WRITER_PROMPT
    .replace("{targetWords}", String(TARGET_WORD_COUNT))
    .replace("{researchDocument}", JSON.stringify(researchDocument))
    .replace("{sources}", JSON.stringify(sources))
    .replace("{disclaimerContext}", disclaimerContext);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Write the podcast script." },
    ],
    max_tokens: 6000,
  });

  const rawOutput = response.choices[0].message.content ?? "";

  // Extract script (everything before the fenced chapter_research_map block)
  const script = rawOutput.replace(/```chapter_research_map[\s\S]*?```/, "").trim();

  // Content moderation -- output filtering
  const modResponse = await openai.moderations.create({ input: script });
  if (modResponse.results[0].flagged) {
    return {
      status: "failed",
      errorMessage:
        "Generated script flagged by content moderation. Topic may not be suitable.",
    };
  }

  // Parse chapter-research mapping
  const chapterResearchMap = parseChapterResearchMap(
    rawOutput,
    sectionCount,
    sources.length,
  );

  return { script, chapterResearchMap, status: "scripting" };
}
