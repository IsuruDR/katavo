# API Server Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all 6 Supabase Edge Functions and the LangGraph Cloud pipeline into a single Hono Node.js API server with an in-memory job manager for pipeline retries, deployed on Railway.

**Architecture:** One Hono server replaces 6 Deno Edge Functions and the LangGraph Cloud deployment. The pipeline runs in-process — `submit-podcast` calls `jobManager.enqueue()` which runs `runPipeline()` directly with retry/backoff. Three auth middleware patterns (user JWT, webhook secret, internal secret) replace per-handler auth duplication. Mobile app switches from `supabase.functions.invoke()` to `fetch(EXPO_PUBLIC_API_URL + "/api/...")`.

**Tech Stack:** Hono, @hono/node-server, @supabase/supabase-js, vitest, TypeScript, Node.js 20

**Spec reference:** `docs/superpowers/specs/2026-04-10-api-server-consolidation-design.md`

**Depends on:** Plans 1-6

---

## File Structure

```
pipeline/
├── src/
│   ├── server.ts                              # CREATE: Hono app entry point, route registration, crash recovery on startup
│   ├── routes/
│   │   ├── generateQuestions.ts                # CREATE: POST /api/generate-questions handler
│   │   ├── submitPodcast.ts                    # CREATE: POST /api/submit-podcast handler
│   │   ├── notifyComplete.ts                   # CREATE: POST /api/notify-complete handler + sendPodcastNotification() export
│   │   ├── revenuecatWebhook.ts                # CREATE: POST /api/revenucat-webhook handler
│   │   ├── startDeepDive.ts                    # CREATE: POST /api/start-deep-dive handler
│   │   └── endDeepDive.ts                      # CREATE: POST /api/end-deep-dive handler
│   ├── middleware/
│   │   └── auth.ts                             # CREATE: userAuth, webhookAuth, internalAuth middleware
│   ├── jobs/
│   │   └── jobManager.ts                       # CREATE: in-memory job queue with retry + exponential backoff
│   └── podcast_pipeline/
│       ├── graph.ts                            # MODIFY: runPipeline() accepts isRetryable flag, skip handlePipelineFailure when true
│       ├── nodes/
│       │   ├── metadataWriter.ts               # MODIFY: import and call sendPodcastNotification() directly instead of HTTP fetch
│       │   └── errorHandler.ts                 # MODIFY: import and call sendPodcastNotification() directly instead of HTTP fetch
│       └── (all other pipeline files unchanged)
├── tests/
│   ├── auth.test.ts                            # CREATE: tests for auth middleware
│   ├── jobManager.test.ts                      # CREATE: tests for job manager (TDD)
│   └── (existing pipeline tests unchanged)
├── package.json                                # MODIFY: add hono, @hono/node-server; update scripts
├── tsconfig.json                               # MODIFY: if needed for new entry point
├── Dockerfile                                  # CREATE: for Railway deployment
└── .env.example                                # MODIFY: add new env vars, remove obsolete ones

mobile/
├── src/
│   ├── services/
│   │   └── podcast.ts                          # MODIFY: replace supabase.functions.invoke() with fetch()
│   └── hooks/
│       └── useDeepDive.ts                      # MODIFY: replace Edge Function URLs with EXPO_PUBLIC_API_URL

supabase/functions/                             # DELETE: entire directory (6 Edge Functions)
```

---

## Chunk 1: Server Foundation (Tasks 1-3)

### Task 1: Install Dependencies, Create Server Entry Point

**Files:**
- Modify: `pipeline/package.json`
- Create: `pipeline/src/server.ts`
- Modify: `pipeline/.env.example`

- [ ] **Step 1: Install Hono dependencies**

Run:
```bash
cd pipeline && npm install hono @hono/node-server
```

Expected: `package.json` updated with `hono` and `@hono/node-server` in dependencies.

- [ ] **Step 2: Update package.json scripts**

In `pipeline/package.json`, update the `scripts` section:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Changes: `dev` now points to `server.ts` instead of `graph.ts`. Added `start` script for production.

- [ ] **Step 3: Create `pipeline/src/server.ts`**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

const app = new Hono();

// Global CORS — acceptable for mobile API with JWT auth
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// TODO: Route registration will be added in Chunk 2 (Tasks 4-8)
// TODO: Crash recovery will be added in Chunk 3 (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
```

- [ ] **Step 4: Update `pipeline/.env.example`**

```env
# Server
PORT=3000

# OpenAI
OPENAI_API_KEY=your-openai-key

# Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Auth secrets
PIPELINE_CALLBACK_SECRET=your-pipeline-callback-secret
REVENUCAT_WEBHOOK_SECRET=your-revenucat-webhook-secret

# Push notifications
EXPO_ACCESS_TOKEN=your-expo-access-token

# ElevenLabs (for end-deep-dive duration fetch)
ELEVENLABS_API_KEY=your-elevenlabs-key

# Langfuse
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_HOST=https://your-langfuse-instance.up.railway.app

# Job manager
MAX_CONCURRENT_JOBS=10
```

Changes: Added `PORT`, `SUPABASE_ANON_KEY`, `REVENUCAT_WEBHOOK_SECRET`, `EXPO_ACCESS_TOKEN`, `ELEVENLABS_API_KEY`, `MAX_CONCURRENT_JOBS`. Removed `LANGGRAPH_API_URL`, `LANGGRAPH_API_KEY`, `NOTIFY_COMPLETE_URL`.

- [ ] **Step 5: Verify server starts**

Run:
```bash
cd pipeline && npx tsx src/server.ts &
sleep 2
curl http://localhost:3000/health
kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 6: Commit**

```bash
git add pipeline/package.json pipeline/package-lock.json pipeline/src/server.ts pipeline/.env.example
git commit -m "feat: add Hono server entry point with health check"
```

---

### Task 2: Create Auth Middleware with Tests

**Files:**
- Create: `pipeline/src/middleware/auth.ts`
- Create: `pipeline/tests/auth.test.ts`

The three middleware patterns:
- `userAuth` — validates Supabase JWT via `supabase.auth.getUser()`, sets `c.var.user`
- `webhookAuth` — checks `Authorization: Bearer <REVENUCAT_WEBHOOK_SECRET>`
- `internalAuth` — checks `Authorization: Bearer <PIPELINE_CALLBACK_SECRET>`

