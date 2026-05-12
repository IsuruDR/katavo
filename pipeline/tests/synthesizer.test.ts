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

const findings = (taskId: string, claims: { claim: string; urls: string[]; titles: string[] }[]) => ({
  taskId,
  question: `Question for ${taskId}`,
  status: "complete" as const,
  findings: claims.map((c) => ({ claim: c.claim, sourceUrls: c.urls, sourceTitles: c.titles })),
});

describe("runSynthesizer", () => {
  it("passes findings to LLM and returns parsed structured output", async () => {
    // Note: actual source dedup happens inside the LLM (per the prompt). We can't
    // unit-test the dedup logic with a mocked LLM. Source dedup is verified in the
    // gated live integration test (Task 14).
    mockInvoke.mockResolvedValueOnce({
      sections: [{ title: "S1", content: "Bezzera filed in 1901 [1]." }],
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      claims: [{ text: "Bezzera filed in 1901", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    const usable = [
      findings("task_0", [
        { claim: "c1", urls: ["https://a.com"], titles: ["A"] },
        { claim: "c2", urls: ["https://b.com"], titles: ["B"] },
      ]),
      findings("task_1", [
        { claim: "c3", urls: ["https://a.com"], titles: ["A"] }, // dup of source 0
      ]),
    ];
    const result = await runSynthesizer(usable, []);
    expect(result.sources).toHaveLength(2);
    expect(result.sections[0].title).toBe("S1");
  });

  it("retries once when first attempt throws", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("parse fail"))
      .mockResolvedValueOnce({ sections: [], sources: [], claims: [], droppedQuestions: [] });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    const result = await runSynthesizer([findings("task_0", [])], []);
    expect(result).toBeDefined();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("throws after second retry also fails", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"));
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    await expect(runSynthesizer([findings("task_0", [])], [])).rejects.toThrow(/e2/);
  });
});

describe("runSynthesizer expansion priors", () => {
  it("injects parent research as priors when expansion provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [],
      sources: [],
      claims: [],
      droppedQuestions: [],
    });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    await runSynthesizer(
      [findings("task_0", [])],
      [],
      undefined,
      {
        parentTopic: "T",
        sourceChapterTitle: "C",
        parentResearchDocument: { sections: [{ title: "S1", content: "C1" }] },
      },
    );
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).toContain("LAYER ON TOP");
    expect(text).toContain("Source chapter title: C");
    expect(text).toContain("S1");
  });

  it("omits parent priors when no expansion provided", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [],
      sources: [],
      claims: [],
      droppedQuestions: [],
    });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    await runSynthesizer([findings("task_0", [])], []);
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).not.toContain("LAYER ON TOP");
  });
});
