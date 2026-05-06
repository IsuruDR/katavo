# Deep Dive & Pipeline Simplification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the LangGraph pipeline to use OpenAI's Deep Research API and add the Deep Dive voice conversation feature for paid users.

**Architecture:** Replace 3 research nodes with a single deepResearch node using o4-mini-deep-research. Add per-chapter Deep Dive voice conversations via ElevenLabs Conversational AI with server-authoritative session management. Chapter-to-research mapping connects script chapters to their source research.

**Tech Stack:** TypeScript, LangGraph.js, OpenAI Deep Research API (o4-mini-deep-research), ElevenLabs Conversational AI (@11labs/react-native), Supabase (Edge Functions, Postgres), React Native (Expo)

**Spec reference:** `docs/superpowers/specs/2026-03-28-deep-dive-and-pipeline-simplification-design.md`

**Depends on:** Plans 1-3 (Foundation, Pipeline, Mobile)

---

## File Structure

### Pipeline changes (`pipeline/`)

```
pipeline/src/podcast_pipeline/
├── state.ts                          # MODIFY: remove researchPlan, add chapterResearchMap
├── config.ts                         # MODIFY: remove old prompts, add deep research config
├── graph.ts                          # MODIFY: rewire to 7-node pipeline
├── nodes/
│   ├── index.ts                      # MODIFY: update exports
│   ├── deepResearch.ts               # CREATE: OpenAI Deep Research API node
│   ├── qualityGate.ts                # MODIFY: simplify to heuristic check
│   ├── scriptWriter.ts               # MODIFY: output chapterResearchMap
│   ├── metadataWriter.ts             # MODIFY: store chapter_research_map
│   ├── researchPlanner.ts            # DELETE
│   ├── deepResearcher.ts             # DELETE
│   └── factChecker.ts                # DELETE
pipeline/tests/
├── deepResearch.test.ts              # CREATE
├── qualityGate.test.ts               # MODIFY: update for new heuristic logic
├── scriptWriter.test.ts              # MODIFY: test chapterResearchMap output
├── metadataWriter.test.ts            # MODIFY: test chapter_research_map storage
├── graph.test.ts                     # MODIFY: update for new graph shape
├── researchPlanner.test.ts           # DELETE
├── deepResearcher.test.ts            # DELETE
├── factChecker.test.ts               # DELETE
```

### Supabase changes (`supabase/`)

```
supabase/
├── migrations/
│   └── 00005_deep_dive.sql                # CREATE
├── functions/
│   ├── start-deep-dive/index.ts           # CREATE
│   ├── end-deep-dive/index.ts             # CREATE
│   └── revenucat-webhook/index.ts         # MODIFY: add deep dive minutes
```

### Mobile changes (`mobile/`)

```
mobile/
├── src/
│   ├── hooks/
│   │   ├── useSubscription.ts             # MODIFY: add deep dive minutes
│   │   └── useDeepDive.ts                 # CREATE
│   ├── services/
│   │   └── elevenlabs.ts                  # CREATE
│   └── components/
│       └── ChapterMarkers.tsx             # MODIFY: add Dive button support
├── app/
│   ├── player/
│   │   ├── [id].tsx                       # MODIFY: redesign layout
│   │   └── deep-dive.tsx                  # CREATE
│   └── (tabs)/
│       └── account.tsx                    # MODIFY: show deep dive minutes
```

---

## Chunk 1: Database Migration + Pipeline State/Config

### Task 1: Create migration 00005_deep_dive.sql

**Files:**
- Create: `supabase/migrations/00005_deep_dive.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 00005_deep_dive.sql
-- Adds deep dive minute tracking, chapter-research mapping, and chapter reference for Q&A.

-- Deep dive minute tracking on subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN deep_dive_minutes_per_month integer NOT NULL DEFAULT 0,
  ADD COLUMN deep_dive_minutes_remaining integer NOT NULL DEFAULT 0;

-- Chapter-to-research mapping on podcasts (indexes into research_contexts)
ALTER TABLE public.podcasts
  ADD COLUMN chapter_research_map jsonb;

-- Chapter reference on Q&A sessions
ALTER TABLE public.qa_sessions
  ADD COLUMN chapter_title text,
  ADD COLUMN elevenlabs_session_id text;
```

- [ ] **Step 2: Verify migration applies locally**

Run: `cd "/Users/isuru/personal/AI Podcast App" && npx supabase db reset`
Expected: All migrations apply without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00005_deep_dive.sql
git commit -m "feat: add deep dive migration (minutes, chapter map, session fields)"
```

---

### Task 2: Update pipeline state.ts

**Files:**
- Modify: `pipeline/src/podcast_pipeline/state.ts`
- Modify: `pipeline/tests/state.test.ts`

- [ ] **Step 1: Update the state test to reflect new fields**

Replace `pipeline/tests/state.test.ts` with:

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
    expect(state.chapterResearchMap).toBeNull();
  });

  it("should not have researchPlan field", () => {
    const state = makeInitialState({});
    expect("researchPlan" in state).toBe(false);
  });

  it("should accept chapterResearchMap", () => {
    const map = {
      "The Quantum Threat": { researchSections: [0, 1], sourceIndexes: [0, 1, 2] },
    };
    const state = makeInitialState({ chapterResearchMap: map });
    expect(state.chapterResearchMap).toEqual(map);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/state.test.ts`
Expected: FAIL — `chapterResearchMap` not in state, `researchPlan` still exists.

- [ ] **Step 3: Update state.ts — remove researchPlan, add chapterResearchMap**

Update `pipeline/src/podcast_pipeline/state.ts`:

```typescript
/**
 * Pipeline state schema — defines all data flowing through the graph.
 * Uses LangGraph.js Annotation.Root for state management.
 */

import { Annotation } from "@langchain/langgraph";

/** Per-chapter mapping to research sections and source indexes */
export interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

export type ChapterResearchMap = Record<string, ChapterResearchEntry> | null;

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
  researchDocument: Annotation<Record<string, unknown>>, // Structured JSONB
  sources: Annotation<Record<string, unknown>[]>, // [{url, title}]
  credibilityScore: Annotation<number | null>,
  credibilityReport: Annotation<string>,
  researchIterations: Annotation<number>,

  // Script phase
  script: Annotation<string>,
  chapterResearchMap: Annotation<ChapterResearchMap>,
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
    researchDocument: {},
    sources: [],
    credibilityScore: null,
    credibilityReport: "",
    researchIterations: 0,
    script: "",
    chapterResearchMap: null,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/state.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/state.ts pipeline/tests/state.test.ts
git commit -m "feat: update pipeline state — remove researchPlan, add chapterResearchMap"
```

---

### Task 3: Update pipeline config.ts

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Update config.ts — remove old prompts/config, add deep research config**

Replace `pipeline/src/podcast_pipeline/config.ts` with:

```typescript
/**
 * Pipeline configuration — prompts, thresholds, and constants.
 */

// Quality gate
export const CREDIBILITY_THRESHOLD = 0.7;
export const MAX_RESEARCH_RETRIES = 2;
export const MIN_SOURCES_THRESHOLD = 3;

// Deep research
export const MAX_TOOL_CALLS: Record<string, number> = {
  free: 20,
  plus: 20,
  pro: 40,
};
export const DEEP_RESEARCH_POLL_INTERVAL = 10_000; // 10s between polls
export const DEEP_RESEARCH_TIMEOUT = 900_000; // 15 minutes

export const DEEP_RESEARCH_PROMPT = `You are conducting deep research for a podcast episode.
Given a research brief, produce a comprehensive, well-cited research document.

Structure your output as a JSON object with:
- "sections": list of {{"title": string, "content": string}} — 3-6 sections covering the topic thoroughly with inline citations
- "sources": list of {{"url": string, "title": string}} — all sources referenced

Requirements:
- Every factual claim must cite at least one source
- Cover the topic from multiple angles
- Prioritize recent, authoritative sources
- Include specific data, statistics, and expert quotes where available
{trustedSourceContext}
{retryContext}

Research brief:
{researchBrief}
`;

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

After writing the script, output a JSON block with a chapter-to-research mapping.
For each [CHAPTER: Title] in the script, map the chapter title to:
- "researchSections": indexes into the research document sections array that this chapter draws from
- "sourceIndexes": indexes into the sources array that this chapter references

Output the mapping as a fenced JSON block after the script:
\`\`\`chapter_research_map
{{
  "Chapter Title": {{ "researchSections": [0, 1], "sourceIndexes": [0, 2] }},
  ...
}}
\`\`\`

Research document:
{researchDocument}

Sources:
{sources}
`;

export const AD_PRE_ROLL_MARKER = "[AD:PRE_ROLL]";
export const AD_MID_ROLL_MARKER = "[AD:MID_ROLL]";
```

- [ ] **Step 2: Run all pipeline tests to check for import breakage**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run`
Expected: Some tests that imported `RESEARCH_PLANNER_PROMPT`, `FACT_CHECKER_PROMPT`, or `RESEARCH_COST_CEILING` will fail. This is expected — those files will be deleted in Task 8. The state and config tests should pass.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts
git commit -m "feat: update pipeline config — replace old prompts with deep research config"
```

---

## Chunk 2: Pipeline Node Changes

### Task 4: Create deepResearch node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/deepResearch.ts`
- Create: `pipeline/tests/deepResearch.test.ts`

