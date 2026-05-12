import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { RESEARCH_MAX_TOKENS, RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../config.js";
import { SYNTHESIZER_PROMPT, SYNTHESIZER_PARENT_PRIORS } from "./prompts.js";
import type { SubagentFindings } from "./subagent.js";

export const ResearchDocumentSchema = z.object({
  sections: z.array(z.object({ title: z.string(), content: z.string() })),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
  claims: z.array(z.object({ text: z.string(), sourceIndexes: z.array(z.number()) })),
  droppedQuestions: z.array(z.string()).optional(),
});
export type ResearchDocument = z.infer<typeof ResearchDocumentSchema>;

export async function runSynthesizer(
  usable: SubagentFindings[],
  droppedQuestions: string[],
  config?: RunnableConfig,
  expansion?: {
    parentTopic: string;
    sourceChapterTitle: string;
    parentResearchDocument: Record<string, unknown>;
  },
): Promise<ResearchDocument> {
  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.synthesizer,
    maxTokens: RESEARCH_MAX_TOKENS.synthesizer,
  });
  const structured = llm.withStructuredOutput(ResearchDocumentSchema, { name: "research_document" });

  const parentPriors = expansion
    ? SYNTHESIZER_PARENT_PRIORS
        .replace("{parentTopic}", expansion.parentTopic)
        .replace("{sourceChapterTitle}", expansion.sourceChapterTitle)
        .replace("{parentResearchDocument}", JSON.stringify(expansion.parentResearchDocument, null, 2))
    : "";

  const payload = JSON.stringify({ subagentFindings: usable, droppedQuestions }, null, 2);
  const prompt = `${SYNTHESIZER_PROMPT.replace("{parentPriors}", parentPriors)}\n\nInput payload:\n${payload}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt, config);
      // Ensure droppedQuestions is set (model may omit if empty)
      return { ...result, droppedQuestions: result.droppedQuestions ?? droppedQuestions };
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn("[deepResearchAgent.synthesizer] retrying after failure:", { error: err });
    }
  }
  throw new Error("runSynthesizer fell through retry loop");
}
