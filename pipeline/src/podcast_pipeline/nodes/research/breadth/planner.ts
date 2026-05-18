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
import { BREADTH_PLANNER_PROMPT } from "../prompts.js";
import { SearchProviderSchema, type SubagentTask } from "../types.js";

const PlannerOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      context: z.string(),
      searchHints: z.array(z.string()),
      searchProvider: SearchProviderSchema,
    }),
  ),
});

export async function runBreadthPlanner(
  researchBrief: string,
  tier: string,
  config?: RunnableConfig,
): Promise<SubagentTask[]> {
  const tierName: TierName = resolveTier(tier);
  const tierCfg = TIER_CONFIG[tierName];

  const prompt = BREADTH_PLANNER_PROMPT.replace(
    "{questionCount}",
    String(tierCfg.breadthQuestions),
  ).replace("{researchBrief}", researchBrief);

  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.planner,
    maxTokens: RESEARCH_MAX_TOKENS.planner,
  });
  const structured = llm.withStructuredOutput(PlannerOutputSchema, {
    name: "breadth_planner_output",
  });

  let result!: z.infer<typeof PlannerOutputSchema>;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = await structured.invoke(prompt, config);
    if (result.tasks.length === tierCfg.breadthQuestions) break;
    if (attempt === 2) {
      throw new Error(
        `Breadth planner returned ${result.tasks.length} tasks, expected ${tierCfg.breadthQuestions}`,
      );
    }
    console.warn(`[breadth.planner] count mismatch attempt ${attempt}; retrying`);
  }

  return result.tasks.map((t) => ({
    ...t,
    maxSearches: tierCfg.searchBudget.maxSearches,
    maxReflections: tierCfg.searchBudget.maxReflections,
    fetchCitedUrls: true,
  }));
}
