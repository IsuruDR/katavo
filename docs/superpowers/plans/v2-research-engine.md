# Plan 2: Pipeline — LangGraph Research-to-Podcast Engine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete LangGraph pipeline that takes a topic + clarifying answers and produces a finished podcast audio file stored in Supabase, with research quality gates and ad injection.

**Architecture:** A LangGraph stateful graph with 8 nodes: briefBuilder -> researchPlanner -> deepResearcher -> factChecker -> qualityGate -> scriptWriter -> adInjector -> audioProducer -> metadataWriter. The pipeline runs on LangGraph Cloud, uses OpenAI for research/scripting, Google WaveNet for TTS, and writes results to Supabase.

**Tech Stack:** TypeScript, LangGraph.js (@langchain/langgraph), @langchain/openai, Google Cloud Text-to-Speech, @supabase/supabase-js

**Spec reference:** `docs/superpowers/specs/2026-03-27-ai-podcast-app-design.md` — Sections 4, 6, 8

**Depends on:** Plan 1 (Foundation) — Supabase schema must be in place.

---

## File Structure

```
pipeline/
├── src/
│   └── podcast_pipeline/
│       ├── graph.ts              # Main graph definition + edges
│       ├── state.ts              # Graph state schema
│       ├── config.ts             # Constants, thresholds, prompts
│       ├── nodes/
│       │   ├── index.ts
│       │   ├── briefBuilder.ts
│       │   ├── researchPlanner.ts
│       │   ├── deepResearcher.ts
│       │   ├── factChecker.ts
│       │   ├── qualityGate.ts
│       │   ├── scriptWriter.ts
│       │   ├── adInjector.ts
│       │   ├── audioProducer.ts
│       │   └── metadataWriter.ts
│       └── providers/
│           ├── index.ts
│           ├── ttsBase.ts       # Abstract TTS interface
│           ├── ttsGoogle.ts     # Google WaveNet implementation
│           └── supabaseClient.ts
├── tests/
│   ├── state.test.ts
│   ├── briefBuilder.test.ts
│   ├── researchPlanner.test.ts
│   ├── factChecker.test.ts
│   ├── qualityGate.test.ts
│   ├── scriptWriter.test.ts
│   ├── adInjector.test.ts
│   ├── audioProducer.test.ts
│   ├── metadataWriter.test.ts
│   └── graphIntegration.test.ts
├── langgraph.json
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Chunk 1: State Schema & TTS Provider Abstraction

### Task 1: Define the graph state schema

**Files:**
- Create: `pipeline/src/podcast_pipeline/state.ts`
- Create: `pipeline/tests/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pipeline/tests/state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PipelineState, makeInitialState } from "../src/podcast_pipeline/state.js";
import type { PipelineStateType } from "../src/podcast_pipeline/state.js";

