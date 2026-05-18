import type { RunnableConfig } from "@langchain/core/runnables";
import { runDepthPlanner } from "./planner.js";
import { runSubagentV2, type SubagentFindingsV2 } from "../subagentV2.js";
import { runDepthSynthesizerV1 } from "./synthesizerV1.js";
import { runAuditor } from "./auditor.js";
import { evaluateQualityGate } from "./qualityGate.js";
import { runSynthesizerMerge, buildRound2Tasks } from "./synthesizerMerge.js";
import { sanitizeResearchDocument } from "../sanitize.js";
import {
  findRelevantSection,
  buildCoveredGroundDigest,
} from "../../../../lib/parentContext.js";
import { ROUND2_WALLCLOCK_MS } from "../../../config.js";
import { trackEvent } from "../../../providers/telemetry.js";
import type { PipelineStateType } from "../../../state.js";

function getR2Wallclock(): number {
  const override = process.env.ROUND2_WALLCLOCK_OVERRIDE_MS;
  if (override) return parseInt(override, 10);
  return ROUND2_WALLCLOCK_MS;
}

async function runRound2WithTimeout(
  tasks: ReturnType<typeof buildRound2Tasks>,
  config?: RunnableConfig,
): Promise<SubagentFindingsV2[]> {
  const wallclock = getR2Wallclock();
  const runAll = Promise.all(
    tasks.map((t) =>
      runSubagentV2(
        t,
        { maxSearches: t.maxSearches, maxReflections: t.maxReflections },
        config,
      ),
    ),
  );
  const timeout = new Promise<SubagentFindingsV2[]>((resolve) =>
    setTimeout(() => resolve([]), wallclock),
  );
  return Promise.race([runAll, timeout]);
}

export async function runDepthPipeline(
  state: PipelineStateType,
  config?: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const tier = state.tier ?? "free";
  const parentDoc = state.parentResearchDocument ?? {};
  const sourceChapterTitle = state.sourceChapterTitle ?? "";

  // Build parent context
  const sections =
    ((parentDoc as { sections?: Array<{ title: string; content: string }> }).sections) ?? [];
  const match = findRelevantSection(sourceChapterTitle, sections);
  const chapterSection = match.section
    ? `${match.section.title}\n\n${match.section.content}`
    : "(no chapter section available)";
  const coveredGroundDigest = buildCoveredGroundDigest(parentDoc, match.matchedIndex);

  trackEvent(
    "research.depth.parent_context",
    { matchKind: match.matchKind, matchedIndex: match.matchedIndex },
    state.userId,
  );

  // Round 1
  let tasks;
  try {
    tasks = await runDepthPlanner(
      {
        researchBrief: state.researchBrief,
        sourceChapterTitle,
        chapterSection,
        coveredGroundDigest,
        tier,
      },
      config,
    );
  } catch (err: any) {
    return {
      status: "failed",
      errorMessage: `Depth planning failed: ${err?.message ?? String(err)}`,
    };
  }

  const seenUrls = new Set<string>();
  const r1Results = await Promise.all(
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
  const r1Usable = r1Results.filter((r) => r.status !== "failed");
  if (r1Usable.length < Math.ceil(tasks.length / 2)) {
    return {
      status: "failed",
      errorMessage: `Depth R1 insufficient: ${r1Usable.length}/${tasks.length}`,
    };
  }

  let v1;
  try {
    v1 = await runDepthSynthesizerV1(
      {
        findings: r1Usable as SubagentFindingsV2[],
        droppedQuestions: r1Results.filter((r) => r.status === "failed").map((r) => r.question),
        chapterSection,
        coveredGroundDigest,
      },
      config,
    );
  } catch (err: any) {
    return {
      status: "failed",
      errorMessage: `Depth R1 synthesis failed: ${err?.message ?? String(err)}`,
    };
  }

  // Auditor
  const audited = await runAuditor(v1, chapterSection, config);
  const gateDecision = evaluateQualityGate(tier, audited.length);
  trackEvent(
    "research.depth.gate",
    { tier, auditedCount: audited.length, fired: gateDecision.fire },
    state.userId,
  );

  if (!gateDecision.fire) {
    const sanitized = sanitizeResearchDocument(v1, seenUrls);
    return {
      researchDocument: sanitized.document as Record<string, unknown>,
      sources: sanitized.document.sources as Record<string, unknown>[],
      status: "scripting",
    };
  }

  // Round 2
  const r2Tasks = buildRound2Tasks(audited, v1, tier);
  const r2Results = await runRound2WithTimeout(r2Tasks, config);
  // R2 sees its own URLs; merge them into seenUrls so synth can keep them
  for (const r of r2Results)
    for (const f of r.findings) for (const u of f.sourceUrls) seenUrls.add(u);

  let merged;
  try {
    merged = await runSynthesizerMerge({ v1, round2: r2Results, audited }, config);
  } catch {
    merged = v1;
  }

  const sanitized = sanitizeResearchDocument(merged, seenUrls);
  const finalDoc = sanitized.document;
  if (finalDoc.sources.length === 0 && finalDoc.sections.length === 0) {
    return { status: "failed", errorMessage: "Couldn't gather any research for this topic." };
  }
  return {
    researchDocument: finalDoc as Record<string, unknown>,
    sources: finalDoc.sources as Record<string, unknown>[],
    status: "scripting",
  };
}
