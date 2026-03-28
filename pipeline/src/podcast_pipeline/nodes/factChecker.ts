/**
 * Cross-references research claims against sources for credibility.
 */

import { ChatOpenAI } from "@langchain/openai";
import { FACT_CHECKER_PROMPT } from "../config.js";
import type { PipelineStateType } from "../state.js";

export async function factChecker(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 1000 });
  const { researchDocument, sources = [] } = state;

  const response = await model.invoke([
    { role: "system", content: FACT_CHECKER_PROMPT },
    {
      role: "user",
      content: `Research document:\n${JSON.stringify(researchDocument)}\n\nSources:\n${JSON.stringify(sources)}`,
    },
  ]);

  const responseText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const assessment = JSON.parse(responseText);

  return {
    credibilityScore: assessment.overallScore ?? 0.0,
    credibilityReport: `${assessment.summary ?? ""}\nGaps: ${JSON.stringify(assessment.gaps ?? [])}`,
  };
}
