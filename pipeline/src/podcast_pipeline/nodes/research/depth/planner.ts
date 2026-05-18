import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../../providers/openrouter.js";
import {
  RESEARCH_MAX_TOKENS,
  RESEARCH_MODELS,
  RESEARCH_TEMPERATURES,
  TIER_CONFIG,
  resolveTier,
  type TierName,
} from "../../../config.js";
import { DEPTH_PLANNER_PROMPT } from "../prompts.js";
import { SearchProviderSchema, type SubagentTask } from "../types.js";

const PlannerOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      context: z.string(),
      searchHints: z.array(z.string()),
      searchProvider: SearchProviderSchema,
      seedUrls: z.array(z.string()).default([]),
    }),
  ),
});

export interface DepthPlannerInput {
  researchBrief: string;
  sourceChapterTitle: string;
  chapterSection: string;
  coveredGroundDigest: string;
  tier: string;
}

export async function runDepthPlanner(
  input: DepthPlannerInput,
  config?: RunnableConfig,
): Promise<SubagentTask[]> {
  const tierName: TierName = resolveTier(input.tier);
  const tierCfg = TIER_CONFIG[tierName];
  // Depth uses a tighter question count than breadth: 3 (free) / 4 (plus) / 5 (pro)
  const questionCount = Math.max(3, tierCfg.breadthQuestions - 3);

  const prompt = DEPTH_PLANNER_PROMPT.replace("{sourceChapterTitle}", input.sourceChapterTitle)
    .replace("{questionCount}", String(questionCount))
    .replace("{chapterSection}", input.chapterSection)
    .replace("{coveredGroundDigest}", input.coveredGroundDigest)
    .replace("{researchBrief}", input.researchBrief);

  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.planner,
    maxTokens: RESEARCH_MAX_TOKENS.planner,
  });
  const structured = llm.withStructuredOutput(PlannerOutputSchema, {
    name: "depth_planner_output",
  });

  let result!: z.infer<typeof PlannerOutputSchema>;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = await structured.invoke(prompt, config);
    if (result.tasks.length >= 3 && result.tasks.length <= 5) break;
    if (attempt === 2) {
      throw new Error(
        `Depth planner returned ${result.tasks.length} tasks, expected 3-5`,
      );
    }
  }

  return result.tasks.map((t) => ({
    ...t,
    seedUrls: t.seedUrls.length > 0 ? t.seedUrls : undefined,
    maxSearches: tierCfg.searchBudget.maxSearches,
    maxReflections: tierCfg.searchBudget.maxReflections,
    fetchCitedUrls: true,
  }));
}
