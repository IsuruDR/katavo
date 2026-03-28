/**
 * Generates the podcast script from research, with content moderation.
 * Uses the OpenAI SDK directly for moderation endpoint access.
 */

import OpenAI from "openai";
import { SCRIPT_WRITER_PROMPT, TARGET_WORD_COUNT } from "../config.js";
import type { PipelineStateType } from "../state.js";

const openai = new OpenAI();

export async function scriptWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { researchDocument, needsDisclaimer = false } = state;

  let disclaimerContext = "";
  if (needsDisclaimer) {
    disclaimerContext =
      "\nIMPORTANT: Sources on this topic were limited or conflicting. " +
      "Include a brief disclaimer early in the script acknowledging this, " +
      "e.g., 'I should note that sources on this topic are still emerging...'";
  }

  const prompt = SCRIPT_WRITER_PROMPT
    .replace("{targetWords}", String(TARGET_WORD_COUNT))
    .replace("{researchDocument}", JSON.stringify(researchDocument))
    .replace("{disclaimerContext}", disclaimerContext);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Write the podcast script." },
    ],
    max_tokens: 3000,
  });

  const script = response.choices[0].message.content ?? "";

  // Content moderation — output filtering
  const modResponse = await openai.moderations.create({ input: script });
  if (modResponse.results[0].flagged) {
    return {
      status: "failed",
      errorMessage:
        "Generated script flagged by content moderation. Topic may not be suitable.",
    };
  }

  return { script, status: "scripting" };
}
