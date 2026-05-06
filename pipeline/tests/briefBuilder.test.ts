import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

vi.mock("../src/podcast_pipeline/nodes/persistStatus.js", () => ({
  persistStatus: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("briefBuilder", () => {
  it("should produce a structured brief from topic and answers", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "Impact of quantum computing on cryptography",
      angle: "beginner-friendly",
      depth: "intermediate",
      keyQuestions: [
        "What is quantum computing?",
        "How does it threaten encryption?",
        "What is post-quantum cryptography?",
      ],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");

    const state = {
      podcastId: "p1",
      topic: "quantum computing and cryptography",
      clarifyingAnswers: [{ q: "What angle?", a: "beginner friendly" }],
    };

    const result = await briefBuilder(state as any);

    expect(result.researchBrief).toBeDefined();
    expect(result.researchBrief!.toLowerCase()).toContain("quantum");
    // Now stored as JSON string, parseable
    const parsed = JSON.parse(result.researchBrief!);
    expect(parsed.keyQuestions.length).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe("researching");
  });
});
