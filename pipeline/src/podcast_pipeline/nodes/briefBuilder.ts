/**
 * Packages topic + clarifying answers into a structured research brief.
 */

import { ChatOpenAI } from "@langchain/openai";
import { BRIEF_BUILDER_PROMPT } from "../config.js";
import { persistStatus } from "./persistStatus.js";
import type { PipelineStateType } from "../state.js";

export async function briefBuilder(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  // Surface the queued → researching transition to the mobile client
  // immediately so the row's status reflects "we're actually working
  // on it" instead of sitting at queued through deepResearch's wait.
  await persistStatus(state.podcastId, "researching");

  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });
  const { topic, clarifyingAnswers = [] } = state;

  const answersText = clarifyingAnswers
    .map((a: any) => `Q: ${a.q ?? ""}\nA: ${a.a ?? ""}`)
    .join("\n");

  const response = await model.invoke([
    { role: "system", content: BRIEF_BUILDER_PROMPT },
    { role: "user", content: `Topic: ${topic}\n\nUser's answers:\n${answersText}` },
  ]);

  const brief = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  return { researchBrief: brief, status: "researching" };
}