describe("PipelineState", () => {
  it("should create initial state with required fields and defaults", () => {
    const state = makeInitialState({
      podcastId: "test-123",
      userId: "user-456",
      topic: "quantum computing",
      clarifyingAnswers: [{ q: "What angle?", a: "beginner friendly" }],
      hasAds: true,
      trustedSourceUrls: [],
      tier: "free",
    });

    expect(state.podcastId).toBe("test-123");
    expect(state.researchIterations).toBe(0);
    expect(state.status).toBe("queued");
    expect(state.credibilityScore).toBeNull();
  });

  it("should accept all pipeline fields", () => {
    const state = makeInitialState({
      podcastId: "test-123",
      userId: "user-456",
      topic: "AI",
      clarifyingAnswers: [],
      hasAds: false,
      trustedSourceUrls: [],
      tier: "pro",
      researchBrief: "brief",
      researchPlan: "plan",
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.9,
      credibilityReport: "all good",
      researchIterations: 2,
      script: "Hello world",
      adMarkers: { preRoll: 0, midRoll: 120 },
      audioUrl: "https://example.com/audio.mp3",
      transcript: "Hello world",
      chapterMarkers: [{ timestampSeconds: 0, title: "Intro" }],
      durationSeconds: 600,
      status: "complete",
      errorMessage: null,
    });

    expect(state.researchIterations).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline"
npx vitest run tests/state.test.ts
```

Expected: FAIL — cannot find module `../src/podcast_pipeline/state.js`

- [ ] **Step 3: Implement the state**

Create `pipeline/src/podcast_pipeline/state.ts`:

```typescript
/**
 * Pipeline state schema — defines all data flowing through the graph.
 * Uses LangGraph.js Annotation.Root for state management.
 */

import { Annotation } from "@langchain/langgraph";

export const PipelineState = Annotation.Root({
  // Input (set at pipeline start)
  podcastId: Annotation<string>,
  userId: Annotation<string>,
  topic: Annotation<string>,
  clarifyingAnswers: Annotation<Record<string, unknown>[]>,
  hasAds: Annotation<boolean>,
  trustedSourceUrls: Annotation<string[]>,
  tier: Annotation<string>, // "free", "plus", "pro"

  // Research phase
  researchBrief: Annotation<string>,
  researchPlan: Annotation<string>,
  researchDocument: Annotation<Record<string, unknown>>, // Structured JSONB
  sources: Annotation<Record<string, unknown>[]>, // [{url, title, snippet, credibilityScore}]
  credibilityScore: Annotation<number | null>,
  credibilityReport: Annotation<string>,
  researchIterations: Annotation<number>,

  // Script phase
  script: Annotation<string>,
  adMarkers: Annotation<Record<string, number> | null>, // {preRoll: seconds, midRoll: seconds}

  // Audio phase
  audioUrl: Annotation<string>,
  transcript: Annotation<string>,
  chapterMarkers: Annotation<Record<string, unknown>[]>, // [{timestampSeconds, title}]
  durationSeconds: Annotation<number>,

  // Status
  status: Annotation<string>,
  errorMessage: Annotation<string | null>,

  // Quality gate routing
  shouldRetry: Annotation<boolean>,
  needsDisclaimer: Annotation<boolean>,
});

export type PipelineStateType = typeof PipelineState.State;

/** Default values for a new state */
export function makeInitialState(overrides: Partial<PipelineStateType>): PipelineStateType {
  const defaults: PipelineStateType = {
    podcastId: "",
    userId: "",
    topic: "",
    clarifyingAnswers: [],
    hasAds: false,
    trustedSourceUrls: [],
    tier: "free",
    researchBrief: "",
    researchPlan: "",
    researchDocument: {},
    sources: [],
    credibilityScore: null,
    credibilityReport: "",
    researchIterations: 0,
    script: "",
    adMarkers: null,
    audioUrl: "",
    transcript: "",
    chapterMarkers: [],
    durationSeconds: 0,
    status: "queued",
    errorMessage: null,
    shouldRetry: false,
    needsDisclaimer: false,
  };
  return { ...defaults, ...overrides };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline"
npm install
npx vitest run tests/state.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/state.ts pipeline/tests/state.test.ts
git commit -m "feat: define pipeline state schema"
```

### Task 2: Create the TTS provider abstraction and Google WaveNet implementation

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/ttsBase.ts`
- Create: `pipeline/src/podcast_pipeline/providers/ttsGoogle.ts`
- Create: `pipeline/src/podcast_pipeline/providers/index.ts`
- Create: `pipeline/tests/ttsGoogle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pipeline/tests/ttsGoogle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

// Mock the @google-cloud/text-to-speech module before importing
vi.mock("@google-cloud/text-to-speech", () => {
  const mockSynthesize = vi.fn();
  return {
    default: {
      TextToSpeechClient: vi.fn().mockImplementation(() => ({
        synthesizeSpeech: mockSynthesize,
      })),
    },
    TextToSpeechClient: vi.fn().mockImplementation(() => ({
      synthesizeSpeech: mockSynthesize,
    })),
    __mockSynthesize: mockSynthesize,
  };
});

import { GoogleWaveNetTTS } from "../src/podcast_pipeline/providers/ttsGoogle.js";
import tts from "@google-cloud/text-to-speech";

describe("GoogleWaveNetTTS", () => {
  it("should implement TTSProvider interface", () => {
    const provider: TTSProvider = new GoogleWaveNetTTS();
    expect(provider.synthesize).toBeDefined();
  });

  it("should return audio bytes from synthesize", async () => {
    const mockSynthesize = (tts as any).__mockSynthesize;
    mockSynthesize.mockResolvedValue([
      { audioContent: Buffer.from("fake-audio-bytes") },
    ]);

    const provider = new GoogleWaveNetTTS();
    const audioBytes = await provider.synthesize("Hello, this is a test.");

    expect(audioBytes).toEqual(Buffer.from("fake-audio-bytes"));
    expect(mockSynthesize).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ttsGoogle.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement TTS base and Google provider**

Create `pipeline/src/podcast_pipeline/providers/index.ts`:

```typescript
export type { TTSProvider } from "./ttsBase.js";
export { GoogleWaveNetTTS } from "./ttsGoogle.js";
```

Create `pipeline/src/podcast_pipeline/providers/ttsBase.ts`:

```typescript
/**
 * Abstract TTS provider interface — swap implementations without rewriting nodes.
 */
export interface TTSProvider {
  synthesize(text: string, voiceName?: string): Promise<Buffer>;
}
```

Create `pipeline/src/podcast_pipeline/providers/ttsGoogle.ts`:

```typescript
/**
 * Google Cloud WaveNet TTS provider.
 */

import textToSpeech from "@google-cloud/text-to-speech";
import type { TTSProvider } from "./ttsBase.js";

// Default voice — change after A/B testing (see open question #3 in spec)
const DEFAULT_VOICE = "en-US-Neural2-D";
const DEFAULT_SPEAKING_RATE = 1.0;

export class GoogleWaveNetTTS implements TTSProvider {
  private client: InstanceType<typeof textToSpeech.TextToSpeechClient>;
  private voiceName: string;
  private speakingRate: number;

  constructor(voiceName = DEFAULT_VOICE, speakingRate = DEFAULT_SPEAKING_RATE) {
    this.client = new textToSpeech.TextToSpeechClient();
    this.voiceName = voiceName;
    this.speakingRate = speakingRate;
  }

  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const voice = voiceName ?? this.voiceName;

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "en-US",
        name: voice,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: this.speakingRate,
      },
    });

    return Buffer.from(response.audioContent as Uint8Array);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/ttsGoogle.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/ pipeline/tests/ttsGoogle.test.ts
git commit -m "feat: add TTS provider abstraction with Google WaveNet implementation"
```

### Task 3: Create the Supabase client helper and config

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/supabaseClient.ts`
- Create: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Create Supabase client helper**

```typescript
// pipeline/src/podcast_pipeline/providers/supabaseClient.ts
/**
 * Supabase client for pipeline — uses service role key for privileged access.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  return createClient(url, key);
}
```

- [ ] **Step 2: Create config with prompts and thresholds**

```typescript
// pipeline/src/podcast_pipeline/config.ts
/**
 * Pipeline configuration — prompts, thresholds, and constants.
 */

// Quality gate
export const CREDIBILITY_THRESHOLD = 0.7;
export const MAX_RESEARCH_RETRIES = 2;

// Cost ceiling per tier (USD)
export const RESEARCH_COST_CEILING: Record<string, number> = {
  free: 3.0,
  plus: 3.0,
  pro: 5.0,
};

// Script targets
export const TARGET_WORD_COUNT = 1500; // ~10 minutes at 150 wpm
export const TARGET_CHAPTER_COUNT = 4; // Intro + 2-3 sections + conclusion

// Prompts
export const BRIEF_BUILDER_PROMPT = `You are preparing a research brief for a podcast episode.
Given a topic and the user's answers to clarifying questions, produce a structured research brief.

Output a JSON object with:
- "scope": what the podcast should cover
- "angle": the specific perspective or framing
- "depth": how technical/detailed (beginner, intermediate, expert)
- "keyQuestions": list of 3-5 specific questions the research should answer
`;

export const RESEARCH_PLANNER_PROMPT = `You are a research planner for a deep-dive podcast.
Given a research brief, produce a research plan.

Output a JSON object with:
- "queries": list of 3-5 specific search queries to execute
- "angles": different perspectives to explore
- "prioritySources": types of sources to prioritize (academic, news, expert blogs, etc.)
{retryContext}
`;

export const FACT_CHECKER_PROMPT = `You are a fact-checker for a podcast script.
Given a research document with claims and citations, assess credibility.

For each major claim, evaluate:
1. Is it supported by multiple independent sources?
2. Are the sources reliable and recent?
3. Are there contradictions in the evidence?

Output a JSON object with:
- "claims": list of {"claim": string, "confidence": number, "sourcesCount": number, "issues": string}
- "overallScore": number between 0 and 1
- "summary": brief text summary of credibility assessment
- "gaps": list of specific areas that need more research (empty if all clear)
`;

export const SCRIPT_WRITER_PROMPT = `You are a podcast script writer creating a single-narrator deep-dive episode.

Rules:
- Write ~{targetWords} words (~10 minutes at 150 wpm)
- Use a conversational, engaging tone — like explaining to a smart friend
- Include natural chapter breaks marked with [CHAPTER: Title]
- Start with a compelling hook, not "Welcome to..."
- Include specific data, examples, and citations from the research
- End with a thought-provoking takeaway, not a generic sign-off
- Do NOT include any harmful, misleading, or offensive content
{disclaimerContext}

Research document:
{researchDocument}
`;

export const AD_PRE_ROLL_MARKER = "[AD:PRE_ROLL]";
export const AD_MID_ROLL_MARKER = "[AD:MID_ROLL]";
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/supabaseClient.ts pipeline/src/podcast_pipeline/config.ts
git commit -m "feat: add pipeline config with prompts and Supabase client helper"
```

---

## Chunk 2: Pipeline Nodes (Research Phase)

### Task 4: Implement briefBuilder node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/index.ts`
- Create: `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts`
- Create: `pipeline/tests/briefBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/briefBuilder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { briefBuilder } from "../src/podcast_pipeline/nodes/briefBuilder.js";

describe("briefBuilder", () => {
  it("should produce a structured brief from topic and answers", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        scope: "Impact of quantum computing on cryptography",
        angle: "beginner-friendly",
        depth: "intermediate",
        keyQuestions: ["What is quantum computing?", "How does it threaten encryption?"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      topic: "quantum computing and cryptography",
      clarifyingAnswers: [
        { q: "What angle?", a: "beginner friendly" },
      ],
    };

    const result = await briefBuilder(state as any);

    expect(result.researchBrief).toBeDefined();
    expect(result.researchBrief!.toLowerCase()).toContain("quantum");
    expect(result.status).toBe("researching");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/briefBuilder.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/index.ts
/** Pipeline nodes — each function takes state and returns a partial state update. */
export { briefBuilder } from "./briefBuilder.js";
export { researchPlanner } from "./researchPlanner.js";
export { deepResearcher } from "./deepResearcher.js";
export { factChecker } from "./factChecker.js";
export { qualityGate } from "./qualityGate.js";
export { scriptWriter } from "./scriptWriter.js";
export { adInjector } from "./adInjector.js";
export { audioProducer } from "./audioProducer.js";
export { metadataWriter } from "./metadataWriter.js";
```

```typescript
// pipeline/src/podcast_pipeline/nodes/briefBuilder.ts
/**
 * Packages topic + clarifying answers into a structured research brief.
 */

import { ChatOpenAI } from "@langchain/openai";
import { BRIEF_BUILDER_PROMPT } from "../config.js";
import type { PipelineStateType } from "../state.js";

const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });

export async function briefBuilder(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { topic, clarifyingAnswers = [] } = state;

  const answersText = clarifyingAnswers
    .map((a: any) => `Q: ${a.q ?? ""}\nA: ${a.a ?? ""}`)
    .join("\n");

  const response = await model.invoke([
    { role: "system", content: BRIEF_BUILDER_PROMPT },
    { role: "user", content: `Topic: ${topic}\n\nUser's answers:\n${answersText}` },
  ]);

  const brief = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  return { researchBrief: brief, status: "researching" };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/briefBuilder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/ pipeline/tests/briefBuilder.test.ts
git commit -m "feat: implement briefBuilder node"
```

### Task 5: Implement researchPlanner node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/researchPlanner.ts`
- Create: `pipeline/tests/researchPlanner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/researchPlanner.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { researchPlanner } from "../src/podcast_pipeline/nodes/researchPlanner.js";

describe("researchPlanner", () => {
  it("should create a plan from brief", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        queries: ["quantum computing cryptography impact 2026", "post-quantum encryption standards"],
        angles: ["technical", "policy implications"],
        prioritySources: ["academic papers", "NIST publications"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchBrief: '{"scope": "quantum crypto", "keyQuestions": ["what?"]}',
      credibilityReport: "",
      researchIterations: 0,
    };

    const result = await researchPlanner(state as any);

    expect(result.researchPlan).toBeDefined();
    const plan = JSON.parse(result.researchPlan!);
    expect(plan.queries.length).toBeGreaterThanOrEqual(2);
  });

  it("should include retry context when iterations > 0", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        queries: ["specific gap query"],
        angles: ["fill gaps"],
        prioritySources: ["academic"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchBrief: '{"scope": "test"}',
      credibilityReport: "Gap: missing data on X",
      researchIterations: 1,
    };

    const result = await researchPlanner(state as any);

    // Verify the retry context was passed to the LLM
    const callArgs = mockInvoke.mock.calls[0][0];
    const userMessage = callArgs[1].content;
    expect(userMessage).toContain("Gap: missing data on X");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/researchPlanner.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/researchPlanner.ts
/**
 * Produces a research plan from the brief, incorporating retry context if present.
 */

import { ChatOpenAI } from "@langchain/openai";
import { RESEARCH_PLANNER_PROMPT } from "../config.js";
import type { PipelineStateType } from "../state.js";

const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });

export async function researchPlanner(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { researchBrief, researchIterations = 0, credibilityReport = "" } = state;

  let retryContext = "";
  if (researchIterations > 0 && credibilityReport) {
    retryContext = `\n\nPREVIOUS RESEARCH HAD GAPS. Focus on filling these:\n${credibilityReport}`;
  }

  const prompt = RESEARCH_PLANNER_PROMPT.replace("{retryContext}", retryContext);

  let userContent = `Research brief:\n${researchBrief}`;
  if (retryContext) {
    userContent += `\n${retryContext}`;
  }

  const response = await model.invoke([
    { role: "system", content: prompt },
    { role: "user", content: userContent },
  ]);

  const plan = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  return { researchPlan: plan };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/researchPlanner.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/researchPlanner.ts pipeline/tests/researchPlanner.test.ts
git commit -m "feat: implement researchPlanner node with retry support"
```

### Task 6: Implement deepResearcher node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/deepResearcher.ts`
- Create: `pipeline/tests/deepResearcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/deepResearcher.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { deepResearcher } from "../src/podcast_pipeline/nodes/deepResearcher.js";

describe("deepResearcher", () => {
  it("should produce a structured research document", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        sections: [
          { title: "Introduction", content: "Quantum computing threatens..." },
          { title: "Current State", content: "NIST has standardized..." },
        ],
        sources: [
          { url: "https://nist.gov/pqc", title: "NIST PQC", snippet: "..." },
        ],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchPlan: '{"queries": ["quantum crypto"], "angles": ["technical"]}',
      trustedSourceUrls: [],
      tier: "free",
    };

    const result = await deepResearcher(state as any);

    expect(result.researchDocument).toBeDefined();
    expect(result.sources).toBeDefined();
    expect(result.status).toBe("fact_checking");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/deepResearcher.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/deepResearcher.ts
/**
 * Executes deep research using OpenAI o4-mini.
 */

import { ChatOpenAI } from "@langchain/openai";
import { RESEARCH_COST_CEILING } from "../config.js";
import type { PipelineStateType } from "../state.js";

const model = new ChatOpenAI({ modelName: "o4-mini", maxTokens: 4000 });

export async function deepResearcher(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const plan = JSON.parse(state.researchPlan);
  const trustedUrls = state.trustedSourceUrls ?? [];
  const tier = state.tier ?? "free";
  const costCeiling = RESEARCH_COST_CEILING[tier] ?? 3.0;

  const queries = plan.queries ?? [];
  const angles = plan.angles ?? [];

  let sourceConstraint = "";
  if (trustedUrls.length > 0) {
    sourceConstraint = `\n\nIMPORTANT: Only use information from these trusted sources: ${trustedUrls.join(", ")}`;
  }

  const researchPrompt = `Conduct deep research on the following queries and angles.
Produce a comprehensive, well-structured research document with citations.

Queries: ${JSON.stringify(queries)}
Angles: ${JSON.stringify(angles)}
${sourceConstraint}

Output a JSON object with:
- "sections": list of {"title": string, "content": string} — 3-5 sections covering the topic thoroughly
- "sources": list of {"url": string, "title": string, "snippet": string} — all sources used
`;

  const response = await model.invoke([
    { role: "user", content: researchPrompt },
  ]);

  const responseText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const content = JSON.parse(responseText);
  const researchDoc = content.sections ?? content;
  const sources = content.sources ?? [];

  return {
    researchDocument: Array.isArray(researchDoc) ? { sections: researchDoc } : researchDoc,
    sources,
    status: "fact_checking",
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/deepResearcher.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/deepResearcher.ts pipeline/tests/deepResearcher.test.ts
git commit -m "feat: implement deepResearcher node with cost ceiling awareness"
```

### Task 7: Implement factChecker and qualityGate nodes

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/factChecker.ts`
- Create: `pipeline/src/podcast_pipeline/nodes/qualityGate.ts`
- Create: `pipeline/tests/factChecker.test.ts`
- Create: `pipeline/tests/qualityGate.test.ts`

- [ ] **Step 1: Write factChecker test**

```typescript
// pipeline/tests/factChecker.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { factChecker } from "../src/podcast_pipeline/nodes/factChecker.js";

describe("factChecker", () => {
  it("should produce a credibility assessment", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        claims: [
          { claim: "Quantum computers can break RSA", confidence: 0.9, sourcesCount: 3, issues: "" },
        ],
        overallScore: 0.85,
        summary: "Research is well-sourced",
        gaps: [],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      sources: [{ url: "https://test.com", title: "Test", snippet: "..." }],
    };

    const result = await factChecker(state as any);

    expect(result.credibilityScore).toBe(0.85);
    expect(result.credibilityReport).toBeDefined();
  });
});
```

- [ ] **Step 2: Write qualityGate test**

```typescript
// pipeline/tests/qualityGate.test.ts
import { describe, it, expect } from "vitest";
import { qualityGate } from "../src/podcast_pipeline/nodes/qualityGate.js";

