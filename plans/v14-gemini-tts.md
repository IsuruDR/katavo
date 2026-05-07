# Gemini TTS + Audio Tag Injection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenAI `gpt-4o-mini-tts` with Gemini 2.5 Flash TTS. Insert a new `tagInjector` node between `scriptWriter` and `audioProducer` that uses Gemini text to embed inline `[laughs]`/`[whispers]`/etc. audio tags into the script. Migrate the 4-voice picker from OpenAI voices (coral/sage/ash/ballad) to Gemini voices (Sulafat/Charon/Sadaltager/Achird). Hard cutover, no flag — greenfield, zero users.

**Architecture:**
- New node `tagInjector` at `nodes/tagInjector.ts`. Uses Gemini text model. Threads through `RunnableConfig` for Langfuse traces (free via v11). Falls through to `state.script` on any failure (SDK error, empty output, chapter-marker count mismatch).
- New TTS provider at `providers/ttsGemini.ts` implementing existing `TTSProvider` interface. Returns mp3 `Buffer` like the OpenAI impl did. Internally: call Gemini TTS → base64-decode → write tmp PCM → ffmpeg encode → read mp3.
- Existing `audioProducer.ts` keeps its ad-stitching path untouched; only the `getTtsProvider()` factory swaps from `OpenAITTS` to `GeminiTTS`.
- Existing `splitScriptSegments` keeps stripping `[CHAPTER:]` markers; new `[tag]` markers pass through to TTS verbatim.
- New tag set is configurable via `AUDIO_TAGS` env var (10 curated defaults).
- DB migration `00016` clears `preferred_voice` and `podcasts.voice`, sets `Sulafat` default, adds check constraint.
- Mobile asset filenames lowercased to match existing convention; `state.voice` capitalization preserved.

**Tech Stack:** TypeScript, vitest, `@google/genai`, ffmpeg (already a dep), LangChain v1, langgraph 1.x, Langfuse via langfuse-langchain.

**Spec:** `docs/superpowers/specs/2026-05-07-gemini-tts-design.md`

## Test mocking convention (read first)

Same as v11: any mock function declared at module scope and referenced inside `vi.mock(...)` MUST use `vi.hoisted(() => vi.fn())`. Don't use `const mockX = vi.fn()` at module scope and reference it inside `vi.mock(...)` — vitest hoists `vi.mock` above declarations and you'll get `ReferenceError`. Reference pattern: `pipeline/tests/deepResearch.test.ts:3-13`.

---

## Chunk 1: Foundation — deps, env, config, Gemini client

### Task 1: Install @google/genai

**Files:**
- Modify: `pipeline/package.json`

- [ ] **Step 1: Install**

```bash
cd "pipeline" && npm install @google/genai
```

Expected: package added, no peer-dep errors.

- [ ] **Step 2: Verify import works**

```bash
cd pipeline && node -e "import('@google/genai').then(m => console.log('exports:', Object.keys(m).slice(0,5)))"
```

Expected: prints array including `GoogleGenAI` (or similar entry export).

- [ ] **Step 3: Commit**

```bash
git add pipeline/package.json pipeline/package-lock.json
git commit -m "deps: add @google/genai for Gemini TTS + tag injection"
```

---

### Task 2: Env vars

**Files:**
- Modify: `pipeline/.env.example`

- [ ] **Step 1: Append new keys**

Append to `pipeline/.env.example`:

```
# Gemini TTS (v14+)
GEMINI_API_KEY=
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TAG_INJECTOR_MODEL=gemini-2.5-flash
AUDIO_TAGS=laughs,whispers,sighs,chuckles,curious,thoughtful,serious,surprised,exhales,pauses
```

- [ ] **Step 2: Commit**

```bash
git add pipeline/.env.example
git commit -m "env: document Gemini TTS env vars in .env.example"
```

- [ ] **Step 3: USER ACTION (defer to deploy task)**

Add `GEMINI_API_KEY` to local `pipeline/.env` and Railway. Defer until Task 18.

---

### Task 3: Add config constants + remove o4-mini OpenAI TTS constants

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Add new constants**

Append to `config.ts`:

```typescript
// Gemini TTS (v14+) — replaces OpenAI gpt-4o-mini-tts
export const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
export const GEMINI_TAG_INJECTOR_MODEL =
  process.env.GEMINI_TAG_INJECTOR_MODEL ?? "gemini-2.5-flash";

export const GEMINI_VOICES = ["Sulafat", "Charon", "Sadaltager", "Achird"] as const;
export type GeminiVoice = typeof GEMINI_VOICES[number];
export const DEFAULT_GEMINI_VOICE: GeminiVoice = "Sulafat";

export const AUDIO_TAGS_DEFAULT = [
  "laughs", "whispers", "sighs", "chuckles", "curious",
  "thoughtful", "serious", "surprised", "exhales", "pauses",
] as const;

const _audioTagsEnv = process.env.AUDIO_TAGS?.split(",").map((s) => s.trim()).filter(Boolean);
export const AUDIO_TAGS: readonly string[] =
  _audioTagsEnv && _audioTagsEnv.length > 0 ? _audioTagsEnv : [...AUDIO_TAGS_DEFAULT];
```

- [ ] **Step 2: Remove old OpenAI TTS constants**

In the same file, delete:
- `TTS_VOICE` constant
- `TTS_VOICE_INSTRUCTIONS` constant

- [ ] **Step 3: Verify nothing imports the removed symbols (other than what we're about to delete/rewrite)**

```bash
cd pipeline && grep -rn "TTS_VOICE\|TTS_VOICE_INSTRUCTIONS" src/ tests/ scripts/ 2>/dev/null
```

Expected references — all of these get fixed/deleted in later tasks:
- `nodes/audioProducer.ts` (Task 8 rewrites)
- `providers/ttsOpenai.ts` (Task 10 deletes)
- `scripts/build-voice-samples.ts` (Task 12 rewrites)
- `scripts/test-voices.ts` (Task 10 deletes — one-off A/B utility, no longer relevant)

- [ ] **Step 4: Skip full tsc check until Task 10**

Until `ttsOpenai.ts`, `test-voices.ts` and `build-voice-samples.ts` are addressed, tsc will report errors in those files. To verify your changes compile cleanly in scope, scope tsc to the files we've touched:

```bash
cd pipeline && npx tsc --noEmit src/podcast_pipeline/config.ts
```

Expected: clean. Full-suite tsc check waits until Task 10.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts
git commit -m "config: add Gemini TTS constants; drop TTS_VOICE/TTS_VOICE_INSTRUCTIONS"
```

---

### Task 4: Gemini client provider factory (TDD)

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/gemini.ts`
- Test: `pipeline/tests/gemini.test.ts`

- [ ] **Step 1: Write failing test**

Create `pipeline/tests/gemini.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation((cfg: any) => ({ _cfg: cfg })),
);

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  mockGoogleGenAI.mockClear();
});

describe("getGeminiClient", () => {
  it("returns a GoogleGenAI configured with the env apiKey", async () => {
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    const client = getGeminiClient() as any;
    expect(client._cfg.apiKey).toBe("test-key");
  });

  it("caches the client instance across calls", async () => {
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    const a = getGeminiClient();
    const b = getGeminiClient();
    expect(a).toBe(b);
  });

  it("throws when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    expect(() => getGeminiClient()).toThrow(/GEMINI_API_KEY/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/gemini.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `gemini.ts`**

```typescript
import { GoogleGenAI } from "@google/genai";

let cached: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (cached) return cached;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  cached = new GoogleGenAI({ apiKey });
  return cached;
}

/** For tests only — clears the singleton. */
export function resetGeminiClient(): void {
  cached = null;
}
```

- [ ] **Step 4: Update test to clear the singleton between cases**

Add `resetGeminiClient()` call to `beforeEach`. Update import.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation((cfg: any) => ({ _cfg: cfg })),
);

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  mockGoogleGenAI.mockClear();
  const { resetGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
  resetGeminiClient();
});
```

- [ ] **Step 5: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/gemini.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/gemini.ts pipeline/tests/gemini.test.ts
git commit -m "feat: add Gemini client singleton factory"
```

---

### Task 4b: Empty-AUDIO_TAGS guard test

**Files:**
- Create: `pipeline/tests/audioTags.test.ts`

The spec requires `AUDIO_TAGS` to fall back to defaults if the env var is set but empty/comma-only. This test guards against a future regression where someone removes the `length > 0` check.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("AUDIO_TAGS env-var guard", () => {
  beforeEach(() => {
    // Clear module cache so config.ts re-evaluates env on each import
    vi.resetModules();
  });

  it("falls back to defaults when env var is unset", async () => {
    delete process.env.AUDIO_TAGS;
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("falls back to defaults when env var is empty string", async () => {
    process.env.AUDIO_TAGS = "";
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("falls back to defaults when env var is just commas", async () => {
    process.env.AUDIO_TAGS = ",,,";
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("uses env var when populated", async () => {
    process.env.AUDIO_TAGS = "laughs,whispers";
    const { AUDIO_TAGS } = await import("../src/podcast_pipeline/config.js");
    expect(AUDIO_TAGS).toEqual(["laughs", "whispers"]);
  });
});
```

