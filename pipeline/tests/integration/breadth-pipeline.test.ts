import { describe, it, expect, vi, beforeEach } from "vitest";

const planMock = vi.hoisted(() => vi.fn());
const subagentMock = vi.hoisted(() => vi.fn());
const synthMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/podcast_pipeline/nodes/research/breadth/planner.js", () => ({
  runBreadthPlanner: planMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/subagentV2.js", () => ({
  runSubagentV2: subagentMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/breadth/synthesizer.js", () => ({
  runBreadthSynthesizer: synthMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/sanitize.js", () => ({
  sanitizeResearchDocument: (doc: any) => ({
    document: doc,
    droppedCount: 0,
    droppedReasons: {},
  }),
}));

describe("breadth pipeline node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: plans, dispatches subagents, synthesizes, sets scripting status", async () => {
    planMock.mockResolvedValueOnce([
      { id: "t1", question: "Q1", context: "", searchHints: [], searchProvider: "tavily", maxSearches: 3, maxReflections: 2, fetchCitedUrls: true },
      { id: "t2", question: "Q2", context: "", searchHints: [], searchProvider: "exa", maxSearches: 3, maxReflections: 2, fetchCitedUrls: true },
    ]);
    subagentMock
      .mockResolvedValueOnce({
        taskId: "t1", question: "Q1", findings: [{ claim: "c1", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }], status: "complete", sourceKinds: ["tavily-fetched"],
      })
      .mockResolvedValueOnce({
        taskId: "t2", question: "Q2", findings: [{ claim: "c2", sourceUrls: ["https://b.com"], sourceTitles: ["B"] }], status: "complete", sourceKinds: ["exa-fetched"],
      });
    synthMock.mockResolvedValueOnce({
      sections: [{ title: "S1", content: "x" }],
      sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
      droppedQuestions: [],
    });

    const { runBreadthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/breadth/index.js"
    );
    const result = await runBreadthPipeline({
      podcastId: "p1",
      userId: "u1",
      tier: "plus",
      researchBrief: '{"keyQuestions":["q1","q2"]}',
    } as any);
    expect(result.status).toBe("scripting");
    expect(result.researchDocument).toBeDefined();
    expect(result.sources).toHaveLength(2);
  });

  it("fails fast when planner throws", async () => {
    planMock.mockRejectedValueOnce(new Error("planner exploded"));
    const { runBreadthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/breadth/index.js"
    );
    const result = await runBreadthPipeline({
      podcastId: "p1", userId: "u1", tier: "free", researchBrief: "{}",
    } as any);
    expect(result.status).toBe("failed");
  });

  it("fails when >50% subagents fail", async () => {
    planMock.mockResolvedValueOnce([
      { id: "t1", question: "Q1", context: "", searchHints: [], searchProvider: "tavily", maxSearches: 2, maxReflections: 1, fetchCitedUrls: true },
      { id: "t2", question: "Q2", context: "", searchHints: [], searchProvider: "tavily", maxSearches: 2, maxReflections: 1, fetchCitedUrls: true },
      { id: "t3", question: "Q3", context: "", searchHints: [], searchProvider: "tavily", maxSearches: 2, maxReflections: 1, fetchCitedUrls: true },
    ]);
    subagentMock
      .mockResolvedValueOnce({ taskId: "t1", question: "Q1", findings: [], status: "failed", sourceKinds: [] })
      .mockResolvedValueOnce({ taskId: "t2", question: "Q2", findings: [], status: "failed", sourceKinds: [] })
      .mockResolvedValueOnce({ taskId: "t3", question: "Q3", findings: [{ claim: "c", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }], status: "complete", sourceKinds: ["tavily-fetched"] });
    const { runBreadthPipeline } = await import(
      "../../src/podcast_pipeline/nodes/research/breadth/index.js"
    );
    const result = await runBreadthPipeline({
      podcastId: "p1", userId: "u1", tier: "free", researchBrief: "{}",
    } as any);
    expect(result.status).toBe("failed");
  });
});