describe("qualityGate", () => {
  it("should pass when score is above threshold", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("scripting");
    expect(result.researchIterations).toBe(1);
  });

  it("should retry when score is below threshold", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 0,
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.researchIterations).toBe(1);
  });

  it("should proceed with disclaimer after max retries", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 2, // Already retried twice
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(false);
    expect(result.status).toBe("scripting");
    expect(result.needsDisclaimer).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, verify fail**

```bash
npx vitest run tests/factChecker.test.ts tests/qualityGate.test.ts
```

- [ ] **Step 4: Implement both nodes**

```typescript
// pipeline/src/podcast_pipeline/nodes/factChecker.ts
/**
 * Cross-references research claims against sources for credibility.
 */

import { ChatOpenAI } from "@langchain/openai";
import { FACT_CHECKER_PROMPT } from "../config.js";
import type { PipelineStateType } from "../state.js";

const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 1000 });

export async function factChecker(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { researchDocument, sources = [] } = state;

  const response = await model.invoke([
    { role: "system", content: FACT_CHECKER_PROMPT },
    {
      role: "user",
      content: `Research document:\n${JSON.stringify(researchDocument)}\n\nSources:\n${JSON.stringify(sources)}`,
    },
  ]);

  const responseText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const assessment = JSON.parse(responseText);

  return {
    credibilityScore: assessment.overallScore ?? 0.0,
    credibilityReport: `${assessment.summary ?? ""}\nGaps: ${JSON.stringify(assessment.gaps ?? [])}`,
  };
}
```

```typescript
// pipeline/src/podcast_pipeline/nodes/qualityGate.ts
/**
 * LLM-as-judge decision node — retry research or proceed to scripting.
 */

import { CREDIBILITY_THRESHOLD, MAX_RESEARCH_RETRIES } from "../config.js";
import type { PipelineStateType } from "../state.js";

export function qualityGate(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const score = state.credibilityScore ?? 0.0;
  const iterations = state.researchIterations ?? 0;
  const newIterations = iterations + 1;

  if (score >= CREDIBILITY_THRESHOLD) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: false,
    };
  }

  if (newIterations > MAX_RESEARCH_RETRIES) {
    // Max retries exceeded — proceed with disclaimer
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: true,
    };
  }

  // Below threshold and retries remaining — retry
  return {
    researchIterations: newIterations,
    shouldRetry: true,
    needsDisclaimer: false,
  };
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npx vitest run tests/factChecker.test.ts tests/qualityGate.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/factChecker.ts pipeline/src/podcast_pipeline/nodes/qualityGate.ts pipeline/tests/factChecker.test.ts pipeline/tests/qualityGate.test.ts
git commit -m "feat: implement factChecker and qualityGate nodes"
```

---

## Chunk 3: Pipeline Nodes (Production Phase)

### Task 8: Implement scriptWriter node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts`
- Create: `pipeline/tests/scriptWriter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/scriptWriter.test.ts
import { describe, it, expect, vi } from "vitest";
import OpenAI from "openai";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const mockModCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      moderations: { create: mockModCreate },
    })),
    __mockCreate: mockCreate,
    __mockModCreate: mockModCreate,
  };
});

import { scriptWriter } from "../src/podcast_pipeline/nodes/scriptWriter.js";

describe("scriptWriter", () => {
  it("should produce a script with chapters", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      await import("openai") as any;

    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: `[CHAPTER: The Quantum Threat]
Imagine a computer so powerful it could crack every encryption...

[CHAPTER: Fighting Back]
But researchers aren't sitting idle. NIST has been working on...

[CHAPTER: What It Means For You]
So what does this mean for the average person?...`,
        },
      }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toBeDefined();
    expect(result.script).toContain("[CHAPTER:");
    expect(result.status).toBe("scripting");
  });

  it("should add disclaimer when needed", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      await import("openai") as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Script with disclaimer..." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [] },
      needsDisclaimer: true,
    };

    const result = await scriptWriter(state as any);

    const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
    const systemMsg = callArgs.messages[0].content;
    expect(systemMsg.toLowerCase()).toMatch(/limited|disclaimer/);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/scriptWriter.ts
/**
 * Generates the podcast script from research, with content moderation.
 * Uses the OpenAI SDK directly for moderation endpoint access.
 */

import OpenAI from "openai";
import { SCRIPT_WRITER_PROMPT, TARGET_WORD_COUNT } from "../config.js";
import type { PipelineStateType } from "../state.js";

const openai = new OpenAI();

export async function scriptWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { researchDocument, needsDisclaimer = false } = state;

  let disclaimerContext = "";
  if (needsDisclaimer) {
    disclaimerContext =
      "\nIMPORTANT: Sources on this topic were limited or conflicting. " +
      "Include a brief disclaimer early in the script acknowledging this, " +
      "e.g., 'I should note that sources on this topic are still emerging...'";
  }

  const prompt = SCRIPT_WRITER_PROMPT
    .replace("{targetWords}", String(TARGET_WORD_COUNT))
    .replace("{researchDocument}", JSON.stringify(researchDocument))
    .replace("{disclaimerContext}", disclaimerContext);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Write the podcast script." },
    ],
    max_tokens: 3000,
  });

  const script = response.choices[0].message.content ?? "";

  // Content moderation — output filtering
  const modResponse = await openai.moderations.create({ input: script });
  if (modResponse.results[0].flagged) {
    return {
      status: "failed",
      errorMessage:
        "Generated script flagged by content moderation. Topic may not be suitable.",
    };
  }

  return { script, status: "scripting" };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/scriptWriter.ts pipeline/tests/scriptWriter.test.ts
git commit -m "feat: implement scriptWriter node with content moderation"
```

### Task 9: Implement adInjector node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/adInjector.ts`
- Create: `pipeline/tests/adInjector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/adInjector.test.ts
import { describe, it, expect } from "vitest";
import { adInjector } from "../src/podcast_pipeline/nodes/adInjector.js";
import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../src/podcast_pipeline/config.js";

describe("adInjector", () => {
  it("should insert markers for free tier", () => {
    const state = {
      script:
        "[CHAPTER: Intro]\nHello world\n\n[CHAPTER: Main]\nContent here\n\n[CHAPTER: End]\nGoodbye",
      hasAds: true,
    };

    const result = adInjector(state as any);

    expect(result.script).toContain(AD_PRE_ROLL_MARKER);
    expect(result.script).toContain(AD_MID_ROLL_MARKER);
  });

  it("should skip ad markers for paid tier", () => {
    const state = {
      script: "[CHAPTER: Intro]\nHello world",
      hasAds: false,
    };

    const result = adInjector(state as any);

    expect(result.script).not.toContain(AD_PRE_ROLL_MARKER);
    expect(result.script).not.toContain(AD_MID_ROLL_MARKER);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/adInjector.ts
/**
 * Inserts ad placement markers into the script for free-tier podcasts.
 */

import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../config.js";
import type { PipelineStateType } from "../state.js";

export function adInjector(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  let { script } = state;
  const hasAds = state.hasAds ?? false;

  if (!hasAds) {
    return { script };
  }

  // Insert pre-roll at the very beginning
  script = `${AD_PRE_ROLL_MARKER}\n\n${script}`;

  // Insert mid-roll at the second chapter break (natural midpoint)
  const chapterPattern = /\[CHAPTER:/g;
  const chapterPositions: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = chapterPattern.exec(script)) !== null) {
    chapterPositions.push(match.index);
  }

  if (chapterPositions.length >= 3) {
    // Insert before the third chapter (after intro + first section)
    const midPos = chapterPositions[2];
    script = script.slice(0, midPos) + `\n${AD_MID_ROLL_MARKER}\n\n` + script.slice(midPos);
  } else if (chapterPositions.length >= 2) {
    const midPos = chapterPositions[1];
    script = script.slice(0, midPos) + `\n${AD_MID_ROLL_MARKER}\n\n` + script.slice(midPos);
  }

  return { script };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/adInjector.ts pipeline/tests/adInjector.test.ts
git commit -m "feat: implement adInjector node"
```

### Task 10: Implement audioProducer node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/audioProducer.ts`
- Create: `pipeline/tests/audioProducer.test.ts`

> **Note:** This node requires `@google-cloud/text-to-speech` (already added for TTS provider) and an audio stitching approach. Since we cannot use pydub (Python), we use `fluent-ffmpeg` and `ffmpeg-static` for audio concatenation. Install with:
> ```bash
> npm install fluent-ffmpeg ffmpeg-static
> npm install -D @types/fluent-ffmpeg
> ```

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/audioProducer.test.ts
import { describe, it, expect, vi } from "vitest";
import { splitScriptSegments } from "../src/podcast_pipeline/nodes/audioProducer.js";

vi.mock("../src/podcast_pipeline/providers/ttsGoogle.js", () => ({
  GoogleWaveNetTTS: vi.fn().mockImplementation(() => ({
    synthesize: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
  })),
}));

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue(null),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://storage/audio.mp3" } }),
      }),
    },
  }),
}));

