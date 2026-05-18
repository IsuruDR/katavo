import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditedClaim } from "../src/podcast_pipeline/nodes/research/types.js";
import type { ResearchDocument } from "../src/podcast_pipeline/nodes/research/synthesizer.js";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockStructured = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeOpenRouter = vi.hoisted(() =>
  vi.fn(() => ({ withStructuredOutput: mockStructured })),
);

vi.mock("../src/podcast_pipeline/providers/openrouter.js", () => ({
  makeOpenRouterModel: mockMakeOpenRouter,
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("buildRound2Tasks", () => {
  it("converts AuditedClaim to SubagentTask with seedUrls from indexes", async () => {
    const { buildRound2Tasks } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js"
    );
    const v1: ResearchDocument = {
      sections: [],
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      claims: [],
    } as ResearchDocument;
    const audited: AuditedClaim[] = [
      { originalClaim: "x", weakness: "depth", drillQuestion: "deeper q", originatingSourceIndexes: [0, 1] },
    ];
    const tasks = buildRound2Tasks(audited, v1, "plus");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].searchProvider).toBe("exa");
    expect(tasks[0].seedUrls).toEqual(["https://a.com", "https://b.com"]);
    expect(tasks[0].fetchCitedUrls).toBe(true);
  });

  it("caps tasks at TIER_CONFIG[tier].maxR2Subagents", async () => {
    const { buildRound2Tasks } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js"
    );
    const audited: AuditedClaim[] = Array.from({ length: 5 }, (_, i) => ({
      originalClaim: `c${i}`,
      weakness: "depth" as const,
      drillQuestion: `q${i}`,
      originatingSourceIndexes: [],
    }));
    const tasks = buildRound2Tasks(
      audited,
      { sections: [], sources: [], claims: [] } as ResearchDocument,
      "free",
    );
    expect(tasks).toHaveLength(3); // free cap
  });
});

describe("runSynthesizerMerge", () => {
  it("merges v1 and r2 into a single document", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [{ title: "Merged", content: "x" }],
      sources: [{ url: "https://a.com", title: "A" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
    });
    const { runSynthesizerMerge } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js"
    );
    const result = await runSynthesizerMerge({
      v1: { sections: [], sources: [], claims: [] } as ResearchDocument,
      round2: [
        {
          taskId: "r2",
          question: "q",
          findings: [{ claim: "c", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
          status: "complete",
          sourceKinds: ["exa-fetched"],
        },
      ],
      audited: [],
    });
    expect(result.sections[0].title).toBe("Merged");
  });

  it("returns v1 unchanged when round 2 produced nothing usable", async () => {
    const v1 = { sections: [{ title: "v1", content: "x" }], sources: [], claims: [] } as ResearchDocument;
    const { runSynthesizerMerge } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js"
    );
    const result = await runSynthesizerMerge({ v1, round2: [], audited: [] });
    expect(result).toBe(v1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("falls back to v1 when merge throws on both attempts", async () => {
    mockInvoke.mockRejectedValue(new Error("synth failed"));
    const v1 = { sections: [{ title: "v1", content: "x" }], sources: [], claims: [] } as ResearchDocument;
    const { runSynthesizerMerge } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js"
    );
    const result = await runSynthesizerMerge({
      v1,
      round2: [
        {
          taskId: "r2",
          question: "q",
          findings: [{ claim: "c", sourceUrls: [], sourceTitles: [] }],
          status: "complete",
          sourceKinds: [],
        },
      ],
      audited: [],
    });
    expect(result).toBe(v1);
  });
});
