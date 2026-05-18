import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../../providers/openrouter.js";
import { RESEARCH_MAX_TOKENS, RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../../config.js";
import { BREADTH_SYNTHESIZER_PROMPT } from "../prompts.js";
import {
  ResearchDocumentSchema,
  type ResearchDocument,
} from "../synthesizer.js";
import type { SubagentFindingsV2 } from "../subagentV2.js";

export async function runBreadthSynthesizer(
  findings: SubagentFindingsV2[],
  droppedQuestions: string[],
  config?: RunnableConfig,
): Promise<ResearchDocument> {
  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.synthesizer,
    maxTokens: RESEARCH_MAX_TOKENS.synthesizer,
  });
  const structured = llm.withStructuredOutput(ResearchDocumentSchema, {
    name: "breadth_research_document",
  });

  const prompt = BREADTH_SYNTHESIZER_PROMPT.replace(
    "{findings}",
    JSON.stringify(findings, null, 2),
  ).replace("{droppedQuestions}", JSON.stringify(droppedQuestions));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt, config);
      return { ...result, droppedQuestions: result.droppedQuestions ?? droppedQuestions };
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn("[breadth.synthesizer] retrying after:", err);
    }
  }
  throw new Error("runBreadthSynthesizer fell through retry loop");
}
