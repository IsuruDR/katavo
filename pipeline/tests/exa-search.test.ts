import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.hoisted(() => vi.fn());
const findSimilarMock = vi.hoisted(() => vi.fn());

vi.mock("exa-js", () => ({
  default: vi.fn().mockImplementation(() => ({
    searchAndContents: searchMock,
    findSimilarAndContents: findSimilarMock,
  })),
}));

describe("makeExaTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXA_API_KEY = "test-key";
  });

  it("calls searchAndContents when no seed URLs", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        { url: "https://a.com", title: "A", text: "content a" },
        { url: "https://b.com", title: "B", text: "content b" },
      ],
    });
    const { makeExaTool } = await import("../src/podcast_pipeline/tools/exaSearch.js");
    const tool = makeExaTool({ taskId: "t1", maxSearches: 3 });
    const result: any = await tool.invoke({ query: "test query" });
    expect(searchMock).toHaveBeenCalledOnce();
    expect(result.results).toHaveLength(2);
    expect(result.results[0].url).toBe("https://a.com");
  });

  it("budget exceeded returns error after maxSearches", async () => {
    searchMock.mockResolvedValue({ results: [] });
    const { makeExaTool } = await import("../src/podcast_pipeline/tools/exaSearch.js");
    const tool = makeExaTool({ taskId: "t1", maxSearches: 1 });
    await tool.invoke({ query: "q1" });
    const second: any = await tool.invoke({ query: "q2" });
    expect(second.error).toBe("search_budget_exceeded");
  });

  it("uses findSimilarAndContents when seedUrls provided", async () => {
    findSimilarMock.mockResolvedValueOnce({
      results: [{ url: "https://similar.com", title: "S", text: "x" }],
    });
    const { makeExaTool } = await import("../src/podcast_pipeline/tools/exaSearch.js");
    const tool = makeExaTool({
      taskId: "t1",
      maxSearches: 3,
      seedUrls: ["https://seed.com"],
    });
    await tool.invoke({ query: "anything" });
    expect(findSimilarMock).toHaveBeenCalledWith(
      "https://seed.com",
      expect.objectContaining({ numResults: expect.any(Number) }),
    );
  });

  it("wraps content with untrusted markers", async () => {
    searchMock.mockResolvedValueOnce({
      results: [{ url: "https://a.com", title: "A", text: "untrusted body" }],
    });
    const { makeExaTool } = await import("../src/podcast_pipeline/tools/exaSearch.js");
    const tool = makeExaTool({ taskId: "t1", maxSearches: 3 });
    const result: any = await tool.invoke({ query: "x" });
    expect(result.results[0].content).toMatch(/<<UNTRUSTED_WEB_CONTENT/);
    expect(result.results[0].content).toMatch(/<<END_UNTRUSTED>>/);
  });
});
