import type { RunnableConfig } from "@langchain/core/runnables";
import { runBreadthPlanner } from "./planner.js";
import { runSubagentV2, type SubagentFindingsV2 } from "../subagentV2.js";
import { runBreadthSynthesizer } from "./synthesizer.js";
import { sanitizeResearchDocument } from "../sanitize.js";
import { trackEvent } from "../../../providers/telemetry.js";
import type { PipelineStateType } from "../../../state.js";

export async function runBreadthPipeline(
  state: PipelineStateType,
  config?: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const tier = state.tier ?? "free";

  let tasks;
  try {
    tasks = await runBreadthPlanner(state.researchBrief, tier, config);
  } catch (err: any) {
    console.error("[breadth.planner] failed:", err);
    return {
      status: "failed",
      errorMessage: `Breadth planning failed: ${err?.message ?? String(err)}`,
    };
  }

  const seenUrls = new Set<string>();
  const results = await Promise.all(
    tasks.map((t) =>
      runSubagentV2(
        t,
        {
          maxSearches: t.maxSearches,
          maxReflections: t.maxReflections,
          seenUrlSink: seenUrls,
          userId: state.userId,
        },
        config,
      ),
    ),
  );
  const usable = results.filter((r) => r.status !== "failed");
  const dropped = results.filter((r) => r.status === "failed").map((r) => r.question);

  // >50% failure rate → abort
  if (usable.length < Math.ceil(tasks.length / 2)) {
    return {
      status: "failed",
      errorMessage: `Research insufficient: ${dropped.length} of ${tasks.length} angles failed`,
    };
  }

  let researchDocument;
  try {
    researchDocument = await runBreadthSynthesizer(usable as SubagentFindingsV2[], dropped, config);
  } catch (err: any) {
    return {
      status: "failed",
      errorMessage: `Breadth synthesis failed: ${err?.message ?? String(err)}`,
    };
  }

  const sanitized = sanitizeResearchDocument(researchDocument, seenUrls);
  const finalDoc = sanitized.document;

  trackEvent(
    "research.breadth.complete",
    {
      tier,
      taskCount: tasks.length,
      droppedCount: dropped.length,
      sourceCount: finalDoc.sources.length,
      sanitizedDropCount: sanitized.droppedCount,
      fetchedSourceCount: results.reduce(
        (n, r) => n + (r.sourceKinds?.filter((k) => k.endsWith("-fetched")).length ?? 0),
        0,
      ),
    },
    state.userId,
  );

  // Empty research → fail.
  if (finalDoc.sources.length === 0 && finalDoc.sections.length === 0) {
    return {
      status: "failed",
      errorMessage: "Couldn't gather any research for this topic.",
    };
  }

  return {
    researchDocument: finalDoc as Record<string, unknown>,
    sources: finalDoc.sources as Record<string, unknown>[],
    status: "scripting",
  };
}
