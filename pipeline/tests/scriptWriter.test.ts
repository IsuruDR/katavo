import { describe, it, expect, vi } from "vitest";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const mockModCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      moderations: { create: mockModCreate },
    })),
    __mockCreate: mockCreate,
    __mockModCreate: mockModCreate,
  };
});

import { scriptWriter } from "../src/podcast_pipeline/nodes/scriptWriter.js";

describe("scriptWriter", () => {
  it("should produce a script with chapters", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      await import("openai") as any;

    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: `[CHAPTER: The Quantum Threat]
Imagine a computer so powerful it could crack every encryption...

[CHAPTER: Fighting Back]
But researchers aren't sitting idle. NIST has been working on...

[CHAPTER: What It Means For You]
So what does this mean for the average person?...`,
        },
      }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toBeDefined();
    expect(result.script).toContain("[CHAPTER:");
    expect(result.status).toBe("scripting");
  });

  it("should add disclaimer when needed", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      await import("openai") as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Script with disclaimer..." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [] },
      needsDisclaimer: true,
    };

    const result = await scriptWriter(state as any);

    const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
    const systemMsg = callArgs.messages[0].content;
    expect(systemMsg.toLowerCase()).toMatch(/limited|disclaimer/);
  });
});
