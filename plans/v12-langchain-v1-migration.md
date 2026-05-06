# LangChain v1 Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pipeline off the `@langchain/core ^0.3` / `@langchain/langgraph ^0.2` line onto the `@langchain/core ^1.1` / `@langchain/langgraph ^1.3` line, so we stop blocking ourselves out of newer ecosystem packages (deepagents was the trigger; there will be more).

**Architecture:** Pure version bump + breakage fixes. No design changes. No backward-compat shims. Greenfield project — nothing reads stale APIs externally, so we just update everything in place.

**Tech Stack:** `@langchain/core@^1.1.x`, `@langchain/langgraph@^1.3.x`, `@langchain/openai@^1.4.x`. Langfuse stays on `@langfuse/langchain@^5.3` (peer-dep `>=0.3.8`, accepts v1).

**Trigger:** v11 (deep research agent) had to use `createReactAgent` instead of `deepagents` because deepagents 1.x requires `@langchain/core ^1.x`. Migrating unblocks deepagents and any future ecosystem packages on the v1 line. Resume v11 (Tasks 15-16: smoke test + Railway deploy) after v12 lands.

**Sequencing:** v12 ships first (this plan). Then v11 deploy resumes on the v1 stack. Whether to actually swap `createReactAgent` → `createDeepAgent` is a separate v13 decision after v12 is stable.

---

## Pre-flight notes

LangChain v1 release status verified via `npm view`:
- `@langchain/core@1.1.44` (latest)
- `@langchain/langgraph@1.3.0` (latest)
- `@langchain/openai@1.4.5` (latest)

These are mature releases, not pre-release tags.

`@langfuse/langchain@5.3.0` peer-dep is `@langchain/core >=0.3.8` — no upper bound, accepts v1.

LangChain footprint in our codebase (verified via `grep`):

| File | Imports |
|---|---|
| `pipeline/src/podcast_pipeline/state.ts` | `Annotation` |
| `pipeline/src/podcast_pipeline/graph.ts` | `StateGraph`, `END` |
| `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts` | `ChatOpenAI` |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | likely `ChatOpenAI` (verify) |
| `pipeline/src/podcast_pipeline/tools/tavilySearch.ts` | `tool` |
| `pipeline/src/podcast_pipeline/nodes/research/planner.ts` | (uses `withStructuredOutput` via factory) |
| `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts` | (same) |
| `pipeline/src/podcast_pipeline/nodes/research/subagent.ts` | `createReactAgent` |
| `pipeline/src/podcast_pipeline/providers/openrouter.ts` | `ChatOpenAI` |
| `pipeline/src/podcast_pipeline/providers/langfuseClient.ts` | `CallbackHandler` from `@langfuse/langchain` |

Plus all `tests/*.test.ts` mock the same modules.

**Total: ~10 source files + ~10 test files. Half-day to one-day migration.**

---

## Task 1: Bump packages and capture the breakage surface

**Files:**
- Modify: `pipeline/package.json`, `pipeline/package-lock.json`

- [ ] **Step 1: Read current dep versions for the diff record**

```bash
cd pipeline && grep -E "@langchain|@langfuse" package.json
```

Save output to a scratch note.

- [ ] **Step 2: Bump to latest stable v1**

```bash
cd pipeline && npm install \
  @langchain/core@^1.1.44 \
  @langchain/langgraph@^1.3.0 \
  @langchain/openai@^1.4.5
```

Expected: install succeeds. Possible peer-dep warnings — capture them but don't auto-fix.

- [ ] **Step 3: Capture full type error surface**

```bash
cd pipeline && npx tsc --noEmit 2>&1 | tee /tmp/v12-tsc-baseline.txt
```

Don't fix anything yet. Read the output and identify which files break. The list of breakages drives Tasks 2-4 prioritization.

- [ ] **Step 4: Capture full test failure surface**

```bash
cd pipeline && npx vitest run 2>&1 | tee /tmp/v12-vitest-baseline.txt
```

Same — read, don't fix. Identify which test files fail.

- [ ] **Step 5: Commit the package bump as its own commit (no fixes)**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git add pipeline/package.json pipeline/package-lock.json
git commit -m "deps: bump @langchain/core, langgraph, openai to v1.x (breakages incoming in follow-up commits)"
```

This commit is allowed to leave the build broken. It's the boundary between "v0.3 era" and "v1 era" — easier to bisect later if something subtle is off.

---

## Task 2: Fix state.ts + graph.ts (LangGraph v1)

**Files:**
- Modify: `pipeline/src/podcast_pipeline/state.ts`
- Modify: `pipeline/src/podcast_pipeline/graph.ts`

- [ ] **Step 1: Read v1 docs for `Annotation.Root`**

LangGraph v1 may have renamed/restructured the annotation system. Check the v1 release notes and the type definitions:

```bash
cd pipeline && cat node_modules/@langchain/langgraph/dist/web.d.ts 2>/dev/null | grep -E "Annotation|StateGraph" | head -20
```

Look for: is `Annotation.Root` still the right pattern? Is `StateGraph` constructor signature unchanged? Any new required generics?

- [ ] **Step 2: Fix state.ts to v1 API**

Update imports + `Annotation.Root({...})` call as needed. The shape of the state schema (`PipelineState` annotation map) shouldn't change — just the surrounding API.

- [ ] **Step 3: Fix graph.ts to v1 API**

`StateGraph(PipelineState)` constructor + `.addNode/.addEdge/.addConditionalEdges` should be near-identical. If v1 changed argument signatures, update accordingly. `END` constant is stable.

- [ ] **Step 4: Run tests for these files**

```bash
cd pipeline && npx vitest run tests/state.test.ts tests/graph.test.ts
```

Expected: green. If not, fix until green.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/state.ts pipeline/src/podcast_pipeline/graph.ts
git commit -m "feat: migrate state.ts + graph.ts to LangGraph v1 API"
```

