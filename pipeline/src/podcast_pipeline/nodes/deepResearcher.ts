/**
 * Executes deep research using OpenAI o4-mini.
 */

import { ChatOpenAI } from "@langchain/openai";
import { RESEARCH_COST_CEILING } from "../config.js";
import type { PipelineStateType } from "../state.js";

export async function deepResearcher(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const model = new ChatOpenAI({ modelName: "o4-mini", maxTokens: 4000 });
  const plan = JSON.parse(state.researchPlan);
  const trustedUrls = state.trustedSourceUrls ?? [];
  const tier = state.tier ?? "free";
  const costCeiling = RESEARCH_COST_CEILING[tier] ?? 3.0;

  const queries = plan.queries ?? [];
  const angles = plan.angles ?? [];

  let sourceConstraint = "";
  if (trustedUrls.length > 0) {
    sourceConstraint = `\n\nIMPORTANT: Only use information from these trusted sources: ${trustedUrls.join(", ")}`;
  }

  const researchPrompt = `Conduct deep research on the following queries and angles.
Produce a comprehensive, well-structured research document with citations.

Queries: ${JSON.stringify(queries)}
Angles: ${JSON.stringify(angles)}
${sourceConstraint}

Output a JSON object with:
- "sections": list of {"title": string, "content": string} — 3-5 sections covering the topic thoroughly
- "sources": list of {"url": string, "title": string, "snippet": string} — all sources used
`;

  const response = await model.invoke([
    { role: "user", content: researchPrompt },
  ]);

  const responseText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const content = JSON.parse(responseText);
  const researchDoc = content.sections ?? content;
  const sources = content.sources ?? [];

  return {
    researchDocument: Array.isArray(researchDoc) ? { sections: researchDoc } : researchDoc,
    sources,
    status: "fact_checking",
  };
}
