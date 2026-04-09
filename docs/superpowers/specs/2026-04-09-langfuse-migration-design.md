# LangSmith → Langfuse Migration — Design Spec

## Overview

Replace LangSmith ($39/mo) with self-hosted Langfuse on Railway for pipeline observability and cost monitoring. Minimal code changes — swap the OpenAI client with Langfuse's `observeOpenAI()` wrapper and add LangChain callback handler.

## What Changes

### 1. Infrastructure: Langfuse on Railway

Deploy Langfuse via Railway's one-click template or `railway up`. Langfuse requires:
- Langfuse web container (Docker image `langfuse/langfuse`)
- PostgreSQL database (Railway managed Postgres)
- Environment variables: `DATABASE_URL`, `NEXTAUTH_SECRET`, `SALT`, `NEXTAUTH_URL`

Estimated cost: ~$5-10/mo on Railway (web container + managed Postgres).

### 2. Pipeline Code Changes

**New file: `pipeline/src/podcast_pipeline/providers/langfuseClient.ts`**

Exports:
- `getObservedOpenAI()` — returns an OpenAI client wrapped with `observeOpenAI()` for automatic tracing + cost tracking
- `getLangfuseCallbackHandler()` — returns a LangChain callback handler for auto-tracing `ChatOpenAI` calls

**Modified files:**
- `pipeline/src/podcast_pipeline/nodes/deepResearch.ts` — replace `new OpenAI()` with `getObservedOpenAI()`
- `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` — replace `new OpenAI()` with `getObservedOpenAI()`
- `pipeline/src/podcast_pipeline/graph.ts` — pass Langfuse callback handler to `graph.invoke()` in `runPipeline()`
- `pipeline/package.json` — add `langfuse` dependency

**No changes to:** briefBuilder (uses `ChatOpenAI` which auto-traces via callback), adInjector, audioProducer, metadataWriter, qualityGate, errorHandler.

### 3. Environment Variables

**Remove:**
- `LANGSMITH_API_KEY` from `.env.example`, `pipeline/.env.example`

**Add:**
- `LANGFUSE_PUBLIC_KEY` — from Langfuse project settings
- `LANGFUSE_SECRET_KEY` — from Langfuse project settings
- `LANGFUSE_HOST` — Railway deployment URL (e.g., `https://langfuse-production-xxxx.up.railway.app`)

### 4. Cost Tracking

Langfuse auto-captures token usage and cost from OpenAI API responses when using `observeOpenAI()`. This includes:
- Token counts (prompt + completion) per call
- Model-specific cost calculation
- Per-pipeline-run cost aggregation via traces

No additional code needed — this is built into the `observeOpenAI()` wrapper.

### 5. What Gets Traced

| Component | Tracing Method | What's Captured |
|-----------|---------------|----------------|
| `briefBuilder` (ChatOpenAI) | LangChain callback handler | Prompt, response, tokens, cost, latency |
| `deepResearch` (OpenAI SDK) | `observeOpenAI()` wrapper | API calls, polling attempts, tokens, cost |
| `scriptWriter` (OpenAI SDK) | `observeOpenAI()` wrapper | Script generation, moderation call, tokens, cost |
| `qualityGate` | No tracing needed | Pure function, no external calls |
| `adInjector` | No tracing needed | Pure function |
| `audioProducer` | No tracing needed | TTS calls (Google, not OpenAI) |
| `metadataWriter` | No tracing needed | Supabase writes |

### 6. What Stays the Same

- All pipeline logic, graph structure, node behavior
- `@langchain/langgraph`, `@langchain/core`, `@langchain/openai` (open source, free)
- `langsmith` npm package stays as transitive dep of `@langchain/core` — inert without API key
- No mobile app changes
- No Supabase changes

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `pipeline/src/podcast_pipeline/providers/langfuseClient.ts` | Create | Observed OpenAI client + LangChain callback handler |
| `pipeline/src/podcast_pipeline/nodes/deepResearch.ts` | Modify | Use `getObservedOpenAI()` instead of `new OpenAI()` |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | Modify | Use `getObservedOpenAI()` instead of `new OpenAI()` |
| `pipeline/src/podcast_pipeline/graph.ts` | Modify | Pass callback handler in `runPipeline()` |
| `pipeline/package.json` | Modify | Add `langfuse` dependency |
| `pipeline/.env.example` | Modify | Replace `LANGSMITH_API_KEY` with Langfuse vars |
| `.env.example` | Modify | Replace `LANGSMITH_API_KEY` with Langfuse vars |

## Out of Scope

- Langfuse evaluations/scoring (can be added later)
- Tracing Google TTS or Supabase calls (not needed for cost monitoring)
- Railway deployment automation (manual one-time setup)
- Migrating historical LangSmith data
