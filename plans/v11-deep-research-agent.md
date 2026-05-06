# Deep Research Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenAI `o4-mini-deep-research` API with self-hosted research agent (LangGraph `createReactAgent` + Tavily over OpenRouter). Hard cutover, single PR, no flag.

**Architecture:** New `deepResearchAgent` node = subgraph (planner → N parallel subagents fanned out via `Send` → synthesizer). Each subagent is a deepagent with `tavily_search` tool, hard-capped per-tier search/reflection budget. Output additive `claims[]` field on `research_document`. Floor formula `usable >= ⌈N/2⌉+1`; per-subagent retry once. Models routed through OpenRouter via env vars + per-invocation `configurable` overrides.

**Tech Stack:** TypeScript, vitest, LangGraph.js (`@langchain/langgraph` + `@langchain/langgraph/prebuilt` for `createReactAgent`), `@tavily/core`, OpenRouter (via `@langchain/openai` with custom baseURL), Langfuse for observability.

**Spec:** `docs/superpowers/specs/2026-05-06-deep-research-agent-design.md`

## Test mocking convention (read first)

All test code below uses `vi.hoisted(() => vi.fn())` for any mock function declared at module scope and referenced inside a `vi.mock(...)` factory. **Do not** write `const mockX = vi.fn()` at module scope and reference it inside `vi.mock(...)` — vitest hoists `vi.mock` calls above module-scope declarations and you'll get `ReferenceError: Cannot access 'mockX' before initialization`. The canonical pattern is in `pipeline/tests/deepResearch.test.ts:3-13`. Follow that.

---

## Chunk 1: Foundation — deps, env, providers, search tool

### Task 1: Install Tavily SDK

**Files:**
- Modify: `pipeline/package.json`

> **Note (post-execution amendment):** Originally this task installed both `deepagents` and `@tavily/core`. The deepagents 1.x line requires `@langchain/core ^1.x`; we run on 0.3. The 0.0.x line requires `@langchain/langgraph ^0.4.6`; we run on 0.2.74. Neither is compatible without a major LangChain stack upgrade, which is out of scope. Subagent now uses `createReactAgent` from `@langchain/langgraph/prebuilt` (already installed). See spec section "Why raw LangGraph everywhere" for full rationale.

- [ ] **Step 1: Install Tavily SDK**

```bash
cd "pipeline" && npm install @tavily/core
```

Expected: `package.json` shows `@tavily/core` as dep, `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
cd pipeline && node -e "require('@tavily/core'); console.log('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add pipeline/package.json pipeline/package-lock.json
git commit -m "deps: add @tavily/core for self-hosted research agent"
```

---

### Task 2: Add env vars

**Files:**
- Modify: `pipeline/.env.example` (or create if missing)
- User-managed: `pipeline/.env` (local) and Railway env vars

- [ ] **Step 1: Read current `.env.example` to see existing keys**

```bash
cat pipeline/.env.example 2>/dev/null || echo "missing"
```

- [ ] **Step 2: Add new keys to `.env.example`**

Append these keys to `pipeline/.env.example`:

```
# Research agent (v11+)
OPENROUTER_API_KEY=
TAVILY_API_KEY=
RESEARCH_REASONING_MODEL=anthropic/claude-sonnet-4.6
RESEARCH_SUBAGENT_MODEL=anthropic/claude-haiku-4.5
```

- [ ] **Step 3: Commit example file**

```bash
git add pipeline/.env.example
git commit -m "env: document research agent env vars in .env.example"
```

- [ ] **Step 4: USER ACTION — populate local + Railway env**

Locally:
```bash
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> pipeline/.env
echo "TAVILY_API_KEY=tvly-..." >> pipeline/.env
echo "RESEARCH_REASONING_MODEL=anthropic/claude-sonnet-4.6" >> pipeline/.env
echo "RESEARCH_SUBAGENT_MODEL=anthropic/claude-haiku-4.5" >> pipeline/.env
```

Railway: same four vars via dashboard or `railway variables set`.

Skip until before deploy step (Task 14).

---

### Task 3: OpenRouter provider factory

**Files:**
- Create: `pipeline/src/podcast_pipeline/providers/openrouter.ts`
- Test: `pipeline/tests/openrouter.test.ts`

- [ ] **Step 1: Write failing test**

Create `pipeline/tests/openrouter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation((cfg: any) => ({ _cfg: cfg, invoke: vi.fn() })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});

describe("makeOpenRouterModel", () => {
  it("returns a ChatOpenAI configured for OpenRouter base URL with required temperature", async () => {
    const { makeOpenRouterModel } = await import("../src/podcast_pipeline/providers/openrouter.js");
    const m = makeOpenRouterModel("anthropic/claude-sonnet-4.6", { temperature: 0.0 }) as any;
    expect(m._cfg.modelName).toBe("anthropic/claude-sonnet-4.6");
    expect(m._cfg.apiKey).toBe("test-key");
    expect(m._cfg.configuration.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(m._cfg.temperature).toBe(0.0);
  });

  it("throws helpfully when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { makeOpenRouterModel } = await import("../src/podcast_pipeline/providers/openrouter.js");
    expect(() => makeOpenRouterModel("anthropic/claude-haiku-4.5", { temperature: 0.4 })).toThrow(/OPENROUTER_API_KEY/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/openrouter.test.ts
```

Expected: FAIL with `Cannot find module ../src/podcast_pipeline/providers/openrouter.js`.

- [ ] **Step 3: Implement `openrouter.ts`**

Create `pipeline/src/podcast_pipeline/providers/openrouter.ts`:

```typescript
import { ChatOpenAI } from "@langchain/openai";

export function makeOpenRouterModel(
  modelName: string,
  opts: { temperature: number },
): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return new ChatOpenAI({
    modelName,
    apiKey,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: opts.temperature,
  });
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/openrouter.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/openrouter.ts pipeline/tests/openrouter.test.ts
git commit -m "feat: add makeOpenRouterModel factory for research agent"
```

---

### Task 4: Tavily search tool with budget enforcement

**Files:**
- Create: `pipeline/src/podcast_pipeline/tools/tavilySearch.ts`
- Test: `pipeline/tests/tavilySearch.test.ts`

- [ ] **Step 1: Write failing test**

