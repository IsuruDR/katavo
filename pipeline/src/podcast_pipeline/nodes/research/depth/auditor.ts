import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { makeOpenRouterModel } from "../../../providers/openrouter.js";
import { RESEARCH_MAX_TOKENS, RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../../config.js";
import { DEPTH_AUDITOR_PROMPT } from "../prompts.js";
import { AuditedClaimSchema, type AuditedClaim } from "../types.js";
import type { ResearchDocument } from "../synthesizer.js";

const AuditorOutputSchema = z.object({
  audited: z.array(AuditedClaimSchema).max(5),
});

export async function runAuditor(
  doc: ResearchDocument,
  chapterSection: string,
  config?: RunnableConfig,
): Promise<AuditedClaim[]> {
  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, {
    temperature: RESEARCH_TEMPERATURES.planner, // deterministic for stable signals
    maxTokens: RESEARCH_MAX_TOKENS.planner,
  });
  const structured = llm.withStructuredOutput(AuditorOutputSchema, { name: "auditor_output" });

  const prompt = DEPTH_AUDITOR_PROMPT
    .replace("{chapterSection}", chapterSection)
    .replace("{researchDocumentV1}", JSON.stringify(doc, null, 2));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt, config);
      return result.audited;
    } catch (err) {
      if (attempt === 2) {
        console.warn("[auditor] both attempts failed; returning empty:", err);
        return [];
      }
    }
  }
  return [];
}
