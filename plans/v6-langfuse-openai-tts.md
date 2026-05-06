# Langfuse Migration + OpenAI TTS Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LangSmith with Langfuse for observability and Google WaveNet with OpenAI gpt-4o-mini-tts for better voice quality at similar cost.

**Architecture:** Langfuse `observeOpenAI()` wrapper auto-traces all OpenAI SDK calls (deep research, script writing, TTS). LangChain `CallbackHandler` traces the briefBuilder node. OpenAI TTS uses the same observed client for unified cost tracking. Both changes are pipeline-only -- no mobile or Supabase changes.

**Tech Stack:** Langfuse (`langfuse` + `@langfuse/langchain`), OpenAI `gpt-4o-mini-tts`, TypeScript, vitest

**Spec reference:** `docs/superpowers/specs/2026-04-09-langfuse-migration-design.md`

**Depends on:** Plans 1-5

---

## File Structure

```
pipeline/
├── package.json                                    # MODIFY: add langfuse + @langfuse/langchain, remove @google-cloud/text-to-speech
├── .env.example                                    # MODIFY: replace LANGSMITH/GOOGLE vars with LANGFUSE vars
├── src/podcast_pipeline/
│   ├── config.ts                                   # MODIFY: add TTS_VOICE, TTS_VOICE_INSTRUCTIONS
│   ├── graph.ts                                    # MODIFY: pass Langfuse callback handler to graph.invoke()
│   ├── providers/
│   │   ├── langfuseClient.ts                       # CREATE: getObservedOpenAI(), getLangfuseCallbackHandler()
│   │   ├── ttsOpenai.ts                            # CREATE: OpenAITTS class implementing TTSProvider
│   │   ├── ttsGoogle.ts                            # DELETE
│   │   ├── ttsBase.ts                              # KEEP (unchanged)
│   │   ├── index.ts                                # MODIFY: export OpenAITTS instead of GoogleWaveNetTTS
│   │   └── supabaseClient.ts                       # KEEP (unchanged)
│   └── nodes/
│       ├── deepResearch.ts                         # MODIFY: use getObservedOpenAI() instead of new OpenAI()
│       ├── scriptWriter.ts                         # MODIFY: use getObservedOpenAI() instead of new OpenAI()
│       └── audioProducer.ts                        # MODIFY: use OpenAITTS instead of GoogleWaveNetTTS
├── tests/
│   ├── ttsOpenai.test.ts                           # CREATE: tests for OpenAITTS provider
│   ├── ttsGoogle.test.ts                           # DELETE
│   └── audioProducer.test.ts                       # MODIFY: update mocks from GoogleWaveNetTTS to OpenAITTS

.env.example                                        # MODIFY: replace LANGSMITH/GOOGLE vars with LANGFUSE vars
```

---

## Chunk 1: Langfuse Client + Dependency Changes (Tasks 1-3)

### Task 1: Install Dependencies and Update Env Files

**Files:**
- Modify: `pipeline/package.json`
- Modify: `pipeline/.env.example`
- Modify: `.env.example` (root)

- [ ] **Step 1: Install langfuse packages and remove Google TTS**

Run:
```bash
cd pipeline && npm install langfuse @langfuse/langchain && npm uninstall @google-cloud/text-to-speech
```

Expected: `package.json` updated. `langfuse` and `@langfuse/langchain` in dependencies, `@google-cloud/text-to-speech` removed.

- [ ] **Step 2: Update `pipeline/.env.example`**

Replace contents with:

```env
OPENAI_API_KEY=your-openai-key
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_HOST=https://your-langfuse-instance.up.railway.app
PIPELINE_CALLBACK_SECRET=your-pipeline-callback-secret
```

Changes: Removed `GOOGLE_APPLICATION_CREDENTIALS` and `LANGSMITH_API_KEY`. Added `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`.

- [ ] **Step 3: Update root `.env.example`**

Replace the `# Google Cloud TTS` section and `# LangGraph Cloud` section:

Remove these lines:
```env
# Google Cloud TTS
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
```

```env
# LangGraph Cloud
LANGGRAPH_API_KEY=your-langgraph-key
LANGGRAPH_API_URL=your-langgraph-url
LANGSMITH_API_KEY=your-langsmith-key
```

Add this section in their place:
```env
# Langfuse (Observability)
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_HOST=https://your-langfuse-instance.up.railway.app

# LangGraph Cloud
LANGGRAPH_API_KEY=your-langgraph-key
LANGGRAPH_API_URL=your-langgraph-url
```

- [ ] **Step 4: Verify package.json is correct**

