import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEq, mockUpdate, mockFrom, mockGetClient } = vi.hoisted(() => {
  const mockEq = vi.fn();
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
  const mockGetClient = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockEq, mockUpdate, mockFrom, mockGetClient };
});

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: mockGetClient,
}));

import { persistStatus } from "../src/podcast_pipeline/nodes/persistStatus.js";

describe("persistStatus", () => {
  beforeEach(() => {
    mockEq.mockReset().mockResolvedValue({ error: null });
    mockUpdate.mockClear();
    mockFrom.mockClear();
  });

  it("writes the status to the row keyed by podcastId", async () => {
    await persistStatus("pod-1", "researching");
    expect(mockFrom).toHaveBeenCalledWith("podcasts");
    expect(mockUpdate).toHaveBeenCalledWith({ status: "researching" });
    expect(mockEq).toHaveBeenCalledWith("id", "pod-1");
  });

  it("no-ops on empty podcastId", async () => {
    await persistStatus("", "scripting");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("swallows supabase errors so the pipeline can keep going", async () => {
    mockEq.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(persistStatus("pod-1", "scripting")).resolves.toBeUndefined();
  });

  it("swallows thrown errors (no env, etc.) so the pipeline can keep going", async () => {
    mockGetClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_URL not set");
    });
    await expect(
      persistStatus("pod-1", "generating_audio"),
    ).resolves.toBeUndefined();
  });
});