---

## Task 3: Fix LLM call sites

**Files:**
- Modify: `pipeline/src/podcast_pipeline/providers/openrouter.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` (verify usage)
- Modify: `pipeline/src/podcast_pipeline/nodes/research/planner.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts`

- [ ] **Step 1: Verify `ChatOpenAI` v1 constructor signature**

```bash
cd pipeline && grep -A 20 "interface ChatOpenAIFields\|class ChatOpenAI" node_modules/@langchain/openai/dist/chat_models.d.ts 2>/dev/null | head -40
```

Look for: did `modelName` → `model`? did `apiKey` location change? did `configuration: { baseURL }` survive?

- [ ] **Step 2: Fix `openrouter.ts` factory**

Update `new ChatOpenAI({...})` call to v1 signature. The factory's external API stays the same: `makeOpenRouterModel(modelName, { temperature })`.

- [ ] **Step 3: Fix briefBuilder.ts**

Update `new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 })` if needed. The `model.invoke([{role, content}, ...])` call should be stable.

- [ ] **Step 4: Verify scriptWriter.ts**

Read the file, identify any LangChain calls. Update to v1.

- [ ] **Step 5: Verify `withStructuredOutput` v1 API**

```bash
cd pipeline && grep -A 5 "withStructuredOutput" node_modules/@langchain/core/dist/language_models/chat_models.d.ts 2>/dev/null | head -20
```

Check: does it still accept `(schema, { name })` as the second arg? Does the returned `Runnable.invoke()` still take a string? Update planner.ts + synthesizer.ts if signatures changed.

- [ ] **Step 6: Run tests for these files**

```bash
cd pipeline && npx vitest run tests/openrouter.test.ts tests/briefBuilder.test.ts tests/scriptWriter.test.ts tests/planner.test.ts tests/synthesizer.test.ts
```

