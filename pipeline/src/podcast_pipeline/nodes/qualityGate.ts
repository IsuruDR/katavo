/**
 * Heuristic quality gate -- checks citation count and credibility score.
 * No LLM call; the Deep Research API already produces well-cited research.
 */

import { CREDIBILITY_THRESHOLD, MAX_RESEARCH_RETRIES } from "../config.js";
import type { PipelineStateType } from "../state.js";

/**
 * Returns true when the research bundle has nothing for scriptWriter to
 * work with: zero sources AND no document sections. Distinct from "thin"
 * research (some content, low credibility) which is still scriptable
 * with a disclaimer.
 */
function hasNoResearchMaterial(state: PipelineStateType): boolean {
  const sources = state.sources ?? [];
  const sections = Array.isArray(
    (state.researchDocument as { sections?: unknown[] } | undefined)?.sections,
  )
    ? ((state.researchDocument as { sections: unknown[] }).sections.length)
    : 0;
  return sources.length === 0 && sections === 0;
}

export function qualityGate(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  // V22 short-circuit: when the new asymmetric pipeline ran, it already set
  // status="scripting" and there's no credibilityScore to evaluate. Pass
  // through unchanged so routeAfterQualityGate routes to scriptWriter.
  if (state.status === "scripting" && state.credibilityScore === null) {
    return {};
  }
  const score = state.credibilityScore ?? 0.0;
  const iterations = state.researchIterations ?? 0;
  const newIterations = iterations + 1;

  const gaps: string[] = [];

  // Credibility score threshold (v11+: source-count gate removed; the new
  // credibility formula already weights source diversity into the score.)
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

  // Max retries exceeded
  if (newIterations > MAX_RESEARCH_RETRIES) {
    // Empty research can't be scripted around — failing produces a
    // refunded credit (via handle_podcast_failure trigger) and a clear
    // error_message. The disclaimer path is reserved for thin-but-real
    // research, not no-API-response state.
    if (hasNoResearchMaterial(state)) {
      return {
        status: "failed",
        researchIterations: newIterations,
        shouldRetry: false,
        needsDisclaimer: false,
        errorMessage:
          state.errorMessage ??
          "Couldn't gather any research for this topic after multiple attempts.",
        credibilityReport: gaps.join("; "),
      };
    }

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
