import { z } from "zod";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../config.js";
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

export async function runPlanner(researchBrief: string, ctx: PlannerInput): Promise<SubagentTask[]> {
  const brief = JSON.parse(researchBrief) as { keyQuestions?: string[] };
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
  });
  const structured = llm.withStructuredOutput(PlannerOutputSchema, { name: "planner_output" });
  const result = await structured.invoke(prompt);

  if (result.tasks.length !== keyQuestions.length) {
    throw new Error(`Planner returned ${result.tasks.length} tasks, expected ${keyQuestions.length}`);
  }
  return result.tasks;
}
