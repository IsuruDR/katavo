import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { briefBuilder } from "../src/podcast_pipeline/nodes/briefBuilder.js";

describe("briefBuilder", () => {
  it("should produce a structured brief from topic and answers", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        scope: "Impact of quantum computing on cryptography",
        angle: "beginner-friendly",
        depth: "intermediate",
        keyQuestions: ["What is quantum computing?", "How does it threaten encryption?"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      topic: "quantum computing and cryptography",
      clarifyingAnswers: [
        { q: "What angle?", a: "beginner friendly" },
      ],
    };

    const result = await briefBuilder(state as any);

    expect(result.researchBrief).toBeDefined();
    expect(result.researchBrief!.toLowerCase()).toContain("quantum");
    expect(result.status).toBe("researching");
  });
});
