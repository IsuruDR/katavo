import type { RunnableConfig } from "@langchain/core/runnables";
import { runBreadthPipeline } from "./breadth/index.js";
import { runDepthPipeline } from "./depth/index.js";
import { deepResearchAgent } from "../deepResearchAgent.js";
import { isAsymmetricResearchEnabled } from "../../config.js";
import { trackEvent } from "../../providers/telemetry.js";
import type { PipelineStateType } from "../../state.js";

export async function researchEntry(
  state: PipelineStateType,
  config?: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  if (!isAsymmetricResearchEnabled()) {
    return deepResearchAgent(state, config);
  }
  try {
    if (state.parentPodcastId) {
      return await runDepthPipeline(state, config);
    }
    return await runBreadthPipeline(state, config);
  } catch (err: any) {
    // Track fallbacks separately — this is the leading indicator that v22 is
    // breaking in production. Dead-code removal is gated on this being zero.
    trackEvent(
      "research.entry.fallback",
      {
        isExpansion: !!state.parentPodcastId,
        error: err?.message ?? String(err),
      },
      state.userId,
    );
    console.warn("[research.entry] v22 pipeline threw; falling back to legacy:", err);
    return deepResearchAgent(state, config);
  }
}