Create `pipeline/tests/tavilySearch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearch = vi.hoisted(() => vi.fn());

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: mockSearch })),
}));

beforeEach(() => {
  process.env.TAVILY_API_KEY = "tvly-test";
  mockSearch.mockReset();
});

describe("makeTavilyTool", () => {
  it("returns results from Tavily within budget", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ url: "https://a.com", title: "A", raw_content: "full a", content: "snip a" }],
    });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 2 });
    const result = await tool.invoke({ query: "espresso history" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].url).toBe("https://a.com");
    expect(result.results[0].content).toBe("full a");
    expect(result.searchesRemaining).toBe(1);
  });

  it("returns budget_exceeded after maxSearches", async () => {
    mockSearch.mockResolvedValue({ results: [] });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 1 });
    await tool.invoke({ query: "first" });
    const result = await tool.invoke({ query: "second" });
    expect(result.error).toBe("search_budget_exceeded");
    expect(result.remaining).toBe(0);
  });

  it("returns tavily_error when search throws", async () => {
    mockSearch.mockRejectedValueOnce(new Error("network down"));
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 2 });
    const result = await tool.invoke({ query: "boom" });
    expect(result.error).toBe("tavily_error");
    expect(result.message).toMatch(/network down/);
    expect(result.searchesRemaining).toBe(1);
  });

  it("falls back to content when raw_content missing", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ url: "https://b.com", title: "B", content: "snippet only" }],
    });
    const { makeTavilyTool } = await import("../src/podcast_pipeline/tools/tavilySearch.js");
    const tool = makeTavilyTool({ taskId: "task_0", maxSearches: 1 });
    const result = await tool.invoke({ query: "fallback" });
    expect(result.results[0].content).toBe("snippet only");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/tavilySearch.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `tavilySearch.ts`**

Create `pipeline/src/podcast_pipeline/tools/tavilySearch.ts`:

```typescript
import { tool } from "@langchain/core/tools";
import { tavily } from "@tavily/core";
import { z } from "zod";

const tavilyClient = () => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  return tavily({ apiKey });
};

export interface TavilyToolOpts {
  taskId: string;
  maxSearches: number;
}

export function makeTavilyTool(opts: TavilyToolOpts) {
  let searchCount = 0;
  const client = tavilyClient();
  return tool(
    async ({ query }: { query: string }) => {
      if (++searchCount > opts.maxSearches) {
        return { error: "search_budget_exceeded", remaining: 0 };
      }
      try {
        const res = await client.search(query, {
          searchDepth: "advanced",
          includeRawContent: true,
          maxResults: 5,
        });
        return {
          query,
          results: (res.results ?? []).map((r: any) => ({
            url: r.url,
            title: r.title,
            content: r.raw_content ?? r.rawContent ?? r.content,
          })),
          searchesRemaining: opts.maxSearches - searchCount,
        };
      } catch (err: any) {
        return {
          error: "tavily_error",
          message: err?.message ?? String(err),
          searchesRemaining: opts.maxSearches - searchCount,
        };
      }
    },
    {
      name: "tavily_search",
      description: "Search the web for primary sources. Returns up to 5 results per call with full-page content where available.",
      schema: z.object({
        query: z.string().describe("Concise search query targeting one specific aspect of the research question."),
      }),
    }
  );
}
```

Notes on Tavily SDK: API param names may be camelCase (`searchDepth`, `includeRawContent`, `maxResults`) in `@tavily/core` v0.x. If snake_case (`search_depth`) is required by the version installed, swap accordingly. The test uses both shapes (`raw_content`/`rawContent`) to tolerate either — keep both fallbacks in the impl.

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/tavilySearch.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/tools/tavilySearch.ts pipeline/tests/tavilySearch.test.ts
git commit -m "feat: add tavily_search tool with per-subagent budget enforcement"
```

---

## Chunk 2: Research nodes — planner, subagent, synthesizer

### Task 5: Update `config.ts` with new constants

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Add new constants, keep old ones for now (deletion happens in Task 12)**

Add to top of `config.ts` (after existing imports/header comment):

```typescript
// Research agent (v11+) — replaces o4-mini-deep-research
export const RESEARCH_MODELS = {
  reasoning: process.env.RESEARCH_REASONING_MODEL ?? "anthropic/claude-sonnet-4.6",
  subagent:  process.env.RESEARCH_SUBAGENT_MODEL  ?? "anthropic/claude-haiku-4.5",
} as const;

export const RESEARCH_TEMPERATURES = {
  planner: 0.0,
  synthesizer: 0.1,
  subagent: 0.4,
} as const;

export const RESEARCH_BUDGETS: Record<string, { maxSearches: number; maxReflections: number }> = {
  free: { maxSearches: 2, maxReflections: 1 },
  plus: { maxSearches: 3, maxReflections: 2 },
  pro:  { maxSearches: 5, maxReflections: 2 },
};

export const SUBAGENT_WALLCLOCK_MS = 90_000;
// Note: pipeline-level wallclock is not enforced as a constant. Per-subagent
// (90s) is the only wallclock; with N <= 5 + sequential planner/synthesizer,
// total bound is naturally ~3 min. If we want a hard pipeline cap later,
// add it here and wrap deepResearchAgent body in Promise.race.
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts
git commit -m "config: add RESEARCH_MODELS, RESEARCH_TEMPERATURES, RESEARCH_BUDGETS, wallclocks"
```

---

### Task 6: Research prompts

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/research/prompts.ts`

- [ ] **Step 1: Create `prompts.ts`**

```typescript
/**
 * Prompts for the research agent's planner, subagent, and synthesizer.
 * Templates use {placeholder} substitution at call sites, not LangChain's
 * PromptTemplate (we render with simple string.replace for clarity).
 */

export const PLANNER_PROMPT = `You are decomposing a research brief into focused subtasks.

Given the brief's keyQuestions, produce one SubagentTask per question — no merging, no skipping.

For each task:
- id: "task_{i}" where i is the 0-based index of the question
- question: the keyQuestion verbatim
- context: a 1-2 sentence summary combining the brief's scope, angle, and depth — this is what the subagent needs to know about the broader podcast
- searchHints: 2-3 concrete search queries to start with. Each hint should target a different facet of the question.

Don't research yourself; this is decomposition only.

{retryContext}

Brief:
{researchBrief}
`;

export const PLANNER_RETRY_CONTEXT = `
PREVIOUS ITERATION HAD GAPS:
{credibilityReport}

The subagents that failed last time were investigating: {droppedQuestions}

Adjust your searchHints for those questions to broaden coverage. Try alternative angles, different terminology, less-specific queries.
`;

