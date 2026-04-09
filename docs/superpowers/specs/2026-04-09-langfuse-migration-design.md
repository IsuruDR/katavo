# Langfuse Migration + OpenAI TTS Switch — Design Spec

## Overview

Two pipeline infrastructure changes:

1. **Observability:** Replace LangSmith ($39/mo) with self-hosted Langfuse on Railway — swap the OpenAI client with Langfuse's `observeOpenAI()` wrapper and add LangChain callback handler.
2. **TTS:** Replace Google WaveNet with OpenAI `gpt-4o-mini-tts` — better voice quality at nearly identical cost ($0.15 vs $0.14 per podcast). Instruction-following TTS enables "speak like an engaging podcast host" prompts.

Both changes touch the pipeline only. No mobile or Supabase changes.

---

## 1. Langfuse (Observability)

### 1.1 Infrastructure: Langfuse on Railway

Deploy Langfuse via Railway's one-click template or `railway up`. Langfuse requires:
- Langfuse web container (Docker image `langfuse/langfuse`)
- PostgreSQL database (Railway managed Postgres)
- Environment variables: `DATABASE_URL`, `NEXTAUTH_SECRET`, `SALT`, `NEXTAUTH_URL`

Estimated cost: ~$5-10/mo on Railway (web container + managed Postgres).

### 1.2 Pipeline Code Changes

**New file: `pipeline/src/podcast_pipeline/providers/langfuseClient.ts`**

Exports:
- `getObservedOpenAI()` — returns an OpenAI client wrapped with `observeOpenAI()` for automatic tracing + cost tracking. Singleton-cached like `getSupabaseClient()`.
- `getLangfuseCallbackHandler()` — returns a LangChain callback handler for auto-tracing `ChatOpenAI` calls

**Modified files:**
- `pipeline/src/podcast_pipeline/nodes/deepResearch.ts` — replace `new OpenAI()` with `getObservedOpenAI()`
- `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` — replace `new OpenAI()` with `getObservedOpenAI()`
- `pipeline/src/podcast_pipeline/graph.ts` — pass Langfuse callback handler to `graph.invoke()` in `runPipeline()`
- `pipeline/package.json` — add `langfuse` dependency

### 1.3 Environment Variables

**Remove:**
- `LANGSMITH_API_KEY` from `.env.example`, `pipeline/.env.example`

**Add:**
- `LANGFUSE_PUBLIC_KEY` — from Langfuse project settings
- `LANGFUSE_SECRET_KEY` — from Langfuse project settings
- `LANGFUSE_HOST` — Railway deployment URL (e.g., `https://langfuse-production-xxxx.up.railway.app`)

### 1.4 Cost Tracking

Langfuse auto-captures token usage and cost from OpenAI API responses when using `observeOpenAI()`. This includes:
- Token counts (prompt + completion) per call
- Model-specific cost calculation
- Per-pipeline-run cost aggregation via traces

No additional code needed — this is built into the `observeOpenAI()` wrapper.

### 1.5 What Gets Traced

| Component | Tracing Method | What's Captured |
|-----------|---------------|----------------|
| `briefBuilder` (ChatOpenAI) | LangChain callback handler | Prompt, response, tokens, cost, latency |
| `deepResearch` (OpenAI SDK) | `observeOpenAI()` wrapper | API calls, polling attempts, tokens, cost |
| `scriptWriter` (OpenAI SDK) | `observeOpenAI()` wrapper | Script generation, moderation call, tokens, cost |
| `audioProducer` (OpenAI TTS) | `observeOpenAI()` wrapper | TTS call, tokens/chars, cost |
| `qualityGate` | No tracing needed | Pure function, no external calls |
| `adInjector` | No tracing needed | Pure function |
| `metadataWriter` | No tracing needed | Supabase writes |

---

## 2. OpenAI TTS (Voice Quality)

### 2.1 Why Switch

Google WaveNet sounds robotic and dated. OpenAI `gpt-4o-mini-tts` offers:
- Natural, expressive speech
- **Instruction-following** — can be told how to speak (tone, pacing, emphasis, podcast style)
- Nearly identical cost: ~$0.015/min vs WaveNet's $0.016/1K chars
- Same vendor as the rest of the pipeline (simplifies billing)

### 2.2 Cost Comparison

| Provider | Cost per podcast (9K chars / ~10 min) |
|----------|--------------------------------------|
| Google WaveNet | $0.14 |
| OpenAI gpt-4o-mini-tts | ~$0.15 |
| ElevenLabs | $0.72 |

**No material impact on unit economics.** Total per-podcast cost stays ~$1.89.

### 2.3 Pipeline Code Changes

**Replace TTS provider implementation:**

- `pipeline/src/podcast_pipeline/providers/ttsGoogle.ts` → **Delete** (Google WaveNet)
- `pipeline/src/podcast_pipeline/providers/ttsOpenai.ts` → **Create** (OpenAI TTS)
- `pipeline/src/podcast_pipeline/providers/ttsBase.ts` → **Keep** (interface unchanged)
- `pipeline/src/podcast_pipeline/providers/index.ts` → **Modify** (export `OpenAITTS` instead of `GoogleWaveNetTTS`)

