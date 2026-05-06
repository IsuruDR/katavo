/**
 * Packages topic + clarifying answers into a structured research brief.
 */

import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { BRIEF_BUILDER_PROMPT } from "../config.js";
import { persistStatus } from "./persistStatus.js";
import type { PipelineStateType } from "../state.js";

const BriefSchema = z.object({
  scope: z.string(),
  angle: z.string(),
  depth: z.string(),
  keyQuestions: z.array(z.string()).min(3).max(5),
});

export async function briefBuilder(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  // Surface the queued → researching transition to the mobile client
  // immediately so the row's status reflects "we're actually working
  // on it" instead of sitting at queued through deepResearchAgent's wait.
  await persistStatus(state.podcastId, "researching");

  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });
  const structured = model.withStructuredOutput(BriefSchema, { name: "research_brief" });
  const { topic, clarifyingAnswers = [] } = state;

  const answersText = clarifyingAnswers
    .map((a: any) => `Q: ${a.q ?? ""}\nA: ${a.a ?? ""}`)
    .join("\n");

  const result = await structured.invoke([
    { role: "system", content: BRIEF_BUILDER_PROMPT },
    { role: "user", content: `Topic: ${topic}\n\nUser's answers:\n${answersText}` },
  ]);

  // Persist as JSON string to keep state shape stable for downstream consumers
  // (planner does JSON.parse on it).
  return { researchBrief: JSON.stringify(result), status: "researching" };
}