export const SUBAGENT_SYSTEM_PROMPT = `You are a research subagent. You have ONE question to answer with cited findings.

Your tool: tavily_search(query) — returns up to 5 web results with full-page content. You have a hard budget of {maxSearches} searches and {maxReflections} reflections.

Process:
1. Read your question and context. Use the suggested searchHints as starting queries.
2. Call tavily_search to gather sources.
3. After each search, briefly assess: did the results answer the question? what's still missing?
4. If you have enough material AND have done at least one search: stop searching.
5. If you've exhausted your budget: stop searching.
6. Extract every factual claim you can support with at least one source URL. Each claim should be a specific, verifiable factual statement — not a vague summary.

Output: SubagentFindings JSON.
- status: "complete" if you fully answered the question with multiple cited claims; "partial" if some aspects remain unanswered but you found useful material; "failed" if Tavily returned nothing useful or you couldn't extract any cited claims.
- findings: array of { claim, sourceUrls, sourceTitles } — sourceUrls and sourceTitles are parallel arrays.
- notes: for "partial" or "failed", briefly explain what went wrong or what's missing.

If a tavily_search returns { error: "search_budget_exceeded" } or { error: "tavily_error" }, treat it as a used search and continue with what you have.
`;

export const SUBAGENT_TASK_PROMPT = `Question: {question}

Context: {context}

Suggested starting queries: {searchHints}
`;

export const SYNTHESIZER_PROMPT = `You are merging research findings from N parallel subagents into a single research document for a podcast.

Inputs:
- subagentFindings: an array of { taskId, question, findings: [{ claim, sourceUrls, sourceTitles }], status, notes }
- droppedQuestions: questions where subagents failed entirely. Acknowledge these in prose; do NOT hallucinate around them.

Steps:
1. Build a deduped sources array: iterate subagentFindings in order, then findings within each, then sourceUrls within each finding. First-appearance order. Each unique URL becomes one entry { url, title }.
2. Re-index every claim's source URLs into 0-based positions in your deduped sources array.
3. Group claims into 4-6 sections by topical similarity. A section spans related questions; it doesn't have to be 1:1 with subagent questions.
4. Write each section's content as cited prose (1-3 paragraphs). Use [N] markers where N is 1-indexed into the sources array (so [1] is sources[0], [1][2] is sources 0 and 1).
5. Mention dropped angles in the prose where relevant. Be honest about gaps.

Citation discipline:
- Every factual statement in your prose must have at least one [N] marker.
- Don't repeat the same claim text across multiple claims; consolidate.

Output: a JSON object matching the schema:
{
  "sections": [{ "title": string, "content": string }],
  "sources": [{ "url": string, "title": string }],
  "claims": [{ "text": string, "sourceIndexes": number[] }],
  "droppedQuestions": string[]
}

Worked mini-example for citation format:
  Bezzera filed his patent in 1901 [1]. Tipo Gigante shipped the next year [2]. Both were Italian inventions [1][2].
`;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/research/prompts.ts
git commit -m "feat: add research agent prompts (planner/subagent/synthesizer)"
```

---

### Task 7: Planner node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/research/planner.ts`
- Test: `pipeline/tests/planner.test.ts`

- [ ] **Step 1: Write failing test**

Create `pipeline/tests/planner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("planner", () => {
  it("returns one task per keyQuestion", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C1", searchHints: ["h1a", "h1b"] },
        { id: "task_1", question: "Q2?", context: "C2", searchHints: ["h2a", "h2b"] },
        { id: "task_2", question: "Q3?", context: "C3", searchHints: ["h3a", "h3b"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    const tasks = await runPlanner(brief, { researchIterations: 0 });
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe("task_0");
    expect(tasks[2].question).toBe("Q3?");
  });

  it("throws when planner returns wrong number of tasks", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [{ id: "task_0", question: "Q1?", context: "C", searchHints: [] }],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await expect(runPlanner(brief, { researchIterations: 0 })).rejects.toThrow(/expected 3 tasks/);
  });

  it("injects retry context when researchIterations > 0", async () => {
    mockInvoke.mockResolvedValueOnce({
      tasks: [
        { id: "task_0", question: "Q1?", context: "C", searchHints: ["h"] },
        { id: "task_1", question: "Q2?", context: "C", searchHints: ["h"] },
        { id: "task_2", question: "Q3?", context: "C", searchHints: ["h"] },
      ],
    });
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?", "Q3?"] });
    await runPlanner(brief, {
      researchIterations: 1,
      credibilityReport: "Credibility 0.5",
      droppedQuestions: ["Q3?"],
    });
    const callArg = mockInvoke.mock.calls[0][0];
    const text = typeof callArg === "string" ? callArg : JSON.stringify(callArg);
    expect(text).toContain("Q3?");
    expect(text).toContain("Credibility 0.5");
  });

  it("hard-fails on N < 3 (degenerate brief; spec assumes 3-5 keyQuestions)", async () => {
    const { runPlanner } = await import("../src/podcast_pipeline/nodes/research/planner.js");
    const brief = JSON.stringify({ scope: "S", angle: "A", depth: "intermediate", keyQuestions: ["Q1?", "Q2?"] });
    await expect(runPlanner(brief, { researchIterations: 0 })).rejects.toThrow(/at least 3 keyQuestions/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/planner.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `planner.ts`**

```typescript
import { z } from "zod";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../config.js";
import { PLANNER_PROMPT, PLANNER_RETRY_CONTEXT } from "./prompts.js";

export const SubagentTaskSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  searchHints: z.array(z.string()),
});
export type SubagentTask = z.infer<typeof SubagentTaskSchema>;

const PlannerOutputSchema = z.object({
  tasks: z.array(SubagentTaskSchema),
});

export interface PlannerInput {
  researchIterations: number;
  credibilityReport?: string;
  droppedQuestions?: string[];
}

export async function runPlanner(researchBrief: string, ctx: PlannerInput): Promise<SubagentTask[]> {
  const brief = JSON.parse(researchBrief) as { keyQuestions?: string[] };
  const keyQuestions = brief.keyQuestions ?? [];
  if (keyQuestions.length < 3) {
    throw new Error(`Planner requires at least 3 keyQuestions in brief, got ${keyQuestions.length}`);
  }

  const retryContext = ctx.researchIterations > 0
    ? PLANNER_RETRY_CONTEXT
        .replace("{credibilityReport}", ctx.credibilityReport ?? "")
        .replace("{droppedQuestions}", (ctx.droppedQuestions ?? []).join("; "))
    : "";

  const prompt = PLANNER_PROMPT
    .replace("{retryContext}", retryContext)
    .replace("{researchBrief}", researchBrief);

  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, { temperature: RESEARCH_TEMPERATURES.planner });
  const structured = llm.withStructuredOutput(PlannerOutputSchema, { name: "planner_output" });
  const result = await structured.invoke(prompt);

  if (result.tasks.length !== keyQuestions.length) {
    throw new Error(`Planner returned ${result.tasks.length} tasks, expected ${keyQuestions.length}`);
  }
  return result.tasks;
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/planner.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/research/planner.ts pipeline/tests/planner.test.ts
git commit -m "feat: add research planner node with retry context injection"
```

---

### Task 8: Subagent node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/research/subagent.ts`
- Test: `pipeline/tests/subagent.test.ts`

- [ ] **Step 1: Write failing test**

