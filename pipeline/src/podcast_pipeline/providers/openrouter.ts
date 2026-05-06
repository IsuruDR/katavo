import { ChatOpenAI } from "@langchain/openai";

export function makeOpenRouterModel(
  modelName: string,
  opts: { temperature: number },
): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return new ChatOpenAI({
    modelName,
    apiKey,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: opts.temperature,
  });
}