**The `TTSProvider` interface stays the same:**
```typescript
export interface TTSProvider {
  synthesize(text: string, voiceName?: string): Promise<Buffer>;
}
```

**New `OpenAITTS` implementation:**
- Uses `openai.audio.speech.create()` with model `gpt-4o-mini-tts`
- Accepts a voice instruction prompt (e.g., "Speak like an engaging podcast host with a warm, conversational tone")
- Uses the Langfuse-observed OpenAI client for automatic cost tracking
- Default voice: `"coral"` (or another suitable OpenAI voice — to be configured)

**Modified files:**
- `pipeline/src/podcast_pipeline/nodes/audioProducer.ts` — use `OpenAITTS` instead of `GoogleWaveNetTTS`
- `pipeline/src/podcast_pipeline/config.ts` — add `TTS_VOICE_INSTRUCTIONS` prompt and `TTS_VOICE` config
- `pipeline/tests/ttsGoogle.test.ts` → **Delete** and **Create** `pipeline/tests/ttsOpenai.test.ts`
- `pipeline/tests/audioProducer.test.ts` — update mocks from Google TTS to OpenAI TTS

**Remove dependency:**
- `@google-cloud/text-to-speech` from `pipeline/package.json`

**Remove env var:**
- `GOOGLE_APPLICATION_CREDENTIALS` from `.env.example`, `pipeline/.env.example`

### 2.4 Voice Configuration

New config values in `pipeline/src/podcast_pipeline/config.ts`:

```typescript
export const TTS_VOICE = "coral"; // OpenAI voice ID
export const TTS_VOICE_INSTRUCTIONS = `Speak like an engaging podcast host.
Use a warm, conversational tone — as if explaining to a smart friend.
Vary your pacing naturally. Emphasize key points.
Pause briefly at chapter transitions.`;
```

The instruction-following capability of `gpt-4o-mini-tts` means the voice quality and style are configurable without code changes — just update the prompt.

---

## 3. What Stays the Same

- All pipeline logic, graph structure, node behavior
- `@langchain/langgraph`, `@langchain/core`, `@langchain/openai` (open source, free)
- `langsmith` npm package stays as transitive dep of `@langchain/core` — inert without API key
- `TTSProvider` interface (unchanged — audioProducer just gets a different implementation)
- No mobile app changes
- No Supabase changes
- No pricing/tier changes (cost is nearly identical)

---

## 4. Files Changed Summary

### Langfuse

| File | Action | Description |
|------|--------|-------------|
| `pipeline/src/podcast_pipeline/providers/langfuseClient.ts` | Create | Observed OpenAI client + LangChain callback handler |
| `pipeline/src/podcast_pipeline/nodes/deepResearch.ts` | Modify | Use `getObservedOpenAI()` instead of `new OpenAI()` |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | Modify | Use `getObservedOpenAI()` instead of `new OpenAI()` |
| `pipeline/src/podcast_pipeline/graph.ts` | Modify | Pass callback handler in `runPipeline()` |
| `pipeline/package.json` | Modify | Add `langfuse`, remove `@google-cloud/text-to-speech` |
| `pipeline/.env.example` | Modify | Replace `LANGSMITH_API_KEY` + `GOOGLE_APPLICATION_CREDENTIALS` with Langfuse vars |
| `.env.example` | Modify | Same env var changes |

### TTS

| File | Action | Description |
|------|--------|-------------|
| `pipeline/src/podcast_pipeline/providers/ttsOpenai.ts` | Create | OpenAI gpt-4o-mini-tts implementation |
| `pipeline/src/podcast_pipeline/providers/ttsGoogle.ts` | Delete | No longer needed |
| `pipeline/src/podcast_pipeline/providers/index.ts` | Modify | Export `OpenAITTS` instead of `GoogleWaveNetTTS` |
| `pipeline/src/podcast_pipeline/nodes/audioProducer.ts` | Modify | Use `OpenAITTS` instead of `GoogleWaveNetTTS` |
| `pipeline/src/podcast_pipeline/config.ts` | Modify | Add `TTS_VOICE`, `TTS_VOICE_INSTRUCTIONS` |
| `pipeline/tests/ttsOpenai.test.ts` | Create | Tests for OpenAI TTS provider |
| `pipeline/tests/ttsGoogle.test.ts` | Delete | No longer needed |
| `pipeline/tests/audioProducer.test.ts` | Modify | Update mocks |

---

## 5. Out of Scope

- Langfuse evaluations/scoring (can be added later)
- Railway deployment automation (manual one-time setup)
- Migrating historical LangSmith data
- ElevenLabs TTS hybrid for Pro tier (revisit later)
- Voice A/B testing (just pick a good default voice for now)