If test mocks need updating (e.g., the mocked `ChatOpenAI` shape needs to match v1), update them.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/podcast_pipeline/providers/openrouter.ts \
  pipeline/src/podcast_pipeline/nodes/briefBuilder.ts \
  pipeline/src/podcast_pipeline/nodes/scriptWriter.ts \
  pipeline/src/podcast_pipeline/nodes/research/planner.ts \
  pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts \
  pipeline/tests/*.test.ts
git commit -m "feat: migrate LLM call sites to @langchain/openai v1"
```

---

## Task 4: Fix tools + subagent

**Files:**
- Modify: `pipeline/src/podcast_pipeline/tools/tavilySearch.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/research/subagent.ts`

- [ ] **Step 1: Verify `tool()` helper v1 API**

```bash
cd pipeline && grep -A 10 "export function tool\|export const tool" node_modules/@langchain/core/dist/tools/index.d.ts 2>/dev/null | head -20
```

Check: does the `tool(fn, { name, description, schema })` signature survive in v1? Update if changed.

- [ ] **Step 2: Verify `createReactAgent` v1 API**

```bash
cd pipeline && grep -A 30 "CreateReactAgentParams" node_modules/@langchain/langgraph/dist/prebuilt/react_agent_executor.d.ts 2>/dev/null
```

Check:
- Is `prompt` still the right name (vs old `stateModifier`)?
- Is `responseFormat` still accepted?
- Does the result still expose `.structuredResponse`?
- Any new required fields in the params?

- [ ] **Step 3: Update subagent.ts**

The `createReactAgent({ llm, tools, prompt, responseFormat })` call may need adjustments. The contract (returns `SubagentFindings` from `result.structuredResponse`) is what the test asserts; if v1 renamed `structuredResponse`, update both the impl and test.

- [ ] **Step 4: Update tavilySearch.ts**

Should be minor — `tool()` factory + `z.object({ query })` schema should be stable.

- [ ] **Step 5: Run tests**

```bash
cd pipeline && npx vitest run tests/tavilySearch.test.ts tests/subagent.test.ts tests/deepResearchAgent.test.ts
```

`deepResearchAgent.test.ts` mocks `runSubagent` directly so it shouldn't be affected by subagent internals. But if it broke at the package-bump stage, fix it here.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/podcast_pipeline/tools/tavilySearch.ts \
  pipeline/src/podcast_pipeline/nodes/research/subagent.ts \
  pipeline/tests/tavilySearch.test.ts \
  pipeline/tests/subagent.test.ts
git commit -m "feat: migrate tavily tool + subagent (createReactAgent) to LangGraph v1"
```

---

## Task 5: Verify Langfuse integration

**Files:**
- Verify: `pipeline/src/podcast_pipeline/providers/langfuseClient.ts`

- [ ] **Step 1: Type-check the Langfuse module**

```bash
cd pipeline && npx tsc --noEmit src/podcast_pipeline/providers/langfuseClient.ts 2>&1 | tail -10
```

If `@langfuse/langchain@5.3.0` types are compatible with `@langchain/core@^1.1`, this is clean.

- [ ] **Step 2: Smoke-check the wrap**

Write a one-shot script (don't commit) that:
1. Calls `getObservedOpenAI()`
2. Confirms it returns an OpenAI client
3. Calls `getLangfuseCallbackHandler()`
4. Confirms it's a CallbackHandler instance

```bash
cd pipeline && cat > /tmp/v12-langfuse-smoke.ts <<'EOF'
import { getObservedOpenAI, getLangfuseCallbackHandler } from "./src/podcast_pipeline/providers/langfuseClient.js";
const client = getObservedOpenAI();
const handler = getLangfuseCallbackHandler();
console.log("client?", !!client, "handler?", !!handler, "handler.constructor:", handler.constructor.name);
EOF
npx tsx /tmp/v12-langfuse-smoke.ts
rm /tmp/v12-langfuse-smoke.ts
```

Expected: prints `client? true handler? true handler.constructor: CallbackHandler` (or whatever the class is named in v1).

- [ ] **Step 3: If broken, check @langfuse/langchain release notes**

If the smoke fails because of LangChain v1 incompatibility, check whether a newer `@langfuse/langchain` exists. Bump if available. If no compatible version exists, escalate — Langfuse observability is a hard requirement.

- [ ] **Step 4: No commit needed unless something changed**

If only verification, nothing to commit. If `@langfuse/langchain` was bumped, include in the next commit.

---

## Task 6: Full suite green + tsc clean

**Files:** verification only

- [ ] **Step 1: Run full type check**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd pipeline && npx vitest run
```

Expected: 112 tests pass (matching pre-migration count). Skip count may shift slightly if any tests were skipped under v0.3 due to API issues — review skips for any that should now run.

- [ ] **Step 3: Lint check (if configured)**

```bash
cd pipeline && grep -E "lint|eslint" package.json | head -5
```

If a `lint` script exists, run it and fix violations.

- [ ] **Step 4: Smoke the pipeline locally with mocked LLMs**

There's an existing test for the full graph compile. If `tests/graph.test.ts` passes, the graph can compile + route. That's our smoke test for the v1 wiring. No real LLM calls needed at this step — the live integration is deferred to v11 Task 15.

- [ ] **Step 5: Final commit if any tests/lint adjustments**

If any lint/test cleanup happened in steps 2-4, commit:

```bash
git add -A pipeline/
git commit -m "chore: post-migration test + lint cleanup for LangChain v1"
```

---

## Acceptance criteria

- [ ] `package.json` shows `@langchain/core ^1.1`, `@langchain/langgraph ^1.3`, `@langchain/openai ^1.4`
- [ ] `npx tsc --noEmit` exits clean
- [ ] `npx vitest run` shows 112 passing (or higher if previously-skipped tests now run)
- [ ] Langfuse smoke script confirms `getObservedOpenAI()` and `getLangfuseCallbackHandler()` return valid instances
- [ ] `git log --oneline` shows a clean sequence of focused commits per task
- [ ] Pipeline graph compiles via `runPipeline` invocation in tests

---

## Out of scope (explicitly)

- **Swapping `createReactAgent` → `createDeepAgent`.** Decided in Option B sequencing. Future v13 if we want dynamic planning.
- **Upgrading `langfuse` (the JS SDK separate from `@langfuse/langchain`).** Only touch if Task 5 shows it's broken.
- **Refactoring any node beyond what v1 requires.** No opportunistic cleanups.
- **Updating `mobile/`.** Mobile doesn't import LangChain.

---

## Rollback

```bash
git revert <merge-or-final-commit-of-v12>
git push origin main
```

The old o4-mini path is already removed in v11, so reverting v12 leaves us on createReactAgent + LangChain v0.3, which is the state we shipped through v11 Task 14. Safe rollback.

---

## After v12 ships

Resume v11:
- v11 Task 15: Smoke test on 3 topics (espresso, fusion, mDNA)
- v11 Task 16: Railway deploy

The `createReactAgent`-based subagent code we wrote in v11 keeps working under v1 (v1's `createReactAgent` is the supported way; deepagents wraps it). No throwaway work.