- [ ] **Step 1: Write failing tests for auth middleware**

Create `pipeline/tests/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { userAuth, webhookAuth, internalAuth } from "../src/middleware/auth.js";

// Mock @supabase/supabase-js
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

describe("auth middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.PIPELINE_CALLBACK_SECRET = "test-internal-secret";
    process.env.REVENUCAT_WEBHOOK_SECRET = "test-webhook-secret";
  });

  describe("userAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/protected", userAuth);
      app.get("/protected", (c) => {
        const user = c.get("user");
        return c.json({ userId: user.id });
      });
      return app;
    }

    it("returns 401 when no Authorization header is provided", async () => {
      const app = createApp();
      const res = await app.request("/protected");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 when Supabase auth fails", async () => {
      mockCreateClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid token" },
          }),
        },
      } as any);

      const app = createApp();
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer invalid-token" },
      });
      expect(res.status).toBe(401);
    });

    it("sets user on context when auth succeeds", async () => {
      const mockUser = { id: "user-123", email: "test@example.com" };
      mockCreateClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: mockUser },
            error: null,
          }),
        },
      } as any);

      const app = createApp();
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-123");
    });

    it("passes the Authorization header to Supabase client", async () => {
      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });
      mockCreateClient.mockReturnValue({ auth: { getUser: mockGetUser } } as any);

      const app = createApp();
      await app.request("/protected", {
        headers: { Authorization: "Bearer my-jwt" },
      });

      expect(mockCreateClient).toHaveBeenCalledWith(
        "http://localhost:54321",
        "test-anon-key",
        { global: { headers: { Authorization: "Bearer my-jwt" } } },
      );
    });
  });

  describe("webhookAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/webhook", webhookAuth);
      app.post("/webhook", (c) => c.json({ ok: true }));
      return app;
    }

    it("returns 401 when no Authorization header", async () => {
      const app = createApp();
      const res = await app.request("/webhook", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("returns 401 when secret does not match", async () => {
      const app = createApp();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("passes when secret matches REVENUCAT_WEBHOOK_SECRET", async () => {
      const app = createApp();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer test-webhook-secret" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("internalAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/internal", internalAuth);
      app.post("/internal", (c) => c.json({ ok: true }));
      return app;
    }

    it("returns 401 when no Authorization header", async () => {
      const app = createApp();
      const res = await app.request("/internal", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("returns 401 when secret does not match", async () => {
      const app = createApp();
      const res = await app.request("/internal", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("passes when secret matches PIPELINE_CALLBACK_SECRET", async () => {
      const app = createApp();
      const res = await app.request("/internal", {
        method: "POST",
        headers: { Authorization: "Bearer test-internal-secret" },
      });
      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd pipeline && npx vitest run tests/auth.test.ts
```

Expected: FAIL — module `../src/middleware/auth.js` not found.

- [ ] **Step 3: Implement auth middleware**

Create `pipeline/src/middleware/auth.ts`:

```typescript
/**
 * Auth middleware for Hono routes.
 *
 * Three patterns:
 * - userAuth: validates Supabase JWT, sets c.var.user
 * - webhookAuth: checks REVENUCAT_WEBHOOK_SECRET
 * - internalAuth: checks PIPELINE_CALLBACK_SECRET
 */

import { createMiddleware } from "hono/factory";
import { createClient } from "@supabase/supabase-js";

type UserAuthEnv = {
  Variables: {
    user: { id: string; email?: string; [key: string]: unknown };
  };
};

/**
 * Validates Supabase JWT from Authorization header.
 * On success, attaches the authenticated user to `c.var.user`.
 */
export const userAuth = createMiddleware<UserAuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

/**
 * Checks Authorization header matches REVENUCAT_WEBHOOK_SECRET.
 */
export const webhookAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${process.env.REVENUCAT_WEBHOOK_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/**
 * Checks Authorization header matches PIPELINE_CALLBACK_SECRET.
 */
export const internalAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${process.env.PIPELINE_CALLBACK_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd pipeline && npx vitest run tests/auth.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/middleware/auth.ts pipeline/tests/auth.test.ts
git commit -m "feat: add userAuth, webhookAuth, internalAuth middleware with tests"
```

---

### Task 3: Create Job Manager with Tests (TDD)

**Files:**
- Create: `pipeline/src/jobs/jobManager.ts`
- Create: `pipeline/tests/jobManager.test.ts`

The job manager is an in-memory queue that:
- Enqueues pipeline runs with deduplication by podcastId
- Runs up to `MAX_CONCURRENT_JOBS` pipelines concurrently
- Retries failed runs with exponential backoff (30s, 60s, 120s)
- Calls `handlePipelineFailure` only after all retries exhausted
- Recovers stuck jobs from DB on server startup

- [ ] **Step 1: Write failing tests for job manager**

Create `pipeline/tests/jobManager.test.ts`:

```typescript
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
    it("re-enqueues stuck podcasts from DB on startup", async () => {
      mockRunPipeline.mockResolvedValue({});
      mockSelect.mockReturnValue({
        not: vi.fn().mockReturnValue({
          data: [
            { id: "stuck-1", user_id: "u1", topic: "AI", clarifying_answers: [], has_ads: false },
            { id: "stuck-2", user_id: "u2", topic: "ML", clarifying_answers: [], has_ads: true },
          ],
          error: null,
        }),
      });

      const count = await jm.recoverStuckJobs();

      expect(count).toBe(2);
      expect(mockFrom).toHaveBeenCalledWith("podcasts");
      expect(jm.getJob("stuck-1")).toBeDefined();
      expect(jm.getJob("stuck-2")).toBeDefined();
    });

    it("returns 0 when no stuck podcasts exist", async () => {
      mockSelect.mockReturnValue({
        not: vi.fn().mockReturnValue({ data: [], error: null }),
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd pipeline && npx vitest run tests/jobManager.test.ts
```

Expected: FAIL — module `../src/jobs/jobManager.js` not found.

- [ ] **Step 3: Implement job manager**

