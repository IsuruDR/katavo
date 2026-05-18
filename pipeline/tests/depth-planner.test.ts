import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("runDepthPlanner", () => {
  it("returns 3-5 tasks scaled by tier", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "t1", question: "Q1", context: "", searchHints: [], searchProvider: "exa", seedUrls: ["https://seed.com"] },
        { id: "t2", question: "Q2", context: "", searchHints: [], searchProvider: "exa", seedUrls: [] },
        { id: "t3", question: "Q3", context: "", searchHints: [], searchProvider: "tavily", seedUrls: [] },
      ],
    });
    const { runDepthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/depth/planner.js"
    );
    const tasks = await runDepthPlanner({
      researchBrief: "{}",
      sourceChapterTitle: "Origins",
      chapterSection: "Bezzera filed in 1901...",
      coveredGroundDigest: "- Modern: PID controllers",
      tier: "plus",
    });
    expect(tasks).toHaveLength(3);
    expect(tasks[0].seedUrls).toEqual(["https://seed.com"]);
    expect(tasks.every((t) => t.fetchCitedUrls === true)).toBe(true);
  });

  it("converts empty seedUrls to undefined for cleaner downstream handling", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "t1", question: "Q1", context: "", searchHints: [], searchProvider: "exa", seedUrls: [] },
        { id: "t2", question: "Q2", context: "", searchHints: [], searchProvider: "exa", seedUrls: [] },
        { id: "t3", question: "Q3", context: "", searchHints: [], searchProvider: "exa", seedUrls: [] },
      ],
    });
    const { runDepthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/depth/planner.js"
    );
    const tasks = await runDepthPlanner({
      researchBrief: "{}",
      sourceChapterTitle: "Origins",
      chapterSection: "",
      coveredGroundDigest: "",
      tier: "free",
    });
    expect(tasks[0].seedUrls).toBeUndefined();
  });

  it("throws when planner returns outside 3-5 range twice", async () => {
    mockInvoke
      .mockResolvedValueOnce({ tasks: [] })
      .mockResolvedValueOnce({ tasks: [] });
    const { runDepthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/depth/planner.js"
    );
    await expect(
      runDepthPlanner({
        researchBrief: "{}",
        sourceChapterTitle: "S",
        chapterSection: "",
        coveredGroundDigest: "",
        tier: "free",
      }),
    ).rejects.toThrow(/expected 3-5/);
  });
});