Run: `cd pipeline && cat package.json | grep -E "langfuse|google-cloud"`

Expected: `langfuse` and `@langfuse/langchain` present, `@google-cloud/text-to-speech` absent.

- [ ] **Step 5: Commit**

```bash
git add pipeline/package.json pipeline/package-lock.json pipeline/.env.example .env.example
git commit -m "chore: add langfuse deps, remove google-cloud/text-to-speech, update env examples"
```

---

### Task 2: Create Langfuse Client Provider

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/langfuseClient.ts`

**Docs to check:** The `observeOpenAI` function is imported from `"langfuse"`. The `CallbackHandler` is imported from `"@langfuse/langchain"`. Verified via Context7 Langfuse docs.

- [ ] **Step 1: Create `langfuseClient.ts`**

Create file at `pipeline/src/podcast_pipeline/providers/langfuseClient.ts`:

```typescript
/**
 * Langfuse observability provider.
 *
 * - getObservedOpenAI(): Returns a singleton OpenAI client wrapped with
 *   Langfuse's observeOpenAI() for automatic tracing and cost tracking.
 * - getLangfuseCallbackHandler(): Returns a LangChain callback handler
 *   for tracing ChatOpenAI calls (used by briefBuilder).
 */

import OpenAI from "openai";
import { observeOpenAI } from "langfuse";
import { CallbackHandler } from "@langfuse/langchain";

let observedClient: OpenAI | null = null;

/**
 * Returns a singleton OpenAI client wrapped with Langfuse tracing.
 * All API calls (chat completions, responses, moderations, audio) are
 * automatically traced with token counts and cost.
 *
 * Langfuse reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and
 * LANGFUSE_HOST from environment variables automatically.
 */
export function getObservedOpenAI(): OpenAI {
  if (observedClient) return observedClient;
  observedClient = observeOpenAI(new OpenAI());
  return observedClient;
}

/**
 * Returns a fresh LangChain callback handler for Langfuse tracing.
 * Pass this to graph.invoke() or chain.invoke() via { callbacks: [handler] }.
 *
 * Langfuse reads credentials from environment variables automatically.
 */
export function getLangfuseCallbackHandler(): CallbackHandler {
  return new CallbackHandler();
}

/**
 * Reset the singleton client. Used only in tests.
 */
export function resetObservedOpenAI(): void {
  observedClient = null;
}
```

Note: Langfuse SDK reads `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_HOST` from env automatically -- no need to pass them explicitly in constructor.

- [ ] **Step 2: Verify it compiles**

Run: `cd pipeline && npx tsc --noEmit src/podcast_pipeline/providers/langfuseClient.ts`

Expected: No errors. If there are type errors with `observeOpenAI` return type, the wrapper returns a proxied OpenAI instance that is type-compatible. If the compiler complains, cast: `observedClient = observeOpenAI(new OpenAI()) as unknown as OpenAI;`

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/langfuseClient.ts
git commit -m "feat: add Langfuse client provider with observeOpenAI wrapper"
```

---

### Task 3: Wire Observed OpenAI into deepResearch and scriptWriter

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/deepResearch.ts:6,15`
- Modify: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts:6,10`

- [ ] **Step 1: Update `deepResearch.ts` imports and client usage**

In `pipeline/src/podcast_pipeline/nodes/deepResearch.ts`:

Replace:
```typescript
import OpenAI from "openai";
```
with:
```typescript
import { getObservedOpenAI } from "../providers/langfuseClient.js";
```

Replace the module-level client:
```typescript
const openai = new OpenAI();
```
with nothing (delete the line).

Inside the `deepResearch()` function, at the top of the function body (after the existing const declarations around line 106), add:
```typescript
  const openai = getObservedOpenAI();
```

This moves the client from module scope to function scope so the singleton is initialized after env vars are loaded (important for test mocking).

- [ ] **Step 2: Update `scriptWriter.ts` imports and client usage**

In `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts`:

Replace:
```typescript
import OpenAI from "openai";
```
with:
```typescript
import { getObservedOpenAI } from "../providers/langfuseClient.js";
```

Replace the module-level client:
```typescript
const openai = new OpenAI();
```
with nothing (delete the line).

Inside the `scriptWriter()` function, at the top of the function body (after the destructuring on line 54), add:
```typescript
  const openai = getObservedOpenAI();
```

- [ ] **Step 3: Verify compilation**

