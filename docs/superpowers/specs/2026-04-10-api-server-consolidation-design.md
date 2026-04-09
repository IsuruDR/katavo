# API Server Consolidation — Design Spec

## Overview

Consolidate all 6 Supabase Edge Functions and the pipeline into a single Hono Node.js API server deployed on Railway. Pipeline runs in-process with an in-memory job manager that handles retries with exponential backoff. Eliminates Edge Function compute costs, LangGraph Cloud dependency, and reduces network hops.

---

## 1. Architecture

One Hono server on Railway replaces:
- 6 Supabase Edge Functions (generate-questions, submit-podcast, notify-complete, revenucat-webhook, start-deep-dive, end-deep-dive)
- LangGraph Cloud pipeline deployment

```
Mobile App → Railway (Hono API)
                ├── POST /api/generate-questions     [auth: user JWT]
                ├── POST /api/submit-podcast          [auth: user JWT]
                ├── POST /api/start-deep-dive         [auth: user JWT]
                ├── POST /api/end-deep-dive           [auth: user JWT]
                ├── POST /api/notify-complete          [auth: pipeline callback secret]
                └── POST /api/revenucat-webhook        [auth: RevenueCat bearer token]
```

Pipeline runs in the same process — `submit-podcast` calls `runPipeline()` directly via the job manager. No HTTP dispatch to LangGraph Cloud.

Supabase is still used for: auth (JWT verification), database, storage, realtime subscriptions. Only the Edge Functions move.

---

## 2. Job Manager

In-memory job tracker for pipeline runs.

**Flow:**
1. `submitPodcast` handler calls `jobManager.enqueue(podcastId, pipelineInput)` — rejects if podcastId is already enqueued (deduplication)
2. Returns `{ podcastId, status: "queued" }` immediately to the client
3. Job manager runs the pipeline in the background (see retry design below)
4. On success: job removed from memory
5. On final failure (after all retries exhausted): job removed from memory
6. Concurrency limit: max 10 simultaneous pipeline runs (configurable via `MAX_CONCURRENT_JOBS`)

**Critical: Retry vs. failure handling separation.**

The job manager owns the retry lifecycle. `handlePipelineFailure` (which sets DB status to "failed" and triggers the refund) is called ONLY after all retries are exhausted, NOT on each attempt. This prevents premature refunds.

The modified `runPipeline()` accepts an `isRetryable` flag:
- On non-final attempts: catch the error, do NOT call `handlePipelineFailure`, return the error to the job manager for retry scheduling
- On final attempt (or `isRetryable: false`): call `handlePipelineFailure` as today — sets status to "failed", DB trigger refunds credit, notification sent

```
Attempt 1: fails → job manager catches → schedules retry in 30s
Attempt 2: fails → job manager catches → schedules retry in 60s
Attempt 3: fails → job manager catches → schedules retry in 120s
Attempt 4: fails → handlePipelineFailure called → DB: "failed" → trigger: refund → notification sent → job removed
```

Backoff delays are measured from when the failure is detected, not from job start.

**Notification deduplication:** Push notification via `notify-complete` is sent only on the final failure or on success. Intermediate retry failures do not trigger notifications.

**Job deduplication:** `enqueue()` rejects if a job with the same `podcastId` is already in the queue (running or pending retry). Returns the existing job's status instead.

**Crash recovery on server restart:**
- In-flight jobs are lost from memory
- On startup (after a 5-second delay for Supabase connection), query for ALL stuck podcasts: `status NOT IN ('complete', 'failed')`
- Re-enqueue any found with `attempt: 0` (fresh retry budget) — the pipeline is idempotent so re-runs are safe
- No age filter — picks up both recent and old stuck jobs
- This avoids needing a persistent job queue table

**Memory cleanup:** Jobs are removed from the in-memory map on both success and final failure. No zombie entries.

**LangGraph checkpointing:** LangGraph's built-in checkpointing is NOT used in this design. Retries re-run the entire pipeline from scratch. This is acceptable because: (a) the pipeline is idempotent, (b) the most expensive step (Deep Research) cannot be partially resumed anyway (it's a single API call), (c) the job manager retry handles transient failures.

**What the job manager does NOT do:**
- No persistent queue (memory only)
- No priority ordering (FIFO)
- No distributed workers (single process)

**TypeScript interface:**
```typescript
interface Job {
  podcastId: string;
  input: Partial<PipelineStateType>;
  status: "queued" | "running" | "retrying" | "completed" | "failed";
  attempt: number;
  maxAttempts: number;
  error?: string;
}

interface JobManager {
  enqueue(podcastId: string, input: Partial<PipelineStateType>): Job;
  getJob(podcastId: string): Job | undefined;
  getActiveCount(): number;
  recoverStuckJobs(): Promise<number>;
}
```

---

## 3. Auth Middleware

Shared Hono middleware instead of per-handler auth duplication.

**Three auth patterns:**

### User auth (protected routes)
Validates Supabase JWT from `Authorization: Bearer <token>` header using `supabase.auth.getUser()`. Attaches user to Hono context via `c.set("user", user)`. Returns 401 if invalid.

Applied to: `/api/generate-questions`, `/api/submit-podcast`, `/api/start-deep-dive`, `/api/end-deep-dive`

### Webhook auth
Checks `Authorization: Bearer <REVENUCAT_WEBHOOK_SECRET>`. Returns 401 if mismatch.

Applied to: `/api/revenucat-webhook`

### Internal auth
Checks `Authorization: Bearer <PIPELINE_CALLBACK_SECRET>`. Returns 401 if mismatch.