Create `pipeline/src/jobs/jobManager.ts`:

```typescript
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
    drainQueue();
    return job;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd pipeline && npx vitest run tests/jobManager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run all existing pipeline tests to verify no regressions**

Run:
```bash
cd pipeline && npx vitest run
```

Expected: All tests PASS (new + existing).

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/jobs/jobManager.ts pipeline/tests/jobManager.test.ts
git commit -m "feat: add in-memory job manager with retry, backoff, crash recovery (TDD)"
```

---

## Chunk 2: Route Migration (Tasks 4-8)

Each Edge Function becomes a Hono route handler. The translation pattern is:
- `serve(async (req) => { ... })` becomes an exported Hono handler function
- `Deno.env.get("X")` becomes `process.env.X`
- `req.json()` becomes `c.req.json()`
- `new Response(JSON.stringify({...}), { status, headers })` becomes `c.json({...}, status)`
- Auth checking moves to middleware — user is accessed via `c.get("user")`
- CORS is handled by global middleware (already set up in server.ts)

No tests for route handlers — the business logic is identical to the Edge Functions which are already validated in production.

### Task 4: Migrate generate-questions Route

**Files:**
- Create: `pipeline/src/routes/generateQuestions.ts`
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Create the route handler**

Create `pipeline/src/routes/generateQuestions.ts`:

```typescript
/**
 * POST /api/generate-questions
 *
 * Generates 2-3 clarifying questions for a podcast topic using GPT-4o.
 * Checks topic against a moderation blocklist before calling OpenAI.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { topic: string }
 * Response: { questions: string[] }
 */

import { Hono } from "hono";
import { userAuth } from "../middleware/auth.js";

const MODERATION_BLOCKLIST = [
  "how to make a bomb",
  "how to harm",
];

const route = new Hono();

route.post("/", userAuth, async (c) => {
  try {
    const { topic } = await c.req.json();

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return c.json({ error: "Topic is required" }, 400);
    }

    const lowerTopic = topic.toLowerCase();
    for (const pattern of MODERATION_BLOCKLIST) {
      if (lowerTopic.includes(pattern)) {
        return c.json(
          { error: "This topic is not supported. Please try a different topic." },
          400,
        );
      }
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are helping a user create a personalized podcast on a topic they've chosen. Generate exactly 2-3 short, focused clarifying questions to understand what angle, depth, and specific aspects they want covered. Return a JSON array of strings. Example: [\"What specific aspect interests you most?\", \"What's your familiarity level with this topic?\"]",
          },
          {
            role: "user",
            content: `Topic: ${topic}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
    });

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    const questions = content.questions || content;

    return c.json({ questions });
  } catch {
    return c.json({ error: "Failed to generate questions" }, 500);
  }
});

export { route as generateQuestionsRoute };
```

- [ ] **Step 2: Register route in server.ts**

Update `pipeline/src/server.ts` — add the import and route registration after the health check:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";

const app = new Hono();

app.use("*", cors());
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);

// TODO: Remaining routes (Tasks 5-8)
// TODO: Crash recovery (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/routes/generateQuestions.ts pipeline/src/server.ts
git commit -m "feat: migrate generate-questions Edge Function to Hono route"
```

---

### Task 5: Migrate submit-podcast Route

**Files:**
- Create: `pipeline/src/routes/submitPodcast.ts`
- Modify: `pipeline/src/server.ts`

This is the most complex migration. Key change: replaces LangGraph HTTP dispatch with `jobManager.enqueue()`.

- [ ] **Step 1: Create the route handler**

Create `pipeline/src/routes/submitPodcast.ts`:

```typescript
/**
 * POST /api/submit-podcast
 *
 * Validates credits, deducts one credit (CAS), creates podcast record,
 * enqueues pipeline run via job manager.
 *
 * Key difference from Edge Function: no LangGraph HTTP dispatch.
 * Instead calls jobManager.enqueue() for in-process pipeline execution.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { topic, clarifyingAnswers?, trustedSourceId? }
 * Response: { podcast_id, status: "queued" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";
import type { JobManager } from "../jobs/jobManager.js";

const route = new Hono();

/**
 * Must be called once at startup to inject the job manager dependency.
 * This avoids circular imports between routes and the job manager.
 */
let jobManager: JobManager;
export function setJobManager(jm: JobManager): void {
  jobManager = jm;
}

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const topic = body.topic;
    const clarifyingAnswers = body.clarifyingAnswers ?? body.clarifying_answers ?? [];
    const trustedSourceId = body.trustedSourceId ?? body.trusted_source_id;

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check subscription exists
    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subscription) {
      return c.json(
        { error: "No credits remaining. Purchase more credits to continue." },
        402,
      );
    }

    // Check concurrent generation limit
    const tierLimits: Record<string, number> = { free: 1, plus: 2, pro: 3 };
    const maxConcurrent = tierLimits[subscription.tier] || 1;

    const { count } = await serviceClient
      .from("podcasts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "researching", "fact_checking", "scripting", "generating_audio"]);

    if ((count || 0) >= maxConcurrent) {
      return c.json(
        {
          error: `Maximum ${maxConcurrent} concurrent generations allowed. Please wait for current podcasts to finish.`,
        },
        429,
      );
    }

    const hasAds = subscription.tier === "free";

    // CAS credit deduction
    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ credits_remaining: subscription.credits_remaining - 1 })
      .eq("user_id", user.id)
      .eq("credits_remaining", subscription.credits_remaining)
      .gt("credits_remaining", 0)
      .select("credits_remaining")
      .single();

    if (deductError && deductError.code !== "PGRST116") {
      throw deductError;
    }

    if (!updatedSub) {
      const { data: currentSub } = await serviceClient
        .from("subscriptions")
        .select("credits_remaining")
        .eq("user_id", user.id)
        .single();

      if (!currentSub || currentSub.credits_remaining <= 0) {
        return c.json(
          { error: "No credits remaining. Purchase more credits to continue." },
          402,
        );
      }

      return c.json({ error: "Credit deduction conflict. Please retry." }, 409);
    }

    // Create podcast record
    const { data: podcast, error: insertError } = await serviceClient
      .from("podcasts")
      .insert({
        user_id: user.id,
        topic,
        clarifying_answers: clarifyingAnswers || [],
        status: "queued",
        has_ads: hasAds,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Record credit transaction
    await serviceClient.from("credit_transactions").insert({
      user_id: user.id,
      type: "deduction",
      amount: -1,
      podcast_id: podcast.id,
    });

    // Resolve trusted source URLs
    let trustedSourceUrls: string[] = [];
    if (trustedSourceId && subscription.tier === "pro") {
      const { data: sources } = await serviceClient
        .from("trusted_sources")
        .select("urls")
        .eq("id", trustedSourceId)
        .eq("user_id", user.id)
        .single();
      if (sources) {
        trustedSourceUrls = sources.urls.map((s: { url: string }) => s.url);
      }
    }

    // Enqueue pipeline run (replaces LangGraph HTTP dispatch)
    try {
      jobManager.enqueue(podcast.id, {
        podcastId: podcast.id,
        userId: user.id,
        topic,
        clarifyingAnswers: clarifyingAnswers || [],
        hasAds,
        trustedSourceUrls,
        tier: subscription.tier,
      });
    } catch {
      // Job already enqueued (deduplication) — this is fine, return success
    }

    return c.json({ podcast_id: podcast.id, status: "queued" });
  } catch {
    return c.json({ error: "Failed to submit podcast" }, 500);
  }
});

export { route as submitPodcastRoute };
```

