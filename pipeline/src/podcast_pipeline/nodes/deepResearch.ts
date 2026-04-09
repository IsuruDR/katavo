/**
 * Calls OpenAI Deep Research API (o4-mini-deep-research) with background polling.
 * Replaces the old researchPlanner + deepResearcher + factChecker chain.
 */

import { getObservedOpenAI } from "../providers/langfuseClient.js";
import {
  DEEP_RESEARCH_PROMPT,
  DEEP_RESEARCH_POLL_INTERVAL,
  DEEP_RESEARCH_TIMEOUT,
  MAX_TOOL_CALLS,
} from "../config.js";
import type { PipelineStateType } from "../state.js";

interface DeepResearchOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface UrlCitationAnnotation {
  type: "url_citation";
  url: string;
  title: string;
}

interface OutputTextContent {
  type: "output_text";
  text: string;
  annotations?: UrlCitationAnnotation[];
}

interface MessageOutput {
  type: "message";
  content: OutputTextContent[];
}

/**
 * Extract unique sources from url_citation annotations on the response output.
 */
function extractSourcesFromAnnotations(
  output: MessageOutput[],
): { url: string; title: string }[] {
  const seen = new Set<string>();
  const sources: { url: string; title: string }[] = [];

  for (const msg of output) {
    if (msg.type !== "message") continue;
    for (const content of msg.content) {
      if (content.type !== "output_text" || !content.annotations) continue;
      for (const ann of content.annotations) {
        if (ann.type === "url_citation" && !seen.has(ann.url)) {
          seen.add(ann.url);
          sources.push({ url: ann.url, title: ann.title });
        }
      }
    }
  }

  return sources;
}

/**
 * Extract the text content from the response output and parse as JSON.
 */
function extractResearchDocument(
  output: MessageOutput[],
): Record<string, unknown> {
  for (const msg of output) {
    if (msg.type !== "message") continue;
    for (const content of msg.content) {
      if (content.type === "output_text" && content.text) {
        try {
          return JSON.parse(content.text);
        } catch {
          // If not valid JSON, wrap the text as a single section
          return { sections: [{ title: "Research", content: content.text }] };
        }
      }
    }
  }
  return { sections: [] };
}

/**
 * Compute credibility score from citation density.
 * Score = min(1.0, uniqueSources / keyQuestionsCount)
 */
function computeCredibilityScore(
  uniqueSourceCount: number,
  keyQuestionsCount: number,
): number {
  if (keyQuestionsCount <= 0) return uniqueSourceCount > 0 ? 1.0 : 0.0;
  return Math.min(1.0, uniqueSourceCount / keyQuestionsCount);
}

export async function deepResearch(
  state: PipelineStateType,
  options?: DeepResearchOptions,
): Promise<Partial<PipelineStateType>> {
  const openai = getObservedOpenAI();
  const timeoutMs = options?.timeoutMs ?? DEEP_RESEARCH_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEEP_RESEARCH_POLL_INTERVAL;

  const tier = state.tier ?? "free";
  const maxToolCalls = MAX_TOOL_CALLS[tier] ?? 20;
  const trustedUrls = state.trustedSourceUrls ?? [];
  const iterations = state.researchIterations ?? 0;
  const credibilityReport = state.credibilityReport ?? "";

  // Validate URLs to prevent prompt injection via malformed entries
  const validUrls = trustedUrls.filter((u) => {
    try { new URL(u); return true; } catch { return false; }
  });

  // Build prompt with context
  let trustedSourceContext = "";
  if (validUrls.length > 0) {
    trustedSourceContext = `\nPrioritize information from these sources: ${validUrls.join(", ")}`;
  }

  let retryContext = "";
  if (iterations > 0 && credibilityReport) {
    retryContext = `\nPrevious research had these gaps: ${credibilityReport}. Focus on filling them.`;
  }

  const prompt = DEEP_RESEARCH_PROMPT
    .replace("{trustedSourceContext}", trustedSourceContext)
    .replace("{retryContext}", retryContext)
    .replace("{researchBrief}", state.researchBrief);

  let response;
  try {
    response = await openai.responses.create({
      model: "o4-mini-deep-research",
      input: prompt,
      background: true,
      tools: [{ type: "web_search_preview" }],
      max_tool_calls: maxToolCalls,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      errorMessage: `Deep research failed: ${message}`,
    };
  }

  // If immediately completed (no polling needed)
  if (response.status === "completed") {
    return processCompletedResponse(response, state);
  }

  // If immediately failed
  if (response.status === "failed" || response.status === "cancelled") {
    return {
      status: "failed",
      errorMessage: `Deep research failed: ${(response as any).error?.message ?? "Unknown error"}`,
    };
  }

  // Poll for completion
  const startTime = Date.now();
  let result = response;

  while (result.status === "in_progress" || result.status === "queued") {
    if (Date.now() - startTime > timeoutMs) {
      return {
        status: "failed",
        errorMessage: `Deep research timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    result = await openai.responses.retrieve(result.id);
  }

  if (result.status !== "completed") {
    return {
      status: "failed",
      errorMessage: `Deep research failed: status=${result.status}`,
    };
  }

  return processCompletedResponse(result, state);
}

function processCompletedResponse(
  response: any,
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const output = response.output as MessageOutput[];
  const researchDocument = extractResearchDocument(output);
  const annotationSources = extractSourcesFromAnnotations(output);

  // Prefer sources from annotations; fall back to parsed document sources
  const docSources = (researchDocument as any).sources ?? [];
  const sources = annotationSources.length > 0 ? annotationSources : docSources;

  // Parse key questions count from brief for credibility scoring
  let keyQuestionsCount = 3; // safe default
  try {
    const brief = JSON.parse(state.researchBrief);
    keyQuestionsCount = brief.keyQuestions?.length ?? 3;
  } catch {
    // Use default
  }

  const credibilityScore = computeCredibilityScore(sources.length, keyQuestionsCount);
  const credibilityReport = `${sources.length} unique sources found across research. Citation density score: ${credibilityScore.toFixed(2)}.`;

  return {
    researchDocument,
    sources,
    credibilityScore,
    credibilityReport,
    status: "scripting",
  };
}
