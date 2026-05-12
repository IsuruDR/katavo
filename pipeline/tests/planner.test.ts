import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("planner", () => {
  it("returns one task per keyQuestion", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C1", searchHints: ["h1a", "h1b"] },
        { id: "task_1", question: "Q2?", context: "C2", searchHints: ["h2a", "h2b"] },
        { id: "task_2", question: "Q3?", context: "C3", searchHints: ["h3a", "h3b"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    const tasks = await runPlanner(brief, { researchIterations: 0 });
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe("task_0");
    expect(tasks[2].question).toBe("Q3?");
  });

  it("throws when planner returns wrong number of tasks", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [{ id: "task_0", question: "Q1?", context: "C", searchHints: [] }],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await expect(runPlanner(brief, { researchIterations: 0 })).rejects.toThrow(/expected 3/);
  });

  it("injects retry context when researchIterations > 0", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C", searchHints: ["h"] },
        { id: "task_1", question: "Q2?", context: "C", searchHints: ["h"] },
        { id: "task_2", question: "Q3?", context: "C", searchHints: ["h"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await runPlanner(brief, {
      researchIterations: 1,
      credibilityReport: "Credibility 0.5",
      droppedQuestions: ["Q3?"],
    });
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).toContain("Q3?");
    expect(text).toContain("Credibility 0.5");
  });

  it("hard-fails on N < 3 (degenerate brief; spec assumes 3-5 keyQuestions)", async () => {
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?"] });
    await expect(runPlanner(brief, { researchIterations: 0 })).rejects.toThrow(/at least 3 keyQuestions/);
  });

  it("includes parent context block when expansion provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C", searchHints: ["h"] },
        { id: "task_1", question: "Q2?", context: "C", searchHints: ["h"] },
        { id: "task_2", question: "Q3?", context: "C", searchHints: ["h"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await runPlanner(brief, {
      researchIterations: 0,
      expansion: {
        parentTopic: "AI environmental impact",
        sourceChapterTitle: "Data center energy",
        parentResearchDigest: "Section A: covered.",
      },
    });
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).toContain("continuation episode");
    expect(text).toContain("AI environmental impact");
    expect(text).toContain("Section A: covered");
  });

  it("omits parent context block when no expansion provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C", searchHints: ["h"] },
        { id: "task_1", question: "Q2?", context: "C", searchHints: ["h"] },
        { id: "task_2", question: "Q3?", context: "C", searchHints: ["h"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await runPlanner(brief, { researchIterations: 0 });
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).not.toContain("continuation episode");
  });
});