- [ ] **Step 2: Register route in server.ts**

Add to `pipeline/src/server.ts`:

```typescript
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";
```

And in the routes section:

```typescript
app.route("/api/submit-podcast", submitPodcastRoute);
```

Note: `setJobManager()` will be called in Task 10 when wiring the job manager into the server.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/routes/submitPodcast.ts pipeline/src/server.ts
git commit -m "feat: migrate submit-podcast Edge Function to Hono route with jobManager.enqueue"
```

---

### Task 6: Create sendPodcastNotification Helper + Migrate notify-complete Route

**Files:**
- Create: `pipeline/src/routes/notifyComplete.ts`
- Modify: `pipeline/src/server.ts`

This task creates both the HTTP route AND the `sendPodcastNotification()` function that will be imported directly by `metadataWriter` and `errorHandler` in Task 9.

- [ ] **Step 1: Create the route handler with exported helper function**

Create `pipeline/src/routes/notifyComplete.ts`:

```typescript
/**
 * POST /api/notify-complete
 *
 * Sends a push notification via Expo when a podcast completes or fails.
 * The HTTP route exists for external callers.
 *
 * For in-process callers (metadataWriter, errorHandler): import and call
 * sendPodcastNotification() directly — no HTTP overhead, no auth needed.
 *
 * Auth: internalAuth middleware (PIPELINE_CALLBACK_SECRET) for HTTP route only
 * Request body: { podcast_id, status, error_message? }
 * Response: { message: "Notification sent" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { internalAuth } from "../middleware/auth.js";

const route = new Hono();

/**
 * Core notification logic — used by both the HTTP route and direct in-process callers.
 * Looks up the podcast and user's push token, then sends via Expo Push API.
 */
export async function sendPodcastNotification(
  podcastId: string,
  status: "complete" | "failed",
  errorMessage?: string,
): Promise<void> {
  const serviceClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: podcast } = await serviceClient
    .from("podcasts")
    .select("user_id, topic")
    .eq("id", podcastId)
    .single();

  if (!podcast) return;

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("expo_push_token")
    .eq("id", podcast.user_id)
    .single();

  if (!profile?.expo_push_token) return;

  const title =
    status === "complete" ? "Your podcast is ready!" : "Podcast generation failed";
  const body =
    status === "complete"
      ? `"${podcast.topic}" is ready to listen.`
      : `"${podcast.topic}" failed. Your credit has been refunded.`;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: profile.expo_push_token,
      title,
      body,
      data: { podcast_id: podcastId, status },
      sound: "default",
    }),
  });
}

route.post("/", internalAuth, async (c) => {
  try {
    const { podcast_id, status, error_message } = await c.req.json();

    await sendPodcastNotification(podcast_id, status, error_message);

    return c.json({ message: "Notification sent" });
  } catch {
    return c.json({ error: "Failed to send notification" }, 500);
  }
});

