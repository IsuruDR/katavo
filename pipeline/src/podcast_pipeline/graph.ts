/**
 * Main LangGraph graph definition — wires all nodes together.
 */

import { StateGraph, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import type { PipelineStateType } from "./state.js";
import { briefBuilder } from "./nodes/briefBuilder.js";
import { researchPlanner } from "./nodes/researchPlanner.js";
import { deepResearcher } from "./nodes/deepResearcher.js";
import { factChecker } from "./nodes/factChecker.js";
import { qualityGate } from "./nodes/qualityGate.js";
import { scriptWriter } from "./nodes/scriptWriter.js";
import { adInjector } from "./nodes/adInjector.js";
import { audioProducer } from "./nodes/audioProducer.js";
import { metadataWriter } from "./nodes/metadataWriter.js";

function routeAfterQualityGate(state: PipelineStateType): string {
  if (state.shouldRetry) {
    return "researchPlanner";
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
  .addNode("researchPlanner", researchPlanner)
  .addNode("deepResearcher", deepResearcher)
  .addNode("factChecker", factChecker)
  .addNode("qualityGate", qualityGate)
  .addNode("scriptWriter", scriptWriter)
  .addNode("adInjector", adInjector)
  .addNode("audioProducer", audioProducer)
  .addNode("metadataWriter", metadataWriter)
  .addEdge("__start__", "briefBuilder")
  .addEdge("briefBuilder", "researchPlanner")
  .addEdge("researchPlanner", "deepResearcher")
  .addEdge("deepResearcher", "factChecker")
  .addEdge("factChecker", "qualityGate")
  .addConditionalEdges("qualityGate", routeAfterQualityGate)
  .addConditionalEdges("scriptWriter", routeAfterScript)
  .addEdge("adInjector", "audioProducer")
  .addEdge("audioProducer", "metadataWriter")
  .addEdge("metadataWriter", END);

export const graph = workflow.compile();
