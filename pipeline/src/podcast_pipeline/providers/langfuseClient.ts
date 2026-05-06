/**
 * Langfuse observability provider.
 *
 * - getObservedOpenAI(): Returns a singleton OpenAI client wrapped with
 *   Langfuse's observeOpenAI() for automatic tracing and cost tracking.
 * - getLangfuseCallbackHandler(): Returns a LangChain callback handler
 *   for tracing ChatOpenAI calls (used by briefBuilder).
 */

import OpenAI from "openai";
import { observeOpenAI } from "langfuse";
import { CallbackHandler } from "langfuse-langchain";

let observedClient: OpenAI | null = null;

/**
 * Returns a singleton OpenAI client wrapped with Langfuse tracing.
 * All API calls (chat completions, responses, moderations, audio) are
 * automatically traced with token counts and cost.
 *
 * Langfuse reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and
 * LANGFUSE_HOST from environment variables automatically.
 */
export function getObservedOpenAI(): OpenAI {
  if (observedClient) return observedClient;
  observedClient = observeOpenAI(new OpenAI());
  return observedClient;
}

/**
 * Returns a fresh LangChain callback handler for Langfuse tracing.
 * Pass this to graph.invoke() or chain.invoke() via { callbacks: [handler] }.
 *
 * Langfuse reads credentials from environment variables automatically.
 */
export function getLangfuseCallbackHandler(): CallbackHandler {
  return new CallbackHandler();
}

/**
 * Reset the singleton client. Used only in tests.
 */
export function resetObservedOpenAI(): void {
  observedClient = null;
}
