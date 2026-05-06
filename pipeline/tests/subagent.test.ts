import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockCreateReactAgent = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeTavilyTool = vi.hoisted(() => vi.fn(() => ({ name: "tavily_search" })));
const mockChatOpenAI = vi.hoisted(() => vi.fn().mockImplementation(() => ({})));

vi.mock("@langchain/langgraph/prebuilt", () => ({ createReactAgent: mockCreateReactAgent }));
vi.mock("../src/podcast_pipeline/tools/tavilySearch.js", () => ({ makeTavilyTool: mockMakeTavilyTool }));
vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("runSubagent", () => {
  it("returns SubagentFindings on first-attempt success", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "task_0",
        question: "Q?",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
        status: "complete",
      },
    });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("complete");
    expect(result.findings[0].claim).toBe("c");
  });

  it("retries once when first attempt returns failed", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "first" },
      })
      .mockResolvedValueOnce({
        structuredResponse: {
          taskId: "task_0",
          question: "Q?",
          findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
          status: "complete",
        },
      });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("complete");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("returns failed after second attempt also fails", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "1" },
      })
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "2" },
      });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("failed");
    expect(result.findings).toHaveLength(0);
  });

  it("returns failed when both attempts throw", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("e1")).mockRejectedValueOnce(new Error("e2"));
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/e2/);
  });
});
