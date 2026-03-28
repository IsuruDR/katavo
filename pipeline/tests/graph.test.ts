import { describe, it, expect, vi } from "vitest";

// scriptWriter creates an OpenAI client at module level, so we mock it
// to avoid requiring OPENAI_API_KEY for graph compilation tests.
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    moderations: { create: vi.fn() },
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
