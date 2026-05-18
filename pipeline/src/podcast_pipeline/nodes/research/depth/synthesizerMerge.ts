import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../../providers/openrouter.js";
import {
  RESEARCH_MAX_TOKENS,
  RESEARCH_MODELS,
  RESEARCH_TEMPERATURES,
  TIER_CONFIG,
  resolveTier,
} from "../../../config.js";
import { DEPTH_SYNTHESIZER_MERGE_PROMPT } from "../prompts.js";
import {
  ResearchDocumentSchema,
  type ResearchDocument,
} from "../synthesizer.js";
import type { SubagentFindingsV2 } from "../subagentV2.js";
import type { AuditedClaim, SubagentTask } from "../types.js";

export function buildRound2Tasks(
  audited: AuditedClaim[],
  v1: ResearchDocument,
  rawTier: string | undefined,
): SubagentTask[] {
  const tier = resolveTier(rawTier);
  const cfg = TIER_CONFIG[tier];
  const capped = audited.slice(0, cfg.maxR2Subagents);
  return capped.map((a, i) => {
    const seedUrls = a.originatingSourceIndexes
      .map((idx) => v1.sources[idx]?.url)
      .filter((u): u is string => Boolean(u));
    return {
      id: `r2-${i}`,
      question: a.drillQuestion,
      context: `Drill claim: "${a.originalClaim}" (weakness: ${a.weakness})`,
      searchHints: [],
      searchProvider: "exa" as const,
      seedUrls: seedUrls.length > 0 ? seedUrls : undefined,
      maxSearches: cfg.searchBudget.maxSearches,
      maxReflections: cfg.searchBudget.maxReflections,
      fetchCitedUrls: true,
    };
  });
}

export interface SynthMergeInput {
  v1: ResearchDocument;
  round2: SubagentFindingsV2[];
  audited: AuditedClaim[];
}

export async function runSynthesizerMerge(
  input: SynthMergeInput,
  config?: RunnableConfig,
): Promise<ResearchDocument> {
  // If round 2 produced nothing useful, return v1 unchanged
  const round2Usable = input.round2.filter(
    (r) => r.status !== "failed" && r.findings.length > 0,
  );
  if (round2Usable.length === 0) return input.v1;

  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.synthesizer,
    maxTokens: RESEARCH_MAX_TOKENS.synthesizer,
  });
  const structured = llm.withStructuredOutput(ResearchDocumentSchema, { name: "depth_merge" });

  const prompt = DEPTH_SYNTHESIZER_MERGE_PROMPT
    .replace("{round1Doc}", JSON.stringify(input.v1, null, 2))
    .replace("{round2Findings}", JSON.stringify(round2Usable, null, 2))
    .replace("{auditedClaims}", JSON.stringify(input.audited, null, 2));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt, config);
      return { ...result, droppedQuestions: result.droppedQuestions ?? input.v1.droppedQuestions };
    } catch (err) {
      if (attempt === 2) {
        console.warn("[depth.merge] both attempts failed; falling back to v1:", err);
        return input.v1;
      }
    }
  }
  return input.v1;
}