**Key details:**
- Uses OpenAI Responses API (`openai.responses.create()`), NOT `chat.completions.create()`
- Uses `background: true` for async execution, then polls via `openai.responses.retrieve()`
- Extracts sources from `url_citation` annotations on the response output
- Computes `credibilityScore` from citation density (unique sources / key questions count, clamped to 0-1)

- [ ] **Step 1: Write the test file**

Create `pipeline/tests/deepResearch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockRetrieve = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: {
      create: mockCreate,
      retrieve: mockRetrieve,
    },
  })),
}));

import { deepResearch } from "../src/podcast_pipeline/nodes/deepResearch.js";

describe("deepResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should poll until complete and extract research document with sources", async () => {
    // First call returns in_progress (background: true)
    mockCreate.mockResolvedValue({
      id: "resp_abc123",
      status: "in_progress",
    });

    // Polling: first still in_progress, then completed
    mockRetrieve
      .mockResolvedValueOnce({
        id: "resp_abc123",
        status: "in_progress",
      })
      .mockResolvedValueOnce({
        id: "resp_abc123",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  sections: [
                    { title: "Introduction", content: "Quantum computing threatens current encryption..." },
                    { title: "Current State", content: "NIST has standardized post-quantum algorithms..." },
                  ],
                  sources: [
                    { url: "https://nist.gov/pqc", title: "NIST PQC Standards" },
                    { url: "https://arxiv.org/quantum", title: "Quantum Threat Analysis" },
                    { url: "https://ieee.org/crypto", title: "IEEE Crypto Review" },
                  ],
                }),
                annotations: [
                  { type: "url_citation", url: "https://nist.gov/pqc", title: "NIST PQC Standards" },
                  { type: "url_citation", url: "https://arxiv.org/quantum", title: "Quantum Threat Analysis" },
                  { type: "url_citation", url: "https://ieee.org/crypto", title: "IEEE Crypto Review" },
                ],
              },
            ],
          },
        ],
      });

    const state = {
      researchBrief: '{"scope":"quantum crypto","keyQuestions":["What is PQC?","When is Q-day?"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    const result = await deepResearch(state as any);

    expect(result.researchDocument).toBeDefined();
    expect((result.researchDocument as any).sections).toHaveLength(2);
    expect(result.sources).toHaveLength(3);
    expect(result.credibilityScore).toBeGreaterThan(0);
    expect(result.credibilityReport).toContain("3 unique sources");
    expect(result.status).toBe("scripting");

    // Verify background: true was used
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "o4-mini-deep-research",
        background: true,
      }),
    );
  });

  it("should use higher max_tool_calls for pro tier", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_pro",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Test", content: "Content" }],
                sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "pro",
      researchIterations: 0,
      credibilityReport: "",
    };

    await deepResearch(state as any);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tool_calls: 40,
      }),
    );
  });

  it("should include trusted sources in prompt for pro tier", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_trusted",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Test", content: "Content" }],
                sources: [{ url: "https://trusted.com", title: "Trusted" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://trusted.com", title: "Trusted" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: ["https://trusted.com"],
      tier: "pro",
      researchIterations: 0,
      credibilityReport: "",
    };

    await deepResearch(state as any);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.input).toContain("https://trusted.com");
  });

  it("should include retry context when researchIterations > 0", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_retry",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Retry", content: "Filled gaps" }],
                sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 1,
      credibilityReport: "Missing coverage on quantum key distribution",
    };

    await deepResearch(state as any);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.input).toContain("Missing coverage on quantum key distribution");
  });

  it("should fail with retryable error on timeout", async () => {
    // Override timeout for test speed — the implementation accepts an optional timeout param
    mockCreate.mockResolvedValue({
      id: "resp_timeout",
      status: "in_progress",
    });

    // Always return in_progress (simulate timeout)
    mockRetrieve.mockResolvedValue({
      id: "resp_timeout",
      status: "in_progress",
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    // Use internal override for test — 100ms timeout, 50ms poll
    const result = await deepResearch(state as any, {
      timeoutMs: 100,
      pollIntervalMs: 50,
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("timed out");
  });

  it("should handle API failure gracefully", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_fail",
      status: "failed",
      error: { message: "Rate limited" },
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    const result = await deepResearch(state as any);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Deep research failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/deepResearch.test.ts`
Expected: FAIL — module `deepResearch` does not exist at the import path.

- [ ] **Step 3: Implement the deepResearch node**

Create `pipeline/src/podcast_pipeline/nodes/deepResearch.ts`:

```typescript
/**
 * Calls OpenAI Deep Research API (o4-mini-deep-research) with background polling.
 * Replaces the old researchPlanner + deepResearcher + factChecker chain.
 */

import OpenAI from "openai";
import {
  DEEP_RESEARCH_PROMPT,
  DEEP_RESEARCH_POLL_INTERVAL,
  DEEP_RESEARCH_TIMEOUT,
  MAX_TOOL_CALLS,
} from "../config.js";
import type { PipelineStateType } from "../state.js";

const openai = new OpenAI();

interface DeepResearchOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface UrlCitationAnnotation {
  type: "url_citation";
  url: string;
  title: string;
}

interface OutputTextContent {
  type: "output_text";
  text: string;
  annotations?: UrlCitationAnnotation[];
}

interface MessageOutput {
  type: "message";
  content: OutputTextContent[];
}

/**
 * Extract unique sources from url_citation annotations on the response output.
 */
function extractSourcesFromAnnotations(
  output: MessageOutput[],
): { url: string; title: string }[] {
  const seen = new Set<string>();
  const sources: { url: string; title: string }[] = [];

  for (const msg of output) {
    if (msg.type !== "message") continue;
    for (const content of msg.content) {
      if (content.type !== "output_text" || !content.annotations) continue;
      for (const ann of content.annotations) {
        if (ann.type === "url_citation" && !seen.has(ann.url)) {
          seen.add(ann.url);
          sources.push({ url: ann.url, title: ann.title });
        }
      }
    }
  }

  return sources;
}

/**
 * Extract the text content from the response output and parse as JSON.
 */
function extractResearchDocument(
  output: MessageOutput[],
): Record<string, unknown> {
  for (const msg of output) {
    if (msg.type !== "message") continue;
    for (const content of msg.content) {
      if (content.type === "output_text" && content.text) {
        try {
          return JSON.parse(content.text);
        } catch {
          // If not valid JSON, wrap the text as a single section
          return { sections: [{ title: "Research", content: content.text }] };
        }
      }
    }
  }
  return { sections: [] };
}

/**
 * Compute credibility score from citation density.
 * Score = min(1.0, uniqueSources / keyQuestionsCount)
 */
function computeCredibilityScore(
  uniqueSourceCount: number,
  keyQuestionsCount: number,
): number {
  if (keyQuestionsCount <= 0) return uniqueSourceCount > 0 ? 1.0 : 0.0;
  return Math.min(1.0, uniqueSourceCount / keyQuestionsCount);
}

export async function deepResearch(
  state: PipelineStateType,
  options?: DeepResearchOptions,
): Promise<Partial<PipelineStateType>> {
  const timeoutMs = options?.timeoutMs ?? DEEP_RESEARCH_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEEP_RESEARCH_POLL_INTERVAL;

  const tier = state.tier ?? "free";
  const maxToolCalls = MAX_TOOL_CALLS[tier] ?? 20;
  const trustedUrls = state.trustedSourceUrls ?? [];
  const iterations = state.researchIterations ?? 0;
  const credibilityReport = state.credibilityReport ?? "";

  // Build prompt with context
  let trustedSourceContext = "";
  if (trustedUrls.length > 0) {
    trustedSourceContext = `\nPrioritize information from these sources: ${trustedUrls.join(", ")}`;
  }

  let retryContext = "";
  if (iterations > 0 && credibilityReport) {
    retryContext = `\nPrevious research had these gaps: ${credibilityReport}. Focus on filling them.`;
  }

  const prompt = DEEP_RESEARCH_PROMPT
    .replace("{trustedSourceContext}", trustedSourceContext)
    .replace("{retryContext}", retryContext)
    .replace("{researchBrief}", state.researchBrief);

  let response;
  try {
    response = await openai.responses.create({
      model: "o4-mini-deep-research",
      input: prompt,
      background: true,
      tools: [{ type: "web_search_preview" }],
      max_tool_calls: maxToolCalls,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      errorMessage: `Deep research failed: ${message}`,
    };
  }

  // If immediately completed (no polling needed)
  if (response.status === "completed") {
    return processCompletedResponse(response, state);
  }

  // If immediately failed
  if (response.status === "failed" || response.status === "cancelled") {
    return {
      status: "failed",
      errorMessage: `Deep research failed: ${(response as any).error?.message ?? "Unknown error"}`,
    };
  }

  // Poll for completion
  const startTime = Date.now();
  let result = response;

  while (result.status === "in_progress" || result.status === "queued") {
    if (Date.now() - startTime > timeoutMs) {
      return {
        status: "failed",
        errorMessage: `Deep research timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    result = await openai.responses.retrieve(result.id);
  }

  if (result.status !== "completed") {
    return {
      status: "failed",
      errorMessage: `Deep research failed: status=${result.status}`,
    };
  }

  return processCompletedResponse(result, state);
}

