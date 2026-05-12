/**
 * Packages topic + clarifying answers into a structured research brief.
 * Expansion mode (state.parentPodcastId set) swaps to the CONTINUATION-style
 * prompt so the brief drills deeper into a parent chapter instead of
 * introducing a new topic from scratch.
 */

import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { BRIEF_BUILDER_PROMPT, BRIEF_BUILDER_EXPANSION_PROMPT } from "../config.js";
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
  await persistStatus(state.podcastId, "researching");

  const isExpansion = !!state.parentPodcastId;
  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });
  const structured = model.withStructuredOutput(BriefSchema, { name: "research_brief" });

  let systemPrompt: string;
  let userContent: string;

  if (isExpansion) {
    systemPrompt = BRIEF_BUILDER_EXPANSION_PROMPT;
    userContent =
      `Parent topic: ${state.topic}\n\n` +
      `Source chapter title: ${state.sourceChapterTitle}\n\n` +
      `Parent research digest:\n${state.parentResearchDigest ?? "(none)"}\n\n` +
      `Source chapter transcript:\n${state.parentChapterTranscript ?? "(none)"}`;
  } else {
    systemPrompt = BRIEF_BUILDER_PROMPT;
    const answersText = (state.clarifyingAnswers ?? [])
      .map((a: any) => `Q: ${a.q ?? ""}\nA: ${a.a ?? ""}`)
      .join("\n");
    userContent = `Topic: ${state.topic}\n\nUser's answers:\n${answersText}`;
  }

  const result = await structured.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]);

  return { researchBrief: JSON.stringify(result), status: "researching" };
}
