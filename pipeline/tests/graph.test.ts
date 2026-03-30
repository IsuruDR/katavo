import { describe, it, expect, vi } from "vitest";

// Mock OpenAI (used by scriptWriter and deepResearch at module level)
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    moderations: { create: vi.fn() },
    responses: { create: vi.fn(), retrieve: vi.fn() },
  })),
}));

import { graph } from "../src/podcast_pipeline/graph.js";

describe("graph", () => {
  it("should compile and be invocable", () => {
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should compile without errors", () => {
    expect(graph).toBeDefined();
  });
});
