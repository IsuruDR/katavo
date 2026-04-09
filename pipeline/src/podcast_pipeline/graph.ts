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

function routeAfterQualityGate(state: PipelineStateType): string {
  if (state.shouldRetry) {
    return "deepResearch";
  }
  if (state.status === "failed") {
    return END;
  }
  return "scriptWriter";
}

function routeAfterScript(state: PipelineStateType): string {
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
  .addEdge("deepResearch", "qualityGate")
  .addConditionalEdges("qualityGate", routeAfterQualityGate)
  .addConditionalEdges("scriptWriter", routeAfterScript)
  .addEdge("adInjector", "audioProducer")
  .addEdge("audioProducer", "metadataWriter")
  .addEdge("metadataWriter", END);

export const graph = workflow.compile();

export async function runPipeline(input: Partial<PipelineStateType>): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    const callbacks = [getLangfuseCallbackHandler()];
    return await graph.invoke(state, { callbacks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.podcastId) {
      await handlePipelineFailure(state.podcastId, message);
    }
    throw error;
  }
}
