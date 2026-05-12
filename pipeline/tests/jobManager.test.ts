import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the pipeline runner and error handler before importing jobManager
const mockRunPipeline = vi.fn();
const mockHandlePipelineFailure = vi.fn();
vi.mock("../src/podcast_pipeline/graph.js", () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));
vi.mock("../src/podcast_pipeline/nodes/errorHandler.js", () => ({
  handlePipelineFailure: (...args: unknown[]) => mockHandlePipelineFailure(...args),
}));

// Mock supabase for crash recovery
const mockSelect = vi.fn();
const mockFrom = vi.fn(() => ({ select: mockSelect }));
vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { createJobManager } from "../src/jobs/jobManager.js";
import type { Job, JobManager } from "../src/jobs/jobManager.js";

describe("JobManager", () => {
  let jm: JobManager;

  beforeEach(() => {
    vi.resetAllMocks();
    // Re-establish mockFrom's implementation after resetAllMocks clears it
    mockFrom.mockImplementation(() => ({ select: mockSelect }));
    vi.useFakeTimers();
    jm = createJobManager({ maxConcurrentJobs: 2, maxAttempts: 4 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("enqueue", () => {
    it("creates a job with queued status", () => {
      mockRunPipeline.mockResolvedValue({});
      const job = jm.enqueue("pod-1", { podcastId: "pod-1", topic: "AI" });
      expect(job.podcastId).toBe("pod-1");
      expect(job.status).toBe("queued");
      expect(job.attempt).toBe(0);
    });

    it("rejects duplicate podcastId", () => {
      mockRunPipeline.mockImplementation(() => new Promise(() => {})); // never resolves
      jm.enqueue("pod-1", { podcastId: "pod-1", topic: "AI" });
      expect(() => jm.enqueue("pod-1", { podcastId: "pod-1", topic: "AI" })).toThrow(
        "already enqueued",
      );
    });

    it("allows re-enqueue after job completes", async () => {
      mockRunPipeline.mockResolvedValue({});
      jm.enqueue("pod-1", { podcastId: "pod-1", topic: "AI" });
      // Let the pipeline resolve
      await vi.advanceTimersByTimeAsync(0);
      // Should not throw
      const job = jm.enqueue("pod-1", { podcastId: "pod-1", topic: "AI" });
      expect(job.status).toBe("queued");
    });
  });

  describe("concurrency", () => {
    it("respects MAX_CONCURRENT_JOBS limit", () => {
      mockRunPipeline.mockImplementation(() => new Promise(() => {})); // never resolves
      jm.enqueue("pod-1", { podcastId: "pod-1" });
      jm.enqueue("pod-2", { podcastId: "pod-2" });
      jm.enqueue("pod-3", { podcastId: "pod-3" });

      // Only 2 should be running (maxConcurrentJobs: 2)
      expect(jm.getActiveCount()).toBe(2);
    });

    it("starts queued jobs when a running job completes", async () => {
      let resolve1!: () => void;
      mockRunPipeline
        .mockImplementationOnce(() => new Promise((r) => { resolve1 = r; }))
        .mockImplementation(() => new Promise(() => {}));

      jm.enqueue("pod-1", { podcastId: "pod-1" });
      jm.enqueue("pod-2", { podcastId: "pod-2" });
      jm.enqueue("pod-3", { podcastId: "pod-3" });

      expect(jm.getActiveCount()).toBe(2);

      // Complete first job
      resolve1();
      await vi.advanceTimersByTimeAsync(0);

      // pod-3 should now be running
      expect(jm.getActiveCount()).toBe(2);
      expect(jm.getJob("pod-3")?.status).toBe("running");
    });
  });

  describe("retry with backoff", () => {
    it("retries on failure with exponential backoff", async () => {
      mockRunPipeline
        .mockRejectedValueOnce(new Error("transient error 1"))
        .mockRejectedValueOnce(new Error("transient error 2"))
        .mockResolvedValueOnce({});

      jm.enqueue("pod-1", { podcastId: "pod-1" });
      await vi.advanceTimersByTimeAsync(0); // attempt 1 runs and fails

      expect(jm.getJob("pod-1")?.status).toBe("retrying");
      expect(jm.getJob("pod-1")?.attempt).toBe(1);

      // Backoff: 30s for first retry
      await vi.advanceTimersByTimeAsync(30_000);
      // attempt 2 runs and fails
      await vi.advanceTimersByTimeAsync(0);

      expect(jm.getJob("pod-1")?.status).toBe("retrying");
      expect(jm.getJob("pod-1")?.attempt).toBe(2);

      // Backoff: 60s for second retry
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      // Third attempt succeeds — job removed
      expect(jm.getJob("pod-1")).toBeUndefined();
    });

    it("calls handlePipelineFailure only on final failure", async () => {
      mockRunPipeline.mockRejectedValue(new Error("permanent error"));
      mockHandlePipelineFailure.mockResolvedValue(undefined);

      jm.enqueue("pod-1", { podcastId: "pod-1" });

      // Attempt 1
      await vi.advanceTimersByTimeAsync(0);
      expect(mockHandlePipelineFailure).not.toHaveBeenCalled();

      // Attempt 2 (after 30s backoff)
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockHandlePipelineFailure).not.toHaveBeenCalled();

      // Attempt 3 (after 60s backoff)
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockHandlePipelineFailure).not.toHaveBeenCalled();

      // Attempt 4 / final (after 120s backoff)
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHandlePipelineFailure).toHaveBeenCalledOnce();
      expect(mockHandlePipelineFailure).toHaveBeenCalledWith("pod-1", "permanent error");
      expect(jm.getJob("pod-1")).toBeUndefined();
    });

    it("does not send notifications on intermediate failures", async () => {
      mockRunPipeline.mockRejectedValue(new Error("fail"));
      mockHandlePipelineFailure.mockResolvedValue(undefined);

      jm.enqueue("pod-1", { podcastId: "pod-1" });

      // Run through first 3 attempts
      await vi.advanceTimersByTimeAsync(0); // attempt 1
      await vi.advanceTimersByTimeAsync(30_000); // wait
      await vi.advanceTimersByTimeAsync(0); // attempt 2
      await vi.advanceTimersByTimeAsync(60_000); // wait
      await vi.advanceTimersByTimeAsync(0); // attempt 3

      // handlePipelineFailure should NOT have been called yet
      expect(mockHandlePipelineFailure).not.toHaveBeenCalled();
    });

    it("passes isRetryable=true for non-final attempts", async () => {
      mockRunPipeline
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({});

      jm.enqueue("pod-1", { podcastId: "pod-1" });
      await vi.advanceTimersByTimeAsync(0); // attempt 1

      // First call should have isRetryable: true
      expect(mockRunPipeline).toHaveBeenCalledWith(
        { podcastId: "pod-1" },
        { isRetryable: true },
      );

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0); // attempt 2 succeeds

      // For attempt 2 (2 of 4), still retryable
      expect(mockRunPipeline).toHaveBeenLastCalledWith(
        { podcastId: "pod-1" },
        { isRetryable: true },
      );
    });

    it("passes isRetryable=false for the final attempt", async () => {
      mockRunPipeline.mockRejectedValue(new Error("fail"));
      mockHandlePipelineFailure.mockResolvedValue(undefined);

      jm = createJobManager({ maxConcurrentJobs: 2, maxAttempts: 2 });
      jm.enqueue("pod-1", { podcastId: "pod-1" });

      // Attempt 1 (non-final)
      await vi.advanceTimersByTimeAsync(0);
      expect(mockRunPipeline).toHaveBeenLastCalledWith(
        { podcastId: "pod-1" },
        { isRetryable: true },
      );

      // Attempt 2 (final)
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockRunPipeline).toHaveBeenLastCalledWith(
        { podcastId: "pod-1" },
        { isRetryable: false },
      );
    });
  });

  describe("getJob / getActiveCount", () => {
    it("returns undefined for unknown podcastId", () => {
      expect(jm.getJob("nonexistent")).toBeUndefined();
    });

    it("returns 0 when no jobs are active", () => {
      expect(jm.getActiveCount()).toBe(0);
    });
  });

  describe("crash recovery", () => {
    it("re-enqueues stuck podcasts from DB on startup with correct tier", async () => {
      mockRunPipeline.mockImplementation(() => new Promise(() => {})); // never resolves
      mockFrom.mockImplementation((table: string) => {
        if (table === "podcasts") {
          return {
            select: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                data: [
                  { id: "stuck-1", user_id: "u1", topic: "AI", clarifying_answers: [], has_ads: false, voice: null, parent_podcast_id: null, source_chapter_title: null },
                  { id: "stuck-2", user_id: "u2", topic: "ML", clarifying_answers: [], has_ads: true, voice: null, parent_podcast_id: null, source_chapter_title: null },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "subscriptions") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                data: [
                  { user_id: "u1", tier: "pro" },
                  { user_id: "u2", tier: "plus" },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                data: [
                  { id: "u1", has_used_expand: true },
                  { id: "u2", has_used_expand: false },
                ],
                error: null,
              }),
            }),
          };
        }
        return { select: mockSelect };
      });

      const count = await jm.recoverStuckJobs();

      expect(count).toBe(2);
      expect(mockFrom).toHaveBeenCalledWith("podcasts");
      expect(mockFrom).toHaveBeenCalledWith("subscriptions");
      expect(mockFrom).toHaveBeenCalledWith("profiles");
      expect(jm.getJob("stuck-1")).toBeDefined();
      expect(jm.getJob("stuck-2")).toBeDefined();
    });

    it("defaults to free tier when subscription not found", async () => {
      mockRunPipeline.mockImplementation(() => new Promise(() => {}));
      mockFrom.mockImplementation((table: string) => {
        if (table === "podcasts") {
          return {
            select: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                data: [
                  { id: "stuck-1", user_id: "u1", topic: "AI", clarifying_answers: [], has_ads: false, voice: null, parent_podcast_id: null, source_chapter_title: null },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "subscriptions") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        return { select: mockSelect };
      });

      const count = await jm.recoverStuckJobs();

      expect(count).toBe(1);
      expect(jm.getJob("stuck-1")).toBeDefined();
    });

    it("returns 0 when no stuck podcasts exist", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "podcasts") {
          return {
            select: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({ data: [], error: null }),
            }),
          };
        }
        if (table === "subscriptions") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({ data: [], error: null }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({ data: [], error: null }),
            }),
          };
        }
        return { select: mockSelect };
      });

      const count = await jm.recoverStuckJobs();
      expect(count).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("removes job from memory on success", async () => {
      mockRunPipeline.mockResolvedValue({});
      jm.enqueue("pod-1", { podcastId: "pod-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(jm.getJob("pod-1")).toBeUndefined();
    });

    it("removes job from memory on final failure", async () => {
      mockRunPipeline.mockRejectedValue(new Error("fail"));
      mockHandlePipelineFailure.mockResolvedValue(undefined);

      jm = createJobManager({ maxConcurrentJobs: 2, maxAttempts: 1 });
      jm.enqueue("pod-1", { podcastId: "pod-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(jm.getJob("pod-1")).toBeUndefined();
    });
  });
});