describe("splitScriptSegments", () => {
  it("should split script into text and ad segments", () => {
    const script =
      "[AD:PRE_ROLL]\n\n[CHAPTER: Intro]\nHello world\n\n[AD:MID_ROLL]\n\n[CHAPTER: Main]\nContent";
    const segments = splitScriptSegments(script);

    const adSegments = segments.filter((s) => s.type === "ad");
    const textSegments = segments.filter((s) => s.type === "text");

    expect(adSegments).toHaveLength(2);
    expect(textSegments).toHaveLength(2);
    expect(textSegments[0].content).toContain("Hello world");
  });
});

describe("audioProducer", () => {
  it("should call TTS and upload to Supabase", async () => {
    // Mock stitchAudio at module level
    vi.mock("../src/podcast_pipeline/nodes/audioProducer.js", async (importOriginal) => {
      const original = await importOriginal() as any;
      return {
        ...original,
        stitchAudio: vi.fn().mockResolvedValue({ audioBytes: Buffer.from("final-audio"), durationSeconds: 600 }),
      };
    });

    const { audioProducer } = await import("../src/podcast_pipeline/nodes/audioProducer.js");

    const state = {
      podcastId: "test-123",
      userId: "user-456",
      script: "[CHAPTER: Intro]\nHello world",
      hasAds: false,
    };

    const result = await audioProducer(state as any);

    expect(result.audioUrl).toBeDefined();
    expect(result.status).toBe("generating_audio");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/audioProducer.ts
/**
 * Converts script to audio via TTS, stitches ads, uploads to Supabase Storage.
 * Uses ffmpeg (via fluent-ffmpeg) for audio concatenation instead of pydub.
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../config.js";
import type { TTSProvider } from "../providers/ttsBase.js";
import { GoogleWaveNetTTS } from "../providers/ttsGoogle.js";
import { getSupabaseClient } from "../providers/supabaseClient.js";
import type { PipelineStateType } from "../state.js";

// Ad audio files — stored in Supabase Storage or local for MVP
const AD_AUDIO_DIR = process.env.AD_AUDIO_DIR ?? "ad_assets";

interface ScriptSegment {
  type: "text" | "ad";
  content?: string;
  adType?: string;
}

function getTtsProvider(): TTSProvider {
  /** Factory — swap provider here when migrating to ElevenLabs. */
  return new GoogleWaveNetTTS();
}

export function splitScriptSegments(script: string): ScriptSegment[] {
  /** Split script into ordered segments of text and ad markers. */
  const segments: ScriptSegment[] = [];
  const escapedPre = AD_PRE_ROLL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedMid = AD_MID_ROLL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = script.split(new RegExp(`(${escapedPre}|${escapedMid})`));

  for (const part of parts) {
    const stripped = part.trim();
    if (!stripped) continue;

    if (stripped === AD_PRE_ROLL_MARKER) {
      segments.push({ type: "ad", adType: "pre_roll" });
    } else if (stripped === AD_MID_ROLL_MARKER) {
      segments.push({ type: "ad", adType: "mid_roll" });
    } else {
      // Strip chapter markers from TTS input but keep for metadata
      const cleanText = stripped.replace(/\[CHAPTER:[^\]]+\]\n?/g, "").trim();
      if (cleanText) {
        segments.push({ type: "text", content: cleanText });
      }
    }
  }

  return segments;
}

export async function stitchAudio(
  segments: ScriptSegment[],
  tts: TTSProvider,
): Promise<{ audioBytes: Buffer; durationSeconds: number }> {
  /**
   * Synthesize text segments, stitch with ad audio using ffmpeg,
   * return {audioBytes, durationSeconds}.
   */
  const tempDir = mkdtempSync(join(tmpdir(), "podcast-audio-"));

  try {
    const partFiles: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type === "ad" && segment.adType) {
        const adFile = join(AD_AUDIO_DIR, `${segment.adType}.mp3`);
        try {
          readFileSync(adFile);
          partFiles.push(adFile);
        } catch {
          // Ad file not found — skip
        }
      } else if (segment.type === "text" && segment.content) {
        const audioBytes = await tts.synthesize(segment.content);
        const partPath = join(tempDir, `part_${i}.mp3`);
        writeFileSync(partPath, audioBytes);
        partFiles.push(partPath);
      }
    }

    if (partFiles.length === 0) {
      return { audioBytes: Buffer.alloc(0), durationSeconds: 0 };
    }

    // Concatenate with ffmpeg
    const listFile = join(tempDir, "files.txt");
    const listContent = partFiles.map((f) => `file '${f}'`).join("\n");
    writeFileSync(listFile, listContent);

    const outputPath = join(tempDir, "output.mp3");
    execSync(
      `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}" -y`,
      { stdio: "pipe" },
    );

    const audioBytes = readFileSync(outputPath);

    // Get duration via ffprobe
    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
      { encoding: "utf-8" },
    ).trim();
    const durationSeconds = Math.round(parseFloat(durationOutput) || 0);

    return { audioBytes: Buffer.from(audioBytes), durationSeconds };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function audioProducer(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { script, podcastId, userId } = state;

  const tts = getTtsProvider();
  const segments = splitScriptSegments(script);
  const { audioBytes, durationSeconds } = await stitchAudio(segments, tts);

  // Upload to Supabase Storage
  const supabase = getSupabaseClient();
  const storagePath = `${userId}/${podcastId}.mp3`;

  await supabase.storage.from("podcast-audio").upload(storagePath, audioBytes, {
    contentType: "audio/mpeg",
  });

  const { data } = supabase.storage
    .from("podcast-audio")
    .getPublicUrl(storagePath);

  return {
    audioUrl: data.publicUrl,
    durationSeconds,
    status: "generating_audio",
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/audioProducer.ts pipeline/tests/audioProducer.test.ts
git commit -m "feat: implement audioProducer node with TTS and ad stitching"
```

### Task 11: Implement metadataWriter node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts`
- Create: `pipeline/tests/metadataWriter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/tests/metadataWriter.test.ts
import { describe, it, expect, vi } from "vitest";

const mockTable = vi.fn().mockReturnValue({
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(null) }),
  }),
  insert: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue(null),
  }),
});

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({ table: mockTable }),
}));

// Mock global fetch for notification
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

import {
  metadataWriter,
  extractChapters,
} from "../src/podcast_pipeline/nodes/metadataWriter.js";

describe("extractChapters", () => {
  it("should extract chapter markers from script", () => {
    const script =
      "[CHAPTER: The Quantum Threat]\nContent...\n[CHAPTER: Fighting Back]\nMore content...";
    const chapters = extractChapters(script, 600);

    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe("The Quantum Threat");
    expect(chapters[0].timestampSeconds).toBe(0);
  });
});

describe("metadataWriter", () => {
  it("should update Supabase and return complete status", async () => {
    const state = {
      podcastId: "test-123",
      userId: "user-456",
      topic: "quantum computing",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.85,
      researchIterations: 1,
    };

    const result = await metadataWriter(state as any);

    expect(result.status).toBe("complete");
    expect(result.chapterMarkers!.length).toBeGreaterThan(0);
    // Verify Supabase was called
    expect(mockTable).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement**

```typescript
// pipeline/src/podcast_pipeline/nodes/metadataWriter.ts
/**
 * Generates metadata, stores research context, updates Supabase, sends notification.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import type { PipelineStateType } from "../state.js";

const NOTIFY_COMPLETE_URL = process.env.NOTIFY_COMPLETE_URL ?? "";

interface ChapterMarker {
  timestampSeconds: number;
  title: string;
}

export function extractChapters(
  script: string,
  totalDuration: number,
): ChapterMarker[] {
  /** Extract chapter markers from script, estimate timestamps proportionally. */
  const chapterPattern = /\[CHAPTER:\s*([^\]]+)\]/g;
  const matches: { index: number; title: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = chapterPattern.exec(script)) !== null) {
    matches.push({ index: match.index, title: match[1].trim() });
  }

  if (matches.length === 0) {
    return [{ timestampSeconds: 0, title: "Full Episode" }];
  }

  return matches.map((m) => {
    const positionRatio = m.index / Math.max(script.length, 1);
    const timestamp = Math.round(positionRatio * totalDuration);
    return { timestampSeconds: timestamp, title: m.title };
  });
}

