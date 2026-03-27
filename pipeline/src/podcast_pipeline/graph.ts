/**
 * AI Podcast Generation Pipeline — LangGraph.js orchestration.
 * Placeholder graph to be implemented in Plan 2.
 */
import { Annotation, StateGraph } from "@langchain/langgraph";

const PipelineState = Annotation.Root({
  podcastId: Annotation<string>,
  userId: Annotation<string>,
  topic: Annotation<string>,
  clarifyingAnswers: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  hasAds: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => true,
  }),
  trustedSourceUrls: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  tier: Annotation<string>,
  status: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "queued",
  }),
});

function placeholder(state: typeof PipelineState.State) {
  return { status: "complete" };
}

const builder = new StateGraph(PipelineState)
  .addNode("placeholder", placeholder)
  .addEdge("__start__", "placeholder")
  .addEdge("placeholder", "__end__");

export const graph = builder.compile();
