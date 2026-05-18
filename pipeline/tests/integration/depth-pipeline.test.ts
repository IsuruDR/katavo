import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const planMock = vi.hoisted(() => vi.fn());
const subagentMock = vi.hoisted(() => vi.fn());
const synthV1Mock = vi.hoisted(() => vi.fn());
const auditorMock = vi.hoisted(() => vi.fn());
const mergeMock = vi.hoisted(() => vi.fn());
const buildR2Mock = vi.hoisted(() => vi.fn());

vi.mock("../../src/podcast_pipeline/nodes/research/depth/planner.js", () => ({
  runDepthPlanner: planMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/subagentV2.js", () => ({
  runSubagentV2: subagentMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/depth/synthesizerV1.js", () => ({
  runDepthSynthesizerV1: synthV1Mock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/depth/auditor.js", () => ({
  runAuditor: auditorMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/depth/synthesizerMerge.js", () => ({
  runSynthesizerMerge: mergeMock,
  buildRound2Tasks: buildR2Mock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/sanitize.js", () => ({
  sanitizeResearchDocument: (doc: any) => ({
    document: doc,
    droppedCount: 0,
    droppedReasons: {},
  }),
}));
vi.mock("../../src/lib/parentContext.js", () => ({
  findRelevantSection: () => ({
    section: { title: "S", content: "content" },
    matchedIndex: 0,
    matchKind: "substring",
  }),
  buildCoveredGroundDigest: () => "- other section",
}));

describe("depth pipeline node", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete process.env.ROUND2_WALLCLOCK_OVERRIDE_MS;
  });

  it("skips R2 when auditor returns empty (gate passes)", async () => {
    planMock.mockResolvedValueOnce([
      {
        id: "t1",
        question: "Q1",
        context: "",
        searchHints: [],
        searchProvider: "exa",
        maxSearches: 3,
        maxReflections: 2,
        fetchCitedUrls: true,
      },
    ]);
    subagentMock.mockResolvedValueOnce({
      taskId: "t1",
      question: "Q1",
      findings: [{ claim: "c", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
      status: "complete",
      sourceKinds: ["exa-fetched"],
    });
    synthV1Mock.mockResolvedValueOnce({
      sections: [{ title: "v1", content: "x" }],
      sources: [{ url: "https://a.com", title: "A" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
    });
    auditorMock.mockResolvedValueOnce([]);

    const { runDepthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/depth/index.js"
    );
    const result = await runDepthPipeline({
      podcastId: "p1",
      userId: "u1",
      tier: "plus",
      researchBrief: "{}",
      parentPodcastId: "parent-1",
      sourceChapterTitle: "Origins",
      parentResearchDocument: { sections: [{ title: "Origins", content: "..." }] },
    } as any);
    expect(result.status).toBe("scripting");
    expect(buildR2Mock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("runs R2 when gate fires (free tier needs 3 findings)", async () => {
    planMock.mockResolvedValueOnce([
      {
        id: "t1",
        question: "Q",
        context: "",
        searchHints: [],
        searchProvider: "exa",
        maxSearches: 2,
        maxReflections: 1,
        fetchCitedUrls: true,
      },
    ]);
    subagentMock.mockResolvedValueOnce({
      taskId: "t1",
      question: "Q",
      findings: [{ claim: "c", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
      status: "complete",
      sourceKinds: ["exa-fetched"],
    });
    synthV1Mock.mockResolvedValueOnce({
      sections: [{ title: "v1", content: "x" }],
      sources: [{ url: "https://a.com", title: "A" }],
      claims: [],
    });
    auditorMock.mockResolvedValueOnce([
      { originalClaim: "x", weakness: "depth", drillQuestion: "q1", originatingSourceIndexes: [] },
      { originalClaim: "y", weakness: "depth", drillQuestion: "q2", originatingSourceIndexes: [] },
      { originalClaim: "z", weakness: "depth", drillQuestion: "q3", originatingSourceIndexes: [] },
    ]);
    buildR2Mock.mockReturnValueOnce([
      {
        id: "r2-0",
        question: "q1",
        context: "",
        searchHints: [],
        searchProvider: "exa",
        maxSearches: 2,
        maxReflections: 1,
        fetchCitedUrls: true,
      },
    ]);
    subagentMock.mockResolvedValueOnce({
      taskId: "r2-0",
      question: "q1",
      findings: [{ claim: "deeper", sourceUrls: ["https://b.com"], sourceTitles: ["B"] }],
      status: "complete",
      sourceKinds: ["exa-fetched"],
    });
    mergeMock.mockResolvedValueOnce({
      sections: [{ title: "merged", content: "x" }],
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      claims: [],
    });

    const { runDepthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/depth/index.js"
    );
    const result = await runDepthPipeline({
      podcastId: "p1",
      userId: "u1",
      tier: "free",
      researchBrief: "{}",
      parentPodcastId: "p",
      sourceChapterTitle: "S",
      parentResearchDocument: { sections: [{ title: "S", content: "..." }] },
    } as any);
    expect(buildR2Mock).toHaveBeenCalled();
    expect(mergeMock).toHaveBeenCalled();
    expect(result.status).toBe("scripting");
  });

  it("falls back to v1 on R2 wall-clock timeout", async () => {
    planMock.mockResolvedValueOnce([
      {
        id: "t1",
        question: "Q",
        context: "",
        searchHints: [],
        searchProvider: "exa",
        maxSearches: 2,
        maxReflections: 1,
        fetchCitedUrls: true,
      },
    ]);
    subagentMock.mockResolvedValueOnce({
      taskId: "t1",
      question: "Q",
      findings: [{ claim: "c", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
      status: "complete",
      sourceKinds: ["exa-fetched"],
    });
    const v1Doc = { sections: [{ title: "v1", content: "x" }], sources: [], claims: [] };
    synthV1Mock.mockResolvedValueOnce(v1Doc);
    auditorMock.mockResolvedValueOnce([
      { originalClaim: "x", weakness: "depth", drillQuestion: "q1", originatingSourceIndexes: [] },
      { originalClaim: "y", weakness: "depth", drillQuestion: "q2", originatingSourceIndexes: [] },
      { originalClaim: "z", weakness: "depth", drillQuestion: "q3", originatingSourceIndexes: [] },
    ]);
    buildR2Mock.mockReturnValueOnce([
      {
        id: "r2-0",
        question: "q1",
        context: "",
        searchHints: [],
        searchProvider: "exa",
        maxSearches: 2,
        maxReflections: 1,
        fetchCitedUrls: true,
      },
    ]);
    // R2 subagent hangs past the wall-clock
    subagentMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 100_000)),
    );
    // Merge call when R2 returns nothing
    mergeMock.mockResolvedValueOnce(v1Doc);

    process.env.ROUND2_WALLCLOCK_OVERRIDE_MS = "200";
    const { runDepthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/depth/index.js"
    );
    const result = await runDepthPipeline({
      podcastId: "p1",
      userId: "u1",
      tier: "free",
      researchBrief: "{}",
      parentPodcastId: "p",
      sourceChapterTitle: "S",
      parentResearchDocument: { sections: [{ title: "S", content: "..." }] },
    } as any);
    expect(result.status).toBe("scripting");
  }, 10_000);
});