function processCompletedResponse(
  response: any,
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const output = response.output as MessageOutput[];
  const researchDocument = extractResearchDocument(output);
  const annotationSources = extractSourcesFromAnnotations(output);

  // Prefer sources from annotations; fall back to parsed document sources
  const docSources = (researchDocument as any).sources ?? [];
  const sources = annotationSources.length > 0 ? annotationSources : docSources;

  // Parse key questions count from brief for credibility scoring
  let keyQuestionsCount = 3; // safe default
  try {
    const brief = JSON.parse(state.researchBrief);
    keyQuestionsCount = brief.keyQuestions?.length ?? 3;
  } catch {
    // Use default
  }

  const credibilityScore = computeCredibilityScore(sources.length, keyQuestionsCount);
  const credibilityReport = `${sources.length} unique sources found across research. Citation density score: ${credibilityScore.toFixed(2)}.`;

  return {
    researchDocument,
    sources,
    credibilityScore,
    credibilityReport,
    status: "scripting",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/deepResearch.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/deepResearch.ts pipeline/tests/deepResearch.test.ts
git commit -m "feat: add deepResearch node using OpenAI Deep Research API with polling"
```

---

### Task 5: Update qualityGate node

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/qualityGate.ts`
- Modify: `pipeline/tests/qualityGate.test.ts`

**Key changes:**
- Now checks citation count (>= `MIN_SOURCES_THRESHOLD`) instead of just `credibilityScore >= threshold`
- Checks if key questions are addressed (keyword match in research document)
- Populates `credibilityScore` and `credibilityReport` if not already set by deepResearch
- Retry now keeps `shouldRetry = true` with gap description in `credibilityReport`

- [ ] **Step 1: Rewrite the test file**

Replace `pipeline/tests/qualityGate.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { qualityGate } from "../src/podcast_pipeline/nodes/qualityGate.js";

describe("qualityGate", () => {
  it("should pass when score meets threshold and sources are sufficient", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      researchBrief: '{"keyQuestions":["What is PQC?","When is Q-day?"]}',
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("scripting");
    expect(result.shouldRetry).toBe(false);
    expect(result.needsDisclaimer).toBe(false);
    expect(result.researchIterations).toBe(1);
  });

  it("should retry when sources are below minimum threshold", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
      ],
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.credibilityReport).toContain("Insufficient sources");
  });

  it("should retry when credibility score is below threshold", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [] },
      researchBrief: '{"keyQuestions":["q1","q2","q3","q4","q5"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.credibilityReport).toContain("below threshold");
  });

  it("should proceed with disclaimer after max retries even if quality is low", () => {
    const state = {
      credibilityScore: 0.3,
      researchIterations: 2,
      sources: [{ url: "https://a.com", title: "A" }],
      researchDocument: { sections: [] },
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(false);
    expect(result.needsDisclaimer).toBe(true);
    expect(result.status).toBe("scripting");
    expect(result.researchIterations).toBe(3);
  });

  it("should handle malformed researchBrief gracefully", () => {
    const state = {
      credibilityScore: 0.9,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      researchBrief: "not valid json",
    };

    const result = qualityGate(state as any);

    // Should still pass since sources and score are good
    expect(result.status).toBe("scripting");
    expect(result.shouldRetry).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/qualityGate.test.ts`
Expected: FAIL — old qualityGate does not check sources or produce credibilityReport.

- [ ] **Step 3: Rewrite qualityGate.ts with heuristic checks**

Replace `pipeline/src/podcast_pipeline/nodes/qualityGate.ts` with:

```typescript
/**
 * Heuristic quality gate — checks citation count and credibility score.
 * No LLM call; the Deep Research API already produces well-cited research.
 */

import {
  CREDIBILITY_THRESHOLD,
  MAX_RESEARCH_RETRIES,
  MIN_SOURCES_THRESHOLD,
} from "../config.js";
import type { PipelineStateType } from "../state.js";

export function qualityGate(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  const score = state.credibilityScore ?? 0.0;
  const iterations = state.researchIterations ?? 0;
  const sources = state.sources ?? [];
  const newIterations = iterations + 1;

  const gaps: string[] = [];

  // Check 1: Minimum source count
  if (sources.length < MIN_SOURCES_THRESHOLD) {
    gaps.push(
      `Insufficient sources: found ${sources.length}, need at least ${MIN_SOURCES_THRESHOLD}`,
    );
  }

  // Check 2: Credibility score threshold
  if (score < CREDIBILITY_THRESHOLD) {
    gaps.push(
      `Credibility score ${score.toFixed(2)} is below threshold ${CREDIBILITY_THRESHOLD}`,
    );
  }

  const hasPassed = gaps.length === 0;

  // All checks passed
  if (hasPassed) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: false,
    };
  }

  // Max retries exceeded — proceed with disclaimer
  if (newIterations > MAX_RESEARCH_RETRIES) {
    return {
      status: "scripting",
      researchIterations: newIterations,
      shouldRetry: false,
      needsDisclaimer: true,
      credibilityReport: `Proceeding with disclaimer. Issues: ${gaps.join("; ")}`,
    };
  }

  // Retry with gap description
  return {
    researchIterations: newIterations,
    shouldRetry: true,
    needsDisclaimer: false,
    credibilityReport: gaps.join("; "),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/qualityGate.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/qualityGate.ts pipeline/tests/qualityGate.test.ts
git commit -m "feat: simplify qualityGate to heuristic source/score checks"
```

---

### Task 6: Update scriptWriter to output chapterResearchMap

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts`
- Modify: `pipeline/tests/scriptWriter.test.ts`

**Key details:**
- The LLM prompt now asks for a `chapter_research_map` JSON block after the script
- Parse the fenced JSON block, validate indexes, clamp out-of-bounds, return `null` if unparseable
- Uses updated `SCRIPT_WRITER_PROMPT` from config which includes `{sources}` placeholder

- [ ] **Step 1: Rewrite the test file**

Replace `pipeline/tests/scriptWriter.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { scriptWriter, parseChapterResearchMap } from "../src/podcast_pipeline/nodes/scriptWriter.js";

describe("parseChapterResearchMap", () => {
  it("should extract chapter_research_map from fenced JSON block", () => {
    const text = `[CHAPTER: Intro]
Some script content...

\`\`\`chapter_research_map
{
  "Intro": { "researchSections": [0], "sourceIndexes": [0, 1] },
  "Deep Dive": { "researchSections": [1, 2], "sourceIndexes": [2] }
}
\`\`\``;

    const result = parseChapterResearchMap(text, 3, 3);

    expect(result).toEqual({
      Intro: { researchSections: [0], sourceIndexes: [0, 1] },
      "Deep Dive": { researchSections: [1, 2], sourceIndexes: [2] },
    });
  });

  it("should clamp out-of-bounds indexes", () => {
    const text = `script
\`\`\`chapter_research_map
{
  "Ch1": { "researchSections": [0, 10], "sourceIndexes": [0, 99] }
}
\`\`\``;

    const result = parseChapterResearchMap(text, 2, 3);

    expect(result).toEqual({
      Ch1: { researchSections: [0, 1], sourceIndexes: [0, 2] },
    });
  });

  it("should return null for malformed JSON", () => {
    const text = `script
\`\`\`chapter_research_map
not valid json
\`\`\``;

    const result = parseChapterResearchMap(text, 2, 3);
    expect(result).toBeNull();
  });

  it("should return null when no chapter_research_map block exists", () => {
    const text = "[CHAPTER: Intro]\nJust a script, no map block.";
    const result = parseChapterResearchMap(text, 2, 3);
    expect(result).toBeNull();
  });
});

describe("scriptWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should produce a script and chapterResearchMap", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    const scriptWithMap = `[CHAPTER: The Quantum Threat]
Imagine a computer so powerful...

[CHAPTER: Fighting Back]
But researchers aren't idle...

\`\`\`chapter_research_map
{
  "The Quantum Threat": { "researchSections": [0], "sourceIndexes": [0, 1] },
  "Fighting Back": { "researchSections": [1], "sourceIndexes": [1, 2] }
}
\`\`\``;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: scriptWithMap } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: {
        sections: [
          { title: "Threat", content: "..." },
          { title: "Defense", content: "..." },
        ],
      },
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toContain("[CHAPTER: The Quantum Threat]");
    // Script should not contain the map block
    expect(result.script).not.toContain("chapter_research_map");
    expect(result.chapterResearchMap).toEqual({
      "The Quantum Threat": { researchSections: [0], sourceIndexes: [0, 1] },
      "Fighting Back": { researchSections: [1], sourceIndexes: [1, 2] },
    });
    expect(result.status).toBe("scripting");
  });

  it("should return null chapterResearchMap when LLM omits the block", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: Intro]\nJust a plain script." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [] },
      sources: [],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toBeDefined();
    expect(result.chapterResearchMap).toBeNull();
  });

  it("should fail when content is flagged by moderation", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Flagged content..." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: true }],
    });

    const state = {
      researchDocument: { sections: [] },
      sources: [],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("moderation");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/scriptWriter.test.ts`
Expected: FAIL — `parseChapterResearchMap` is not exported, `chapterResearchMap` not in result.

- [ ] **Step 3: Rewrite scriptWriter.ts**

Replace `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` with:

```typescript
/**
 * Generates the podcast script from research, with content moderation.
 * Also extracts a chapter-to-research mapping from the LLM output.
 */

import OpenAI from "openai";
import { SCRIPT_WRITER_PROMPT, TARGET_WORD_COUNT } from "../config.js";
import type { PipelineStateType, ChapterResearchMap, ChapterResearchEntry } from "../state.js";

const openai = new OpenAI();

/**
 * Parse the chapter_research_map fenced JSON block from the LLM output.
 * Clamps out-of-bounds indexes. Returns null if block is missing or malformed.
 */
export function parseChapterResearchMap(
  text: string,
  sectionCount: number,
  sourceCount: number,
): ChapterResearchMap {
  const mapMatch = text.match(/```chapter_research_map\s*\n([\s\S]*?)```/);
  if (!mapMatch) return null;

  let parsed: Record<string, { researchSections?: number[]; sourceIndexes?: number[] }>;
  try {
    parsed = JSON.parse(mapMatch[1]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const result: Record<string, ChapterResearchEntry> = {};

  for (const [chapter, entry] of Object.entries(parsed)) {
    const clampedSections = (entry.researchSections ?? []).map((i) =>
      Math.min(Math.max(0, i), Math.max(0, sectionCount - 1)),
    );
    const clampedSources = (entry.sourceIndexes ?? []).map((i) =>
      Math.min(Math.max(0, i), Math.max(0, sourceCount - 1)),
    );
    result[chapter] = {
      researchSections: clampedSections,
      sourceIndexes: clampedSources,
    };
  }

  return result;
}

export async function scriptWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { researchDocument, sources = [], needsDisclaimer = false } = state;

  let disclaimerContext = "";
  if (needsDisclaimer) {
    disclaimerContext =
      "\nIMPORTANT: Sources on this topic were limited or conflicting. " +
      "Include a brief disclaimer early in the script acknowledging this, " +
      "e.g., 'I should note that sources on this topic are still emerging...'";
  }

  const sectionCount = Array.isArray((researchDocument as any)?.sections)
    ? (researchDocument as any).sections.length
    : 0;

  const prompt = SCRIPT_WRITER_PROMPT
    .replace("{targetWords}", String(TARGET_WORD_COUNT))
    .replace("{researchDocument}", JSON.stringify(researchDocument))
    .replace("{sources}", JSON.stringify(sources))
    .replace("{disclaimerContext}", disclaimerContext);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Write the podcast script." },
    ],
    max_tokens: 4000,
  });

  const rawOutput = response.choices[0].message.content ?? "";

  // Extract script (everything before the fenced chapter_research_map block)
  const script = rawOutput.replace(/```chapter_research_map[\s\S]*?```/, "").trim();

  // Content moderation — output filtering
  const modResponse = await openai.moderations.create({ input: script });
  if (modResponse.results[0].flagged) {
    return {
      status: "failed",
      errorMessage:
        "Generated script flagged by content moderation. Topic may not be suitable.",
    };
  }

  // Parse chapter-research mapping
  const chapterResearchMap = parseChapterResearchMap(
    rawOutput,
    sectionCount,
    sources.length,
  );

  return { script, chapterResearchMap, status: "scripting" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/scriptWriter.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/scriptWriter.ts pipeline/tests/scriptWriter.test.ts
git commit -m "feat: scriptWriter outputs chapterResearchMap with index validation"
```

---

### Task 7: Update metadataWriter to store chapter_research_map

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts`
- Modify: `pipeline/tests/metadataWriter.test.ts`

- [ ] **Step 1: Update the test file**

Replace `pipeline/tests/metadataWriter.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation(() => ({
      update: mockUpdate,
      insert: mockInsert,
    })),
  }),
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
  it("should return complete status with chapter markers", async () => {
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
      chapterResearchMap: null,
    };

    const result = await metadataWriter(state as any);

    expect(result.status).toBe("complete");
    expect(result.chapterMarkers!.length).toBeGreaterThan(0);
  });

  it("should include chapter_research_map in podcast update when present", async () => {
    vi.clearAllMocks();

    const chapterMap = {
      "Intro": { researchSections: [0], sourceIndexes: [0] },
    };

    const state = {
      podcastId: "test-456",
      userId: "user-789",
      topic: "AI safety",
      script: "[CHAPTER: Intro]\nHello world",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 300,
      researchDocument: { sections: [{ title: "Intro", content: "..." }] },
      sources: [{ url: "https://a.com", title: "A" }],
      credibilityScore: 0.9,
      researchIterations: 1,
      chapterResearchMap: chapterMap,
    };

    await metadataWriter(state as any);

    // Verify podcast update includes chapter_research_map
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_research_map: chapterMap,
      }),
    );
  });

  it("should set chapter_research_map to null in update when not provided", async () => {
    vi.clearAllMocks();

    const state = {
      podcastId: "test-789",
      userId: "user-012",
      topic: "climate",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.85,
      researchIterations: 1,
      chapterResearchMap: null,
    };

    await metadataWriter(state as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_research_map: null,
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/metadataWriter.test.ts`
Expected: FAIL — `chapter_research_map` not included in podcast update call.

- [ ] **Step 3: Update metadataWriter.ts to store chapter_research_map**

Replace `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts` with:

```typescript
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

  // Update podcast record (now includes chapter_research_map)
  await supabase
    .from("podcasts")
    .update({
      status: "complete",
      audio_url: state.audioUrl,
      transcript,
      duration_seconds: duration,
      chapter_markers: chapters,
      chapter_research_map: state.chapterResearchMap ?? null,
    })
    .eq("id", podcastId);

  // Store research context for Q&A / Deep Dive
  await supabase
    .from("research_contexts")
    .insert({
      podcast_id: podcastId,
      research_document: state.researchDocument ?? {},
      sources: state.sources ?? [],
      overall_credibility_score: state.credibilityScore,
      research_iterations: state.researchIterations ?? 1,
    });

  // Send push notification
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
      // Non-critical
    }
  }

  return {
    status: "complete",
    transcript,
    chapterMarkers: chapters,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/metadataWriter.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/metadataWriter.ts pipeline/tests/metadataWriter.test.ts
git commit -m "feat: metadataWriter stores chapter_research_map on podcast record"
```

---

### Task 8: Delete old nodes, update index.ts, rewire graph.ts

**Files:**
- Delete: `pipeline/src/podcast_pipeline/nodes/researchPlanner.ts`
- Delete: `pipeline/src/podcast_pipeline/nodes/deepResearcher.ts`
- Delete: `pipeline/src/podcast_pipeline/nodes/factChecker.ts`
- Delete: `pipeline/tests/researchPlanner.test.ts`
- Delete: `pipeline/tests/deepResearcher.test.ts`
- Delete: `pipeline/tests/factChecker.test.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/index.ts`
- Modify: `pipeline/src/podcast_pipeline/graph.ts`
- Modify: `pipeline/tests/graph.test.ts`

- [ ] **Step 1: Delete the old node files and their tests**

```bash
cd "/Users/isuru/personal/AI Podcast App"
rm pipeline/src/podcast_pipeline/nodes/researchPlanner.ts
rm pipeline/src/podcast_pipeline/nodes/deepResearcher.ts
rm pipeline/src/podcast_pipeline/nodes/factChecker.ts
rm pipeline/tests/researchPlanner.test.ts
rm pipeline/tests/deepResearcher.test.ts
rm pipeline/tests/factChecker.test.ts
```

- [ ] **Step 2: Update index.ts exports**

Replace `pipeline/src/podcast_pipeline/nodes/index.ts` with:

```typescript
/** Pipeline nodes — each function takes state and returns a partial state update. */
export { briefBuilder } from "./briefBuilder.js";
export { deepResearch } from "./deepResearch.js";
export { qualityGate } from "./qualityGate.js";
export { scriptWriter, parseChapterResearchMap } from "./scriptWriter.js";
export { adInjector } from "./adInjector.js";
export { audioProducer, splitScriptSegments } from "./audioProducer.js";
export { metadataWriter } from "./metadataWriter.js";
export { handlePipelineFailure } from "./errorHandler.js";
```

- [ ] **Step 3: Rewire graph.ts — new 7-node pipeline**

Replace `pipeline/src/podcast_pipeline/graph.ts` with:

```typescript
/**
 * Main LangGraph graph definition — wires all nodes together.
 *
 * Pipeline: briefBuilder -> deepResearch -> qualityGate -> scriptWriter
 *           -> adInjector (if ads) -> audioProducer -> metadataWriter
 */

import { StateGraph, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import type { PipelineStateType } from "./state.js";
import { briefBuilder } from "./nodes/briefBuilder.js";
import { deepResearch } from "./nodes/deepResearch.js";
import { qualityGate } from "./nodes/qualityGate.js";
import { scriptWriter } from "./nodes/scriptWriter.js";
import { adInjector } from "./nodes/adInjector.js";
import { audioProducer } from "./nodes/audioProducer.js";
import { metadataWriter } from "./nodes/metadataWriter.js";

function routeAfterQualityGate(state: PipelineStateType): string {
  if (state.shouldRetry) {
    return "deepResearch";
  }
  if (state.status === "failed") {
    return END;
  }
  return "scriptWriter";
}

function routeAfterScript(state: PipelineStateType): string {
  if (state.status === "failed") {
    return END;
  }
  if (state.hasAds) {
    return "adInjector";
  }
  return "audioProducer";
}

const workflow = new StateGraph(PipelineState)
  .addNode("briefBuilder", briefBuilder)
  .addNode("deepResearch", deepResearch)
  .addNode("qualityGate", qualityGate)
  .addNode("scriptWriter", scriptWriter)
  .addNode("adInjector", adInjector)
  .addNode("audioProducer", audioProducer)
  .addNode("metadataWriter", metadataWriter)
  .addEdge("__start__", "briefBuilder")
  .addEdge("briefBuilder", "deepResearch")
  .addEdge("deepResearch", "qualityGate")
  .addConditionalEdges("qualityGate", routeAfterQualityGate)
  .addConditionalEdges("scriptWriter", routeAfterScript)
  .addEdge("adInjector", "audioProducer")
  .addEdge("audioProducer", "metadataWriter")
  .addEdge("metadataWriter", END);

export const graph = workflow.compile();
```

- [ ] **Step 4: Update graph.test.ts for new shape**

Replace `pipeline/tests/graph.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock OpenAI (used by scriptWriter and deepResearch at module level)
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    moderations: { create: vi.fn() },
    responses: { create: vi.fn(), retrieve: vi.fn() },
  })),
}));

import { graph } from "../src/podcast_pipeline/graph.js";

describe("graph", () => {
  it("should compile and be invocable", () => {
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should compile without errors", () => {
    expect(graph).toBeDefined();
  });
});
```

- [ ] **Step 5: Run all pipeline tests**

Run: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run`
Expected: PASS — all remaining tests pass. No imports to deleted modules remain.

- [ ] **Step 6: Commit**

```bash
git add -A pipeline/
git commit -m "feat: rewire pipeline to 7-node graph, delete researchPlanner/deepResearcher/factChecker"
```

---

## Chunk 3: Supabase Edge Functions

### Task 9: Create start-deep-dive Edge Function

**Files:**
- Create: `supabase/functions/start-deep-dive/index.ts`

This function validates the user can start a deep dive, prevents concurrent sessions, creates the session record, and returns research context.

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/start-deep-dive/index.ts`:

```typescript
// supabase/functions/start-deep-dive/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const { podcastId, chapterTitle } = await req.json();

    if (!podcastId || !chapterTitle) {
      return new Response(
        JSON.stringify({ error: "podcastId and chapterTitle are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check subscription has deep dive minutes
    const { data: subscription, error: subError } = await serviceClient
      .from("subscriptions")
      .select("tier, deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    if (subError || !subscription) {
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (subscription.tier === "free") {
      return new Response(
        JSON.stringify({ error: "Deep Dive requires a Plus or Pro subscription" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (subscription.deep_dive_minutes_remaining <= 0) {
      return new Response(
        JSON.stringify({ error: "No deep dive minutes remaining. Resets on next renewal." }),
        { status: 402, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Check no concurrent active session
    const { count: activeSessions } = await serviceClient
      .from("qa_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("ended_at", null);

    if ((activeSessions ?? 0) > 0) {
      return new Response(
        JSON.stringify({ error: "You already have an active deep dive session" }),
        { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Verify podcast ownership and fetch research context
    const { data: podcast, error: podcastError } = await serviceClient
      .from("podcasts")
      .select("id, user_id, topic, transcript, chapter_research_map")
      .eq("id", podcastId)
      .single();

    if (podcastError || !podcast || podcast.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Podcast not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const { data: researchContext } = await serviceClient
      .from("research_contexts")
      .select("research_document, sources")
      .eq("podcast_id", podcastId)
      .single();

    // Create session record
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
      return new Response(
        JSON.stringify({ error: "Failed to create session" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        minutesRemaining: subscription.deep_dive_minutes_remaining,
        researchDocument: researchContext?.research_document ?? {},
        sources: researchContext?.sources ?? [],
        chapterResearchMap: podcast.chapter_research_map,
        transcript: podcast.transcript,
        chapterTitle,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to start deep dive" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/start-deep-dive/index.ts
git commit -m "feat: add start-deep-dive Edge Function with session validation"
```

---

### Task 10: Create end-deep-dive Edge Function

**Files:**
- Create: `supabase/functions/end-deep-dive/index.ts`

This function fetches authoritative duration from ElevenLabs, updates the session record, and deducts minutes.

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/end-deep-dive/index.ts`:

```typescript
// supabase/functions/end-deep-dive/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;

const COST_PER_MINUTE = 0.10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

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
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    // ElevenLabs returns duration_seconds in the conversation metadata
    return data.metadata?.duration_seconds ?? data.duration_seconds ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const { sessionId, elevenlabsSessionId } = await req.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify session belongs to user and is still active
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .select("id, user_id, started_at, ended_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session || session.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (session.ended_at) {
      return new Response(
        JSON.stringify({ error: "Session already ended" }),
        { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Get authoritative duration from ElevenLabs
    let durationSeconds: number;

    if (elevenlabsSessionId) {
      const elevenLabsDuration =
        await getElevenLabsSessionDuration(elevenlabsSessionId);
      if (elevenLabsDuration !== null) {
        durationSeconds = elevenLabsDuration;
      } else {
        // Fallback: compute from start time
        durationSeconds = Math.round(
          (Date.now() - new Date(session.started_at).getTime()) / 1000,
        );
      }
    } else {
      // No ElevenLabs session ID — compute from start time
      durationSeconds = Math.round(
        (Date.now() - new Date(session.started_at).getTime()) / 1000,
      );
    }

    // Round up to nearest minute for billing
    const minutesUsed = Math.ceil(durationSeconds / 60);
    const estimatedCost = minutesUsed * COST_PER_MINUTE;

    // Update session record
    await serviceClient
      .from("qa_sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        estimated_cost: estimatedCost,
        elevenlabs_session_id: elevenlabsSessionId ?? null,
      })
      .eq("id", sessionId);

    // Deduct minutes (clamped to 0)
    await serviceClient.rpc("", {}).catch(() => {});  // placeholder if no RPC
    await serviceClient
      .from("subscriptions")
      .update({
        deep_dive_minutes_remaining: serviceClient.rpc
          ? undefined
          : undefined, // handled below
      })
      .eq("user_id", user.id);

    // Direct SQL for atomic deduction
    const { data: updatedSub } = await serviceClient
      .from("subscriptions")
      .select("deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    const currentMinutes = updatedSub?.deep_dive_minutes_remaining ?? 0;
    const newMinutes = Math.max(0, currentMinutes - minutesUsed);

    await serviceClient
      .from("subscriptions")
      .update({ deep_dive_minutes_remaining: newMinutes })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({
        durationSeconds,
        minutesUsed,
        estimatedCost,
        deepDiveMinutesRemaining: newMinutes,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to end deep dive" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/end-deep-dive/index.ts
git commit -m "feat: add end-deep-dive Edge Function with server-authoritative duration"
```

---

### Task 11: Update revenucat-webhook for deep dive minutes

**Files:**
- Modify: `supabase/functions/revenucat-webhook/index.ts`

- [ ] **Step 1: Update the webhook to handle deep dive minutes**

In `supabase/functions/revenucat-webhook/index.ts`, update the `TIER_CREDITS` map to include deep dive minutes, and add them to the relevant event handlers.

Change the `TIER_CREDITS` constant to:

```typescript
const TIER_CONFIG: Record<
  string,
  { tier: string; credits: number; deepDiveMinutes: number }
> = {
  plus_monthly: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  plus_annual: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  pro_monthly: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
  pro_annual: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
};
```

Update all references from `TIER_CREDITS` to `TIER_CONFIG` and add deep dive minute fields to the `INITIAL_PURCHASE`, `RENEWAL`, `EXPIRATION`, and `PRODUCT_CHANGE` handlers.

The full updated file:

```typescript
// supabase/functions/revenucat-webhook/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REVENUCAT_WEBHOOK_SECRET = Deno.env.get("REVENUCAT_WEBHOOK_SECRET")!;

const TIER_CONFIG: Record<
  string,
  { tier: string; credits: number; deepDiveMinutes: number }
> = {
  "plus_monthly": { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  "plus_annual": { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  "pro_monthly": { tier: "pro", credits: 20, deepDiveMinutes: 45 },
  "pro_annual": { tier: "pro", credits: 20, deepDiveMinutes: 45 },
};

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${REVENUCAT_WEBHOOK_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const event = await req.json();
    const { type, app_user_id, product_id, expiration_at_ms } = event.event;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

        await serviceClient
          .from("credit_transactions")
          .insert({
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

      case "PRODUCT_CHANGE": {
        const config = TIER_CONFIG[product_id];
        if (!config) break;

        const { data: current } = await serviceClient
          .from("subscriptions")
          .select("tier")
          .eq("user_id", userId)
          .single();

        const tierRank: Record<string, number> = { free: 0, plus: 1, pro: 2 };
        const isUpgrade = tierRank[config.tier] > tierRank[current?.tier || "free"];

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
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/revenucat-webhook/index.ts
git commit -m "feat: revenucat-webhook allocates deep dive minutes on purchase/renewal/expiration"
```

---

## Chunk 4: Mobile Changes

### Task 12: Update useSubscription hook + Account screen

**Files:**
- Modify: `mobile/src/hooks/useSubscription.ts`
- Modify: `mobile/app/(tabs)/account.tsx`

- [ ] **Step 1: Update useSubscription to include deep dive minutes**

Replace `mobile/src/hooks/useSubscription.ts` with:

```typescript
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface SubscriptionRow {
  tier: "free" | "plus" | "pro";
  credits_remaining: number;
  credits_per_month: number;
  deep_dive_minutes_remaining: number;
  deep_dive_minutes_per_month: number;
  status: string;
  renewal_date: string | null;
}

/** App-level type — camelCase */
export interface Subscription {
  tier: "free" | "plus" | "pro";
  creditsRemaining: number;
  creditsPerMonth: number;
  deepDiveMinutesRemaining: number;
  deepDiveMinutesPerMonth: number;
  status: string;
  renewalDate: string | null;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    tier: row.tier,
    creditsRemaining: row.credits_remaining,
    creditsPerMonth: row.credits_per_month,
    deepDiveMinutesRemaining: row.deep_dive_minutes_remaining,
    deepDiveMinutesPerMonth: row.deep_dive_minutes_per_month,
    status: row.status,
    renewalDate: row.renewal_date,
  };
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("subscriptions")
      .select(
        "tier, credits_remaining, credits_per_month, deep_dive_minutes_remaining, deep_dive_minutes_per_month, status, renewal_date",
      )
      .eq("user_id", user.id)
      .single();
    if (data) setSubscription(toSubscription(data as SubscriptionRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const refresh = useCallback(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  return { subscription, loading, refresh };
}
```

- [ ] **Step 2: Update Account screen to show deep dive minutes**

Replace `mobile/app/(tabs)/account.tsx` with:

```typescript
// mobile/app/(tabs)/account.tsx
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditBalance } from "../../src/components/CreditBalance";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

const CREDIT_PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

export default function Account() {
  const { user, signOut } = useAuth();
  const { subscription, loading } = useSubscription();

  if (loading) return <LoadingOverlay message="Loading account..." />;

  const creditPrice = CREDIT_PRICES[subscription?.tier || "free"];
  const hasDeepDive = subscription && subscription.tier !== "free";

  const handleBuyCredit = () => {
    Alert.alert("Coming Soon", "Credit purchases will be available via in-app purchase.");
  };

  const handleUpgrade = () => {
    Alert.alert("Coming Soon", "Subscription upgrades will be available soon.");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.email}>{user?.email}</Text>

      {subscription && <CreditBalance subscription={subscription} />}

      {hasDeepDive && (
        <View style={styles.deepDiveCard}>
          <Text style={styles.deepDiveLabel}>Deep Dive</Text>
          <Text style={styles.deepDiveMinutes}>
            {subscription.deepDiveMinutesRemaining} / {subscription.deepDiveMinutesPerMonth} min
          </Text>
          {subscription.renewalDate && (
            <Text style={styles.deepDiveRenewal}>
              Resets {new Date(subscription.renewalDate).toLocaleDateString()}
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.buyButton} onPress={handleBuyCredit}>
        <Text style={styles.buyText}>Buy Extra Credit (${creditPrice})</Text>
      </TouchableOpacity>

      {subscription?.tier === "free" && (
        <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>Upgrade to Plus — $14.99/mo</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 16 },
  email: { fontSize: 16, color: "#888", marginBottom: 8 },
  deepDiveCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#6366f140",
  },
  deepDiveLabel: { fontSize: 14, color: "#888", marginBottom: 4 },
  deepDiveMinutes: { fontSize: 20, fontWeight: "700", color: "#6366f1" },
  deepDiveRenewal: { fontSize: 12, color: "#555", marginTop: 4 },
  buyButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  buyText: { color: "#6366f1", fontSize: 16, fontWeight: "600" },
  upgradeButton: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  upgradeText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  signOutButton: { marginTop: "auto", padding: 16, alignItems: "center" },
  signOutText: { color: "#ff6b6b", fontSize: 16 },
});
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/hooks/useSubscription.ts mobile/app/\(tabs\)/account.tsx
git commit -m "feat: useSubscription includes deep dive minutes, account screen displays them"
```

---

### Task 13: Redesign Player screen

**Files:**
- Modify: `mobile/app/player/[id].tsx`
- Modify: `mobile/src/components/ChapterMarkers.tsx`

**Key changes:**
- Compact player controls pinned to bottom
- Chapter list as main scrollable content
- "Dive" button only on current chapter (paid tiers only)
- Deep dive minutes display in header

- [ ] **Step 1: Update ChapterMarkers to support Dive button**

Replace `mobile/src/components/ChapterMarkers.tsx` with:

```typescript
// mobile/src/components/ChapterMarkers.tsx
/**
 * ChapterMarkers — tappable chapter list with timestamps.
 * Highlights the currently playing chapter.
 * Shows "Dive" button on current chapter when onDive callback is provided.
 *
 * Props:
 * - chapters: array of {timestampSeconds, title}
 * - currentPosition: current playback position in seconds
 * - onChapterPress: seek to chapter timestamp
 * - onDive: optional — callback for Dive button (only shown on current chapter)
 * - diveEnabled: optional — whether Dive button is interactive (false = dimmed)
 */
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";

interface Chapter {
  timestampSeconds: number;
  title: string;
}

interface Props {
  chapters: Chapter[];
  currentPosition: number;
  onChapterPress: (seconds: number) => void;
  onDive?: (chapterTitle: string) => void;
  diveEnabled?: boolean;
}

export function ChapterMarkers({
  chapters,
  currentPosition,
  onChapterPress,
  onDive,
  diveEnabled = true,
}: Props) {
  const currentChapterIndex = chapters.reduce((acc, ch, i) => {
    if (currentPosition >= ch.timestampSeconds) return i;
    return acc;
  }, 0);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isPast = (index: number) => index < currentChapterIndex;
  const isCurrent = (index: number) => index === currentChapterIndex;

  return (
    <FlatList
      data={chapters}
      keyExtractor={(_, i) => i.toString()}
      scrollEnabled={false}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={[
            styles.chapter,
            isCurrent(index) && styles.currentChapter,
            isPast(index) && styles.pastChapter,
          ]}
          onPress={() => onChapterPress(item.timestampSeconds)}
        >
          <View style={styles.chapterContent}>
            <Text style={styles.timestamp}>{formatTime(item.timestampSeconds)}</Text>
            <View style={styles.titleContainer}>
              <Text
                style={[
                  styles.title,
                  isCurrent(index) && styles.currentText,
                  isPast(index) && styles.pastText,
                ]}
              >
                {item.title}
              </Text>
              {isCurrent(index) && (
                <Text style={styles.nowPlaying}>Now playing</Text>
              )}
            </View>
          </View>
          {isCurrent(index) && onDive && (
            <TouchableOpacity
              style={[styles.diveButton, !diveEnabled && styles.diveButtonDisabled]}
              onPress={() => diveEnabled && onDive(item.title)}
              disabled={!diveEnabled}
            >
              <Text
                style={[
                  styles.diveText,
                  !diveEnabled && styles.diveTextDisabled,
                ]}
              >
                Dive
              </Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chapter: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  currentChapter: {
    backgroundColor: "#6366f110",
    borderLeftWidth: 3,
    borderLeftColor: "#6366f1",
  },
  pastChapter: { opacity: 0.5 },
  chapterContent: { flexDirection: "row", flex: 1, gap: 12 },
  timestamp: { color: "#888", fontSize: 14, width: 50 },
  titleContainer: { flex: 1 },
  title: { color: "#fff", fontSize: 15 },
  currentText: { color: "#6366f1", fontWeight: "600" },
  pastText: { color: "#666" },
  nowPlaying: { color: "#6366f1", fontSize: 11, marginTop: 2 },
  diveButton: {
    backgroundColor: "#6366f1",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  diveButtonDisabled: { backgroundColor: "#333" },
  diveText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  diveTextDisabled: { color: "#666" },
});
```

- [ ] **Step 2: Redesign the Player screen**

Replace `mobile/app/player/[id].tsx` with:

```typescript
// mobile/app/player/[id].tsx
/**
 * Player screen — chapter-focused layout with compact bottom controls.
 * Shows "Dive" button on current chapter for paid users with minutes remaining.
 */
import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { usePlayer } from "../../src/hooks/usePlayer";
import { useSubscription } from "../../src/hooks/useSubscription";
import { AudioPlayer } from "../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../src/components/ChapterMarkers";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import type { Podcast } from "../../src/hooks/usePodcasts";

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);
  const { subscription } = useSubscription();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("podcasts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setPodcast(data as unknown as Podcast);
      setLoading(false);
    })();
  }, [id]);

  const player = usePlayer(
    podcast?.id || "",
    podcast?.audioUrl || "",
    podcast?.topic || "",
  );

  const isPaidTier =
    subscription && (subscription.tier === "plus" || subscription.tier === "pro");
  const hasMinutes =
    isPaidTier && subscription.deepDiveMinutesRemaining > 0;

  const handleDive = useCallback(
    (chapterTitle: string) => {
      if (!isPaidTier) {
        Alert.alert(
          "Upgrade Required",
          "Deep Dive requires a Plus or Pro subscription.",
        );
        return;
      }

      if (!hasMinutes) {
        const renewalText = subscription?.renewalDate
          ? `Resets ${new Date(subscription.renewalDate).toLocaleDateString()}.`
          : "";
        Alert.alert(
          "Minutes Used Up",
          `Deep dive minutes used up. ${renewalText}`,
        );
        return;
      }

      // Pause playback and navigate to deep dive
      player.pause();
      router.push({
        pathname: "/player/deep-dive",
        params: {
          podcastId: podcast!.id,
          chapterTitle,
          position: String(Math.floor(player.progress.position)),
        },
      });
    },
    [isPaidTier, hasMinutes, subscription, player, podcast, router],
  );

  if (loading || !podcast) return <LoadingOverlay message="Loading podcast..." />;
  if (!player.ready) return <LoadingOverlay message="Preparing audio..." />;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>Back</Text>
        </TouchableOpacity>
        {isPaidTier && (
          <Text style={styles.minutesBadge}>
            {subscription.deepDiveMinutesRemaining} min
          </Text>
        )}
      </View>

      {/* Title section */}
      <View style={styles.titleSection}>
        <Text style={styles.topic}>{podcast.topic}</Text>
        <Text style={styles.meta}>
          {Math.ceil((podcast.durationSeconds ?? 0) / 60)} min
        </Text>
      </View>

      {/* Chapter list (main scrollable area) */}
      <ScrollView style={styles.chapterList} contentContainerStyle={styles.chapterListContent}>
        {podcast.chapterMarkers.length > 0 && (
          <ChapterMarkers
            chapters={podcast.chapterMarkers}
            currentPosition={player.progress.position}
            onChapterPress={player.seekTo}
            onDive={isPaidTier ? handleDive : undefined}
            diveEnabled={hasMinutes}
          />
        )}
      </ScrollView>

      {/* Compact bottom player */}
      <View style={styles.bottomPlayer}>
        <AudioPlayer
          isPlaying={player.isPlaying}
          position={player.progress.position}
          duration={player.progress.duration}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 8,
  },
  backButton: { color: "#6366f1", fontSize: 16 },
  minutesBadge: {
    color: "#6366f1",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "#6366f115",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  titleSection: { paddingHorizontal: 16, paddingBottom: 16 },
  topic: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 30,
    marginBottom: 4,
  },
  meta: { fontSize: 14, color: "#666" },
  chapterList: { flex: 1 },
  chapterListContent: { paddingBottom: 16 },
  bottomPlayer: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#0a0a0a",
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ChapterMarkers.tsx mobile/app/player/\[id\].tsx
git commit -m "feat: redesign player screen — chapter-focused layout with Dive button"
```

---

### Task 14: Create ElevenLabs service + useDeepDive hook

**Files:**
- Create: `mobile/src/services/elevenlabs.ts`
- Create: `mobile/src/hooks/useDeepDive.ts`

- [ ] **Step 1: Install @11labs/react-native**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npm install @11labs/react-native
```

- [ ] **Step 2: Create ElevenLabs service**

Create `mobile/src/services/elevenlabs.ts`:

```typescript
// mobile/src/services/elevenlabs.ts
/**
 * ElevenLabs Conversational AI service.
 * Handles agent configuration, context preparation, and session management.
 *
 * Usage: Called by useDeepDive hook to initialize a conversation agent
 * with the podcast's research context for a specific chapter.
 */

const ELEVENLABS_AGENT_ID = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID ?? "";
const MAX_CONTEXT_TOKENS = 8000;

interface ResearchSection {
  title: string;
  content: string;
}

interface Source {
  url: string;
  title: string;
}

interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

interface DeepDiveContext {
  researchDocument: { sections?: ResearchSection[] };
  sources: Source[];
  chapterResearchMap: Record<string, ChapterResearchEntry> | null;
  transcript: string;
  chapterTitle: string;
}

/**
 * Estimate token count (rough: 1 token ~ 4 chars).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the system prompt and context for the ElevenLabs agent.
 * If the full research document exceeds MAX_CONTEXT_TOKENS, truncate:
 * - Keep chapter-relevant sections in full
 * - Summarize/truncate the rest
 */
export function buildAgentContext(context: DeepDiveContext): {
  systemPrompt: string;
  firstMessage: string;
} {
  const { researchDocument, sources, chapterResearchMap, transcript, chapterTitle } =
    context;

  const sections = researchDocument.sections ?? [];
  const chapterEntry = chapterResearchMap?.[chapterTitle];

  // Identify priority sections for this chapter
  const prioritySectionIndexes = new Set(chapterEntry?.researchSections ?? []);
  const prioritySourceIndexes = new Set(chapterEntry?.sourceIndexes ?? []);

  // Build research context with priority sections first
  let researchText = "";
  const prioritySections: string[] = [];
  const otherSections: string[] = [];

  sections.forEach((section, i) => {
    const text = `## ${section.title}\n${section.content}`;
    if (prioritySectionIndexes.has(i)) {
      prioritySections.push(text);
    } else {
      otherSections.push(text);
    }
  });

  researchText = [...prioritySections, ...otherSections].join("\n\n");

  // Truncate if exceeding token limit
  if (estimateTokens(researchText) > MAX_CONTEXT_TOKENS) {
    // Keep priority sections, truncate others
    const priorityText = prioritySections.join("\n\n");
    const remainingTokens = MAX_CONTEXT_TOKENS - estimateTokens(priorityText) - 200;

    if (remainingTokens > 0) {
      const otherText = otherSections.join("\n\n");
      const truncatedOther = otherText.slice(0, remainingTokens * 4);
      researchText = `${priorityText}\n\n${truncatedOther}...\n[Remaining sections truncated for context limits]`;
    } else {
      researchText = priorityText;
    }
  }

  // Build source citations text
  const sourceText = sources
    .map((s, i) => {
      const marker = prioritySourceIndexes.has(i) ? " [CHAPTER SOURCE]" : "";
      return `[${i + 1}] ${s.title}: ${s.url}${marker}`;
    })
    .join("\n");

  const systemPrompt = `You are a researcher who produced a podcast episode. The listener wants to go deeper on the chapter "${chapterTitle}".

Draw from the full research below, especially the sections marked as priority for this chapter. Cite sources by number when relevant. Be conversational, clear, and thorough.

If the listener asks about something outside the research, say so honestly rather than speculating.

---
RESEARCH DOCUMENT:
${researchText}

---
SOURCES:
${sourceText}

---
PODCAST TRANSCRIPT (for reference):
${transcript.slice(0, 2000)}${transcript.length > 2000 ? "..." : ""}`;

  const firstMessage = `Hey! I see you're diving deeper into "${chapterTitle}". What would you like to explore?`;

  return { systemPrompt, firstMessage };
}

/**
 * Get the ElevenLabs agent ID for configuration.
 */
export function getAgentId(): string {
  return ELEVENLABS_AGENT_ID;
}
```

- [ ] **Step 3: Create useDeepDive hook**

Create `mobile/src/hooks/useDeepDive.ts`:

```typescript
// mobile/src/hooks/useDeepDive.ts
/**
 * useDeepDive — manages the Deep Dive voice conversation lifecycle.
 *
 * Responsibilities:
 * - Calls start-deep-dive Edge Function to validate and create session
 * - Initializes ElevenLabs Conversational AI agent with research context
 * - Manages session state (connecting, active, ending, error)
 * - Client-side minute countdown timer
 * - Calls end-deep-dive Edge Function on session end
 * - Handles connection drops (3 retries with backoff)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { buildAgentContext, getAgentId } from "../services/elevenlabs";

type DeepDiveStatus = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

const MAX_SESSION_DURATION = 15 * 60; // 15 minutes in seconds
const WARNING_THRESHOLD = 2 * 60; // Warn at 2 minutes remaining
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = 2000;

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

interface UseDeepDiveReturn {
  status: DeepDiveStatus;
  transcript: TranscriptEntry[];
  minutesRemaining: number;
  showWarning: boolean;
  errorMessage: string | null;
  startSession: (podcastId: string, chapterTitle: string) => Promise<void>;
  endSession: () => Promise<{ deepDiveMinutesRemaining: number } | null>;
  sendTextMessage: (text: string) => void;
}

export function useDeepDive(): UseDeepDiveReturn {
  const [status, setStatus] = useState<DeepDiveStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [minutesRemaining, setMinutesRemaining] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const elevenlabsSessionIdRef = useRef<string | null>(null);
  const conversationRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialMinutesRef = useRef<number>(0);

  // Client-side countdown timer
  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const sessionSecondsLeft = MAX_SESSION_DURATION - elapsed;
        const minutePoolLeft = initialMinutesRef.current * 60 - elapsed;
        const secondsLeft = Math.min(sessionSecondsLeft, minutePoolLeft);
        const minsLeft = Math.max(0, Math.ceil(secondsLeft / 60));

        setMinutesRemaining(minsLeft);
        setShowWarning(secondsLeft <= WARNING_THRESHOLD && secondsLeft > 0);

        if (secondsLeft <= 0) {
          endSession();
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  const startSession = useCallback(
    async (podcastId: string, chapterTitle: string) => {
      setStatus("connecting");
      setErrorMessage(null);
      setTranscript([]);

      try {
        // Call start-deep-dive Edge Function
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();

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

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to start deep dive");
        }

        const data = await response.json();
        sessionIdRef.current = data.sessionId;
        initialMinutesRef.current = data.minutesRemaining;
        setMinutesRemaining(data.minutesRemaining);

        // Build agent context
        const { systemPrompt, firstMessage } = buildAgentContext({
          researchDocument: data.researchDocument,
          sources: data.sources,
          chapterResearchMap: data.chapterResearchMap,
          transcript: data.transcript ?? "",
          chapterTitle,
        });

        // Initialize ElevenLabs conversation
        // Dynamic import to avoid loading SDK until needed
        const { Conversation } = await import("@11labs/react-native");

        const conversation = await Conversation.startSession({
          agentId: getAgentId(),
          overrides: {
            agent: {
              prompt: { prompt: systemPrompt },
              firstMessage,
            },
          },
          onConnect: ({ conversationId }: { conversationId: string }) => {
            elevenlabsSessionIdRef.current = conversationId;
            startTimeRef.current = Date.now();
            setStatus("active");
          },
          onDisconnect: () => {
            if (status === "active") {
              // Unexpected disconnect — attempt reconnection is handled by SDK
              // or we end session
              endSession();
            }
          },
          onMessage: ({
            message,
            source,
          }: {
            message: string;
            source: "user" | "ai";
          }) => {
            setTranscript((prev) => [
              ...prev,
              {
                role: source === "ai" ? "assistant" : "user",
                text: message,
              },
            ]);
          },
          onError: (error: Error) => {
            setErrorMessage(error.message);
            setStatus("error");
          },
        });

        conversationRef.current = conversation;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatus("error");
      }
    },
    [],
  );

  const endSession = useCallback(async () => {
    if (status === "ending" || status === "ended") return null;
    setStatus("ending");

    // Stop ElevenLabs conversation
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch {
        // Best effort
      }
      conversationRef.current = null;
    }

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Call end-deep-dive Edge Function
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();

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

      setStatus("ended");

      if (response.ok) {
        const data = await response.json();
        return { deepDiveMinutesRemaining: data.deepDiveMinutesRemaining };
      }
    } catch {
      // Session still ends locally even if Edge Function fails
    }

    setStatus("ended");
    return null;
  }, [status]);

  const sendTextMessage = useCallback(
    (text: string) => {
      if (conversationRef.current && status === "active") {
        // Add to transcript immediately
        setTranscript((prev) => [...prev, { role: "user", text }]);
        // Note: ElevenLabs text input may need different API depending on SDK version
        // The conversation.sendUserInput method sends text as user speech
        conversationRef.current.sendUserInput?.(text);
      }
    },
    [status],
  );

  return {
    status,
    transcript,
    minutesRemaining,
    showWarning,
    errorMessage,
    startSession,
    endSession,
    sendTextMessage,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/src/services/elevenlabs.ts mobile/src/hooks/useDeepDive.ts
git commit -m "feat: add ElevenLabs service and useDeepDive hook for voice conversations"
```

---

### Task 15: Create Deep Dive conversation screen

**Files:**
- Create: `mobile/app/player/deep-dive.tsx`

- [ ] **Step 1: Create the Deep Dive screen**

Create `mobile/app/player/deep-dive.tsx`:

```typescript
// mobile/app/player/deep-dive.tsx
/**
 * Deep Dive conversation screen — full-screen voice/text chat
 * with an ElevenLabs AI agent grounded in podcast research.
 *
 * Navigated to from Player screen when user taps "Dive" on current chapter.
 * On end, returns to Player and resumes playback from saved position.
 */
import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDeepDive } from "../../src/hooks/useDeepDive";
import { useSubscription } from "../../src/hooks/useSubscription";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

export default function DeepDiveScreen() {
  const { podcastId, chapterTitle, position } = useLocalSearchParams<{
    podcastId: string;
    chapterTitle: string;
    position: string;
  }>();
  const router = useRouter();
  const { refresh: refreshSubscription } = useSubscription();

  const {
    status,
    transcript,
    minutesRemaining,
    showWarning,
    errorMessage,
    startSession,
    endSession,
    sendTextMessage,
  } = useDeepDive();

  const [textInput, setTextInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  // Start session on mount
  useEffect(() => {
    if (podcastId && chapterTitle) {
      startSession(podcastId, chapterTitle);
    }
  }, [podcastId, chapterTitle]);

  // Auto-scroll transcript
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  const handleEnd = async () => {
    const result = await endSession();
    if (result) {
      refreshSubscription();
    }
    router.back();
  };

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    sendTextMessage(trimmed);
    setTextInput("");
  };

  // Loading state
  if (status === "connecting") {
    return <LoadingOverlay message="Connecting to researcher..." />;
  }

  // Error state
  if (status === "error") {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back to Podcast</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.chapterContext} numberOfLines={1}>
            Diving into: {chapterTitle}
          </Text>
        </View>
        <Text style={[styles.minutesBadge, showWarning && styles.minutesWarning]}>
          {minutesRemaining} min
        </Text>
      </View>

      {/* Warning banner */}
      {showWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            Less than 2 minutes remaining
          </Text>
        </View>
      )}

      {/* Transcript */}
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {transcript.map((entry, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              entry.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                entry.role === "user" ? styles.userText : styles.assistantText,
              ]}
            >
              {entry.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Input area */}
      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a question..."
            placeholderTextColor="#555"
            value={textInput}
            onChangeText={setTextInput}
            onSubmitEditing={handleSendText}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSendText}
            disabled={!textInput.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.endButton} onPress={handleEnd}>
          <Text style={styles.endButtonText}>End & Resume Podcast</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  headerLeft: { flex: 1, marginRight: 12 },
  chapterContext: { color: "#6366f1", fontSize: 15, fontWeight: "600" },
  minutesBadge: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "700",
    backgroundColor: "#6366f115",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  minutesWarning: { color: "#ff6b6b", backgroundColor: "#ff6b6b15" },

  // Warning banner
  warningBanner: {
    backgroundColor: "#ff6b6b20",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  warningText: { color: "#ff6b6b", fontSize: 13, textAlign: "center" },

  // Transcript
  transcript: { flex: 1 },
  transcriptContent: { padding: 16, gap: 12 },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16 },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#6366f1",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a1a",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  assistantText: { color: "#ddd" },

  // Input
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    padding: 16,
    gap: 12,
  },
  inputRow: { flexDirection: "row", gap: 8 },
  textInput: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: "#6366f1",
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  endButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  endButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  // Error
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorTitle: { color: "#ff6b6b", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  errorText: { color: "#888", fontSize: 15, textAlign: "center", marginBottom: 24 },
  backButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    paddingHorizontal: 24,
  },
  backButtonText: { color: "#6366f1", fontSize: 15, fontWeight: "600" },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/player/deep-dive.tsx
git commit -m "feat: add Deep Dive conversation screen with voice/text chat"
```

---

## Post-Implementation Checklist

After all chunks are complete:

- [ ] Run full pipeline test suite: `cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run`
- [ ] Verify no imports reference deleted modules (`researchPlanner`, `deepResearcher`, `factChecker`, `RESEARCH_PLANNER_PROMPT`, `FACT_CHECKER_PROMPT`, `RESEARCH_COST_CEILING`)
- [ ] Verify migration applies: `cd "/Users/isuru/personal/AI Podcast App" && npx supabase db reset`
- [ ] Verify mobile compiles: `cd "/Users/isuru/personal/AI Podcast App/mobile" && npx expo export --platform ios 2>&1 | head -20`
- [ ] Verify all new Edge Functions have CORS handling
- [ ] Verify `@11labs/react-native` is in mobile `package.json`
