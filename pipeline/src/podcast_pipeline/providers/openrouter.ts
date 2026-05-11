import { ChatOpenAI } from "@langchain/openai";

export function makeOpenRouterModel(
  modelName: string,
  opts: { temperature: number; maxTokens?: number },
): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  // maxTokens left undefined defaults to the model's full output ceiling
  // (e.g., 65536 for Sonnet 4.6). OpenRouter pre-reserves budget against
  // that ceiling regardless of actual output length, which makes calls
  // fail with 402 when the upfront reservation exceeds the account
  // balance. Always pass a per-role cap that fits the realistic output.
  return new ChatOpenAI({
    modelName,
    apiKey,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });
}