export { route as notifyCompleteRoute };
```

- [ ] **Step 2: Register route in server.ts**

Add to `pipeline/src/server.ts`:

```typescript
import { notifyCompleteRoute } from "./routes/notifyComplete.js";
```

And in the routes section:

```typescript
app.route("/api/notify-complete", notifyCompleteRoute);
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/routes/notifyComplete.ts pipeline/src/server.ts
git commit -m "feat: migrate notify-complete Edge Function with direct sendPodcastNotification helper"
```

---

### Task 7: Migrate revenucat-webhook Route

**Files:**
- Create: `pipeline/src/routes/revenuecatWebhook.ts`
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Create the route handler**

Create `pipeline/src/routes/revenuecatWebhook.ts`:

```typescript
/**
 * POST /api/revenucat-webhook
 *
 * Handles RevenueCat subscription events: initial purchase, renewal,
 * cancellation, billing issues, expiration, credit purchases, plan changes.
 *
 * Auth: webhookAuth middleware (REVENUCAT_WEBHOOK_SECRET)
 * Request body: RevenueCat webhook event payload
 * Response: { received: true }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { webhookAuth } from "../middleware/auth.js";

const TIER_CONFIG: Record<
  string,
  { tier: string; credits: number; deepDiveMinutes: number }
> = {
  plus_monthly: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  plus_annual: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  pro_monthly: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
  pro_annual: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
};

const route = new Hono();

route.post("/", webhookAuth, async (c) => {
  try {
    const event = await c.req.json();
    const { type, app_user_id, product_id, expiration_at_ms } = event.event;

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const userId = app_user_id;

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        const config = TIER_CONFIG[product_id];
        if (!config) break;

        await serviceClient
          .from("subscriptions")
          .update({
            tier: config.tier,
            status: "active",
            credits_per_month: config.credits,
            credits_remaining: config.credits,
            deep_dive_minutes_per_month: config.deepDiveMinutes,
            deep_dive_minutes_remaining: config.deepDiveMinutes,
            renewal_date: expiration_at_ms
              ? new Date(expiration_at_ms).toISOString()
              : null,
            revenucat_subscription_id: event.event.id,
          })
          .eq("user_id", userId);

        await serviceClient.from("credit_transactions").insert({
          user_id: userId,
          type: "allocation",
          amount: config.credits,
        });
        break;
      }

      case "CANCELLATION": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("user_id", userId);
        break;
      }

      case "BILLING_ISSUE": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "billing_issue" })
          .eq("user_id", userId);
        break;
      }

      case "EXPIRATION": {
        await serviceClient
          .from("subscriptions")
          .update({
            tier: "free",
            status: "active",
            credits_per_month: 1,
            credits_remaining: 1,
            deep_dive_minutes_per_month: 0,
            deep_dive_minutes_remaining: 0,
            revenucat_subscription_id: null,
          })
          .eq("user_id", userId);
        break;
      }

      case "NON_RENEWING_PURCHASE": {
        const creditTiers: Record<string, number> = {
          credit_free_5: 1,
          credit_plus_4: 1,
          credit_pro_3: 1,
        };

        const creditAmount = creditTiers[product_id];
        if (!creditAmount) break;

        const { data: sub } = await serviceClient
          .from("subscriptions")
          .select("credits_remaining")
          .eq("user_id", userId)
          .single();

        if (sub) {
          const { data: updatedSub, error: creditError } = await serviceClient
            .from("subscriptions")
            .update({
              credits_remaining: sub.credits_remaining + creditAmount,
            })
            .eq("user_id", userId)
            .eq("credits_remaining", sub.credits_remaining)
            .select("credits_remaining")
            .single();

          if (creditError || !updatedSub) {
            // Retry once on concurrent modification
            const { data: retrySub } = await serviceClient
              .from("subscriptions")
              .select("credits_remaining")
              .eq("user_id", userId)
              .single();

            if (retrySub) {
              const { data: retryUpdated } = await serviceClient
                .from("subscriptions")
                .update({
                  credits_remaining:
                    retrySub.credits_remaining + creditAmount,
                })
                .eq("user_id", userId)
                .eq("credits_remaining", retrySub.credits_remaining)
                .select("credits_remaining")
                .single();

              if (!retryUpdated) {
                console.error(
                  `CRITICAL: Failed to add credit for user ${userId} product ${product_id} after retry`,
                );
                return c.json(
                  { error: "Credit allocation failed, please retry" },
                  500,
                );
              }
            }
          }

          const priceMap: Record<string, number> = {
            credit_free_5: 5.0,
            credit_plus_4: 4.0,
            credit_pro_3: 3.0,
          };

          await serviceClient.from("credit_transactions").insert({
            user_id: userId,
            type: "purchase",
            amount: creditAmount,
            price_paid: priceMap[product_id] || 0,
          });
        }
        break;
      }

      case "PRODUCT_CHANGE": {
        const config = TIER_CONFIG[product_id];
        if (!config) break;

        const { data: current } = await serviceClient
          .from("subscriptions")
          .select("tier")
          .eq("user_id", userId)
          .single();

        const tierRank: Record<string, number> = {
          free: 0,
          plus: 1,
          pro: 2,
        };
        const isUpgrade =
          tierRank[config.tier] > tierRank[current?.tier || "free"];

        if (isUpgrade) {
          await serviceClient
            .from("subscriptions")
            .update({
              tier: config.tier,
              credits_per_month: config.credits,
              credits_remaining: config.credits,
              deep_dive_minutes_per_month: config.deepDiveMinutes,
              deep_dive_minutes_remaining: config.deepDiveMinutes,
            })
            .eq("user_id", userId);
        } else {
          console.log(
            `PRODUCT_CHANGE downgrade pending for user ${userId}: ` +
              `current=${current?.tier || "free"} -> new=${config.tier}. ` +
              `Will apply at next renewal.`,
          );
        }
        break;
      }
    }

    return c.json({ received: true });
  } catch {
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

export { route as revenuecatWebhookRoute };
```

- [ ] **Step 2: Register route in server.ts**

Add to `pipeline/src/server.ts`:

```typescript
import { revenuecatWebhookRoute } from "./routes/revenuecatWebhook.js";
```

And in the routes section:

```typescript
app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/routes/revenuecatWebhook.ts pipeline/src/server.ts
git commit -m "feat: migrate revenucat-webhook Edge Function to Hono route"
```

---

### Task 8: Migrate start-deep-dive + end-deep-dive Routes

**Files:**
- Create: `pipeline/src/routes/startDeepDive.ts`
- Create: `pipeline/src/routes/endDeepDive.ts`
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Create start-deep-dive route handler**

Create `pipeline/src/routes/startDeepDive.ts`:

```typescript
/**
 * POST /api/start-deep-dive
 *
 * Validates subscription, checks for active sessions, creates a QA session,
 * and returns research context for the ElevenLabs voice agent.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { podcastId, chapterTitle }
 * Response: { sessionId, minutesRemaining, researchDocument, sources, chapterResearchMap, transcript, chapterTitle }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";

const route = new Hono();

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const { podcastId, chapterTitle } = await c.req.json();

    if (!podcastId || !chapterTitle) {
      return c.json(
        { error: "podcastId and chapterTitle are required" },
        400,
      );
    }

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check subscription
    const { data: subscription, error: subError } = await serviceClient
      .from("subscriptions")
      .select("tier, deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    if (subError || !subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    if (subscription.tier === "free") {
      return c.json(
        { error: "Deep Dive requires a Plus or Pro subscription" },
        403,
      );
    }

    if (subscription.deep_dive_minutes_remaining <= 0) {
      return c.json(
        { error: "No deep dive minutes remaining. Resets on next renewal." },
        402,
      );
    }

    // Check no concurrent active session
    const { count: activeSessions } = await serviceClient
      .from("qa_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("ended_at", null);

    if ((activeSessions ?? 0) > 0) {
      return c.json(
        { error: "You already have an active deep dive session" },
        409,
      );
    }

    // Verify podcast ownership and fetch context
    const { data: podcast, error: podcastError } = await serviceClient
      .from("podcasts")
      .select("id, user_id, topic, transcript, chapter_research_map")
      .eq("id", podcastId)
      .single();

    if (podcastError || !podcast || podcast.user_id !== user.id) {
      return c.json({ error: "Podcast not found" }, 404);
    }

    const { data: researchContext } = await serviceClient
      .from("research_contexts")
      .select("research_document, sources")
      .eq("podcast_id", podcastId)
      .single();

    // Create session
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .insert({
        user_id: user.id,
        podcast_id: podcastId,
        chapter_title: chapterTitle,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessionError) {
      if (sessionError.code === "23505") {
        return c.json(
          { error: "You already have an active deep dive session" },
          409,
        );
      }
      return c.json({ error: "Failed to create session" }, 500);
    }

    return c.json({
      sessionId: session.id,
      minutesRemaining: subscription.deep_dive_minutes_remaining,
      researchDocument: researchContext?.research_document ?? {},
      sources: researchContext?.sources ?? [],
      chapterResearchMap: podcast.chapter_research_map,
      transcript: podcast.transcript,
      chapterTitle,
    });
  } catch {
    return c.json({ error: "Failed to start deep dive" }, 500);
  }
});

export { route as startDeepDiveRoute };
```

- [ ] **Step 2: Create end-deep-dive route handler**

Create `pipeline/src/routes/endDeepDive.ts`:

```typescript
/**
 * POST /api/end-deep-dive
 *
 * Ends an active QA session. Fetches authoritative duration from ElevenLabs,
 * updates the session record, and deducts deep dive minutes with CAS.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { sessionId, elevenlabsSessionId? }
 * Response: { durationSeconds, minutesUsed, estimatedCost, deepDiveMinutesRemaining }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";

const COST_PER_MINUTE = 0.1;

const route = new Hono();

/**
 * Fetch session duration from ElevenLabs API (server-authoritative).
 * Returns duration in seconds, or null if not available.
 */