Create `pipeline/tests/subagent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockCreateReactAgent = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeTavilyTool = vi.hoisted(() => vi.fn(() => ({ name: "tavily_search" })));
const mockChatOpenAI = vi.hoisted(() => vi.fn().mockImplementation(() => ({})));

vi.mock("@langchain/langgraph/prebuilt", () => ({ createReactAgent: mockCreateReactAgent }));
vi.mock("../src/podcast_pipeline/tools/tavilySearch.js", () => ({ makeTavilyTool: mockMakeTavilyTool }));
vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("runSubagent", () => {
  it("returns SubagentFindings on first-attempt success", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredResponse: {
        taskId: "task_0",
        question: "Q?",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
        status: "complete",
      },
    });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("complete");
    expect(result.findings[0].claim).toBe("c");
  });

  it("retries once when first attempt returns failed", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "first" },
      })
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }], status: "complete" },
      });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("complete");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("returns failed after second attempt also fails", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "1" },
      })
      .mockResolvedValueOnce({
        structuredResponse: { taskId: "task_0", question: "Q?", findings: [], status: "failed", notes: "2" },
      });
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("failed");
    expect(result.findings).toHaveLength(0);
  });

  it("returns failed when both attempts throw", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("e1")).mockRejectedValueOnce(new Error("e2"));
    const { runSubagent } = await import("../src/podcast_pipeline/nodes/research/subagent.js");
    const result = await runSubagent(
      { id: "task_0", question: "Q?", context: "C", searchHints: ["h"] },
      { maxSearches: 2, maxReflections: 1 },
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/e2/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/subagent.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `subagent.ts`**

```typescript
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { makeTavilyTool } from "../../tools/tavilySearch.js";
import { RESEARCH_MODELS, RESEARCH_TEMPERATURES, SUBAGENT_WALLCLOCK_MS } from "../../config.js";
import { SUBAGENT_SYSTEM_PROMPT, SUBAGENT_TASK_PROMPT } from "./prompts.js";
import type { SubagentTask } from "./planner.js";

export const FindingSchema = z.object({
  claim: z.string(),
  sourceUrls: z.array(z.string()),
  sourceTitles: z.array(z.string()),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SubagentFindingsSchema = z.object({
  taskId: z.string(),
  question: z.string(),
  findings: z.array(FindingSchema),
  status: z.enum(["complete", "partial", "failed"]),
  notes: z.string().optional(),
});
export type SubagentFindings = z.infer<typeof SubagentFindingsSchema>;

export interface SubagentBudget {
  maxSearches: number;
  maxReflections: number;
}

const timeoutAfter = (ms: number, label: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));

async function invokeOnce(task: SubagentTask, opts: SubagentBudget): Promise<SubagentFindings> {
  const tool = makeTavilyTool({ taskId: task.id, maxSearches: opts.maxSearches });
  const llm = makeOpenRouterModel(RESEARCH_MODELS.subagent, { temperature: RESEARCH_TEMPERATURES.subagent });

  const systemPrompt = SUBAGENT_SYSTEM_PROMPT
    .replace("{maxSearches}", String(opts.maxSearches))
    .replace("{maxReflections}", String(opts.maxReflections));

  const taskMessage = SUBAGENT_TASK_PROMPT
    .replace("{question}", task.question)
    .replace("{context}", task.context)
    .replace("{searchHints}", task.searchHints.join("; "));

  const agent = createReactAgent({
    llm,
    tools: [tool],
    stateModifier: systemPrompt,
    responseFormat: SubagentFindingsSchema,
  } as any);

  const result = await agent.invoke({
    messages: [{ role: "user", content: taskMessage }],
  });
  // createReactAgent returns the structured payload under structuredResponse when responseFormat is set
  return result.structuredResponse as SubagentFindings;
}

export async function runSubagent(task: SubagentTask, opts: SubagentBudget): Promise<SubagentFindings> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await Promise.race([
        invokeOnce(task, opts),
        timeoutAfter(SUBAGENT_WALLCLOCK_MS, `subagent_wallclock_exceeded_${task.id}`),
      ]);
      if (result.status !== "failed") return result;
      if (attempt === 2) return result;
    } catch (err: any) {
      if (attempt === 2) {
        return {
          taskId: task.id,
          question: task.question,
          findings: [],
          status: "failed",
          notes: `Subagent threw on retry: ${err?.message ?? String(err)}`,
        };
      }
    }
  }
  // unreachable
  throw new Error("runSubagent fell through retry loop");
}
```

Note: `responseFormat`/`structuredResponse` is the `createReactAgent` v0.2.x convention for typed final output. The exact key on the returned object may be `structuredResponse` or similar — check the installed version's typings. The test mocks the result shape so the contract is what matters; if the runtime key differs, adjust the impl's last line accordingly.

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/subagent.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/research/subagent.ts pipeline/tests/subagent.test.ts
git commit -m "feat: add research subagent with retry-once on failure"
```

---

### Task 9: Synthesizer node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts`
- Test: `pipeline/tests/synthesizer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

const findings = (taskId: string, claims: { claim: string; urls: string[]; titles: string[] }[]) => ({
  taskId,
  question: `Question for ${taskId}`,
  status: "complete" as const,
  findings: claims.map(c => ({ claim: c.claim, sourceUrls: c.urls, sourceTitles: c.titles })),
});

describe("runSynthesizer", () => {
  it("passes findings to LLM and returns parsed structured output", async () => {
    // Note: actual source dedup happens inside the LLM (per the prompt). We can't
    // unit-test the dedup logic with a mocked LLM. Source dedup is verified in the
    // gated live integration test (Task 14).
    mockInvoke.mockResolvedValueOnce({
      sections: [{ title: "S1", content: "Bezzera filed in 1901 [1]." }],
      sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }],
      claims: [{ text: "Bezzera filed in 1901", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    const usable = [
      findings("task_0", [
        { claim: "c1", urls: ["https://a.com"], titles: ["A"] },
        { claim: "c2", urls: ["https://b.com"], titles: ["B"] },
      ]),
      findings("task_1", [
        { claim: "c3", urls: ["https://a.com"], titles: ["A"] }, // dup of source 0
      ]),
    ];
    const result = await runSynthesizer(usable, []);
    expect(result.sources).toHaveLength(2);
    expect(result.sections[0].title).toBe("S1");
  });

  it("retries once when first attempt throws", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("parse fail"))
      .mockResolvedValueOnce({ sections: [], sources: [], claims: [], droppedQuestions: [] });
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    const result = await runSynthesizer([findings("task_0", [])], []);
    expect(result).toBeDefined();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("throws after second retry also fails", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"));
    const { runSynthesizer } = await import("../src/podcast_pipeline/nodes/research/synthesizer.js");
    await expect(runSynthesizer([findings("task_0", [])], [])).rejects.toThrow(/e2/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/synthesizer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `synthesizer.ts`**

```typescript
import { z } from "zod";
import { makeOpenRouterModel } from "../../providers/openrouter.js";
import { RESEARCH_MODELS, RESEARCH_TEMPERATURES } from "../../config.js";
import { SYNTHESIZER_PROMPT } from "./prompts.js";
import type { SubagentFindings } from "./subagent.js";

