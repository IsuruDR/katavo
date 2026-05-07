import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandleFailure } = vi.hoisted(() => ({
  mockHandleFailure: vi.fn(),
}));

vi.mock("../src/podcast_pipeline/nodes/errorHandler.js", () => ({
  handlePipelineFailure: mockHandleFailure,
}));

// Mock OpenAI (used by scriptWriter and deepResearch at module level)
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    moderations: { create: vi.fn() },
    responses: { create: vi.fn(), retrieve: vi.fn() },
  })),
}));

import {
  graph,
  routeAfterDeepResearch,
  routeAfterQualityGate,
  routeAfterScript,
  runPipeline,
} from "../src/podcast_pipeline/graph.js";

describe("graph", () => {
  it("should compile and be invocable", () => {
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });
});

describe("routeAfterDeepResearch", () => {
  it("ends the pipeline when deepResearch returned status=failed", () => {
    const result = routeAfterDeepResearch({
      status: "failed",
      errorMessage: "rate_limit",
    } as any);
    expect(result).toBe("__end__");
  });

  it("routes to qualityGate on success", () => {
    const result = routeAfterDeepResearch({
      status: "scripting",
      sources: [{ url: "x" }],
    } as any);
    expect(result).toBe("qualityGate");
  });
});

describe("routeAfterQualityGate", () => {
  it("ends the pipeline when qualityGate forwarded a failed status", () => {
    const result = routeAfterQualityGate({
      status: "failed",
      shouldRetry: false,
    } as any);
    expect(result).toBe("__end__");
  });

  it("retries deepResearchAgent when shouldRetry=true", () => {
    const result = routeAfterQualityGate({
      status: "scripting",
      shouldRetry: true,
    } as any);
    expect(result).toBe("deepResearchAgent");
  });

  it("routes to scriptWriter on pass", () => {
    const result = routeAfterQualityGate({
      status: "scripting",
      shouldRetry: false,
    } as any);
    expect(result).toBe("scriptWriter");
  });
});

describe("routeAfterScript", () => {
  it("routes to adInjector when hasAds=true", () => {
    const result = routeAfterScript({
      status: "scripting",
      hasAds: true,
    } as any);
    expect(result).toBe("adInjector");
  });

  it("routes directly to tagInjector when no ads", () => {
    const result = routeAfterScript({
      status: "scripting",
      hasAds: false,
    } as any);
    expect(result).toBe("tagInjector");
  });
});

describe("runPipeline", () => {
  beforeEach(() => {
    mockHandleFailure.mockReset();
    mockHandleFailure.mockResolvedValue(undefined);
  });

  it("persists non-thrown failures via handlePipelineFailure", async () => {
    vi.spyOn(graph, "invoke").mockResolvedValueOnce({
      status: "failed",
      errorMessage: "Deep research failed: rate_limit",
      podcastId: "pod-1",
    } as any);

    const result = await runPipeline({ podcastId: "pod-1" });

    expect(mockHandleFailure).toHaveBeenCalledWith(
      "pod-1",
      "Deep research failed: rate_limit",
    );
    expect(result.status).toBe("failed");
  });

  it("does not call handlePipelineFailure on successful runs", async () => {
    vi.spyOn(graph, "invoke").mockResolvedValueOnce({
      status: "complete",
      podcastId: "pod-2",
      audioUrl: "https://example.com/audio.mp3",
    } as any);

    await runPipeline({ podcastId: "pod-2" });

    expect(mockHandleFailure).not.toHaveBeenCalled();
  });

  it("uses a default message when errorMessage is missing on a failed result", async () => {
    vi.spyOn(graph, "invoke").mockResolvedValueOnce({
      status: "failed",
      podcastId: "pod-3",
    } as any);

    await runPipeline({ podcastId: "pod-3" });

    expect(mockHandleFailure).toHaveBeenCalledWith("pod-3", "Pipeline failed");
  });
});