async function getElevenLabsSessionDuration(
  elevenlabsSessionId: string,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${elevenlabsSessionId}`,
      {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.metadata?.duration_seconds ?? data.duration_seconds ?? null;
  } catch {
    return null;
  }
}

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const { sessionId, elevenlabsSessionId } = await c.req.json();

    if (!sessionId) {
      return c.json({ error: "sessionId is required" }, 400);
    }

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Verify session
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .select("id, user_id, started_at, ended_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session || session.user_id !== user.id) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (session.ended_at) {
      return c.json({ error: "Session already ended" }, 409);
    }

    // Get authoritative duration
    let durationSeconds: number;
    if (elevenlabsSessionId) {
      const elevenLabsDuration =
        await getElevenLabsSessionDuration(elevenlabsSessionId);
      if (elevenLabsDuration !== null) {
        durationSeconds = elevenLabsDuration;
      } else {
        durationSeconds = Math.round(
          (Date.now() - new Date(session.started_at).getTime()) / 1000,
        );
      }
    } else {
      durationSeconds = Math.round(
        (Date.now() - new Date(session.started_at).getTime()) / 1000,
      );
    }

    const minutesUsed = Math.ceil(durationSeconds / 60);
    const estimatedCost = minutesUsed * COST_PER_MINUTE;

    // Update session
    await serviceClient
      .from("qa_sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        estimated_cost: estimatedCost,
        elevenlabs_session_id: elevenlabsSessionId ?? null,
      })
      .eq("id", sessionId);

    // Deduct minutes with CAS
    const { data: currentSub } = await serviceClient
      .from("subscriptions")
      .select("deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    const currentMinutes = currentSub?.deep_dive_minutes_remaining ?? 0;
    const newMinutes = Math.max(0, currentMinutes - minutesUsed);

    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ deep_dive_minutes_remaining: newMinutes })
      .eq("user_id", user.id)
      .eq("deep_dive_minutes_remaining", currentMinutes)
      .select("deep_dive_minutes_remaining")
      .single();

    if (deductError || !updatedSub) {
      // Retry once
      const { data: retrySub } = await serviceClient
        .from("subscriptions")
        .select("deep_dive_minutes_remaining")
        .eq("user_id", user.id)
        .single();

      const retryMinutes = retrySub?.deep_dive_minutes_remaining ?? 0;
      const retryNewMinutes = Math.max(0, retryMinutes - minutesUsed);

      const { data: retryUpdated, error: retryError } = await serviceClient
        .from("subscriptions")
        .update({ deep_dive_minutes_remaining: retryNewMinutes })
        .eq("user_id", user.id)
        .eq("deep_dive_minutes_remaining", retryMinutes)
        .select("deep_dive_minutes_remaining")
        .single();

      if (retryError || !retryUpdated) {
        return c.json(
          {
            error:
              "Failed to deduct minutes due to concurrent update. Please try again.",
          },
          409,
        );
      }

      return c.json({
        durationSeconds,
        minutesUsed,
        estimatedCost,
        deepDiveMinutesRemaining: retryUpdated.deep_dive_minutes_remaining,
      });
    }

    return c.json({
      durationSeconds,
      minutesUsed,
      estimatedCost,
      deepDiveMinutesRemaining: updatedSub.deep_dive_minutes_remaining,
    });
  } catch {
    return c.json({ error: "Failed to end deep dive" }, 500);
  }
});

export { route as endDeepDiveRoute };
```

- [ ] **Step 3: Register both routes in server.ts**

Add to `pipeline/src/server.ts`:

```typescript
import { startDeepDiveRoute } from "./routes/startDeepDive.js";
import { endDeepDiveRoute } from "./routes/endDeepDive.js";
```

And in the routes section:

```typescript
app.route("/api/start-deep-dive", startDeepDiveRoute);
app.route("/api/end-deep-dive", endDeepDiveRoute);
```

- [ ] **Step 4: Verify server.ts has all routes registered**

At this point, `pipeline/src/server.ts` should look like:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";
import { notifyCompleteRoute } from "./routes/notifyComplete.js";
import { revenuecatWebhookRoute } from "./routes/revenuecatWebhook.js";
import { startDeepDiveRoute } from "./routes/startDeepDive.js";
import { endDeepDiveRoute } from "./routes/endDeepDive.js";

const app = new Hono();

app.use("*", cors());
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);
app.route("/api/submit-podcast", submitPodcastRoute);
app.route("/api/notify-complete", notifyCompleteRoute);
app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
app.route("/api/start-deep-dive", startDeepDiveRoute);
app.route("/api/end-deep-dive", endDeepDiveRoute);