Applied to: `/api/notify-complete`

**Mobile app sends the same auth header it already sends** — no client-side auth changes.

---

## 4. Route Migration

Each Edge Function becomes a Hono route handler. The business logic is identical — only the framework adapter changes:

| Edge Function | Route | Migration Notes |
|--------------|-------|-----------------|
| `generate-questions` | `POST /api/generate-questions` | Replace `serve()` with Hono handler. Replace `Deno.env.get()` with `process.env`. Replace Deno fetch with Node fetch (built-in). |
| `submit-podcast` | `POST /api/submit-podcast` | Same + remove LangGraph HTTP dispatch, call `jobManager.enqueue()` instead |
| `notify-complete` | `POST /api/notify-complete` | Direct migration — this is now an internal endpoint called by `metadataWriter` and `errorHandler` via localhost |
| `revenucat-webhook` | `POST /api/revenucat-webhook` | Direct migration |
| `start-deep-dive` | `POST /api/start-deep-dive` | Direct migration |
| `end-deep-dive` | `POST /api/end-deep-dive` | Direct migration |

**Key simplifications:**
- `notify-complete` becomes a **direct function import** (not an HTTP call). `metadataWriter` and `errorHandler` import and call `sendPodcastNotification(podcastId, status)` directly. The HTTP route is kept for any external callers but pipeline code calls the function directly — no `NOTIFY_COMPLETE_URL`, no `PIPELINE_CALLBACK_SECRET` for internal calls, no localhost HTTP overhead.
- `submit-podcast` no longer needs `LANGGRAPH_API_URL` or `LANGGRAPH_API_KEY` — the pipeline is a local function call.
- CORS handling moves to a global Hono middleware with `Access-Control-Allow-Origin: *` (acceptable for a mobile API with JWT auth).
- `langgraph_run_id` column on `podcasts` table is kept but unused. No migration needed — it's nullable and existing records retain their values. Can be repurposed later for job tracking if needed.

**Security note:** `SUPABASE_SERVICE_ROLE_KEY` now lives in Railway's environment instead of Supabase's own Edge Function runtime. Use Railway's encrypted environment variable storage. This is a trust boundary change but Railway's env vars are encrypted at rest and in transit.

---

## 5. Mobile App Changes

Minimal:

- Add `EXPO_PUBLIC_API_URL` env var (e.g., `https://podcast-api.up.railway.app`)
- Update `mobile/src/services/podcast.ts` — replace `supabase.functions.invoke()` calls with `fetch(API_URL + "/api/...")`
- Update `mobile/src/hooks/useDeepDive.ts` — replace Edge Function calls with `fetch(API_URL + "/api/...")`
- `Authorization` header stays the same (Supabase session token)
- Supabase client still used for: auth, realtime subscriptions, direct data queries

---

## 6. What Gets Deleted

- `supabase/functions/` — entire directory (6 Edge Functions)
- `LANGGRAPH_API_URL` env var
- `LANGGRAPH_API_KEY` env var
- LangGraph HTTP dispatch code in submit-podcast
- `NOTIFY_COMPLETE_URL` env var — notify-complete becomes an in-process call or localhost route

---

## 7. File Structure

```
pipeline/
├── src/
│   ├── server.ts                    # Hono app entry point, route registration
│   ├── routes/
│   │   ├── generateQuestions.ts     # POST /api/generate-questions
│   │   ├── submitPodcast.ts         # POST /api/submit-podcast
│   │   ├── startDeepDive.ts         # POST /api/start-deep-dive
│   │   ├── endDeepDive.ts           # POST /api/end-deep-dive
│   │   ├── notifyComplete.ts        # POST /api/notify-complete
│   │   └── revenuecatWebhook.ts     # POST /api/revenucat-webhook
│   ├── middleware/
│   │   └── auth.ts                  # userAuth, webhookAuth, internalAuth
│   ├── jobs/
│   │   └── jobManager.ts            # In-memory queue with retry + backoff
│   └── podcast_pipeline/            # (existing — unchanged)
│       ├── graph.ts
│       ├── state.ts
│       ├── config.ts
│       ├── nodes/
│       └── providers/
├── tests/
│   ├── jobManager.test.ts
│   ├── auth.test.ts
│   └── (existing pipeline tests — unchanged)
├── package.json                     # Add: hono, @hono/node-server
├── tsconfig.json
├── Dockerfile                       # For Railway deployment
└── .env.example
```

---

## 8. Environment Variables

**Server (Railway):**
```
PORT=3000
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PIPELINE_CALLBACK_SECRET=your-secret
REVENUCAT_WEBHOOK_SECRET=your-revenucat-secret
EXPO_ACCESS_TOKEN=your-expo-token
ELEVENLABS_API_KEY=your-elevenlabs-key
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://your-langfuse.up.railway.app
MAX_CONCURRENT_JOBS=10
```

**Mobile app:**
```
EXPO_PUBLIC_API_URL=https://podcast-api.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## 9. Deployment

```bash
cd pipeline
railway login
railway init
railway up
```

Railway auto-detects the Dockerfile (or `package.json` start script). The server starts on `PORT` and is accessible via the Railway-provided URL.

**Dockerfile:**
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
```

---

## 10. Out of Scope

- Database-backed or Redis-backed job queue (upgrade path if needed later)
- Distributed workers / horizontal scaling
- API rate limiting (can add Hono middleware later)
- API documentation / OpenAPI spec
- Health check / readiness probe (add as follow-up)
- Migration of Supabase realtime subscriptions (stays on Supabase)
