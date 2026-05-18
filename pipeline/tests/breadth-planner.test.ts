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

describe("runBreadthPlanner", () => {
  it("returns tier-scaled task count for free (5)", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        question: `Q${i}`,
        context: "",
        searchHints: [],
        searchProvider: "tavily" as const,
      })),
    });
    const { runBreadthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/planner.js"
    );
    const tasks = await runBreadthPlanner('{"keyQuestions":["q1","q2","q3"]}', "free");
    expect(tasks).toHaveLength(5);
    expect(tasks.every((t) => t.fetchCitedUrls === true)).toBe(true);
  });

  it("returns 8 tasks for pro tier", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`,
        question: `Q${i}`,
        context: "",
        searchHints: [],
        searchProvider: i % 2 === 0 ? "tavily" : "exa",
      })),
    });
    const { runBreadthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/planner.js"
    );
    const tasks = await runBreadthPlanner('{"keyQuestions":["q1"]}', "pro");
    expect(tasks).toHaveLength(8);
  });

  it("propagates tier search budgets onto each task", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`,
        question: `Q${i}`,
        context: "",
        searchHints: [],
        searchProvider: "tavily" as const,
      })),
    });
    const { runBreadthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/planner.js"
    );
    const tasks = await runBreadthPlanner('{"keyQuestions":["q1"]}', "plus");
    expect(tasks[0].maxSearches).toBe(3);
    expect(tasks[0].maxReflections).toBe(2);
  });

  it("retries once on count mismatch then throws on second mismatch", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        tasks: Array.from({ length: 3 }, (_, i) => ({
          id: `t${i}`,
          question: `Q${i}`,
          context: "",
          searchHints: [],
          searchProvider: "tavily" as const,
        })),
      })
      .mockResolvedValueOnce({
        tasks: Array.from({ length: 4 }, (_, i) => ({
          id: `t${i}`,
          question: `Q${i}`,
          context: "",
          searchHints: [],
          searchProvider: "tavily" as const,
        })),
      });
    const { runBreadthPlanner } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/planner.js"
    );
    await expect(
      runBreadthPlanner('{"keyQuestions":["q1"]}', "free"),
    ).rejects.toThrow(/expected 5/);
  });
});