// TODO: Wire job manager + crash recovery (Task 10)

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

export { app };
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/routes/startDeepDive.ts pipeline/src/routes/endDeepDive.ts pipeline/src/server.ts
git commit -m "feat: migrate start-deep-dive and end-deep-dive Edge Functions to Hono routes"
```

---

## Chunk 3: Pipeline Integration (Tasks 9-10)

### Task 9: Update Pipeline to Use Direct Notification + isRetryable Flag

**Files:**
- Modify: `pipeline/src/podcast_pipeline/graph.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/errorHandler.ts`

- [ ] **Step 1: Update `runPipeline()` to accept `isRetryable` flag**

In `pipeline/src/podcast_pipeline/graph.ts`, change the `runPipeline` function:

Replace:
```typescript
export async function runPipeline(input: Partial<PipelineStateType>): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    const callbacks = [getLangfuseCallbackHandler()];
    return await graph.invoke(state, { callbacks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.podcastId) {
      await handlePipelineFailure(state.podcastId, message);
    }
    throw error;
  }
}
```

With:
```typescript
interface RunPipelineOptions {
  /** When true, the caller (job manager) will handle retries — skip handlePipelineFailure. */
  isRetryable?: boolean;
}

export async function runPipeline(
  input: Partial<PipelineStateType>,
  options: RunPipelineOptions = {},
): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    const callbacks = [getLangfuseCallbackHandler()];
    return await graph.invoke(state, { callbacks });
  } catch (error: unknown) {
    if (!options.isRetryable && state.podcastId) {
      const message = error instanceof Error ? error.message : String(error);
      await handlePipelineFailure(state.podcastId, message);
    }
    throw error;
  }
}
```

Key change: when `isRetryable` is `true`, the catch block does NOT call `handlePipelineFailure` — it just rethrows. The job manager handles scheduling the next retry. When `isRetryable` is `false` (final attempt or direct call), `handlePipelineFailure` runs as before — sets DB status to "failed", triggers refund, sends notification.

- [ ] **Step 2: Update `metadataWriter` to use direct notification call**

In `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts`:

Replace the import section and `NOTIFY_COMPLETE_URL` constant:
```typescript
import { getSupabaseClient } from "../providers/supabaseClient.js";
import type { PipelineStateType } from "../state.js";

const NOTIFY_COMPLETE_URL = process.env.NOTIFY_COMPLETE_URL ?? "";
```

With:
```typescript
import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";
import type { PipelineStateType } from "../state.js";
```

Then replace the notification fetch block:
```typescript
  // Send push notification
  if (NOTIFY_COMPLETE_URL) {
    try {
      await fetch(NOTIFY_COMPLETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.PIPELINE_CALLBACK_SECRET ?? ""}`,
        },
        body: JSON.stringify({
          podcastId,
          status: "complete",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Non-critical
    }
  }
```

With:
```typescript
  // Send push notification (direct function call — no HTTP overhead)
  try {
    await sendPodcastNotification(podcastId, "complete");
  } catch {
    // Non-critical — podcast is already saved
  }
```

- [ ] **Step 3: Update `errorHandler` to use direct notification call**

In `pipeline/src/podcast_pipeline/nodes/errorHandler.ts`:

Replace the entire file:
```typescript
/**
 * Wraps pipeline execution — updates Supabase on unrecoverable failure.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";

export async function handlePipelineFailure(
  podcastId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error: updateError } = await supabase
    .from("podcasts")
    .update({
      status: "failed",
      error_message: errorMessage,
    })
    .eq("id", podcastId);
  if (updateError) {
    console.error(
      `Failed to update podcast failure status: ${updateError.message}`,
    );
  }

  // Send push notification (direct function call — no HTTP overhead)
  try {
    await sendPodcastNotification(podcastId, "failed");
  } catch {
    // Non-critical
  }
}
```

- [ ] **Step 4: Run all pipeline tests**

Run:
```bash
cd pipeline && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/graph.ts pipeline/src/podcast_pipeline/nodes/metadataWriter.ts pipeline/src/podcast_pipeline/nodes/errorHandler.ts
git commit -m "feat: update pipeline for direct notification calls and isRetryable flag"
```

---

### Task 10: Wire Job Manager into Server + Crash Recovery

**Files:**
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Update server.ts with job manager wiring and crash recovery**

Replace the full `pipeline/src/server.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";

import { generateQuestionsRoute } from "./routes/generateQuestions.js";
import { submitPodcastRoute, setJobManager } from "./routes/submitPodcast.js";
import { notifyCompleteRoute } from "./routes/notifyComplete.js";
import { revenuecatWebhookRoute } from "./routes/revenuecatWebhook.js";
import { startDeepDiveRoute } from "./routes/startDeepDive.js";
import { endDeepDiveRoute } from "./routes/endDeepDive.js";
import { createJobManager } from "./jobs/jobManager.js";

const app = new Hono();

app.use("*", cors());
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/generate-questions", generateQuestionsRoute);
app.route("/api/submit-podcast", submitPodcastRoute);
app.route("/api/notify-complete", notifyCompleteRoute);
app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
app.route("/api/start-deep-dive", startDeepDiveRoute);
app.route("/api/end-deep-dive", endDeepDiveRoute);

// Job manager — inject into submit-podcast route
const jobManager = createJobManager();
setJobManager(jobManager);

// Start server
const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);

// Crash recovery: after a 5-second delay (for Supabase connection),
// query for stuck podcasts and re-enqueue them with fresh retry budgets.
setTimeout(async () => {
  try {
    const recovered = await jobManager.recoverStuckJobs();
    if (recovered > 0) {
      console.log(`Crash recovery: re-enqueued ${recovered} stuck podcast(s)`);
    }
  } catch (error) {
    console.error("Crash recovery failed:", error);
  }
}, 5_000);

export { app };
```

- [ ] **Step 2: Run all tests**

Run:
```bash
cd pipeline && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/server.ts
git commit -m "feat: wire job manager into server with crash recovery on startup"
```

---

## Chunk 4: Mobile + Cleanup (Tasks 11-12)

### Task 11: Update Mobile Services to Use EXPO_PUBLIC_API_URL

**Files:**
- Modify: `mobile/src/services/podcast.ts`
- Modify: `mobile/src/hooks/useDeepDive.ts`

- [ ] **Step 1: Update `mobile/src/services/podcast.ts`**

Replace the entire file:

```typescript
import { supabase } from "../lib/supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/**
 * Helper to get the current session's access token for Authorization header.
 */
async function getAuthToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

export async function generateQuestions(topic: string): Promise<string[]> {
  const token = await getAuthToken();
  const response = await fetch(`${API_URL}/api/generate-questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to generate questions");
  }

  const data = await response.json();
  return data.questions;
}

