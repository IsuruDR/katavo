import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockCreateDeepAgent = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeTavilyTool = vi.hoisted(() => vi.fn(() => ({ name: "tavily_search" })));
const mockChatOpenAI = vi.hoisted(() => vi.fn().mockImplementation(() => ({})));

vi.mock("deepagents", () => ({ createDeepAgent: mockCreateDeepAgent }));
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

  it("logs final-attempt failure with taskId, question, and notes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_5", question: "Why X?", findings: [], status: "failed", notes: "tavily thin" },
      })
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_5", question: "Why X?", findings: [], status: "failed", notes: "still thin" },
      });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    await runSubagent(
      { id: "task_5", question: "Why X?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[subagent] final-attempt failure:",
      expect.objectContaining({ taskId: "task_5", question: "Why X?", notes: "still thin" }),
    );
    warnSpy.mockRestore();
  });

  it("logs final-attempt throw with taskId, question, and error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("openrouter_429"));
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    await runSubagent(
      { id: "task_6", question: "How Y?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[subagent] final-attempt threw:",
      expect.objectContaining({ taskId: "task_6", question: "How Y?", error: "openrouter_429" }),
    );
    warnSpy.mockRestore();
  });
});
