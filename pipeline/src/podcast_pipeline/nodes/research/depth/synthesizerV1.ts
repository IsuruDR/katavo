import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../../providers/openrouter.js";
import { RESEARCH_MAX_TOKENS, RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../../config.js";
import { DEPTH_SYNTHESIZER_V1_PROMPT } from "../prompts.js";
import {
  ResearchDocumentSchema,
  type ResearchDocument,
} from "../synthesizer.js";
import type { SubagentFindingsV2 } from "../subagentV2.js";

export interface DepthSynthInput {
  findings: SubagentFindingsV2[];
  droppedQuestions: string[];
  chapterSection: string;
  coveredGroundDigest: string;
}

export async function runDepthSynthesizerV1(
  input: DepthSynthInput,
  config?: RunnableConfig,
): Promise<ResearchDocument> {
  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.synthesizer,
    maxTokens: RESEARCH_MAX_TOKENS.synthesizer,
  });
  const structured = llm.withStructuredOutput(ResearchDocumentSchema, { name: "depth_v1" });

  const prompt = DEPTH_SYNTHESIZER_V1_PROMPT
    .replace("{chapterSection}", input.chapterSection)
    .replace("{coveredGroundDigest}", input.coveredGroundDigest)
    .replace("{findings}", JSON.stringify(input.findings, null, 2));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt, config);
      return { ...result, droppedQuestions: result.droppedQuestions ?? input.droppedQuestions };
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  throw new Error("runDepthSynthesizerV1 fell through retry loop");
}
