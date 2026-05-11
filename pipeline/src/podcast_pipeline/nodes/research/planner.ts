import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { RESEARCH_MAX_TOKENS, RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../config.js";
import { PLANNER_PROMPT, PLANNER_RETRY_CONTEXT } from "./prompts.js";

export const SubagentTaskSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  searchHints: z.array(z.string()),
});
export type SubagentTask = z.infer<typeof SubagentTaskSchema>;

const PlannerOutputSchema = z.object({
  tasks: z.array(SubagentTaskSchema),
});

export interface PlannerInput {
  researchIterations: number;
  credibilityReport?: string;
  droppedQuestions?: string[];
}

/** Strip optional ```json fences before JSON.parse — some models wrap output in markdown. */
function parseBrief(raw: string): { keyQuestions?: string[] } {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(stripped) as { keyQuestions?: string[] };
}

export async function runPlanner(
  researchBrief: string,
  ctx: PlannerInput,
  config?: RunnableConfig,
): Promise<SubagentTask[]> {
  const brief = parseBrief(researchBrief);
  const keyQuestions = brief.keyQuestions ?? [];
  if (keyQuestions.length < 3) {
    throw new Error(`Planner requires at least 3 keyQuestions in brief, got ${keyQuestions.length}`);
  }

  const retryContext =
    ctx.researchIterations > 0
      ? PLANNER_RETRY_CONTEXT.replace("{credibilityReport}", ctx.credibilityReport ?? "").replace(
          "{droppedQuestions}",
          (ctx.droppedQuestions ?? []).join("; "),
        )
      : "";

  const prompt = PLANNER_PROMPT.replace("{retryContext}", retryContext).replace(
    "{researchBrief}",
    researchBrief,
  );

  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.planner,
    maxTokens: RESEARCH_MAX_TOKENS.planner,
  });
  const structured = llm.withStructuredOutput(PlannerOutputSchema, { name: "planner_output" });
  const result = await structured.invoke(prompt, config);

  if (result.tasks.length !== keyQuestions.length) {
    throw new Error(`Planner returned ${result.tasks.length} tasks, expected ${keyQuestions.length}`);
  }
  return result.tasks;
}