export async function submitPodcast(
  topic: string,
  clarifyingAnswers: Array<{ q: string; a: string }>,
  trustedSourceId?: string,
): Promise<{ podcastId: string }> {
  const token = await getAuthToken();
  const response = await fetch(`${API_URL}/api/submit-podcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ topic, clarifyingAnswers, trustedSourceId }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to submit podcast");
  }

  return response.json();
}
```

Note: The response field from `submit-podcast` returns `podcast_id` (snake_case) — callers should be checked. If callers expect `podcastId` (camelCase), check how `data` is destructured in calling code. The Edge Function returned `{ podcast_id, status }` and the Hono route preserves this. If the mobile app destructures `data.podcast_id`, no change needed.

- [ ] **Step 2: Update deep dive fetch calls in `mobile/src/hooks/useDeepDive.ts`**

In the `startSession` callback, replace the Edge Function fetch:

```typescript
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/start-deep-dive`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSession?.access_token}`,
              apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
            },
            body: JSON.stringify({ podcastId, chapterTitle }),
          },
        );
```

With:

```typescript
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/start-deep-dive`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSession?.access_token}`,
            },
            body: JSON.stringify({ podcastId, chapterTitle }),
          },
        );
```

Changes: URL changes to `EXPO_PUBLIC_API_URL`, `apikey` header removed (not needed — Hono userAuth middleware only checks the JWT).

In the `endSession` callback, replace the Edge Function fetch:

```typescript
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/end-deep-dive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession?.access_token}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            elevenlabsSessionId: elevenlabsSessionIdRef.current,
          }),
        },
      );
```

With:

```typescript
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/end-deep-dive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession?.access_token}`,
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            elevenlabsSessionId: elevenlabsSessionIdRef.current,
          }),
        },
      );
```

- [ ] **Step 3: Run TypeScript check on mobile**

Run:
```bash
cd mobile && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/services/podcast.ts mobile/src/hooks/useDeepDive.ts
git commit -m "feat: update mobile services to use EXPO_PUBLIC_API_URL instead of Edge Functions"
```

---

### Task 12: Delete Edge Functions, Add Dockerfile, Final Verification

**Files:**
- Delete: `supabase/functions/` (entire directory)
- Create: `pipeline/Dockerfile`
- Modify: `mobile/.env.example` (or equivalent) if it exists

- [ ] **Step 1: Delete Supabase Edge Functions directory**

Run:
```bash
rm -rf supabase/functions/
```

Verify:
```bash
ls supabase/functions/ 2>&1
```

Expected: `No such file or directory`

- [ ] **Step 2: Create Dockerfile for Railway deployment**

Create `pipeline/Dockerfile`:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: Verify the build succeeds**

Run:
```bash
cd pipeline && npm run build
```

Expected: No TypeScript errors. `dist/server.js` exists.

- [ ] **Step 4: Run all pipeline tests one final time**

Run:
```bash
cd pipeline && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 5: Run mobile TypeScript check one final time**

Run:
```bash
cd mobile && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete Edge Functions, add Dockerfile, finalize API server consolidation"
```

---

## Environment Variable Checklist

Before deploying, ensure these are set in Railway:

| Variable | Source | Notes |
|----------|--------|-------|
| `PORT` | Railway auto-sets | Usually `3000` |
| `OPENAI_API_KEY` | Existing | Same key |
| `SUPABASE_URL` | Existing | Same URL |
| `SUPABASE_ANON_KEY` | From Supabase dashboard | Was only in Edge Function runtime before |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase dashboard | Trust boundary change: now in Railway |
| `PIPELINE_CALLBACK_SECRET` | Existing | For /api/notify-complete HTTP route |
| `REVENUCAT_WEBHOOK_SECRET` | Existing | Update RevenueCat dashboard webhook URL |
| `EXPO_ACCESS_TOKEN` | Existing | For push notifications |
| `ELEVENLABS_API_KEY` | Existing | For deep dive duration fetch |
| `LANGFUSE_PUBLIC_KEY` | Existing | Same key |
| `LANGFUSE_SECRET_KEY` | Existing | Same key |
| `LANGFUSE_HOST` | Existing | Same URL |
| `MAX_CONCURRENT_JOBS` | New | Default: `10` |

Mobile app (Expo):

| Variable | Notes |
|----------|-------|
| `EXPO_PUBLIC_API_URL` | New — set to Railway URL (e.g., `https://podcast-api.up.railway.app`) |

**Post-deploy:** Update RevenueCat dashboard webhook URL from `https://<supabase-project>.supabase.co/functions/v1/revenucat-webhook` to `https://podcast-api.up.railway.app/api/revenucat-webhook`.

---

## Variables and Config to Remove

After deployment is confirmed working:
- `LANGGRAPH_API_URL` — no longer used (pipeline runs in-process)
- `LANGGRAPH_API_KEY` — no longer used
- `NOTIFY_COMPLETE_URL` — no longer used (direct function call)
- LangGraph Cloud deployment can be decommissioned
- Supabase Edge Functions can be deleted from Supabase dashboard (already deleted from code)
