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

function isDeepResearchOptions(v: unknown): v is DeepResearchOptions {
  return typeof v === "object" && v !== null && ("timeoutMs" in v || "pollIntervalMs" in v);
}

// Rate-limit retry budget. The o4-mini-deep-research model has a tight
// per-minute token cap; transient hits should auto-retry, persistent
// hits should fall through to the user-facing failure.
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_WAIT_PER_RETRY_MS = 30_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 5_000;
// Total wall-clock budget for retries. When the org is sustained-saturated,
// each background job sits in_progress for several minutes before OpenAI
// reports rate-limit. Without a total cap we'd burn the user's wait on
// retries that aren't going to succeed. Past this we surface the last
// failure so the credit refunds and the user can try again later.
const RETRY_TOTAL_BUDGET_MS = 8 * 60_000;

/**
 * Parse "Please try again in NNNms" or "N.NNNs" out of a rate-limit
 * message. Falls back to DEFAULT_RATE_LIMIT_WAIT_MS when the format
 * isn't there. Both unit formats appear in the wild — short waits come
 * back as ms, longer ones as seconds.
 */
export function parseRateLimitWaitMs(message: string): number {
  // Try ms first; the s-pattern would also match the trailing 's' of "ms".
  const msMatch = message.match(/try again in (\d+(?:\.\d+)?)ms\b/i);
  if (msMatch) {
    const ms = parseFloat(msMatch[1]);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(Math.ceil(ms) + 500, MAX_WAIT_PER_RETRY_MS);
    }
  }
  const sMatch = message.match(/try again in (\d+(?:\.\d+)?)s\b/i);
  if (sMatch) {
    const seconds = parseFloat(sMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.ceil(seconds * 1000) + 500, MAX_WAIT_PER_RETRY_MS);
    }
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRateLimited(response: any): boolean {
  return (
    response?.status === "failed" &&
    response?.error?.code === "rate_limit_exceeded"
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Submit a Deep Research background job and poll until it reaches a
 * terminal state. Returns the final response object verbatim — the
 * caller decides whether terminal=completed (success), failed (retry
 * if rate-limited, fail otherwise), or timed out.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createAndPoll(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openai: any,
  prompt: string,
  maxToolCalls: number,
  timeoutMs: number,
  pollIntervalMs: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await openai.responses.create({
    model: "o4-mini-deep-research",
    input: prompt,
    background: true,
    tools: [{ type: "web_search_preview" }],
    max_tool_calls: maxToolCalls,
  } as any);

  // Already terminal — no polling needed
  if (response.status !== "in_progress" && response.status !== "queued") {
    return response;
  }

  const startTime = Date.now();
  let result = response;
  while (result.status === "in_progress" || result.status === "queued") {
    if (Date.now() - startTime > timeoutMs) {
      // Synthesize a terminal response so the retry/failure code path
      // upstream treats this uniformly with API-driven failures.
      return {
        ...result,
        status: "failed",
        error: {
          code: "timeout",
          message: `Deep research timed out after ${Math.round(timeoutMs / 1000)}s`,
        },
      };
    }
    await sleep(pollIntervalMs);
    result = await openai.responses.retrieve(result.id);
  }
  return result;
}

export async function deepResearch(
  state: PipelineStateType,
  configOrOptions?: unknown,
): Promise<Partial<PipelineStateType>> {
  const openai = getObservedOpenAI();
  const opts = isDeepResearchOptions(configOrOptions) ? configOrOptions : undefined;
  const timeoutMs = opts?.timeoutMs ?? DEEP_RESEARCH_TIMEOUT;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEEP_RESEARCH_POLL_INTERVAL;

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

  // Run create+poll, retry the entire cycle when rate-limited. The o4
  // model can return rate_limit_exceeded both at job submission AND
  // after polling (background job hits the cap mid-flight), so wrapping
  // ONLY the create call left a hole the polling path leaked through.
  // A total wall-clock budget bounds how long a sustained-saturation
  // case can keep the user waiting before we surface the failure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = null;
  const retryStart = Date.now();
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    if (attempt > 0 && Date.now() - retryStart >= RETRY_TOTAL_BUDGET_MS) {
      console.log(
        `Deep research retry budget (${RETRY_TOTAL_BUDGET_MS}ms) exhausted; ` +
          `surfacing last failure`,
      );
      break;
    }

    try {
      response = await createAndPoll(
        openai,
        prompt,
        maxToolCalls,
        timeoutMs,
        pollIntervalMs,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "failed",
        errorMessage: `Deep research failed: ${message}`,
      };
    }

    if (!isRateLimited(response)) break;

    if (attempt >= MAX_RATE_LIMIT_RETRIES) break;

    const waitMs = parseRateLimitWaitMs(response.error?.message ?? "");
    console.log(
      `Deep research rate-limited (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}); ` +
        `waiting ${waitMs}ms before retry`,
    );
    await sleep(waitMs);
  }

  if (response.status === "completed") {
    return processCompletedResponse(response, state);
  }

  return failureFromResponse(response);
}

/**
 * Extract a useful error message + log the raw response for debugging.
 * The Responses API surfaces failure details in either `error` (hard
 * failure) or `incomplete_details` (partial / truncated). We dump the
 * whole shape to stderr so Railway logs reveal the cause without code
 * changes; the user-facing message picks the most informative field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failureFromResponse(response: any): Partial<PipelineStateType> {
  const status = response?.status ?? "unknown";
  const errorObj = response?.error;
  const incomplete = response?.incomplete_details;

  console.error("Deep research failure:", {
    id: response?.id,
    status,
    error: errorObj,
    incomplete_details: incomplete,
  });

  let detail = "";
  if (errorObj?.message) {
    detail = ` (${errorObj.code ? `${errorObj.code}: ` : ""}${errorObj.message})`;
  } else if (incomplete?.reason) {
    detail = ` (incomplete: ${incomplete.reason})`;
  }

  return {
    status: "failed",
    errorMessage: `Deep research failed: status=${status}${detail}`,
    rawResearchResponse: response as Record<string, unknown>,
  };
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
    rawResearchResponse: response as Record<string, unknown>,
    credibilityScore,
    credibilityReport,
    status: "scripting",
  };
}
