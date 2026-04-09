/**
 * In-memory job manager for pipeline runs.
 *
 * - Enqueues pipeline runs with deduplication by podcastId
 * - Runs up to maxConcurrentJobs pipelines concurrently (FIFO)
 * - Retries failed runs with exponential backoff (30s base)
 * - Calls handlePipelineFailure only after all retries exhausted
 * - Recovers stuck jobs from DB on server startup
 */

import { runPipeline } from "../podcast_pipeline/graph.js";
import { handlePipelineFailure } from "../podcast_pipeline/nodes/errorHandler.js";
import { getSupabaseClient } from "../podcast_pipeline/providers/supabaseClient.js";
import type { PipelineStateType } from "../podcast_pipeline/state.js";

export interface Job {
  podcastId: string;
  input: Partial<PipelineStateType>;
  status: "queued" | "running" | "retrying" | "completed" | "failed";
  attempt: number;
  maxAttempts: number;
  error?: string;
}

export interface JobManager {
  enqueue(podcastId: string, input: Partial<PipelineStateType>): Job;
  getJob(podcastId: string): Job | undefined;
  getActiveCount(): number;
  recoverStuckJobs(): Promise<number>;
}

interface JobManagerOptions {
  maxConcurrentJobs?: number;
  maxAttempts?: number;
}

const BACKOFF_BASE_MS = 30_000; // 30 seconds

export function createJobManager(options: JobManagerOptions = {}): JobManager {
  const maxConcurrentJobs = options.maxConcurrentJobs ?? parseInt(process.env.MAX_CONCURRENT_JOBS ?? "10");
  const maxAttempts = options.maxAttempts ?? 4;

  const jobs = new Map<string, Job>();

  function getActiveCount(): number {
    let count = 0;
    for (const job of jobs.values()) {
      if (job.status === "running") count++;
    }
    return count;
  }

  function drainQueue(): void {
    for (const job of jobs.values()) {
      if (getActiveCount() >= maxConcurrentJobs) break;
      if (job.status === "queued") {
        executeJob(job);
      }
    }
  }

  function executeJob(job: Job): void {
    job.status = "running";
    job.attempt += 1;

    const isFinalAttempt = job.attempt >= job.maxAttempts;
    const isRetryable = !isFinalAttempt;

    runPipeline(job.input, { isRetryable })
      .then(() => {
        // Success — remove from memory
        jobs.delete(job.podcastId);
        drainQueue();
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        job.error = message;

        if (isFinalAttempt) {
          // Final failure — call handlePipelineFailure, then remove
          await handlePipelineFailure(job.podcastId, message);
          jobs.delete(job.podcastId);
          drainQueue();
        } else {
          // Schedule retry with exponential backoff
          job.status = "retrying";
          const delayMs = BACKOFF_BASE_MS * Math.pow(2, job.attempt - 1);
          setTimeout(() => {
            if (jobs.has(job.podcastId)) {
              job.status = "queued";
              drainQueue();
            }
          }, delayMs);
        }
      });
  }

  function enqueue(podcastId: string, input: Partial<PipelineStateType>): Job {
    if (jobs.has(podcastId)) {
      throw new Error(`Job for podcast ${podcastId} is already enqueued`);
    }

    const job: Job = {
      podcastId,
      input,
      status: "queued",
      attempt: 0,
      maxAttempts,
    };

    jobs.set(podcastId, job);
    const snapshot = { ...job };
    drainQueue();
    return snapshot;
  }

  function getJob(podcastId: string): Job | undefined {
    return jobs.get(podcastId);
  }

  async function recoverStuckJobs(): Promise<number> {
    const supabase = getSupabaseClient();
    const { data: stuckPodcasts, error } = await supabase
      .from("podcasts")
      .select("id, user_id, topic, clarifying_answers, has_ads")
      .not("status", "in", '("complete","failed")');

    if (error || !stuckPodcasts || stuckPodcasts.length === 0) {
      return 0;
    }

    let recovered = 0;
    for (const podcast of stuckPodcasts) {
      if (!jobs.has(podcast.id)) {
        enqueue(podcast.id, {
          podcastId: podcast.id,
          userId: podcast.user_id,
          topic: podcast.topic,
          clarifyingAnswers: podcast.clarifying_answers ?? [],
          hasAds: podcast.has_ads ?? false,
        });
        recovered++;
      }
    }

    return recovered;
  }

  return { enqueue, getJob, getActiveCount, recoverStuckJobs };
}