export const ResearchDocumentSchema = z.object({
  sections: z.array(z.object({ title: z.string(), content: z.string() })),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
  claims: z.array(z.object({ text: z.string(), sourceIndexes: z.array(z.number()) })),
  droppedQuestions: z.array(z.string()).optional(),
});
export type ResearchDocument = z.infer<typeof ResearchDocumentSchema>;

export async function runSynthesizer(
  usable: SubagentFindings[],
  droppedQuestions: string[],
): Promise<ResearchDocument> {
  const llm = makeOpenRouterModel(RESEARCH_MODELS.reasoning, { temperature: RESEARCH_TEMPERATURES.synthesizer });
  const structured = llm.withStructuredOutput(ResearchDocumentSchema, { name: "research_document" });

  const payload = JSON.stringify({ subagentFindings: usable, droppedQuestions }, null, 2);
  const prompt = `${SYNTHESIZER_PROMPT}\n\nInput payload:\n${payload}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await structured.invoke(prompt);
      // Ensure droppedQuestions is set (model may omit if empty)
      return { ...result, droppedQuestions: result.droppedQuestions ?? droppedQuestions };
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn("[deepResearchAgent.synthesizer] retrying after failure:", { error: err });
    }
  }
  throw new Error("runSynthesizer fell through retry loop");
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/synthesizer.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts pipeline/tests/synthesizer.test.ts
git commit -m "feat: add research synthesizer with one retry on failure"
```

---

## Chunk 3: Outer agent + graph integration

### Task 10: Outer `deepResearchAgent` node

**Files:**
- Create: `pipeline/src/podcast_pipeline/nodes/deepResearchAgent.ts`
- Test: `pipeline/tests/deepResearchAgent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPlanner = vi.hoisted(() => vi.fn());
const mockSubagent = vi.hoisted(() => vi.fn());
const mockSynth = vi.hoisted(() => vi.fn());

vi.mock("../src/podcast_pipeline/nodes/research/planner.js", () => ({ runPlanner: mockPlanner }));
vi.mock("../src/podcast_pipeline/nodes/research/subagent.js", () => ({ runSubagent: mockSubagent }));
vi.mock("../src/podcast_pipeline/nodes/research/synthesizer.js", () => ({ runSynthesizer: mockSynth }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockPlanner.mockReset();
  mockSubagent.mockReset();
  mockSynth.mockReset();
});

const baseState = (overrides: any = {}) => ({
  podcastId: "p1",
  topic: "espresso",
  researchBrief: JSON.stringify({ scope: "S", angle: "A", depth: "i", keyQuestions: ["Q1?", "Q2?", "Q3?", "Q4?"] }),
  tier: "pro",
  researchIterations: 0,
  ...overrides,
});

describe("deepResearchAgent", () => {

  it("happy path: 4 subagents succeed → status=scripting", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2, 3].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] })),
    );
    for (let i = 0; i < 4; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`, question: `Q${i+1}?`,
        status: "complete",
        findings: [{ claim: `c${i}`, sourceUrls: [`u${i}`], sourceTitles: [`t${i}`] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [{ title: "S", content: "x [1]" }],
      sources: [{ url: "u0", title: "t0" }, { url: "u1", title: "t1" }, { url: "u2", title: "t2" }, { url: "u3", title: "t3" }],
      claims: [
        { text: "c0", sourceIndexes: [0] },
        { text: "c1", sourceIndexes: [1] },
        { text: "c2", sourceIndexes: [2] },
        { text: "c3", sourceIndexes: [3] },
      ],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState() as any);
    expect(result.status).toBe("scripting");
    expect(result.credibilityScore).toBeGreaterThan(0.7);
    expect(result.errorMessage).toBeNull();
    expect(result.researchDocument).toBeDefined();
  });

  it("floor not met: 2 of 4 fail → status=failed", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2, 3].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] })),
    );
    mockSubagent
      .mockResolvedValueOnce({ taskId: "task_0", question: "Q1?", status: "complete", findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }] })
      .mockResolvedValueOnce({ taskId: "task_1", question: "Q2?", status: "complete", findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }] })
      .mockResolvedValueOnce({ taskId: "task_2", question: "Q3?", status: "failed", findings: [], notes: "n" })
      .mockResolvedValueOnce({ taskId: "task_3", question: "Q4?", status: "failed", findings: [], notes: "n" });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState() as any);
    // floor for N=4 is 3; usable=2 < 3 → fail
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Research insufficient/);
    expect(mockSynth).not.toHaveBeenCalled();
  });

  it("computes credibility from claims, not sources", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] })),
    );
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`, question: `Q${i+1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [],
      sources: [{ url: "u", title: "t" }],
      claims: [
        { text: "c1", sourceIndexes: [0] },
        { text: "c2", sourceIndexes: [] },  // uncited
      ],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState({
      researchBrief: JSON.stringify({ scope: "S", angle: "A", depth: "i", keyQuestions: ["Q1?", "Q2?", "Q3?"] }),
    }) as any);
    // citedClaims=1/2=0.5; sourceDiversity=1/1=1.0; score = 0.5*0.7 + 1.0*0.3 = 0.65
    expect(result.credibilityScore).toBeCloseTo(0.65, 2);
  });

  it("clears errorMessage on retry success", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] })),
    );
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`, question: `Q${i+1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [], sources: [{ url: "u", title: "t" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState({
      researchBrief: JSON.stringify({ scope: "S", angle: "A", depth: "i", keyQuestions: ["Q1?", "Q2?", "Q3?"] }),
      researchIterations: 1,
      errorMessage: "previous failure",
      researchDocument: { droppedQuestions: ["Q3?"] },
      credibilityReport: "thin coverage",
    }) as any);
    expect(result.status).toBe("scripting");
    expect(result.errorMessage).toBeNull();
  });

  it("planner receives droppedQuestions on retry", async () => {
    mockPlanner.mockImplementationOnce(async (_brief: string, ctx: any) => {
      // assert planner gets the dropped questions
      expect(ctx.researchIterations).toBe(1);
      expect(ctx.droppedQuestions).toEqual(["Q3?"]);
      expect(ctx.credibilityReport).toBe("Credibility 0.5");
      return [0, 1, 2].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] }));
    });
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`, question: `Q${i+1}?`,
        status: "complete",
        findings: [{ claim: "c", sourceUrls: ["u"], sourceTitles: ["t"] }],
      });
    }
    mockSynth.mockResolvedValueOnce({
      sections: [], sources: [{ url: "u", title: "t" }],
      claims: [{ text: "c", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    await deepResearchAgent(baseState({
      researchBrief: JSON.stringify({ scope: "S", angle: "A", depth: "i", keyQuestions: ["Q1?", "Q2?", "Q3?"] }),
      researchIterations: 1,
      researchDocument: { droppedQuestions: ["Q3?"] },
      credibilityReport: "Credibility 0.5",
    }) as any);
  });

  it("score=0 when no claims at all", async () => {
    mockPlanner.mockResolvedValueOnce(
      [0, 1, 2].map(i => ({ id: `task_${i}`, question: `Q${i+1}?`, context: "c", searchHints: ["h"] })),
    );
    for (let i = 0; i < 3; i++) {
      mockSubagent.mockResolvedValueOnce({
        taskId: `task_${i}`, question: `Q${i+1}?`,
        status: "partial",
        findings: [],
        notes: "thin",
      });
    }
    mockSynth.mockResolvedValueOnce({ sections: [], sources: [], claims: [], droppedQuestions: [] });
    const { deepResearchAgent } = await import("../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const result = await deepResearchAgent(baseState({
      researchBrief: JSON.stringify({ scope: "S", angle: "A", depth: "i", keyQuestions: ["Q1?", "Q2?", "Q3?"] }),
    }) as any);
    expect(result.credibilityScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd pipeline && npx vitest run tests/deepResearchAgent.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `deepResearchAgent.ts`**

```typescript
import { runPlanner } from "./research/planner.js";
import { runSubagent, type SubagentFindings } from "./research/subagent.js";
import { runSynthesizer, type ResearchDocument } from "./research/synthesizer.js";
import { RESEARCH_BUDGETS, RESEARCH_MODELS } from "../config.js";
import type { PipelineStateType } from "../state.js";

