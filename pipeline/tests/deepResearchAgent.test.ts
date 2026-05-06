import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPlanner = vi.hoisted(() => vi.fn());
const mockSubagent = vi.hoisted(() => vi.fn());
const mockSynth = vi.hoisted(() => vi.fn());

vi.mock("../src/podcast_pipeline/nodes/research/planner.js", () => ({ runPlanner: mockPlanner }));
vi.mock("../src/podcast_pipeline/nodes/research/subagent.js", () => ({ runSubagent: mockSubagent }));
vi.mock("../src/podcast_pipeline/nodes/research/synthesizer.js", () => ({ runSynthesizer: mockSynth }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockPlanner.mockReset();
  mockSubagent.mockReset();
  mockSynth.mockReset();
});

const baseState = (overrides: any = {}) => ({
  podcastId: "p1",
  topic: "espresso",
  researchBrief: JSON.stringify({
    scope: "S",
    angle: "A",
    depth: "i",
    keyQuestions: ["Q1?", "Q2?", "Q3?", "Q4?"],
  }),
  tier: "pro",
  researchIterations: 0,
  ...overrides,
});

describe("deepResearchAgent", () => {
  it("happy path: 4 subagents succeed → status=scripting", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2, 3].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      })),
    );
    for (let i = 0; i < 4; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`,
        question: `Q${i + 1}?`,
        status: "complete",
        findings: [{ claim: `c${i}`, sourceUrls: [`u${i}`], sourceTitles: [`t${i}`] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [{ title: "S", content: "x [1]" }],
      sources: [
        { url: "u0", title: "t0" },
        { url: "u1", title: "t1" },
        { url: "u2", title: "t2" },
        { url: "u3", title: "t3" },
      ],
      claims: [
        { text: "c0", sourceIndexes: [0] },
        { text: "c1", sourceIndexes: [1] },
        { text: "c2", sourceIndexes: [2] },
        { text: "c3", sourceIndexes: [3] },
      ],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState() as any);
    expect(result.status).toBe("scripting");
    expect(result.credibilityScore).toBeGreaterThan(0.7);
    expect(result.errorMessage).toBeNull();
    expect(result.researchDocument).toBeDefined();
  });

  it("floor not met: 2 of 4 fail → status=failed", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2, 3].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      })),
    );
    mockSubagent
      .mockResolvedValueOnce({
        taskId: "task_0",
        question: "Q1?",
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      })
      .mockResolvedValueOnce({
        taskId: "task_1",
        question: "Q2?",
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      })
      .mockResolvedValueOnce({
        taskId: "task_2",
        question: "Q3?",
        status: "failed",
        findings: [],
        notes: "n",
      })
      .mockResolvedValueOnce({
        taskId: "task_3",
        question: "Q4?",
        status: "failed",
        findings: [],
        notes: "n",
      });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState() as any);
    // floor for N=4 is 3; usable=2 < 3 → fail
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Research insufficient/);
    expect(mockSynth).not.toHaveBeenCalled();
  });

  it("computes credibility from claims, not sources", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      })),
    );
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`,
        question: `Q${i + 1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [],
      sources: [{ url: "u", title: "t" }],
      claims: [
        { text: "c1", sourceIndexes: [0] },
        { text: "c2", sourceIndexes: [] }, // uncited
      ],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(
      baseState({
        researchBrief: JSON.stringify({
          scope: "S",
          angle: "A",
          depth: "i",
          keyQuestions: ["Q1?", "Q2?", "Q3?"],
        }),
      }) as any,
    );
    // citedClaims=1/2=0.5; sourceDiversity=1/1=1.0; score = 0.5*0.7 + 1.0*0.3 = 0.65
    expect(result.credibilityScore).toBeCloseTo(0.65, 2);
  });

  it("clears errorMessage on retry success", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      })),
    );
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`,
        question: `Q${i + 1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [],
      sources: [{ url: "u", title: "t" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(
      baseState({
        researchBrief: JSON.stringify({
          scope: "S",
          angle: "A",
          depth: "i",
          keyQuestions: ["Q1?", "Q2?", "Q3?"],
        }),
        researchIterations: 1,
        errorMessage: "previous failure",
        researchDocument: { droppedQuestions: ["Q3?"] },
        credibilityReport: "thin coverage",
      }) as any,
    );
    expect(result.status).toBe("scripting");
    expect(result.errorMessage).toBeNull();
  });

  it("planner receives droppedQuestions on retry", async () => {
    mockPlanner.mockImplementationOnce(async (_brief: string, ctx: any) => {
      expect(ctx.researchIterations).toBe(1);
      expect(ctx.droppedQuestions).toEqual(["Q3?"]);
      expect(ctx.credibilityReport).toBe("Credibility 0.5");
      return [0, 1, 2].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      }));
    });
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`,
        question: `Q${i + 1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [],
      sources: [{ url: "u", title: "t" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    await deepResearchAgent(
      baseState({
        researchBrief: JSON.stringify({
          scope: "S",
          angle: "A",
          depth: "i",
          keyQuestions: ["Q1?", "Q2?", "Q3?"],
        }),
        researchIterations: 1,
        researchDocument: { droppedQuestions: ["Q3?"] },
        credibilityReport: "Credibility 0.5",
      }) as any,
    );
  });

  it("score=0 when no claims at all", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map((i) => ({
        id: `task_${i}`,
        question: `Q${i + 1}?`,
        context: "c",
        searchHints: ["h"],
      })),
    );
    // partial with empty findings still passes the floor (only `failed` is dropped);
    // synthesizer then returns empty claims and credibility lands at 0.
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`,
        question: `Q${i + 1}?`,
        status: "partial",
        findings: [],
        notes: "thin",
      });
    }
    mockSynth.mockResolvedValueOnce({ sections: [], sources: [], claims: [], droppedQuestions: [] });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(
      baseState({
        researchBrief: JSON.stringify({
          scope: "S",
          angle: "A",
          depth: "i",
          keyQuestions: ["Q1?", "Q2?", "Q3?"],
        }),
      }) as any,
    );
    expect(result.credibilityScore).toBe(0);
  });
});
