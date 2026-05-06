import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createDeepAgent } from "deepagents";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { makeTavilyTool } from "../../tools/tavilySearch.js";
import { RESEARCH_MODELS, RESEARCH_TEMPERATURES, SUBAGENT_WALLCLOCK_MS } from "../../config.js";
import { SUBAGENT_SYSTEM_PROMPT, SUBAGENT_TASK_PROMPT } from "./prompts.js";
import type { SubagentTask } from "./planner.js";

export const FindingSchema = z.object({
  claim: z.string(),
  sourceUrls: z.array(z.string()),
  sourceTitles: z.array(z.string()),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SubagentFindingsSchema = z.object({
  taskId: z.string(),
  question: z.string(),
  findings: z.array(FindingSchema),
  status: z.enum(["complete", "partial", "failed"]),
  notes: z.string().optional(),
});
export type SubagentFindings = z.infer<typeof SubagentFindingsSchema>;

export interface SubagentBudget {
  maxSearches: number;
  maxReflections: number;
}

const timeoutAfter = (ms: number, label: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));

async function invokeOnce(
  task: SubagentTask,
  opts: SubagentBudget,
  config?: RunnableConfig,
): Promise<SubagentFindings> {
  const tool = makeTavilyTool({ taskId: task.id, maxSearches: opts.maxSearches });
  const llm = makeOpenRouterModel(RESEARCH_MODELS.subagent, {
    temperature: RESEARCH_TEMPERATURES.subagent,
  });

  const systemPrompt = SUBAGENT_SYSTEM_PROMPT.replace("{maxSearches}", String(opts.maxSearches)).replace(
    "{maxReflections}",
    String(opts.maxReflections),
  );

  const taskMessage = SUBAGENT_TASK_PROMPT.replace("{question}", task.question)
    .replace("{context}", task.context)
    .replace("{searchHints}", task.searchHints.join("; "));

  const agent = createDeepAgent({
    model: llm,
    tools: [tool] as any,
    systemPrompt,
    // deepagents internally uses zod/v4; our schema is zod/v3. Cast at the
    // boundary — runtime accepts both, only the type system disagrees.
    responseFormat: SubagentFindingsSchema as any,
  });

  const result = (await agent.invoke(
    { messages: [{ role: "user", content: taskMessage }] },
    config,
  )) as { structuredResponse?: SubagentFindings };

  if (!result.structuredResponse) {
    throw new Error(`Subagent returned no structuredResponse for task ${task.id}`);
  }
  return result.structuredResponse;
}

export async function runSubagent(
  task: SubagentTask,
  opts: SubagentBudget,
  config?: RunnableConfig,
): Promise<SubagentFindings> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await Promise.race([
        invokeOnce(task, opts, config),
        timeoutAfter(SUBAGENT_WALLCLOCK_MS, `subagent_wallclock_exceeded_${task.id}`),
      ]);
      if (result.status !== "failed") return result;
      if (attempt === 2) return result;
    } catch (err: any) {
      if (attempt === 2) {
        return {
          taskId: task.id,
          question: task.question,
          findings: [],
          status: "failed",
          notes: `Subagent threw on retry: ${err?.message ?? String(err)}`,
        };
      }
    }
  }
  // unreachable
  throw new Error("runSubagent fell through retry loop");
}