Add `import { vi } from "vitest";` at the top.

- [ ] **Step 2: Run test (should fail because Task 3 didn't have the guard yet — wait, it does, so should pass)**

```bash
cd pipeline && npx vitest run tests/audioTags.test.ts
```

Expected: 4 passed (Task 3 already added the guard).

- [ ] **Step 3: Commit**

```bash
git add pipeline/tests/audioTags.test.ts
git commit -m "test: AUDIO_TAGS env-var guard (defaults on empty/missing)"
```

---

## Chunk 2: tagInjector node

### Task 5: Add `taggedScript` field to PipelineState

**Files:**
- Modify: `pipeline/src/podcast_pipeline/state.ts`

We add the state field FIRST so Task 6's tagInjector implementation compiles cleanly when it references `taggedScript` in its `Partial<PipelineStateType>` return.

- [ ] **Step 1: Add field to annotation map**

In `state.ts` after `script: Annotation<string>,` insert:

```typescript
  taggedScript: Annotation<string>,
```

In `makeInitialState` defaults add `taggedScript: ""`.

- [ ] **Step 2: Verify state.test.ts still passes**

```bash
cd pipeline && npx vitest run tests/state.test.ts
```

If the test enumerates fields, it may need updating to expect `taggedScript`.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/state.ts pipeline/tests/state.test.ts
git commit -m "state: add taggedScript field for v14 tagInjector"
```

---

### Task 6: tagInjector node (TDD)

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/tagInjector.ts`
- Test: `pipeline/tests/tagInjector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
);

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  mockGenerateContent.mockReset();
  const { resetGeminiClient } = await import(
    "../src/podcast_pipeline/providers/gemini.js"
  );
  resetGeminiClient();
});

const SCRIPT_WITH_2_CHAPTERS = `[CHAPTER: Origins]
Bezzera filed his patent in 1901. The first commercial machine shipped that year.

[CHAPTER: Modern era]
The Faema E61 in 1961 changed everything.`;

describe("tagInjector", () => {
  it("returns tagged script preserving CHAPTER markers", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: `[CHAPTER: Origins]
[curious] Bezzera filed his patent in 1901. The first commercial machine shipped that year.

[CHAPTER: Modern era]
[thoughtful] The Faema E61 in 1961 changed everything.`,
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toContain("[curious]");
    expect(result.taggedScript).toContain("[thoughtful]");
    expect((result.taggedScript!.match(/\[CHAPTER:/g) ?? []).length).toBe(2);
  });

  it("falls through to original script on Gemini error AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockRejectedValueOnce(new Error("API failure"));
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/SDK error/), expect.anything());
    warnSpy.mockRestore();
  });

  it("falls through when output is empty AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockResolvedValueOnce({ text: "   " });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/empty model output/));
    warnSpy.mockRestore();
  });

  it("falls through when chapter-marker count differs AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockResolvedValueOnce({
      text: `[CHAPTER: Origins]
[curious] Bezzera filed his patent in 1901.`,  // dropped second chapter
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/chapter-marker count mismatch/));
    warnSpy.mockRestore();
  });

  it("includes AUDIO_TAGS values in the prompt", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: SCRIPT_WITH_2_CHAPTERS,
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    const callArg = mockGenerateContent.mock.calls[0][0];
    const prompt = String(callArg.contents);
    expect(prompt).toContain("[laughs]");
    expect(prompt).toContain("[chuckles]");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/tagInjector.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `tagInjector.ts`**

```typescript
import type { RunnableConfig } from "@langchain/core/runnables";
import { getGeminiClient } from "../providers/gemini.js";
import { AUDIO_TAGS, GEMINI_TAG_INJECTOR_MODEL } from "../config.js";
import type { PipelineStateType } from "../state.js";

const TAG_INJECTOR_PROMPT = (script: string, tags: readonly string[]) => `
You are inserting audio tags into a podcast script that will be read aloud
by an expressive TTS model.

Available tags: ${tags.map((t) => `[${t}]`).join(", ")}

Rules:
- Insert tags immediately before the phrase or sentence they should
  influence (e.g., "[chuckles] You'd think they'd have figured it out
  by then.").
- Match the emotional arc — don't overuse tags. Aim for one tag per
  3-5 sentences, more sparse in factual sections, denser in
  conversational asides and chapter transitions.
- Do NOT modify the script's text — only insert bracketed tags.
- Preserve all [CHAPTER: ...] markers verbatim.
- Preserve any [AD:PRE_ROLL] / [AD:MID_ROLL] markers verbatim.

Script:
${script}
`;

function countChapterMarkers(s: string): number {
  return (s.match(/\[CHAPTER:/g) ?? []).length;
}

export async function tagInjector(
  state: PipelineStateType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config?: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const script = state.script;
  if (!script) {
    console.warn("[tagInjector] no script in state — skipping");
    return { taggedScript: "" };
  }

  const client = getGeminiClient();

  try {
    const response = await client.models.generateContent({
      model: GEMINI_TAG_INJECTOR_MODEL,
      contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS),
    });

    const out = (response as { text?: string }).text?.trim() ?? "";

    if (!out) {
      console.warn("[tagInjector] fallthrough: empty model output");
      return { taggedScript: script };
    }

    if (countChapterMarkers(out) !== countChapterMarkers(script)) {
      console.warn("[tagInjector] fallthrough: chapter-marker count mismatch");
      return { taggedScript: script };
    }

    return { taggedScript: out };
  } catch (err) {
    console.warn("[tagInjector] fallthrough: SDK error", { error: err });
    return { taggedScript: script };
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/tagInjector.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/tagInjector.ts pipeline/tests/tagInjector.test.ts
git commit -m "feat: add tagInjector node with graceful fallthrough"
```

---

## Chunk 3: ttsGemini provider + audioProducer Gemini path

### Task 7: ttsGemini provider (TDD)

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/ttsGemini.ts`
- Test: `pipeline/tests/ttsGemini.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
);
const mockExecSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn(() => "/tmp/tts-test"));
const mockRmSync = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));
vi.mock("node:child_process", () => ({ execSync: mockExecSync }));
vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  mkdtempSync: mockMkdtempSync,
  rmSync: mockRmSync,
}));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  vi.clearAllMocks();
  const { resetGeminiClient } = await import(
    "../src/podcast_pipeline/providers/gemini.js"
  );
  resetGeminiClient();
});

describe("GeminiTTS.synthesize", () => {
  it("calls Gemini with correct voice + decodes base64 + invokes ffmpeg", async () => {
    const fakeBase64 = Buffer.from([0x01, 0x02, 0x03]).toString("base64");
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        { content: { parts: [{ inlineData: { data: fakeBase64 } }] } },
      ],
    });
    mockReadFileSync.mockReturnValueOnce(Buffer.from([0xff, 0xfb])); // fake mp3 header

    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    const buf = await tts.synthesize("hello world", "Charon");

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      "Charon",
    );
    expect(callArg.config.responseModalities).toEqual(["AUDIO"]);
    expect(buf).toBeInstanceOf(Buffer);
    // ffmpeg call shape — must include 24000 sample rate + s16le PCM input
    const ffArg = mockExecSync.mock.calls[0][0] as string;
    expect(ffArg).toContain("-f s16le");
    expect(ffArg).toContain("-ar 24000");
    expect(ffArg).toContain("libmp3lame");
  });

  it("falls back to default voice when voiceName is undefined or invalid", async () => {
    const fakeBase64 = Buffer.from([0x01]).toString("base64");
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { data: fakeBase64 } }] } }],
    });
    mockReadFileSync.mockReturnValueOnce(Buffer.from([0xff]));

    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    await tts.synthesize("hi", "ballad"); // legacy OpenAI voice — should fall back
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      "Sulafat",
    );
  });

  it("throws if Gemini returns no audio", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: "oops" }] } }],
    });
    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    await expect(tts.synthesize("hi", "Sulafat")).rejects.toThrow(/no audio/i);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/ttsGemini.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `ttsGemini.ts`**

```typescript
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getGeminiClient } from "./gemini.js";
import {
  GEMINI_TTS_MODEL,
  GEMINI_VOICES,
  DEFAULT_GEMINI_VOICE,
} from "../config.js";
import type { TTSProvider } from "./ttsBase.js";

const VOICE_SET = new Set<string>(GEMINI_VOICES);

function resolveVoice(input?: string): string {
  if (input && VOICE_SET.has(input)) return input;
  if (input) console.warn(`[GeminiTTS] unknown voice "${input}" — falling back to ${DEFAULT_GEMINI_VOICE}`);
  return DEFAULT_GEMINI_VOICE;
}

export class GeminiTTS implements TTSProvider {
  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const client = getGeminiClient();
    const voice = resolveVoice(voiceName);

    const response = await client.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: text,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    } as any);

    const inlineData =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((response as any).candidates?.[0]?.content?.parts ?? []).find(
        (p: any) => p.inlineData?.data,
      )?.inlineData;

    if (!inlineData?.data) {
      throw new Error("GeminiTTS: response contained no audio inlineData");
    }

    const pcmBytes = Buffer.from(inlineData.data, "base64");

    const dir = mkdtempSync(join(tmpdir(), "gemini-tts-"));
    try {
      const pcmPath = join(dir, "audio.pcm");
      const mp3Path = join(dir, "audio.mp3");
      writeFileSync(pcmPath, pcmBytes);
      execSync(
        `ffmpeg -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}" -y`,
        { stdio: "pipe" },
      );
      return Buffer.from(readFileSync(mp3Path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/ttsGemini.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/ttsGemini.ts pipeline/tests/ttsGemini.test.ts
git commit -m "feat: add GeminiTTS provider (PCM → mp3 via ffmpeg)"
```

---

### Task 8: Swap audioProducer to use GeminiTTS + consume taggedScript

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`
- Modify: `pipeline/tests/audioProducer.test.ts` (if it imports OpenAITTS)

- [ ] **Step 1: Read existing test**

```bash
cd pipeline && cat tests/audioProducer.test.ts | head -40
```

Note any references to `OpenAITTS` or `ttsOpenai` — they need updating.

- [ ] **Step 2: Edit `audioProducer.ts`**

Two changes:

a) Replace import + factory:
```typescript
// Replace:
import { OpenAITTS } from "../providers/ttsOpenai.js";
// ...
function getTtsProvider(): TTSProvider {
  return new OpenAITTS();
}

// With:
import { GeminiTTS } from "../providers/ttsGemini.js";
// ...
function getTtsProvider(): TTSProvider {
  return new GeminiTTS();
}
```

b) Consume `taggedScript` instead of `script`:
```typescript
// Replace:
const { script, podcastId, userId } = state;
// ...
const segments = splitScriptSegments(script);

// With:
const { taggedScript, script, podcastId, userId } = state;
const sourceScript = taggedScript || script;  // fallthrough if tagInjector failed silently
const segments = splitScriptSegments(sourceScript);
```

- [ ] **Step 3: Update test if needed**

If `tests/audioProducer.test.ts` mocks `OpenAITTS`, swap to mock `GeminiTTS` instead. Adjust assertions for the new fallback (`taggedScript || script`).

- [ ] **Step 4: Run audioProducer tests**

```bash
cd pipeline && npx vitest run tests/audioProducer.test.ts
```

Expected: green. Fix mock paths/imports if not.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/audioProducer.ts pipeline/tests/audioProducer.test.ts
git commit -m "feat: audioProducer uses GeminiTTS and consumes taggedScript"
```

---

## Chunk 4: Graph wire-up + cleanup

### Task 9: Wire tagInjector into graph

**Files:**
- Modify: `pipeline/src/podcast_pipeline/graph.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/index.ts`
- Modify: `pipeline/tests/graph.test.ts` (if applicable)

- [ ] **Step 1: Update barrel export**

In `nodes/index.ts` add:
```typescript
export { tagInjector } from "./tagInjector.js";
```

- [ ] **Step 2: Update `graph.ts`**

Add import:
```typescript
import { tagInjector } from "./nodes/tagInjector.js";
```

In the workflow builder, insert `tagInjector` between `adInjector`/`scriptWriter` and `audioProducer`:

```typescript
  // ...
  .addNode("scriptWriter", scriptWriter)
  .addNode("adInjector", adInjector)
  .addNode("tagInjector", tagInjector)
  .addNode("audioProducer", audioProducer)
  .addNode("metadataWriter", metadataWriter)
  // ...
  .addConditionalEdges("scriptWriter", routeAfterScript)  // routes to adInjector | tagInjector
  .addEdge("adInjector", "tagInjector")
  .addEdge("tagInjector", "audioProducer")
```

And update `routeAfterScript`:

```typescript
export function routeAfterScript(state: PipelineStateType): string {
  if (state.status === "failed") {
    return END;
  }
  if (state.hasAds) {
    return "adInjector";
  }
  return "tagInjector";  // was "audioProducer"
}
```

- [ ] **Step 3: Update graph test**

`tests/graph.test.ts` checks `routeAfterScript` returns `"audioProducer"` for non-ad case. Update to `"tagInjector"`.

- [ ] **Step 4: Run all tests**

```bash
cd pipeline && npx vitest run --exclude tests/integration/** 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/graph.ts pipeline/src/podcast_pipeline/nodes/index.ts pipeline/tests/graph.test.ts
git commit -m "feat: wire tagInjector node between scriptWriter/adInjector and audioProducer"
```

---

### Task 10: Delete OpenAI TTS provider files + obsolete test-voices script

**Files:**
- Delete: `pipeline/src/podcast_pipeline/providers/ttsOpenai.ts`
- Delete: `pipeline/tests/ttsOpenai.test.ts`
- Delete: `pipeline/scripts/test-voices.ts` (one-off OpenAI A/B utility, no longer relevant — spec opted out of A/B testing)

- [ ] **Step 1: Delete files**

```bash
git rm pipeline/src/podcast_pipeline/providers/ttsOpenai.ts pipeline/tests/ttsOpenai.test.ts pipeline/scripts/test-voices.ts
```

- [ ] **Step 2: Verify no remaining imports**

```bash
cd pipeline && grep -rn "ttsOpenai\|OpenAITTS\|TTS_VOICE_INSTRUCTIONS" src/ tests/ scripts/ 2>/dev/null
```

Expected: only `scripts/build-voice-samples.ts` references `TTS_VOICE_INSTRUCTIONS` (gets rewritten in Task 12).

- [ ] **Step 3: Skip-scope tsc + run unit tests**

```bash
cd pipeline && npx vitest run --exclude tests/integration/**
```

Expected: tests green. Full tsc still pending (`build-voice-samples.ts` rewrite in Task 12 is the last remaining broken file).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove OpenAI TTS provider + test-voices script (replaced by Gemini)"
```

---

### Task 11: Add migration 00016

**Files:**
- Create: `supabase/migrations/00016_gemini_voice_migration.sql`

- [ ] **Step 1: Create migration**

```sql
-- 00016_gemini_voice_migration.sql
-- Switch from OpenAI voices to Gemini voices. Greenfield project (zero users)
-- so we clear all existing voice preferences and force re-onboarding.

UPDATE public.profiles SET preferred_voice = NULL WHERE preferred_voice IS NOT NULL;
UPDATE public.podcasts SET voice = NULL WHERE voice IS NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN preferred_voice SET DEFAULT 'Sulafat';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_voice_check
  CHECK (preferred_voice IS NULL OR preferred_voice IN ('Sulafat', 'Charon', 'Sadaltager', 'Achird'));

COMMENT ON COLUMN public.profiles.preferred_voice IS
  'Gemini TTS voice name (Sulafat|Charon|Sadaltager|Achird). Default: Sulafat. Reset by v14 Gemini TTS migration on 2026-05-07.';

COMMENT ON COLUMN public.podcasts.voice IS
  'Gemini voice this podcast was rendered with. Snapshot from profiles.preferred_voice at submit-podcast time. NULL on legacy rows = pipeline default (Sulafat).';
```

- [ ] **Step 2: Apply locally (optional)**

If you have local Supabase running:
```bash
cd supabase && supabase db push
```

Otherwise queue for production via Supabase MCP at deploy time.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00016_gemini_voice_migration.sql
git commit -m "migration: 00016 — clear preferred_voice, set Sulafat default + check constraint"
```

---

## Chunk 5: Mobile + voice samples

### Task 12: Rewrite build-voice-samples.ts for Gemini

**Files:**
- Modify: `pipeline/scripts/build-voice-samples.ts`

- [ ] **Step 1: Rewrite the script**

Replace the entire file:

```typescript
/**
 * Build script: renders the 4 self-introducing voice samples used by
 * the mobile onboarding voice picker. Run on demand when:
 *   - The sample copy below changes
 *   - We add or remove a voice
 *
 * Output: mobile/assets/voice-samples/{voice}.mp3 (lowercase, committed)
 *
 * Run: cd pipeline && npx tsx scripts/build-voice-samples.ts
 *
 * Env: GEMINI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiTTS } from "../src/podcast_pipeline/providers/ttsGemini.js";

const SAMPLES = [
  {
    voice: "Sulafat",
    script:
      "[chuckles] Hey, I'm Sulafat. I'll narrate your podcast like a friend who happened to know a lot about whatever you're curious about.",
  },
  {
    voice: "Charon",
    script:
      "I'm Charon. I'll bring substance to the topic — clear, informed, and to the point. [pauses] No fluff.",
  },
  {
    voice: "Sadaltager",
    script:
      "[thoughtful] I'm Sadaltager. Think of me as the person at dinner who actually knows the history behind whatever you brought up.",
  },
  {
    voice: "Achird",
    script:
      "I'm Achird. [chuckles] I'll keep it casual and conversational, like we're catching up over coffee.",
  },
] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, "../../mobile/assets/voice-samples");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tts = new GeminiTTS();

  for (const { voice, script } of SAMPLES) {
    console.log(`Rendering ${voice}...`);
    const buf = await tts.synthesize(script, voice);
    const path = join(OUT_DIR, `${voice.toLowerCase()}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. 4 mp3s written to mobile/assets/voice-samples/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Full tsc check (all broken files now fixed)**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean. This is the first time the full suite compiles cleanly since Task 3.

- [ ] **Step 3: Full test suite**

```bash
cd pipeline && npx vitest run --exclude tests/integration/**
```

Expected: all tests green.

- [ ] **Step 4: Commit (don't run script yet — needs API key)**

```bash
git add pipeline/scripts/build-voice-samples.ts
git commit -m "feat: rewrite build-voice-samples for Gemini TTS"
```

---

### Task 13: Generate the 4 sample mp3s + delete old ones

**Files:**
- Delete: `mobile/assets/voice-samples/coral.mp3`, `sage.mp3`, `ash.mp3`, `ballad.mp3`
- Create: `mobile/assets/voice-samples/sulafat.mp3`, `charon.mp3`, `sadaltager.mp3`, `achird.mp3`

- [ ] **Step 1: USER ACTION — make sure GEMINI_API_KEY is in `pipeline/.env`**

If not yet, add it. (Same key we'll set on Railway in Task 18.)

- [ ] **Step 2: Run the build script**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsx scripts/build-voice-samples.ts
```

Expected: 4 mp3s written. Listen to each briefly to confirm they sound right.

- [ ] **Step 3: Delete old OpenAI samples**

```bash
git rm mobile/assets/voice-samples/coral.mp3 mobile/assets/voice-samples/sage.mp3 mobile/assets/voice-samples/ash.mp3 mobile/assets/voice-samples/ballad.mp3
```

- [ ] **Step 4: Commit**

```bash
git add mobile/assets/voice-samples/sulafat.mp3 mobile/assets/voice-samples/charon.mp3 mobile/assets/voice-samples/sadaltager.mp3 mobile/assets/voice-samples/achird.mp3
git commit -m "assets: regenerate voice samples for Gemini voices (Sulafat/Charon/Sadaltager/Achird)"
```

---

### Task 14: Update mobile voiceSamples.ts + VoicePicker

**Files:**
- Modify: `mobile/src/lib/voiceSamples.ts`
- Possibly modify: `mobile/src/components/VoicePicker.tsx` (only if it hardcodes voice IDs)

- [ ] **Step 1: Rewrite `voiceSamples.ts`**

```typescript
/**
 * Voice picker metadata + bundled sample audio.
 * Samples are pre-rendered by pipeline/scripts/build-voice-samples.ts.
 * Re-run that script when this metadata or the script copy changes.
 */

export interface VoiceMeta {
  id: string;        // Gemini voice name, capitalized (matches state.voice)
  name: string;      // Display name in UI
  descriptor: string;
  sample: number;    // require() module ID
}

export const VOICES: readonly VoiceMeta[] = [
  {
    id: "Sulafat",
    name: "Sulafat",
    descriptor: "Warm, conversational. Like a friend who knows their stuff.",
    sample: require("../../assets/voice-samples/sulafat.mp3"),
  },
  {
    id: "Charon",
    name: "Charon",
    descriptor: "Substance-forward, clear, informed. No fluff.",
    sample: require("../../assets/voice-samples/charon.mp3"),
  },
  {
    id: "Sadaltager",
    name: "Sadaltager",
    descriptor: "Thoughtful, knowledgeable. The dinner-party historian.",
    sample: require("../../assets/voice-samples/sadaltager.mp3"),
  },
  {
    id: "Achird",
    name: "Achird",
    descriptor: "Casual, friendly. Coffee-shop conversation tempo.",
    sample: require("../../assets/voice-samples/achird.mp3"),
  },
];
```

- [ ] **Step 2: Check VoicePicker for hardcoded IDs**

```bash
grep -n "coral\|sage\|ash\|ballad" mobile/src/components/VoicePicker.tsx
```

If matches found, update those to Gemini voice IDs. If empty, no change needed.

- [ ] **Step 3: Verify TypeScript on mobile**

```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean. If errors about `preferred_voice` literal type, proceed to Task 15.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/voiceSamples.ts mobile/src/components/VoicePicker.tsx
git commit -m "feat(mobile): swap voice picker to Gemini voices"
```

---

### Task 15: Update mobile database types

**Files:**
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Find `preferred_voice` declarations**

```bash
grep -n "preferred_voice" mobile/src/types/database.ts
```

- [ ] **Step 2: Update literal type**

If type is something like `preferred_voice: "coral" | "sage" | "ash" | "ballad" | null`, change to:

```typescript
preferred_voice: "Sulafat" | "Charon" | "Sadaltager" | "Achird" | null
```

If type is just `string | null`, leave as-is (DB constraint handles the allowlist).

- [ ] **Step 3: Verify TypeScript**

```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean. Fix any cascade errors in account screens or hooks (`useProfile.tsx`).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/types/database.ts
git commit -m "types(mobile): update preferred_voice literal to Gemini voices"
```

---

## Chunk 6: Migration + Deploy + Smoke

### Task 16: Apply migration to production Supabase

**Files:** none

- [ ] **Step 1: USER ACTION OR via Supabase MCP**

Apply `00016_gemini_voice_migration.sql` to the production Supabase project (`rkupotxkyeficaanxzrp`). Either:

a) Via Supabase MCP — `mcp__supabase__apply_migration` if linked, or
b) Manually — copy the SQL, paste into Supabase dashboard SQL editor, run.

- [ ] **Step 2: Verify**

Check that `profiles.preferred_voice` default is now `'Sulafat'`:

```sql
SELECT column_default, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='preferred_voice';
```

Expected: `column_default = 'Sulafat'`.

---

### Task 17: Set Railway env vars

**Files:** none

- [ ] **Step 1: Set GEMINI_API_KEY + AUDIO_TAGS on Railway**

Use the Railway MCP `set-variables` if available. Otherwise CLI or dashboard:

```bash
railway variables set GEMINI_API_KEY="..."
# AUDIO_TAGS optional — defaults in code work; only set if you want to override
```

- [ ] **Step 2: Verify**

```bash
railway variables | grep -E "GEMINI|AUDIO_TAGS"
```

Expected: `GEMINI_API_KEY` is set.

---

### Task 18: Deploy

**Files:** none

- [ ] **Step 1: Deploy from `pipeline/` directory** (per the v11 lesson — Railway needs to start at the Dockerfile root)

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && railway up --ci
```

Watch for `Deploy complete`.

- [ ] **Step 2: Health check**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://podcasts-production-3b07.up.railway.app/health"
```

Expected: `HTTP 200`.

---

### Task 19: Live smoke test

**Files:** none

- [ ] **Step 1: Submit a real podcast through the app**

Open the mobile app, complete onboarding (pick any of the 4 Gemini voices), submit a podcast on any topic.

- [ ] **Step 2: Watch Railway logs**

Via Railway MCP `get-logs` or dashboard. Look for:
- Node sequence: `briefBuilder → deepResearchAgent → qualityGate → scriptWriter → (adInjector?) → tagInjector → audioProducer → metadataWriter`
- No `[tagInjector] fallthrough` warnings (or if they appear, the podcast still completes — fallthrough is graceful)

- [ ] **Step 3: Listen to the podcast**

When the podcast lands at status=`complete`, listen end-to-end. Verify:
- Voice matches the picked Gemini voice
- Inline tags audibly affect delivery (chuckles, pauses, etc.)
- Chapter transitions feel natural
- No truncation or weird artifacts

- [ ] **Step 4: Verify Langfuse trace**

Open Langfuse cloud, find the run. Should see spans for:
- briefBuilder, scriptWriter, adInjector?, **tagInjector** (NEW), audioProducer
- Each Gemini call (text + TTS) traced as nested LLM calls

- [ ] **Step 5: If everything looks good — done!** 

If quality issues, file follow-ups (e.g., expand `AUDIO_TAGS`, swap to `gemini-3.1-flash-tts-preview` via env var).

---

## Acceptance criteria

- [ ] All unit tests pass: `cd pipeline && npx vitest run`
- [ ] TypeScript clean: `cd pipeline && npx tsc --noEmit` and `cd mobile && npx tsc --noEmit`
- [ ] No references to `TTS_VOICE`, `TTS_VOICE_INSTRUCTIONS`, `OpenAITTS`, `ttsOpenai` remain in pipeline source/tests/scripts
- [ ] Migration 00016 applied; `profiles.preferred_voice` default = `Sulafat`, check constraint enforced
- [ ] 4 new voice sample mp3s in `mobile/assets/voice-samples/` (lowercase filenames)
- [ ] Old voice sample mp3s (`coral.mp3` etc.) deleted
- [ ] One full pipeline run on Railway succeeds end-to-end with audible inline tags
- [ ] Langfuse trace shows the new `tagInjector` span

---

## Out of scope (per spec)

- Multi-speaker podcasts (Gemini supports it but we render single-voice)
- A/B testing voice quality before commit (user opted out)
- Per-chapter voice variation
- Hot-reload of `AUDIO_TAGS` without restart
- Per-segment TTS parallelization

---

## Rollback

```bash
git revert <merge-commit>
cd pipeline && railway up --ci
```

The migration (00016) is NOT auto-reverted by code revert — that's fine. Cleared `preferred_voice` rows + Sulafat default + check constraint are the desired state regardless of which TTS path runs (and if we wanted to go back to OpenAI we'd write `00017` to drop the constraint and reset the default).