Run: `cd pipeline && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Run existing tests to ensure nothing breaks**

Run: `cd pipeline && npx vitest run`

Expected: All existing tests pass. The mock for `OpenAI` in existing test files should still work because the mock intercepts at the import level -- but if tests fail, update the mocks to mock `../providers/langfuseClient.js` instead of `openai`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/deepResearch.ts pipeline/src/podcast_pipeline/nodes/scriptWriter.ts
git commit -m "refactor: use Langfuse-observed OpenAI client in deepResearch and scriptWriter"
```

---

## Chunk 2: OpenAI TTS + Graph Integration (Tasks 4-7)

### Task 4: Create OpenAI TTS Provider (TDD)

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`
- Create: `pipeline/src/podcast_pipeline/providers/ttsOpenai.ts`
- Create: `pipeline/tests/ttsOpenai.test.ts`

- [ ] **Step 1: Add TTS config constants to `config.ts`**

In `pipeline/src/podcast_pipeline/config.ts`, append at the end of the file:

```typescript

// TTS
export const TTS_VOICE = "coral";
export const TTS_VOICE_INSTRUCTIONS = `Speak like an engaging podcast host.
Use a warm, conversational tone — as if explaining to a smart friend.
Vary your pacing naturally. Emphasize key points.
Pause briefly at chapter transitions.`;
```

- [ ] **Step 2: Write the failing test**

Create `pipeline/tests/ttsOpenai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

// Mock the langfuse client before importing the module under test
vi.mock("../src/podcast_pipeline/providers/langfuseClient.js", () => {
  const mockCreate = vi.fn();
  return {
    getObservedOpenAI: vi.fn().mockReturnValue({
      audio: {
        speech: {
          create: mockCreate,
        },
      },
    }),
    __mockCreate: mockCreate,
  };
});

import { OpenAITTS } from "../src/podcast_pipeline/providers/ttsOpenai.js";
import * as langfuseClient from "../src/podcast_pipeline/providers/langfuseClient.js";

describe("OpenAITTS", () => {
  const mockCreate = (langfuseClient as any).__mockCreate;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should implement TTSProvider interface", () => {
    const provider: TTSProvider = new OpenAITTS();
    expect(provider.synthesize).toBeDefined();
  });

  it("should return audio bytes from synthesize", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]); // fake MP3 header
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    const result = await provider.synthesize("Hello, this is a test.");

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini-tts",
        voice: "coral",
        input: "Hello, this is a test.",
        response_format: "mp3",
      }),
    );
  });

  it("should use custom voice when provided", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]);
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    await provider.synthesize("Test", "alloy");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );
  });

  it("should include voice instructions in the API call", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]);
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    await provider.synthesize("Test");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("podcast host"),
      }),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd pipeline && npx vitest run tests/ttsOpenai.test.ts`

Expected: FAIL -- cannot find module `../src/podcast_pipeline/providers/ttsOpenai.js`

- [ ] **Step 4: Write the implementation**

Create `pipeline/src/podcast_pipeline/providers/ttsOpenai.ts`:

```typescript
/**
 * OpenAI gpt-4o-mini-tts provider.
 * Uses the Langfuse-observed OpenAI client for automatic cost tracking.
 */

import { getObservedOpenAI } from "./langfuseClient.js";
import type { TTSProvider } from "./ttsBase.js";
import { TTS_VOICE, TTS_VOICE_INSTRUCTIONS } from "../config.js";

