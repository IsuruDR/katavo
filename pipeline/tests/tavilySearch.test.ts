import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearch = vi.hoisted(() => vi.fn());

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: mockSearch })),
}));

beforeEach(() => {
  process.env.TAVILY_API_KEY = "tvly-test";
  mockSearch.mockReset();
});

describe("makeTavilyTool", () => {
  it("returns results from Tavily within budget", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ url: "https://a.com", title: "A", raw_content: "full a", content: "snip a" }],
    });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 2 });
    const result: any = await tool.invoke({ query: "espresso history" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].url).toBe("https://a.com");
    expect(result.results[0].content).toBe("full a");
    expect(result.searchesRemaining).toBe(1);
  });

  it("returns budget_exceeded after maxSearches", async () => {
    mockSearch.mockResolvedValue({ results: [] });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 1 });
    await tool.invoke({ query: "first" });
    const result: any = await tool.invoke({ query: "second" });
    expect(result.error).toBe("search_budget_exceeded");
    expect(result.remaining).toBe(0);
  });

  it("returns tavily_error when search throws", async () => {
    mockSearch.mockRejectedValueOnce(new Error("network down"));
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 2 });
    const result: any = await tool.invoke({ query: "boom" });
    expect(result.error).toBe("tavily_error");
    expect(result.message).toMatch(/network down/);
    expect(result.searchesRemaining).toBe(1);
  });

  it("falls back to content when raw_content missing", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ url: "https://b.com", title: "B", content: "snippet only" }],
    });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 1 });
    const result: any = await tool.invoke({ query: "fallback" });
    expect(result.results[0].content).toBe("snippet only");
  });
});
