import { describe, it, expect, vi, beforeEach } from "vitest";

const breadthMock = vi.hoisted(() => vi.fn());
const depthMock = vi.hoisted(() => vi.fn());
const legacyMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/podcast_pipeline/nodes/research/breadth/index.js", () => ({
  runBreadthPipeline: breadthMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/research/depth/index.js", () => ({
  runDepthPipeline: depthMock,
}));
vi.mock("../../src/podcast_pipeline/nodes/deepResearchAgent.js", () => ({
  deepResearchAgent: legacyMock,
}));
vi.mock("../../src/podcast_pipeline/providers/telemetry.js", () => ({
  trackEvent: trackMock,
}));

describe("researchEntry node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEARCH_V12_ASYMMETRIC;
  });

  it("delegates to legacy when flag is off", async () => {
    legacyMock.mockResolvedValueOnce({ status: "scripting" });
    const { researchEntry } = await import(
      "../../src/podcast_pipeline/nodes/research/entry.js"
    );
    await researchEntry({ tier: "free" } as any);
    expect(legacyMock).toHaveBeenCalled();
    expect(breadthMock).not.toHaveBeenCalled();
  });

  it("routes to breadth when flag on and no parentPodcastId", async () => {
    process.env.RESEARCH_V12_ASYMMETRIC = "1";
    breadthMock.mockResolvedValueOnce({ status: "scripting" });
    const { researchEntry } = await import(
      "../../src/podcast_pipeline/nodes/research/entry.js"
    );
    await researchEntry({ tier: "plus", parentPodcastId: null } as any);
    expect(breadthMock).toHaveBeenCalled();
    expect(depthMock).not.toHaveBeenCalled();
  });

  it("routes to depth when flag on and parentPodcastId set", async () => {
    process.env.RESEARCH_V12_ASYMMETRIC = "1";
    depthMock.mockResolvedValueOnce({ status: "scripting" });
    const { researchEntry } = await import(
      "../../src/podcast_pipeline/nodes/research/entry.js"
    );
    await researchEntry({ tier: "pro", parentPodcastId: "parent-1" } as any);
    expect(depthMock).toHaveBeenCalled();
    expect(breadthMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy if new pipeline throws and tracks the fallback event", async () => {
    process.env.RESEARCH_V12_ASYMMETRIC = "1";
    breadthMock.mockRejectedValueOnce(new Error("v22 broke"));
    legacyMock.mockResolvedValueOnce({ status: "scripting" });
    const { researchEntry } = await import(
      "../../src/podcast_pipeline/nodes/research/entry.js"
    );
    const result = await researchEntry({
      tier: "free",
      parentPodcastId: null,
      userId: "u1",
    } as any);
    expect(legacyMock).toHaveBeenCalled();
    expect(result.status).toBe("scripting");
    expect(trackMock).toHaveBeenCalledWith(
      "research.entry.fallback",
      expect.objectContaining({ isExpansion: false, error: "v22 broke" }),
      "u1",
    );
  });
});
