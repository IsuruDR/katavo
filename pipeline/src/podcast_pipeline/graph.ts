/**
 * Main LangGraph graph definition -- wires all nodes together.
 *
 * Pipeline: briefBuilder -> deepResearch -> qualityGate -> scriptWriter
 *           -> adInjector (if ads) -> audioProducer -> metadataWriter
 */

import { StateGraph, END } from "@langchain/langgraph";
import { PipelineState, makeInitialState } from "./state.js";
import type { PipelineStateType } from "./state.js";
import { briefBuilder } from "./nodes/briefBuilder.js";
import { deepResearch } from "./nodes/deepResearch.js";
import { qualityGate } from "./nodes/qualityGate.js";
import { scriptWriter } from "./nodes/scriptWriter.js";
import { adInjector } from "./nodes/adInjector.js";
import { audioProducer } from "./nodes/audioProducer.js";
import { metadataWriter } from "./nodes/metadataWriter.js";
import { handlePipelineFailure } from "./nodes/errorHandler.js";
import { getLangfuseCallbackHandler } from "./providers/langfuseClient.js";

const DEFAULT_FAILURE_MESSAGE = "Pipeline failed";

/**
 * If deepResearch came back with status="failed" (rate-limited, content
 * rejected, polling timeout, etc.), short-circuit to END instead of
 * letting qualityGate run on empty state. qualityGate's retry-or-disclaim
 * loop is for low-quality research, not no-API-response research.
 */
export function routeAfterDeepResearch(state: PipelineStateType): string {
  if (state.status === "failed") {
    return END;
  }
  return "qualityGate";
}

export function routeAfterQualityGate(state: PipelineStateType): string {
  if (state.status === "failed") {
    return END;
  }
  if (state.shouldRetry) {
    return "deepResearch";
  }
  return "scriptWriter";
}

export function routeAfterScript(state: PipelineStateType): string {
  if (state.status === "failed") {
    return END;
  }
  if (state.hasAds) {
    return "adInjector";
  }
  return "audioProducer";
}

const workflow = new StateGraph(PipelineState)
  .addNode("briefBuilder", briefBuilder)
  .addNode("deepResearch", deepResearch)
  .addNode("qualityGate", qualityGate)
  .addNode("scriptWriter", scriptWriter)
  .addNode("adInjector", adInjector)
  .addNode("audioProducer", audioProducer)
  .addNode("metadataWriter", metadataWriter)
  .addEdge("__start__", "briefBuilder")
  .addEdge("briefBuilder", "deepResearch")
  .addConditionalEdges("deepResearch", routeAfterDeepResearch)
  .addConditionalEdges("qualityGate", routeAfterQualityGate)
  .addConditionalEdges("scriptWriter", routeAfterScript)
  .addEdge("adInjector", "audioProducer")
  .addEdge("audioProducer", "metadataWriter")
  .addEdge("metadataWriter", END);

export const graph = workflow.compile();

export interface RunPipelineOptions {
  /** When true, skip handlePipelineFailure on error — let the caller (job manager) handle retries. */
  isRetryable?: boolean;
}

export async function runPipeline(
  input: Partial<PipelineStateType>,
  options: RunPipelineOptions = {},
): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    const callbacks = [getLangfuseCallbackHandler()];
    const result = await graph.invoke(state, { callbacks });

    // A node may set status="failed" without throwing (e.g. deepResearch
    // returns { status: "failed", errorMessage } when the API rejects).
    // The graph completes "successfully" but the work didn't. Persist the
    // failure so the row reflects reality and the auto-refund trigger fires.
    if (result.status === "failed" && state.podcastId) {
      await handlePipelineFailure(
        state.podcastId,
        result.errorMessage ?? DEFAULT_FAILURE_MESSAGE,
      );
    }

    return result;
  } catch (error: unknown) {
    if (!options.isRetryable) {
      const message = error instanceof Error ? error.message : String(error);
      if (state.podcastId) {
        await handlePipelineFailure(state.podcastId, message);
      }
    }
    throw error;
  }
}
