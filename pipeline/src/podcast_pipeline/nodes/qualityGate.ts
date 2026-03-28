/**
 * LLM-as-judge decision node — retry research or proceed to scripting.
 */

import { CREDIBILITY_THRESHOLD, MAX_RESEARCH_RETRIES } from "../config.js";
import type { PipelineStateType } from "../state.js";

export function qualityGate(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const score = state.credibilityScore ?? 0.0;
  const iterations = state.researchIterations ?? 0;
  const newIterations = iterations + 1;

  if (score >= CREDIBILITY_THRESHOLD) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: false,
    };
  }

  if (newIterations > MAX_RESEARCH_RETRIES) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: true,
    };
  }

  return {
    researchIterations: newIterations,
    shouldRetry: true,
    needsDisclaimer: false,
  };
}
