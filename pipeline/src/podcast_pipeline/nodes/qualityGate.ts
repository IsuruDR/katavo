/**
 * Heuristic quality gate -- checks citation count and credibility score.
 * No LLM call; the Deep Research API already produces well-cited research.
 */

import {
  CREDIBILITY_THRESHOLD,
  MAX_RESEARCH_RETRIES,
  MIN_SOURCES_THRESHOLD,
} from "../config.js";
import type { PipelineStateType } from "../state.js";

export function qualityGate(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const score = state.credibilityScore ?? 0.0;
  const iterations = state.researchIterations ?? 0;
  const sources = state.sources ?? [];
  const newIterations = iterations + 1;

  const gaps: string[] = [];

  // Check 1: Minimum source count
  if (sources.length < MIN_SOURCES_THRESHOLD) {
    gaps.push(
      `Insufficient sources: found ${sources.length}, need at least ${MIN_SOURCES_THRESHOLD}`,
    );
  }

  // Check 2: Credibility score threshold
  if (score < CREDIBILITY_THRESHOLD) {
    gaps.push(
      `Credibility score ${score.toFixed(2)} is below threshold ${CREDIBILITY_THRESHOLD}`,
    );
  }

  const hasPassed = gaps.length === 0;

  // All checks passed
  if (hasPassed) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: false,
    };
  }

  // Max retries exceeded -- proceed with disclaimer
  if (newIterations > MAX_RESEARCH_RETRIES) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: true,
      credibilityReport: `Proceeding with disclaimer. Issues: ${gaps.join("; ")}`,
    };
  }

  // Retry with gap description
  return {
    researchIterations: newIterations,
    shouldRetry: true,
    needsDisclaimer: false,
    credibilityReport: gaps.join("; "),
  };
}