function computeCredibility(doc: ResearchDocument): { score: number; report: string } {
  const totalClaims = doc.claims.length;
  if (totalClaims === 0) {
    return { score: 0, report: "No claims extracted from research." };
  }
  const citedClaims = doc.claims.filter(c => c.sourceIndexes.length > 0).length;
  const distinctSourcesUsed = new Set(doc.claims.flatMap(c => c.sourceIndexes)).size;
  const sourceDiversity = distinctSourcesUsed / Math.max(1, doc.sources.length);
  const score = (citedClaims / totalClaims) * 0.7 + sourceDiversity * 0.3;
  const report = `${citedClaims}/${totalClaims} claims cited; source diversity ${sourceDiversity.toFixed(2)}.`;
  return { score, report };
}

export async function deepResearchAgent(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const tier = state.tier ?? "free";
  const budget = RESEARCH_BUDGETS[tier] ?? RESEARCH_BUDGETS.free;

  let tasks;
  try {
    tasks = await runPlanner(state.researchBrief, {
      researchIterations: state.researchIterations ?? 0,
      credibilityReport: state.credibilityReport,
      droppedQuestions: (state.researchDocument as ResearchDocument | undefined)?.droppedQuestions ?? [],
    });
  } catch (err: any) {
    console.error("[deepResearchAgent.planner] failed:", { error: err?.message ?? String(err) });
    return {
      status: "failed",
      errorMessage: `Research planning failed: ${err?.message ?? String(err)}`,
    };
  }

  const results = await Promise.all(tasks.map(t => runSubagent(t, budget)));
  const usable = results.filter(r => r.status !== "failed");
  const dropped = results.filter(r => r.status === "failed").map(r => r.question);

  const floor = Math.ceil(tasks.length / 2) + 1;
  const modelTags = { reasoning: RESEARCH_MODELS.reasoning, subagent: RESEARCH_MODELS.subagent };
  const rawResearchResponse = { tasks, subagentFindings: results, model: modelTags };

  if (usable.length < floor) {
    console.error("[deepResearchAgent.floor] insufficient subagents:", {
      usable: usable.length,
      dropped: dropped.length,
      required: floor,
    });
    return {
      status: "failed",
      errorMessage: `Research insufficient: ${dropped.length} of ${tasks.length} angles failed`,
      rawResearchResponse,
    };
  }

  let researchDocument: ResearchDocument;
  try {
    researchDocument = await runSynthesizer(usable as SubagentFindings[], dropped);
  } catch (err: any) {
    console.error("[deepResearchAgent.synthesizer] hard failure:", { error: err?.message ?? String(err) });
    return {
      status: "failed",
      errorMessage: `Research synthesis failed: ${err?.message ?? String(err)}`,
      rawResearchResponse,
    };
  }

  const { score, report } = computeCredibility(researchDocument);

  return {
    researchDocument: researchDocument as Record<string, unknown>,
    sources: researchDocument.sources as Record<string, unknown>[],
    rawResearchResponse,
    credibilityScore: score,
    credibilityReport: report,
    status: "scripting",
    errorMessage: null,
  };
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd pipeline && npx vitest run tests/deepResearchAgent.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/nodes/deepResearchAgent.ts pipeline/tests/deepResearchAgent.test.ts
git commit -m "feat: add deepResearchAgent outer node with floor + credibility logic"
```

---

### Task 11: Wire into graph + remove `MIN_SOURCES_THRESHOLD`

**Files:**
- Modify: `pipeline/src/podcast_pipeline/graph.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/index.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/qualityGate.ts`
- Modify: `pipeline/tests/qualityGate.test.ts` (remove tests for the gone gate)

- [ ] **Step 1: Update `nodes/index.ts` barrel**

Edit `pipeline/src/podcast_pipeline/nodes/index.ts`:

```typescript
/** Pipeline nodes -- each function takes state and returns a partial state update. */
export { briefBuilder } from "./briefBuilder.js";
export { deepResearchAgent } from "./deepResearchAgent.js";
export { qualityGate } from "./qualityGate.js";
export { scriptWriter, parseChapterResearchMap } from "./scriptWriter.js";
export { adInjector } from "./adInjector.js";
export { audioProducer, splitScriptSegments } from "./audioProducer.js";
export { metadataWriter } from "./metadataWriter.js";
export { handlePipelineFailure } from "./errorHandler.js";
```

- [ ] **Step 2: Update `graph.ts`**

In `pipeline/src/podcast_pipeline/graph.ts`:

- Replace `import { deepResearch }` with `import { deepResearchAgent }`.
- Update all 3 graph-builder call sites (`addNode("deepResearch", ...)`, `addEdge("briefBuilder", "deepResearch")`, `addConditionalEdges("deepResearch", ...)`) plus the `routeAfterQualityGate` return-string from `"deepResearch"` to `"deepResearchAgent"`. **4 string replacements total.**
- The function `routeAfterDeepResearch` keeps its name (no rename per spec). Its existing docstring (`graph.ts` lines ~22-28) currently says "If deepResearch came back…" — rewrite to "If deepResearchAgent came back…" so the prose matches the new node.

- [ ] **Step 3: Update `qualityGate.ts` — remove MIN_SOURCES_THRESHOLD check**

In `pipeline/src/podcast_pipeline/nodes/qualityGate.ts`, remove these lines:

```typescript
// Check 1: Minimum source count
if (sources.length < MIN_SOURCES_THRESHOLD) {
  gaps.push(
    `Insufficient sources: found ${sources.length}, need at least ${MIN_SOURCES_THRESHOLD}`,
  );
}
```

Also remove `MIN_SOURCES_THRESHOLD` from the import at the top.

In `config.ts`, remove the `MIN_SOURCES_THRESHOLD` export line.

- [ ] **Step 4: Update `qualityGate.test.ts`**

Open `pipeline/tests/qualityGate.test.ts` and:
- Delete the test case `"should retry when sources are below minimum threshold"` (it asserts the `Insufficient sources` gap that no longer exists).
- Update any other test that incidentally checks `result.credibilityReport` against `Insufficient sources` — those assertions will fail since we now only report credibility-based gaps.
- Verify the remaining tests still cover: pass-on-good-credibility, retry-on-low-credibility, max-retries-exceeded-with-disclaimer.

Run `cd pipeline && npx vitest run tests/qualityGate.test.ts` and confirm green before moving on.

- [ ] **Step 5: Run all tests**

```bash
cd pipeline && npx vitest run
```

Expected: all green except `deepResearch.test.ts` (which we'll delete next task). If `qualityGate.test.ts` fails on removed-gate assertions, fix the tests.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/graph.ts \
        pipeline/src/podcast_pipeline/nodes/index.ts \
        pipeline/src/podcast_pipeline/nodes/qualityGate.ts \
        pipeline/src/podcast_pipeline/config.ts \
        pipeline/tests/qualityGate.test.ts
git commit -m "feat: wire deepResearchAgent into graph; drop MIN_SOURCES_THRESHOLD gate"
```

---

### Task 12: Delete old `deepResearch.ts` + cleanup `config.ts`

**Files:**
- Delete: `pipeline/src/podcast_pipeline/nodes/deepResearch.ts`
- Delete: `pipeline/tests/deepResearch.test.ts`
- Modify: `pipeline/src/podcast_pipeline/config.ts`

- [ ] **Step 1: Delete old files**

```bash
rm pipeline/src/podcast_pipeline/nodes/deepResearch.ts pipeline/tests/deepResearch.test.ts
```

- [ ] **Step 2: Remove o4-mini constants from `config.ts`**

In `pipeline/src/podcast_pipeline/config.ts`, delete:

- `DEEP_RESEARCH_PROMPT`
- `DEEP_RESEARCH_POLL_INTERVAL`
- `DEEP_RESEARCH_TIMEOUT`
- `MAX_TOOL_CALLS`

- [ ] **Step 3: Verify nothing imports the deleted symbols and no stale `"deepResearch"` strings remain**

```bash
cd pipeline && grep -rn "MAX_TOOL_CALLS\|DEEP_RESEARCH_PROMPT\|DEEP_RESEARCH_POLL_INTERVAL\|DEEP_RESEARCH_TIMEOUT\|MIN_SOURCES_THRESHOLD" src/ tests/ scripts/ 2>/dev/null
cd pipeline && grep -rn '"deepResearch"' src/ tests/ scripts/ 2>/dev/null
```

Expected: both empty. The first checks dead constants are fully removed; the second catches any node-name string we missed during the rename.

- [ ] **Step 4: Run full test suite + tsc**

```bash
cd pipeline && npx tsc --noEmit && npx vitest run
```

Expected: clean compile, all tests green.

- [ ] **Step 5: Commit**

```bash
git add -A pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/deepResearch.ts pipeline/tests/deepResearch.test.ts
git commit -m "chore: remove o4-mini-deep-research code, prompts, constants"
```

---

### Task 13: Update migration column comment

**Files:**
- Create: `supabase/migrations/00015_research_raw_response_comment.sql`

- [ ] **Step 1: Add migration to update column comment**

Create `supabase/migrations/00015_research_raw_response_comment.sql`:

```sql
-- 00015_research_raw_response_comment.sql
-- Update column comment to reflect new shape after v11 deep research agent
-- replaced o4-mini-deep-research with self-hosted LangGraph (createReactAgent + Tavily).
COMMENT ON COLUMN public.research_contexts.raw_response IS
  'Subagent findings array from deep research agent: { tasks, subagentFindings, model }. Used by deep-dive feature for granular per-claim source access.';
```

- [ ] **Step 2: Apply migration locally (if applicable)**

```bash
cd supabase && supabase db push
```

If using Supabase MCP for production, queue this migration to apply at deploy time.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00015_research_raw_response_comment.sql
git commit -m "migration: update raw_response column comment for v11 agent shape"
```

---

## Chunk 4: Smoke test, gated live integration, deploy

### Task 14: Gated live integration test

**Files:**
- Create: `pipeline/tests/integration/researchAgent.live.test.ts`

- [ ] **Step 1: Write live integration test (gated by env)**

```typescript
import { describe, it, expect } from "vitest";

const RUN_LIVE_RESEARCH = process.env.RUN_LIVE_RESEARCH === "1";

describe.skipIf(!RUN_LIVE_RESEARCH)("deepResearchAgent (live, gated)", () => {
  it("produces a valid research_document for the smoke topic", async () => {
    const { deepResearchAgent } = await import("../../src/podcast_pipeline/nodes/deepResearchAgent.js");
    const topic = process.env.SMOKE_TOPIC ?? "history of espresso machines";
    // N=4 keyQuestions intentionally — floor for N=4 is 3, so the test tolerates
    // one dropped subagent (real Tavily flakiness). N=3 would require all to
    // succeed and turn every gated $0.20 run into a coin flip.
    const brief = process.env.SMOKE_BRIEF ?? JSON.stringify({
      scope: "Origins and evolution of espresso machines from 1900 to today",
      angle: "engaging history with key inventors and technical milestones",
      depth: "intermediate",
      keyQuestions: [
        "Who invented the first espresso machine?",
        "What were the major technical milestones in espresso machine evolution?",
        "Which manufacturers shaped the modern espresso market?",
        "How did espresso culture spread beyond Italy?",
      ],
    });
    const state = {
      podcastId: "test-live",
      topic,
      researchBrief: brief,
      tier: "pro",
      researchIterations: 0,
      hasAds: false,
      trustedSourceUrls: [],
    } as any;

    const result = await deepResearchAgent(state);
    expect(result.status).toBe("scripting");
    expect(result.researchDocument).toBeDefined();
    const doc = result.researchDocument as any;
    expect(doc.sections.length).toBeGreaterThanOrEqual(3);
    expect(doc.sources.length).toBeGreaterThan(0);
    expect(doc.claims.length).toBeGreaterThan(0);
    expect(result.credibilityScore).toBeGreaterThan(0.5);
  }, 5 * 60_000); // 5 min wallclock
});
```

- [ ] **Step 2: Run the gated test**

```bash
cd pipeline && RUN_LIVE_RESEARCH=1 npx vitest run tests/integration/researchAgent.live.test.ts
```

Expected: passes within ~2 minutes. Cost: ~$0.20.

- [ ] **Step 3: Commit**

```bash
git add pipeline/tests/integration/researchAgent.live.test.ts
git commit -m "test: gated live integration test for deep research agent"
```

---

### Task 15: Manual smoke test on 3 topics

This task is manual — you read the output and judge quality. No commit unless prompts need to change.

The live test from Task 14 already reads `SMOKE_TOPIC` + `SMOKE_BRIEF` env vars with espresso defaults — no temp edits needed. Run all three topics directly.

- [ ] **Step 1: Run smoke for "history of espresso machines" (default)**

```bash
cd pipeline && RUN_LIVE_RESEARCH=1 npx vitest run tests/integration/researchAgent.live.test.ts
```

Inspect Langfuse trace. Open the persisted `research_document`:
- Read 3-5 cited claims, click sources, verify they actually support the claim.
- Look for hallucinated facts, missing citations, paraphrasing without attribution.

- [ ] **Step 2: Run smoke for "current state of fusion energy 2026"**

```bash
cd pipeline && RUN_LIVE_RESEARCH=1 \
  SMOKE_TOPIC="current state of fusion energy 2026" \
  SMOKE_BRIEF='{"scope":"Where commercial fusion energy stands in 2026","angle":"realistic, no hype","depth":"intermediate","keyQuestions":["Which projects achieved net-positive energy gain?","What materials and confinement approaches dominate?","What is the realistic commercial timeline?"]}' \
  npx vitest run tests/integration/researchAgent.live.test.ts
```

Look for: are sources from 2024+? Recency check.

- [ ] **Step 3: Run smoke for "what is mitochondrial DNA"**

```bash
cd pipeline && RUN_LIVE_RESEARCH=1 \
  SMOKE_TOPIC="what is mitochondrial DNA" \
  SMOKE_BRIEF='{"scope":"Mitochondrial DNA — biology, inheritance, and clinical relevance","angle":"clear technical explanation for educated lay listener","depth":"intermediate","keyQuestions":["What is mitochondrial DNA and how does it differ from nuclear DNA?","How is mitochondrial DNA inherited?","What diseases are linked to mitochondrial DNA mutations?"]}' \
  npx vitest run tests/integration/researchAgent.live.test.ts
```

Look for: dense factual content, every claim cited, no general-encyclopedia-style summaries.

- [ ] **Step 4: If quality is good, no commit needed. If prompts need iteration:**

Edit `pipeline/src/podcast_pipeline/nodes/research/prompts.ts` to fix discovered issues. Re-run all 3 smoke variants. Commit prompt changes:

```bash
git add pipeline/src/podcast_pipeline/nodes/research/prompts.ts
git commit -m "feat: refine research agent prompts based on smoke test (espresso/fusion/mDNA)"
```

---

### Task 16: Deploy to Railway

**Files:** none (config-only)

- [ ] **Step 1: Push branch + open PR (or push to main per project workflow)**

```bash
git push origin main
```

Or if using PR workflow: `gh pr create --title "feat: replace o4-mini with self-hosted research agent" --body "..."`.

- [ ] **Step 2: Set Railway env vars**

Via Railway dashboard or CLI:

```bash
railway variables set OPENROUTER_API_KEY="sk-or-v1-..."
railway variables set TAVILY_API_KEY="tvly-..."
railway variables set RESEARCH_REASONING_MODEL="anthropic/claude-sonnet-4.6"
railway variables set RESEARCH_SUBAGENT_MODEL="anthropic/claude-haiku-4.5"
```

- [ ] **Step 3: Trigger deploy**

```bash
railway up
```

Or push triggers auto-deploy if configured.

- [ ] **Step 4: Watch logs for the first generation**

```bash
railway logs --tail
```

Submit a test podcast through the live API. Watch for:
- `briefBuilder` → `deepResearchAgent` → `qualityGate` transitions.
- Any `[deepResearchAgent.*] failed:` or `dropped after retry` warnings.
- Final `status: "scripting"`.

- [ ] **Step 5: Validate one full podcast end-to-end**

Run a full pipeline (research → script → audio) via the live API and confirm:
- Pipeline reaches `complete` status.
- Audio is listenable.
- `research_contexts.research_document` has populated `claims[]`.

If anything fails, check Langfuse trace + Railway logs. Common issues:
- OpenRouter model ID typo (404 from OpenRouter): fix env var.
- Tavily auth (401): fix `TAVILY_API_KEY`.
- Synthesizer JSON parse fail: prompt iteration needed (see Task 15).

---

## Acceptance criteria (verified at end of plan)

- [ ] All unit tests in `pipeline/tests/` pass: `npx vitest run`
- [ ] TypeScript clean: `npx tsc --noEmit`
- [ ] Live gated test passes: `RUN_LIVE_RESEARCH=1 npx vitest run tests/integration/researchAgent.live.test.ts`
- [ ] Smoke test on 3 topics produces credible, cited research (manual review)
- [ ] One full pipeline run on Railway succeeds: brief → research → script → audio → complete
- [ ] No references to `MAX_TOOL_CALLS`, `DEEP_RESEARCH_PROMPT`, `MIN_SOURCES_THRESHOLD`, `deepResearch` remain anywhere
- [ ] `research_document` row in `research_contexts` has populated `claims[]` and `sections` with `[N]` markers
- [ ] Cost per podcast run (visible in OpenRouter + Tavily dashboards) is in the $0.15–$0.30 range

---

## Out of scope (per spec)

- Reintroducing trusted source filtering
- Per-tier model differentiation
- `scriptWriter` consuming `claims[]` directly
- Deep-dive feature consuming new `raw_response` shape
- Eval harness as a hard prerequisite

---

## Rollback

If quality regresses post-deploy:

```bash
git revert <merge-commit>
git push origin main
```

The old `o4-mini-deep-research` API is still active on OpenAI's side — revert + redeploy fully restores the previous pipeline.
