/**
 * Produces a research plan from the brief, incorporating retry context if present.
 */

import { ChatOpenAI } from "@langchain/openai";
import { RESEARCH_PLANNER_PROMPT } from "../config.js";
import type { PipelineStateType } from "../state.js";

export async function researchPlanner(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });
  const { researchBrief, researchIterations = 0, credibilityReport = "" } = state;

  let retryContext = "";
  if (researchIterations > 0 && credibilityReport) {
    retryContext = `\n\nPREVIOUS RESEARCH HAD GAPS. Focus on filling these:\n${credibilityReport}`;
  }

  const prompt = RESEARCH_PLANNER_PROMPT.replace("{retryContext}", retryContext);

  let userContent = `Research brief:\n${researchBrief}`;
  if (retryContext) {
    userContent += `\n${retryContext}`;
  }

  const response = await model.invoke([
    { role: "system", content: prompt },
    { role: "user", content: userContent },
  ]);

  const plan = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  return { researchPlan: plan };
}
