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

describe("runDepthSynthesizerV1", () => {
  it("produces a research document from findings + chapter context", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [{ title: "Mechanism", content: "PID loops..." }],
      sources: [{ url: "https://a.com", title: "A" }],
      claims: [{ text: "PID...", sourceIndexes: [0] }],
    });
    const { runDepthSynthesizerV1 } = await import(
      "../src/podcast_pipeline/nodes/research/depth/synthesizerV1.js"
    );
    const doc = await runDepthSynthesizerV1({
      findings: [],
      droppedQuestions: [],
      chapterSection: "Origins...",
      coveredGroundDigest: "- Modern: x",
    });
    expect(doc.sections[0].title).toBe("Mechanism");
  });
});