export async function metadataWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { podcastId, script } = state;
  const duration = state.durationSeconds ?? 0;

  const chapters = extractChapters(script, duration);

  // Clean transcript (remove markers)
  const transcript = script
    .replace(/\[CHAPTER:[^\]]+\]\n?/g, "")
    .replace(/\[AD:[^\]]+\]\n?/g, "")
    .trim();

  const supabase = getSupabaseClient();

  // Update podcast record
  await supabase
    .table("podcasts")
    .update({
      status: "complete",
      audio_url: state.audioUrl,
      transcript,
      duration_seconds: duration,
      chapter_markers: chapters,
    })
    .eq("id", podcastId)
    .execute();

  // Store research context for Q&A
  await supabase
    .table("research_contexts")
    .insert({
      podcast_id: podcastId,
      research_document: state.researchDocument ?? {},
      sources: state.sources ?? [],
      overall_credibility_score: state.credibilityScore,
      research_iterations: state.researchIterations ?? 1,
    })
    .execute();

  // Send push notification via fetch (built-in)
  if (NOTIFY_COMPLETE_URL) {
    try {
      await fetch(NOTIFY_COMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastId,
          status: "complete",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Non-critical — user can still see status via Realtime
    }
  }

  return {
    status: "complete",
    transcript,
    chapterMarkers: chapters,
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/metadataWriter.ts pipeline/tests/metadataWriter.test.ts
git commit -m "feat: implement metadataWriter node with Supabase update and notification"
```

---

## Chunk 4: Graph Assembly & Integration

### Task 12: Assemble the LangGraph graph

**Files:**
- Update: `pipeline/src/podcast_pipeline/graph.ts`
- Create: `pipeline/tests/graphIntegration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// pipeline/tests/graphIntegration.test.ts
import { describe, it, expect } from "vitest";
import { graph } from "../src/podcast_pipeline/graph.js";

describe("graph", () => {
  it("should have all nodes", () => {
    const nodeNames = new Set(Object.keys(graph.nodes));
    const expected = [
      "briefBuilder",
      "researchPlanner",
      "deepResearcher",
      "factChecker",
      "qualityGate",
      "scriptWriter",
      "adInjector",
      "audioProducer",
      "metadataWriter",
    ];
    // __start__ and __end__ are implicit
    for (const name of expected) {
      expect(nodeNames).toContain(name);
    }
  });

  it("should compile without errors", () => {
    expect(graph).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement the graph**

```typescript
// pipeline/src/podcast_pipeline/graph.ts
/**
 * Main LangGraph graph definition — wires all nodes together.
 */

import { StateGraph, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import type { PipelineStateType } from "./state.js";
import { briefBuilder } from "./nodes/briefBuilder.js";
import { researchPlanner } from "./nodes/researchPlanner.js";
import { deepResearcher } from "./nodes/deepResearcher.js";
import { factChecker } from "./nodes/factChecker.js";
import { qualityGate } from "./nodes/qualityGate.js";
import { scriptWriter } from "./nodes/scriptWriter.js";
import { adInjector } from "./nodes/adInjector.js";
import { audioProducer } from "./nodes/audioProducer.js";
import { metadataWriter } from "./nodes/metadataWriter.js";

function routeAfterQualityGate(state: PipelineStateType): string {
  /** Conditional edge: retry research or proceed to scripting. */
  if (state.shouldRetry) {
    return "researchPlanner";
  }
  if (state.status === "failed") {
    return END;
  }
  return "scriptWriter";
}

function routeAfterScript(state: PipelineStateType): string {
  /** Conditional edge: inject ads or skip to audio. */
  if (state.status === "failed") {
    return END; // Content moderation rejection
  }
  if (state.hasAds) {
    return "adInjector";
  }
  return "audioProducer";
}

// Build the graph
const workflow = new StateGraph(PipelineState)
  // Add nodes
  .addNode("briefBuilder", briefBuilder)
  .addNode("researchPlanner", researchPlanner)
  .addNode("deepResearcher", deepResearcher)
  .addNode("factChecker", factChecker)
  .addNode("qualityGate", qualityGate)
  .addNode("scriptWriter", scriptWriter)
  .addNode("adInjector", adInjector)
  .addNode("audioProducer", audioProducer)
  .addNode("metadataWriter", metadataWriter)
  // Wire edges
  .addEdge("__start__", "briefBuilder")
  .addEdge("briefBuilder", "researchPlanner")
  .addEdge("researchPlanner", "deepResearcher")
  .addEdge("deepResearcher", "factChecker")
  .addEdge("factChecker", "qualityGate")
  .addConditionalEdges("qualityGate", routeAfterQualityGate)
  .addConditionalEdges("scriptWriter", routeAfterScript)
  .addEdge("adInjector", "audioProducer")
  .addEdge("audioProducer", "metadataWriter")
  .addEdge("metadataWriter", END);

// Compile
export const graph = workflow.compile();
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/graphIntegration.test.ts
```

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/graph.ts pipeline/tests/graphIntegration.test.ts
git commit -m "feat: assemble complete LangGraph pipeline with conditional routing"
```

### Task 13: Add error handling wrapper for Supabase status updates

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/errorHandler.ts`

- [ ] **Step 1: Create error handler**

This wraps the graph execution to update Supabase status on failure (since LangGraph owns the `failed` status -- see spec Section 3.3).

```typescript
// pipeline/src/podcast_pipeline/nodes/errorHandler.ts
/**
 * Wraps pipeline execution — updates Supabase on unrecoverable failure.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";

const NOTIFY_COMPLETE_URL = process.env.NOTIFY_COMPLETE_URL ?? "";

export async function handlePipelineFailure(
  podcastId: string,
  errorMessage: string,
): Promise<void> {
  /** Called when the pipeline fails after exhausting retries. */
  const supabase = getSupabaseClient();

  await supabase
    .table("podcasts")
    .update({
      status: "failed",
      error_message: errorMessage,
    })
    .eq("id", podcastId)
    .execute();

  // Trigger notification (refund happens via DB trigger)
  if (NOTIFY_COMPLETE_URL) {
    try {
      await fetch(NOTIFY_COMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastId,
          status: "failed",
          errorMessage,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Non-critical
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/errorHandler.ts
git commit -m "feat: add pipeline error handler for Supabase status updates"
```

---

## Summary

After completing this plan, you will have:
- Complete LangGraph.js pipeline with 9 nodes (TypeScript)
- Quality gate with retry loop (max 2 retries)
- TTS provider abstraction (Google WaveNet implementation, swappable to ElevenLabs)
- Ad injection for free-tier podcasts
- Content moderation (OpenAI moderation endpoint)
- Audio stitching with ad clips via ffmpeg
- Supabase integration for storing results and triggering notifications
- Unit tests for every node (vitest)
- Graph integration test

**Additional packages to install (beyond v1 package.json):**
```bash
npm install @google-cloud/text-to-speech openai fluent-ffmpeg ffmpeg-static
npm install -D @types/fluent-ffmpeg
```

**Next:** Plan 3 (Mobile App) builds the React Native screens on top of this foundation.