export class OpenAITTS implements TTSProvider {
  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const openai = getObservedOpenAI();
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voiceName ?? TTS_VOICE,
      input: text,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd pipeline && npx vitest run tests/ttsOpenai.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/providers/ttsOpenai.ts pipeline/tests/ttsOpenai.test.ts
git commit -m "feat: add OpenAI TTS provider with gpt-4o-mini-tts and voice instructions"
```

---

### Task 5: Delete Google TTS, Update Providers Index and audioProducer

**Files:**
- Delete: `pipeline/src/podcast_pipeline/providers/ttsGoogle.ts`
- Delete: `pipeline/tests/ttsGoogle.test.ts`
- Modify: `pipeline/src/podcast_pipeline/providers/index.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/audioProducer.ts:12-13,24-26`

- [ ] **Step 1: Delete Google TTS files**

```bash
rm pipeline/src/podcast_pipeline/providers/ttsGoogle.ts
rm pipeline/tests/ttsGoogle.test.ts
```

- [ ] **Step 2: Update `providers/index.ts`**

Replace the full contents of `pipeline/src/podcast_pipeline/providers/index.ts` with:

```typescript
export type { TTSProvider } from "./ttsBase.js";
export { OpenAITTS } from "./ttsOpenai.js";
```

- [ ] **Step 3: Update `audioProducer.ts` imports and factory**

In `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`:

Replace:
```typescript
import { GoogleWaveNetTTS } from "../providers/ttsGoogle.js";
```
with:
```typescript
import { OpenAITTS } from "../providers/ttsOpenai.js";
```

Replace:
```typescript
function getTtsProvider(): TTSProvider {
  return new GoogleWaveNetTTS();
}
```
with:
```typescript
function getTtsProvider(): TTSProvider {
  return new OpenAITTS();
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd pipeline && npx tsc --noEmit`

Expected: No errors. No remaining references to `ttsGoogle` or `GoogleWaveNetTTS`.

- [ ] **Step 5: Commit**

```bash
git add -A pipeline/src/podcast_pipeline/providers/ttsGoogle.ts pipeline/tests/ttsGoogle.test.ts pipeline/src/podcast_pipeline/providers/index.ts pipeline/src/podcast_pipeline/nodes/audioProducer.ts
git commit -m "refactor: replace Google WaveNet TTS with OpenAI TTS in audioProducer"
```

---

### Task 6: Update audioProducer Test Mocks

**Files:**
- Modify: `pipeline/tests/audioProducer.test.ts`

- [ ] **Step 1: Update the mock in `audioProducer.test.ts`**

In `pipeline/tests/audioProducer.test.ts`:

Replace:
```typescript
vi.mock("../src/podcast_pipeline/providers/ttsGoogle.js", () => ({
  GoogleWaveNetTTS: vi.fn().mockImplementation(() => ({
    synthesize: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
  })),
}));
```
with:
```typescript
vi.mock("../src/podcast_pipeline/providers/ttsOpenai.js", () => ({
  OpenAITTS: vi.fn().mockImplementation(() => ({
    synthesize: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
  })),
}));
```

- [ ] **Step 2: Run the audioProducer tests**

Run: `cd pipeline && npx vitest run tests/audioProducer.test.ts`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add pipeline/tests/audioProducer.test.ts
git commit -m "test: update audioProducer mocks from GoogleWaveNetTTS to OpenAITTS"
```

---

### Task 7: Wire Langfuse Callback into Graph, Final Verification

**Files:**
- Modify: `pipeline/src/podcast_pipeline/graph.ts:59-62`

- [ ] **Step 1: Update `graph.ts` to pass Langfuse callback handler**

In `pipeline/src/podcast_pipeline/graph.ts`:

Add import at the top (after existing imports):
```typescript
import { getLangfuseCallbackHandler } from "./providers/langfuseClient.js";
```

Replace the `runPipeline` function:
```typescript
export async function runPipeline(input: Partial<PipelineStateType>): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    return await graph.invoke(state);
  } catch (error: unknown) {
```
with:
```typescript
export async function runPipeline(input: Partial<PipelineStateType>): Promise<PipelineStateType> {
  const state = makeInitialState(input);
  try {
    const callbacks = [getLangfuseCallbackHandler()];
    return await graph.invoke(state, { callbacks });
  } catch (error: unknown) {
```

Only the two lines inside the `try` block change. The rest of the function (error handling) stays the same.

- [ ] **Step 2: Verify compilation**

Run: `cd pipeline && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `cd pipeline && npx vitest run`

Expected: ALL tests pass. No remaining references to Google TTS or LangSmith.

- [ ] **Step 4: Verify no stale references remain**

Run: `cd pipeline && grep -r "GoogleWaveNetTTS\|ttsGoogle\|@google-cloud/text-to-speech\|LANGSMITH_API_KEY\|GOOGLE_APPLICATION_CREDENTIALS" src/ tests/ .env.example`

Expected: No output (no matches).

Also check root:
Run: `grep -r "LANGSMITH_API_KEY\|GOOGLE_APPLICATION_CREDENTIALS" .env.example`

Expected: No output.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/graph.ts
git commit -m "feat: pass Langfuse callback handler to LangGraph pipeline"
```

---

## Post-Implementation Checklist

- [ ] `cd pipeline && npx vitest run` -- all tests pass
- [ ] `cd pipeline && npx tsc --noEmit` -- no type errors
- [ ] No references to `GoogleWaveNetTTS`, `ttsGoogle`, `@google-cloud/text-to-speech`, `LANGSMITH_API_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` in pipeline source, tests, or env examples
- [ ] `langfuse` and `@langfuse/langchain` are in `pipeline/package.json` dependencies
- [ ] `@google-cloud/text-to-speech` is NOT in `pipeline/package.json`
- [ ] `.env.example` (both root and pipeline) have `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
- [ ] Deploy Langfuse on Railway (manual, out of scope for this plan -- see spec section 1.1)
