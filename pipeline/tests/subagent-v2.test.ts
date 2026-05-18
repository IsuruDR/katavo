import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubagentTask } from "../src/podcast_pipeline/nodes/research/types.js";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockCreateDeepAgent = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeTavilyTool = vi.hoisted(() => vi.fn(() => ({ name: "tavily_search" })));
const mockMakeExaTool = vi.hoisted(() => vi.fn(() => ({ name: "exa_search" })));
const mockFetchExtract = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() => vi.fn().mockImplementation(() => ({})));
const mockTrackEvent = vi.hoisted(() => vi.fn());

vi.mock("deepagents", () => ({ createDeepAgent: mockCreateDeepAgent }));
vi.mock("../src/podcast_pipeline/tools/tavilySearch.js", () => ({ makeTavilyTool: mockMakeTavilyTool }));
vi.mock("../src/podcast_pipeline/tools/exaSearch.js", () => ({ makeExaTool: mockMakeExaTool }));
vi.mock("../src/podcast_pipeline/tools/webFetch.js", () => ({ fetchAndExtract: mockFetchExtract }));
vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));
vi.mock("../src/podcast_pipeline/providers/telemetry.js", () => ({ trackEvent: mockTrackEvent }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
  mockMakeTavilyTool.mockClear();
  mockMakeExaTool.mockClear();
  mockFetchExtract.mockReset();
  mockTrackEvent.mockClear();
});

describe("runSubagentV2", () => {
  it("uses tavily tool when task.searchProvider is tavily", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
        status: "complete",
      },
    });
    mockFetchExtract.mockResolvedValue({
      success: true,
      url: "https://a.com",
      content: "fetched article",
    });
    // Reflection pass — return same shape
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C refined", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
        status: "complete",
      },
    });
    const { runSubagentV2 } = await import(
      "../src/podcast_pipeline/nodes/research/subagentV2.js"
    );
    const task: SubagentTask = {
      id: "t1",
      question: "Q",
      context: "",
      searchHints: [],
      searchProvider: "tavily",
      maxSearches: 2,
      maxReflections: 1,
      fetchCitedUrls: true,
    };
    const result = await runSubagentV2(task, { maxSearches: 2, maxReflections: 1 });
    expect(result.status).toBe("complete");
    expect(mockMakeTavilyTool).toHaveBeenCalled();
    expect(mockMakeExaTool).not.toHaveBeenCalled();
    expect(mockFetchExtract).toHaveBeenCalledWith("https://a.com");
  });

  it("uses exa tool when task.searchProvider is exa", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C", sourceUrls: [], sourceTitles: [] }],
        status: "complete",
      },
    });
    const { runSubagentV2 } = await import(
      "../src/podcast_pipeline/nodes/research/subagentV2.js"
    );
    const task: SubagentTask = {
      id: "t1",
      question: "Q",
      context: "",
      searchHints: [],
      searchProvider: "exa",
      maxSearches: 3,
      maxReflections: 2,
      fetchCitedUrls: false,
    };
    await runSubagentV2(task, { maxSearches: 3, maxReflections: 2 });
    expect(mockMakeExaTool).toHaveBeenCalled();
    expect(mockMakeTavilyTool).not.toHaveBeenCalled();
  });

  it("skips fetch step when fetchCitedUrls is false", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
        status: "complete",
      },
    });
    const { runSubagentV2 } = await import(
      "../src/podcast_pipeline/nodes/research/subagentV2.js"
    );
    const task: SubagentTask = {
      id: "t1",
      question: "Q",
      context: "",
      searchHints: [],
      searchProvider: "exa",
      maxSearches: 3,
      maxReflections: 2,
      fetchCitedUrls: false,
    };
    await runSubagentV2(task, { maxSearches: 3, maxReflections: 2 });
    expect(mockFetchExtract).not.toHaveBeenCalled();
  });

  it("marks sourceKinds as snippet when fetch fails", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [
          { claim: "C", sourceUrls: ["https://paywalled.com"], sourceTitles: ["P"] },
        ],
        status: "complete",
      },
    });
    mockFetchExtract.mockResolvedValueOnce({
      success: false,
      url: "https://paywalled.com",
      reason: "paywall_or_thin",
    });
    const { runSubagentV2 } = await import(
      "../src/podcast_pipeline/nodes/research/subagentV2.js"
    );
    const task: SubagentTask = {
      id: "t1",
      question: "Q",
      context: "",
      searchHints: [],
      searchProvider: "exa",
      maxSearches: 2,
      maxReflections: 1,
      fetchCitedUrls: true,
    };
    const result = await runSubagentV2(task, { maxSearches: 2, maxReflections: 1 });
    expect(result.sourceKinds).toEqual(["exa-snippet"]);
  });

  it("emits research.subagent.fetch event per URL when userId provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
        status: "complete",
      },
    });
    mockFetchExtract.mockResolvedValueOnce({ success: true, url: "https://a.com", content: "x" });
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "t1",
        question: "Q",
        findings: [{ claim: "C refined", sourceUrls: ["https://a.com"], sourceTitles: ["A"] }],
        status: "complete",
      },
    });
    const { runSubagentV2 } = await import(
      "../src/podcast_pipeline/nodes/research/subagentV2.js"
    );
    await runSubagentV2(
      {
        id: "t1",
        question: "Q",
        context: "",
        searchHints: [],
        searchProvider: "tavily",
        maxSearches: 2,
        maxReflections: 1,
        fetchCitedUrls: true,
      },
      { maxSearches: 2, maxReflections: 1, userId: "u1" },
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "research.subagent.fetch",
      expect.objectContaining({ url: "https://a.com", success: true, provider: "tavily" }),
      "u1",
    );
  });
});
