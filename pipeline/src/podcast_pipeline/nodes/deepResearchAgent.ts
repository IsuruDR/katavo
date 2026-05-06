import { runPlanner } from "./research/planner.js";
import { runSubagent, type SubagentFindings } from "./research/subagent.js";
import { runSynthesizer, type ResearchDocument } from "./research/synthesizer.js";
import { RESEARCH_BUDGETS, RESEARCH_MODELS } from "../config.js";
import type { PipelineStateType } from "../state.js";

function computeCredibility(doc: ResearchDocument): { score: number; report: string } {
  const totalClaims = doc.claims.length;
  if (totalClaims === 0) {
    return { score: 0, report: "No claims extracted from research." };
  }
  const citedClaims = doc.claims.filter((c) => c.sourceIndexes.length > 0).length;
  const distinctSourcesUsed = new Set(doc.claims.flatMap((c) => c.sourceIndexes)).size;
  const sourceDiversity = distinctSourcesUsed / Math.max(1, doc.sources.length);
  const score = (citedClaims / totalClaims) * 0.7 + sourceDiversity * 0.3;
  const report = `${citedClaims}/${totalClaims} claims cited; source diversity ${sourceDiversity.toFixed(2)}.`;
  return { score, report };
}

export async function deepResearchAgent(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const tier = state.tier ?? "free";
  const budget = RESEARCH_BUDGETS[tier] ?? RESEARCH_BUDGETS.free;

  let tasks;
  try {
    tasks = await runPlanner(state.researchBrief, {
      researchIterations: state.researchIterations ?? 0,
      credibilityReport: state.credibilityReport,
      droppedQuestions:
        (state.researchDocument as ResearchDocument | undefined)?.droppedQuestions ?? [],
    });
  } catch (err: any) {
    console.error("[deepResearchAgent.planner] failed:", { error: err?.message ?? String(err) });
    return {
      status: "failed",
      errorMessage: `Research planning failed: ${err?.message ?? String(err)}`,
    };
  }

  const results = await Promise.all(tasks.map((t) => runSubagent(t, budget)));
  const usable = results.filter((r) => r.status !== "failed");
  const dropped = results.filter((r) => r.status === "failed").map((r) => r.question);

  const floor = Math.ceil(tasks.length / 2) + 1;
  const modelTags = { reasoning: RESEARCH_MODELS.reasoning, subagent: RESEARCH_MODELS.subagent };
  const rawResearchResponse = { tasks, subagentFindings: results, model: modelTags };

  if (usable.length < floor) {
    console.error("[deepResearchAgent.floor] insufficient subagents:", {
      usable: usable.length,
      dropped: dropped.length,
      required: floor,
    });
    return {
      status: "failed",
      errorMessage: `Research insufficient: ${dropped.length} of ${tasks.length} angles failed`,
      rawResearchResponse,
    };
  }

  let researchDocument: ResearchDocument;
  try {
    researchDocument = await runSynthesizer(usable as SubagentFindings[], dropped);
  } catch (err: any) {
    console.error("[deepResearchAgent.synthesizer] hard failure:", {
      error: err?.message ?? String(err),
    });
    return {
      status: "failed",
      errorMessage: `Research synthesis failed: ${err?.message ?? String(err)}`,
      rawResearchResponse,
    };
  }

  const { score, report } = computeCredibility(researchDocument);

  return {
    researchDocument: researchDocument as Record<string, unknown>,
    sources: researchDocument.sources as Record<string, unknown>[],
    rawResearchResponse,
    credibilityScore: score,
    credibilityReport: report,
    status: "scripting",
    errorMessage: null,
  };
}
