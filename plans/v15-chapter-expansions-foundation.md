# v15 — Chapter Expansions Foundation (Server) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side foundation for chapter expansions — DB migration, `submitPodcast` handler, pipeline node updates so the pipeline can produce continuation-style expansion podcasts. No mobile UI in this plan; expansion-capable end-to-end via curl by the time this ships.

**Architecture:** Single migration adds the expansion relationship columns and `chapter_transcripts` jsonb. `submitPodcast` accepts optional `parentPodcastId` + `sourceChapterTitle`, validates ownership/idempotency, builds a research digest from the parent, populates new pipeline-state fields. Pipeline nodes (briefBuilder, planner, synthesizer, scriptWriter, metadataWriter) branch on expansion-mode state. No new pipeline topology — same graph, prompt and prior changes only.

**Tech Stack:** Hono on Railway, Supabase (Postgres + RLS), LangGraph.js, Sonnet 4.6 (planner+synthesizer) via OpenRouter, gpt-4o-mini (subagent) via OpenRouter, Gemini direct (TTS + tag injection).

**Spec reference:** `docs/superpowers/specs/2026-05-12-chapter-expansions-design.md`

**Depends on:** nothing new — builds on the current main branch.

**Ships as:** standalone PR. Server can accept expansion requests via curl after this lands; mobile UI ships in v16.

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/00019_chapter_expansions.sql` | DDL for expansion + chapter_transcripts + playback_events + has_used_expand. One atomic migration. |

### Modified files

| Path | What changes |
|---|---|
| `pipeline/src/podcast_pipeline/state.ts` | Add `parentPodcastId`, `sourceChapterTitle`, `parentResearchDigest`, `parentResearchDocument`, `parentChapterTranscript`, `hasUsedExpand` to `PipelineState`. |
| `pipeline/src/podcast_pipeline/config.ts` | Add `BRIEF_BUILDER_EXPANSION_PROMPT`, `SCRIPT_WRITER_EXPANSION_PROMPT`. Update planner/synthesizer prompts to reference parent context. |
| `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts` | Branch on `state.parentPodcastId` to select prompt. |
| `pipeline/src/podcast_pipeline/nodes/research/planner.ts` | When `parentResearchDigest` set, include it in prompt context. |
| `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts` | When `parentResearchDocument` set, include it as priors in prompt. |
| `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts` | Branch on `parentChapterTranscript` to select expansion prompt + pass parent context. |
| `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts` | Build `chapter_transcripts` map from script BEFORE strip; add to the `.update()`. |
| `pipeline/src/routes/submitPodcast.ts` | Accept `parentPodcastId` + `sourceChapterTitle`. Parent lookup, validation, idempotency, digest, `has_used_expand` flip, pass expansion fields to enqueue. |
| `mobile/src/types/database.ts` | Add new columns to types (regenerated or hand-edited). |

### Test files

| Path | What changes |
|---|---|
| `pipeline/tests/state.test.ts` | Add expansion-mode state fields |
| `pipeline/tests/briefBuilder.test.ts` | New test: expansion branch uses expansion prompt |
| `pipeline/tests/planner.test.ts` | New test: digest appears in prompt context |
| `pipeline/tests/synthesizer.test.ts` | New test: parent research doc appears as priors |
| `pipeline/tests/scriptWriter.test.ts` | New test: B-mode opening callback |
| `pipeline/tests/metadataWriter.test.ts` | New test: `chapter_transcripts` populated from script |
| `pipeline/tests/integration/api.test.ts` | New tests: expansion submit happy path, ownership 404, chapter 400, idempotency 409, legacy 400, flag flip |

---

## Chunk 1: Database migration

### Task 1: Write migration 00019

**Files:**
- Create: `supabase/migrations/00019_chapter_expansions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00019_chapter_expansions.sql
-- Foundation for chapter expansions: parent-child relationship on podcasts,
-- per-chapter transcript storage so expansions can extract just the relevant
-- chapter as scriptWriter callback context, has_used_expand flag for coach-mark
-- gating, playback_events log for re-engagement chapter selection.

-- 1. Expansion relationship + per-chapter transcript on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN parent_podcast_id uuid REFERENCES public.podcasts(id) ON DELETE SET NULL,
  ADD COLUMN source_chapter_title text,
  ADD COLUMN expansion_prompt_sent_at timestamptz,
  ADD COLUMN chapter_transcripts jsonb,
  ADD CONSTRAINT podcasts_expansion_consistency
    CHECK (parent_podcast_id IS NULL OR source_chapter_title IS NOT NULL);

-- 2. Idempotency: a chapter can be expanded exactly once per parent
--    (excluding soft-deleted expansions so users can re-roll a bad one)
CREATE UNIQUE INDEX idx_podcasts_unique_expansion
  ON public.podcasts (parent_podcast_id, source_chapter_title)
  WHERE parent_podcast_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Lookup index for "which expansions has this podcast spawned?"
CREATE INDEX idx_podcasts_parent
  ON public.podcasts (parent_podcast_id)
  WHERE parent_podcast_id IS NOT NULL;

-- 4. Feature-introduced flag on profiles (coach-mark gate)
ALTER TABLE public.profiles
  ADD COLUMN has_used_expand boolean NOT NULL DEFAULT false;

-- 5. Playback event log (drives chapter selection heuristic for the push)
CREATE TABLE public.playback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  timestamp_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playback_event_type_valid CHECK (event_type IN ('skip_back', 'skip_forward'))
);

CREATE INDEX idx_playback_events_podcast ON public.playback_events(podcast_id);
CREATE INDEX idx_playback_events_user ON public.playback_events(user_id);

ALTER TABLE public.playback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own playback events"
  ON public.playback_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own playback events"
  ON public.playback_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with `name: "chapter_expansions"` and the SQL body. Returns `{ success: true }` on success.

- [ ] **Step 3: Verify schema in remote DB**

Use `mcp__supabase__execute_sql` to confirm:

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='podcasts'
  AND column_name IN ('parent_podcast_id', 'source_chapter_title',
                       'expansion_prompt_sent_at', 'chapter_transcripts');
```

Expected: 4 rows with the right types (uuid, text, timestamptz, jsonb).

```sql
SELECT to_regclass('public.playback_events');
```

Expected: `public.playback_events` (non-null).

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='has_used_expand';
```

Expected: 1 row.

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add supabase/migrations/00019_chapter_expansions.sql && git commit -m "$(cat <<'EOF'
db: migration 00019 — chapter expansions foundation

Adds the schema for v15: parent_podcast_id + source_chapter_title +
chapter_transcripts + expansion_prompt_sent_at on podcasts, has_used_expand
on profiles, new playback_events table with own-row RLS.

Partial unique index on (parent_podcast_id, source_chapter_title) where
parent set + not soft-deleted: enforces "expand each chapter once per
parent" while allowing re-roll via soft-delete.

Migration applied to remote via mcp__supabase__apply_migration.
EOF
)"
```

---

## Chunk 2: Mobile database types

### Task 2: Regenerate mobile types

**Files:**
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Locate existing podcasts/profiles types**

```bash
grep -n "podcasts\|profiles\|playback_events" "/Users/isuru/personal/AI Podcast App/mobile/src/types/database.ts" | head -20
```

- [ ] **Step 2: Add columns to podcasts Row/Insert/Update interfaces**

Within `podcasts: {`, add to the `Row` interface (after `audio_url` or similar):

```ts
parent_podcast_id: string | null
source_chapter_title: string | null
expansion_prompt_sent_at: string | null
chapter_transcripts: Json | null
```

Same fields (as optional) to `Insert` and `Update` interfaces in the same block.

- [ ] **Step 3: Add has_used_expand to profiles Row/Insert/Update**

Within `profiles: {`:
- `Row`: `has_used_expand: boolean`
- `Insert`: `has_used_expand?: boolean`
- `Update`: `has_used_expand?: boolean`

- [ ] **Step 4: Add playback_events table type**

After the profiles block, add:

```ts
playback_events: {
  Row: {
    id: string
    user_id: string
    podcast_id: string
    event_type: "skip_back" | "skip_forward"
    timestamp_seconds: number
    created_at: string
  }
  Insert: {
    id?: string
    user_id?: string
    podcast_id: string
    event_type: "skip_back" | "skip_forward"
    timestamp_seconds: number
    created_at?: string
  }
  Update: {
    id?: string
    user_id?: string
    podcast_id?: string
    event_type?: "skip_back" | "skip_forward"
    timestamp_seconds?: number
    created_at?: string
  }
  Relationships: []
}
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/types/database.ts && git commit -m "types(mobile): expansion + playback_events columns from migration 00019"
```

---

## Chunk 3: Pipeline state additions

### Task 3: Add expansion fields to PipelineState

**Files:**
- Modify: `pipeline/src/podcast_pipeline/state.ts`
- Modify: `pipeline/tests/state.test.ts`

- [ ] **Step 1: Add Annotations to state schema**

In `state.ts`, find the existing `PipelineState = Annotation.Root({...})` block. Add new fields alongside the other inputs (after `voice`):

```ts
  // Expansion mode — null on new-podcast generation, set when parent
  // submission produces a continuation episode.
  parentPodcastId: Annotation<string | null>,
  sourceChapterTitle: Annotation<string | null>,
  parentResearchDigest: Annotation<string | null>,
  parentResearchDocument: Annotation<Record<string, unknown> | null>,
  parentChapterTranscript: Annotation<string | null>,
  hasUsedExpand: Annotation<boolean>,
```

- [ ] **Step 2: Update `makeInitialState` defaults**

In the `defaults: PipelineStateType = {...}` block, add:

```ts
    parentPodcastId: null,
    sourceChapterTitle: null,
    parentResearchDigest: null,
    parentResearchDocument: null,
    parentChapterTranscript: null,
    hasUsedExpand: false,
```

- [ ] **Step 3: Write a state test**

Append to `pipeline/tests/state.test.ts`:

```ts
  it("defaults expansion-mode fields to null/false on new podcast", () => {
    const state = makeInitialState({
      podcastId: "p1",
      userId: "u1",
      topic: "x",
    });
    expect(state.parentPodcastId).toBeNull();
    expect(state.sourceChapterTitle).toBeNull();
    expect(state.parentResearchDigest).toBeNull();
    expect(state.parentResearchDocument).toBeNull();
    expect(state.parentChapterTranscript).toBeNull();
    expect(state.hasUsedExpand).toBe(false);
  });

  it("accepts expansion-mode fields via overrides", () => {
    const state = makeInitialState({
      podcastId: "p2",
      parentPodcastId: "p-parent",
      sourceChapterTitle: "Why fast",
      parentResearchDigest: "digest text",
      parentResearchDocument: { sections: [] },
      parentChapterTranscript: "chapter text",
      hasUsedExpand: true,
    });
    expect(state.parentPodcastId).toBe("p-parent");
    expect(state.sourceChapterTitle).toBe("Why fast");
    expect(state.hasUsedExpand).toBe(true);
  });
```

- [ ] **Step 4: Run tests + type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/state.test.ts 2>&1 | tail -10
```

Expected: tsc clean, 2 new tests pass alongside existing ones.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/state.ts pipeline/tests/state.test.ts && git commit -m "feat(pipeline): add expansion-mode fields to PipelineState"
```

---

## Chunk 4: metadataWriter — populate chapter_transcripts

### Task 4: Build chapter-aligned transcript map

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/metadataWriter.ts`
- Modify: `pipeline/tests/metadataWriter.test.ts`

- [ ] **Step 1: Add `extractChapterTranscripts` helper**

In `metadataWriter.ts` after `extractChapters`, add an exported helper:

```ts
/**
 * Splits the (pre-strip) script on [CHAPTER:] markers and returns a
 * { chapterTitle: chapterText } map. Used to populate podcasts.chapter_transcripts
 * so expansions can extract just the relevant chapter as scriptWriter
 * callback context. The flat transcript field stays as-is (markers stripped,
 * for mobile display).
 */
export function extractChapterTranscripts(script: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on chapter markers but capture the marker so we can pair title+text
  const parts = script.split(/(\[CHAPTER:\s*[^\]]+\])/g);
  // parts looks like: ["preamble", "[CHAPTER: A]", "text A", "[CHAPTER: B]", "text B", ...]
  // Skip the preamble (before first chapter); take pairs of (marker, text)
  for (let i = 1; i < parts.length; i += 2) {
    const markerMatch = parts[i].match(/\[CHAPTER:\s*([^\]]+)\]/);
    if (!markerMatch) continue;
    const title = markerMatch[1].trim();
    const rawText = (parts[i + 1] ?? "");
    // Strip any AD markers that snuck inside; keep prose only
    const text = rawText
      .replace(/\[AD:[^\]]+\]\n?/g, "")
      .trim();
    if (text) {
      result[title] = text;
    }
  }
  return result;
}
```

- [ ] **Step 2: Use it in `metadataWriter`**

Find the existing `.update({ ... })` block. Just BEFORE it, add:

```ts
const chapterTranscripts = extractChapterTranscripts(script);
```

Then add `chapter_transcripts: chapterTranscripts,` to the update object alongside `chapter_markers`.

- [ ] **Step 3: Write the failing test**

Append to `pipeline/tests/metadataWriter.test.ts`:

```ts
import { extractChapterTranscripts } from "../src/podcast_pipeline/nodes/metadataWriter.js";

describe("extractChapterTranscripts", () => {
  it("splits script on chapter markers and returns title→text map", () => {
    const script = `Preamble before any marker.

[CHAPTER: Opening]
Hello world. This is the opening.

[CHAPTER: Middle]
Middle content here.

[CHAPTER: Closer]
Final thoughts.`;
    const out = extractChapterTranscripts(script);
    expect(Object.keys(out)).toEqual(["Opening", "Middle", "Closer"]);
    expect(out["Opening"]).toContain("Hello world");
    expect(out["Middle"]).toContain("Middle content here");
    expect(out["Closer"]).toContain("Final thoughts");
  });

  it("strips AD markers from chapter text", () => {
    const script = `[CHAPTER: A]
Some prose.
[AD:MID_ROLL]
More prose.`;
    const out = extractChapterTranscripts(script);
    expect(out["A"]).not.toContain("[AD:");
    expect(out["A"]).toContain("Some prose");
    expect(out["A"]).toContain("More prose");
  });

  it("returns empty object when no chapter markers present", () => {
    expect(extractChapterTranscripts("just text no markers")).toEqual({});
  });

  it("skips chapters with empty text", () => {
    const script = `[CHAPTER: Empty][CHAPTER: Real]
Content`;
    const out = extractChapterTranscripts(script);
    expect(out).toEqual({ Real: "Content" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails first, then passes after the edit above**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/metadataWriter.test.ts 2>&1 | tail -15
```

Expected: 4 new tests pass.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add pipeline/src/podcast_pipeline/nodes/metadataWriter.ts pipeline/tests/metadataWriter.test.ts && git commit -m "feat(pipeline): metadataWriter populates chapter_transcripts for expansion lookup"
```

---

## Chunk 5: briefBuilder — expansion mode

### Task 5: Add expansion prompt + branching

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/briefBuilder.ts`
- Modify: `pipeline/tests/briefBuilder.test.ts`

- [ ] **Step 1: Add `BRIEF_BUILDER_EXPANSION_PROMPT` to config.ts**

In `config.ts`, after the existing `BRIEF_BUILDER_PROMPT`:

```ts
export const BRIEF_BUILDER_EXPANSION_PROMPT = `You are preparing a research brief for a CONTINUATION podcast episode that deepens a specific chapter of a parent podcast.

Inputs you'll receive:
- The parent podcast's topic (broad subject)
- The source chapter title (what we're going deeper on)
- A digest of what the parent's research already covered (so you don't duplicate)
- The transcript of the source chapter (what was actually said)

Output a JSON object with:
- "scope": what THIS expansion should cover (narrowly: the chapter's specific territory)
- "angle": pick up from where the parent chapter ended — what wasn't fully answered?
- "depth": same as the parent (the listener wants more substance, not introductory framing)
- "keyQuestions": list of 3-5 specific questions to research that DEEPEN the chapter without repeating what the parent already covered

Avoid generic "what is X" questions. The listener already heard the parent's coverage. Drill into:
- Specific mechanisms the parent hand-waved
- Concrete case studies the parent gestured at
- Tensions or open questions the parent raised but didn't resolve
- Recent developments the parent might not have included
`;
```

- [ ] **Step 2: Branch in `briefBuilder.ts`**

Read current `briefBuilder.ts`:

```bash
cat "/Users/isuru/personal/AI Podcast App/pipeline/src/podcast_pipeline/nodes/briefBuilder.ts"
```

Replace the existing function body to branch on `state.parentPodcastId`:

```ts
export async function briefBuilder(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  await persistStatus(state.podcastId, "researching");

  const isExpansion = !!state.parentPodcastId;
  const model = new ChatOpenAI({ modelName: "gpt-4o", maxTokens: 500 });
  const structured = model.withStructuredOutput(BriefSchema, { name: "research_brief" });

  let systemPrompt: string;
  let userContent: string;

  if (isExpansion) {
    systemPrompt = BRIEF_BUILDER_EXPANSION_PROMPT;
    userContent =
      `Parent topic: ${state.topic}\n\n` +
      `Source chapter title: ${state.sourceChapterTitle}\n\n` +
      `Parent research digest:\n${state.parentResearchDigest ?? "(none)"}\n\n` +
      `Source chapter transcript:\n${state.parentChapterTranscript ?? "(none)"}`;
  } else {
    systemPrompt = BRIEF_BUILDER_PROMPT;
    const answersText = (state.clarifyingAnswers ?? [])
      .map((a: any) => `Q: ${a.q ?? ""}\nA: ${a.a ?? ""}`)
      .join("\n");
    userContent = `Topic: ${state.topic}\n\nUser's answers:\n${answersText}`;
  }

  const result = await structured.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]);

  return { researchBrief: JSON.stringify(result), status: "researching" };
}
```

Update the import line at the top of the file to include `BRIEF_BUILDER_EXPANSION_PROMPT`:

```ts
import { BRIEF_BUILDER_PROMPT, BRIEF_BUILDER_EXPANSION_PROMPT } from "../config.js";
```

- [ ] **Step 3: Write the failing test**

Read current `briefBuilder.test.ts` first to understand the mock setup, then append:

```ts
describe("briefBuilder expansion mode", () => {
  it("uses BRIEF_BUILDER_EXPANSION_PROMPT when parentPodcastId is set", async () => {
    // Reset module mocks as needed (follow existing test file's pattern)
    const mockInvoke = vi.fn().mockResolvedValue({
      scope: "deep dive on X",
      angle: "extend parent's coverage",
      depth: "expert",
      keyQuestions: ["q1", "q2", "q3"],
    });
    // ... wire up mock for ChatOpenAI.withStructuredOutput().invoke
    // (mirror the existing test's setup)

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "AI environmental impact",
      parentPodcastId: "parent-id",
      sourceChapterTitle: "Data center energy",
      parentResearchDigest: "Section A: covered. Section B: covered.",
      parentChapterTranscript: "We talked about X and Y.",
    } as any);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const messages = mockInvoke.mock.calls[0][0];
    expect(messages[0].content).toContain("CONTINUATION");
    expect(messages[1].content).toContain("Parent topic: AI environmental impact");
    expect(messages[1].content).toContain("Source chapter title: Data center energy");
    expect(messages[1].content).toContain("Section A: covered");
    expect(messages[1].content).toContain("We talked about X and Y");
  });

  it("uses BRIEF_BUILDER_PROMPT when parentPodcastId is null", async () => {
    // Same mock setup
    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "Octopus cognition",
      clarifyingAnswers: [{ q: "How technical?", a: "beginner" }],
      parentPodcastId: null,
    } as any);

    const messages = mockInvoke.mock.calls[0][0];
    expect(messages[0].content).toContain("research brief");
    expect(messages[0].content).not.toContain("CONTINUATION");
    expect(messages[1].content).toContain("Topic: Octopus cognition");
  });
});
```

Note: the test mock setup mirrors the existing test patterns in `briefBuilder.test.ts`. Read that file first and follow its conventions.

- [ ] **Step 4: Run tests + type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/briefBuilder.test.ts 2>&1 | tail -15
```

Expected: tsc clean, 2 new tests + existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/briefBuilder.ts pipeline/tests/briefBuilder.test.ts && git commit -m "feat(pipeline): briefBuilder expansion-mode prompt + branching"
```

---

## Chunk 6: deepResearchAgent — planner + synthesizer parent context

### Task 6: Planner sees digest

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/research/planner.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/research/prompts.ts` (likely lives here based on imports)
- Modify: `pipeline/tests/planner.test.ts`

- [ ] **Step 1: Locate the planner prompt**

```bash
grep -n "PLANNER_PROMPT" "/Users/isuru/personal/AI Podcast App/pipeline/src/podcast_pipeline/nodes/research/"*.ts
```

Likely in `prompts.ts`. Read it:

```bash
cat "/Users/isuru/personal/AI Podcast App/pipeline/src/podcast_pipeline/nodes/research/prompts.ts"
```

- [ ] **Step 2: Add a digest-injection placeholder to PLANNER_PROMPT**

In `prompts.ts`, modify `PLANNER_PROMPT` to include a new placeholder where parent context lives (after the existing `{retryContext}` line, before `{researchBrief}`):

```ts
{parentContext}
```

Then in the same file (or a sibling exported constant), add:

```ts
export const PLANNER_PARENT_CONTEXT = `IMPORTANT CONTEXT: this is a continuation episode that deepens a parent podcast's chapter. The parent already covered the following topology of material — your sub-questions should DRILL DEEPER, not duplicate. Do not propose questions that just re-cover what the parent already established.

Parent topic: {parentTopic}
Source chapter title: {sourceChapterTitle}

Parent research digest (already-covered topology):
{parentResearchDigest}
`;
```

- [ ] **Step 3: Inject parent context in `planner.ts` when state set**

In `planner.ts`'s `runPlanner` function, the existing `prompt` builds via `PLANNER_PROMPT.replace(...)`. Add a new replacement step before the final `.replace("{researchBrief}", ...)`:

```ts
const parentContext =
  state?.parentPodcastId
    ? PLANNER_PARENT_CONTEXT.replace("{parentTopic}", state.parentTopic ?? "")
        .replace("{sourceChapterTitle}", state.sourceChapterTitle ?? "")
        .replace("{parentResearchDigest}", state.parentResearchDigest ?? "")
    : "";

const prompt = PLANNER_PROMPT
  .replace("{retryContext}", retryContext)
  .replace("{parentContext}", parentContext)
  .replace("{researchBrief}", researchBrief);
```

Note: `runPlanner` doesn't currently take the full pipeline state. **Refactor**: change its signature to accept `expansion` context as a discrete arg (parentPodcastId, parentTopic, sourceChapterTitle, parentResearchDigest), passed by `deepResearchAgent` from `state`. Don't pass the whole state — keep the planner's interface tight.

Update `runPlanner` signature:

```ts
export interface PlannerInput {
  researchIterations: number;
  credibilityReport?: string;
  droppedQuestions?: string[];
  expansion?: {
    parentTopic: string;
    sourceChapterTitle: string;
    parentResearchDigest: string;
  };
}
```

Use `ctx.expansion` instead of `state?.parentPodcastId` in the planner.

Update `deepResearchAgent.ts` to pass the expansion context to `runPlanner` when `state.parentPodcastId` is set.

- [ ] **Step 4: Test that digest appears in planner prompt**

Append to `pipeline/tests/planner.test.ts`:

```ts
describe("runPlanner expansion-mode parent context", () => {
  it("includes parent context block when expansion provided", async () => {
    // Mock the makeOpenRouterModel + withStructuredOutput().invoke to capture prompt
    const captured: string[] = [];
    // ... wire up mock to push the prompt arg to captured

    const tasks = await runPlanner(
      JSON.stringify({ keyQuestions: ["q1", "q2", "q3"] }),
      {
        researchIterations: 0,
        expansion: {
          parentTopic: "AI environmental impact",
          sourceChapterTitle: "Data center energy",
          parentResearchDigest: "Section A: covered.",
        },
      },
    );

    expect(captured[0]).toContain("continuation episode");
    expect(captured[0]).toContain("AI environmental impact");
    expect(captured[0]).toContain("Section A: covered");
  });

  it("omits parent context block when no expansion provided", async () => {
    const captured: string[] = [];
    await runPlanner(
      JSON.stringify({ keyQuestions: ["q1", "q2", "q3"] }),
      { researchIterations: 0 },
    );
    expect(captured[0]).not.toContain("continuation episode");
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/planner.test.ts 2>&1 | tail -10 && git add pipeline/src/podcast_pipeline/nodes/research/prompts.ts pipeline/src/podcast_pipeline/nodes/research/planner.ts pipeline/src/podcast_pipeline/nodes/deepResearchAgent.ts pipeline/tests/planner.test.ts && git commit -m "feat(pipeline): planner accepts expansion parent context"
```

### Task 7: Synthesizer sees full parent doc

**Files:**
- Modify: `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/research/prompts.ts`
- Modify: `pipeline/tests/synthesizer.test.ts`

- [ ] **Step 1: Add `SYNTHESIZER_PARENT_PRIORS` to prompts.ts**

```ts
export const SYNTHESIZER_PARENT_PRIORS = `IMPORTANT: this is a continuation episode. Your research_document should LAYER ON TOP of the parent's coverage, not replicate it. The listener already heard the parent — your job is to add depth, not re-establish basics.

Parent topic: {parentTopic}
Source chapter title: {sourceChapterTitle}

Parent research (DO NOT REPRODUCE — extend or contextualize instead):
{parentResearchDocument}
`;
```

- [ ] **Step 2: Modify SYNTHESIZER_PROMPT to include {parentPriors} placeholder**

In `prompts.ts`, find the existing `SYNTHESIZER_PROMPT` and add a placeholder line near the top context:

```ts
{parentPriors}
```

- [ ] **Step 3: Update `runSynthesizer` signature**

In `synthesizer.ts`, accept an optional `expansion` arg similar to planner:

```ts
export async function runSynthesizer(
  usable: SubagentFindings[],
  droppedQuestions: string[],
  config?: RunnableConfig,
  expansion?: {
    parentTopic: string;
    sourceChapterTitle: string;
    parentResearchDocument: Record<string, unknown>;
  },
): Promise<ResearchDocument> {
  // ...
  const parentPriors = expansion
    ? SYNTHESIZER_PARENT_PRIORS
        .replace("{parentTopic}", expansion.parentTopic)
        .replace("{sourceChapterTitle}", expansion.sourceChapterTitle)
        .replace("{parentResearchDocument}", JSON.stringify(expansion.parentResearchDocument, null, 2))
    : "";
  const prompt = `${SYNTHESIZER_PROMPT.replace("{parentPriors}", parentPriors)}\n\nInput payload:\n${payload}`;
  // ... rest unchanged
}
```

Update `deepResearchAgent.ts` to pass expansion context to `runSynthesizer` when `state.parentPodcastId` is set.

- [ ] **Step 4: Test prompt content**

Add to `synthesizer.test.ts`:

```ts
describe("runSynthesizer expansion priors", () => {
  it("injects parent research as priors when expansion provided", async () => {
    const captured: string[] = [];
    // mock makeOpenRouterModel → invoke → capture prompt[0].content

    await runSynthesizer(
      [{ question: "q1", findings: "...", sources: [], status: "success", claims: [] }],
      [],
      undefined,
      {
        parentTopic: "T",
        sourceChapterTitle: "C",
        parentResearchDocument: { sections: [{ title: "S1", content: "C1" }] },
      },
    );

    expect(captured[0]).toContain("LAYER ON TOP");
    expect(captured[0]).toContain("Source chapter title: C");
    expect(captured[0]).toContain("S1");
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/synthesizer.test.ts 2>&1 | tail -10 && git add pipeline/src/podcast_pipeline/nodes/research/prompts.ts pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts pipeline/src/podcast_pipeline/nodes/deepResearchAgent.ts pipeline/tests/synthesizer.test.ts && git commit -m "feat(pipeline): synthesizer accepts parent research priors for expansion"
```

---

## Chunk 7: scriptWriter — B-mode continuation prompt

### Task 8: Add expansion prompt + branching

**Files:**
- Modify: `pipeline/src/podcast_pipeline/config.ts`
- Modify: `pipeline/src/podcast_pipeline/nodes/scriptWriter.ts`
- Modify: `pipeline/tests/scriptWriter.test.ts`

- [ ] **Step 1: Add `SCRIPT_WRITER_EXPANSION_PROMPT` to config.ts**

After existing `SCRIPT_WRITER_PROMPT`:

```ts
export const SCRIPT_WRITER_EXPANSION_PROMPT = `You are writing a CONTINUATION episode of a podcast series. The listener already heard the parent podcast and now wants more depth on a specific chapter.

This script will be rendered as expressive audio by a TTS model with a chosen voice (warm, conversational, low-energy confident). Write for the ear, not the eye.

CRITICAL OPENING RULE: your first chapter MUST open with a callback to the source chapter. Not "today we'll explore" or "imagine for a moment" — instead, sound like you're picking up a conversation: "Back in the chapter on \${sourceChapterTitle} we touched on X. Let's go deeper." Or: "Last time when I talked about \${sourceChapterTitle}, there was a moment where..." — make it feel like a continuation, not a restart.

Inputs:
- Source chapter title (the parent chapter being deepened)
- Source chapter transcript (what was actually said in the parent)
- The new research_document built specifically for this expansion (deeper, more specific)

What this script should do:
- Open with a clear callback to the source chapter (rule above)
- Pick up where the parent chapter ended in substance, not in time
- Add depth, specifics, mechanisms, cases — DON'T re-introduce material the parent already covered
- Build 4-6 chapters of your own depth (which can themselves be expanded later)
- Close in a way that lands the specific deepening — not "thanks for listening"

Hard avoids (same as parent):
- Rhetorical self-Q&A
- "Welcome to", "Today we're going to", "In this episode", "Let's dive in"
- Generic transitions
- Listicle scaffolding
- Section signposting
- Theatrical openings
- Inline audio tags (later pass handles these)

Length: aim for {targetWords} words. Hard floor: 5400 words. Going long is fine; going short is not.

Voice rules: same as the parent — short sentences land, long sentences breathe, contractions natural, em-dash asides, restarts conversational, dry humor on a beat. Read each chapter's opening aloud in your head.

After the script, output the chapter_research_map JSON block (same format as the parent's pipeline).

{disclaimerContext}

Source chapter title: {sourceChapterTitle}

Source chapter transcript (what was said in the parent):
{parentChapterTranscript}

Research document (built for THIS expansion):
{researchDocument}

Sources:
{sources}
`;
```

- [ ] **Step 2: Branch in `scriptWriter.ts`**

In `scriptWriter.ts`, replace the prompt-building section:

```ts
const isExpansion = !!state.parentPodcastId;
const promptTemplate = isExpansion ? SCRIPT_WRITER_EXPANSION_PROMPT : SCRIPT_WRITER_PROMPT;

const prompt = promptTemplate
  .replace("{targetWords}", String(TARGET_WORD_COUNT))
  .replace("{researchDocument}", JSON.stringify(researchDocument))
  .replace("{sources}", JSON.stringify(sources))
  .replace("{disclaimerContext}", disclaimerContext)
  .replace("{sourceChapterTitle}", state.sourceChapterTitle ?? "")
  .replace("{parentChapterTranscript}", state.parentChapterTranscript ?? "");
```

Add `SCRIPT_WRITER_EXPANSION_PROMPT` to the import line.

- [ ] **Step 3: Test prompt selection**

Add to `scriptWriter.test.ts`:

```ts
describe("scriptWriter expansion mode", () => {
  it("uses SCRIPT_WRITER_EXPANSION_PROMPT when parentPodcastId set", async () => {
    // Mock openai.chat.completions.create to capture the prompt
    const captured: string[] = [];
    // ... wire up mock to push messages[0].content to captured

    await scriptWriter({
      podcastId: "p1",
      userId: "u1",
      parentPodcastId: "parent",
      sourceChapterTitle: "Why fast",
      parentChapterTranscript: "We discussed X.",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
    } as any);

    expect(captured[0]).toContain("CONTINUATION");
    expect(captured[0]).toContain("Source chapter title: Why fast");
    expect(captured[0]).toContain("We discussed X");
  });

  it("uses SCRIPT_WRITER_PROMPT when parentPodcastId null", async () => {
    const captured: string[] = [];
    await scriptWriter({
      podcastId: "p1",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
      parentPodcastId: null,
    } as any);
    expect(captured[0]).not.toContain("CONTINUATION");
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/scriptWriter.test.ts 2>&1 | tail -10 && git add pipeline/src/podcast_pipeline/config.ts pipeline/src/podcast_pipeline/nodes/scriptWriter.ts pipeline/tests/scriptWriter.test.ts && git commit -m "feat(pipeline): scriptWriter B-mode continuation prompt for expansions"
```

---

## Chunk 8: submitPodcast — expansion handler

### Task 9: Accept + validate expansion request

**Files:**
- Modify: `pipeline/src/routes/submitPodcast.ts`
- Modify: `pipeline/tests/integration/api.test.ts`

This is the biggest single file change. Read the existing handler first, then transform.

- [ ] **Step 1: Re-read current `submitPodcast.ts` structure**

```bash
cat "/Users/isuru/personal/AI Podcast App/pipeline/src/routes/submitPodcast.ts"
```

- [ ] **Step 2: Add expansion field extraction**

In the route handler body, after `const clarifyingAnswers = ...`:

```ts
const parentPodcastId: string | undefined = body.parentPodcastId ?? body.parent_podcast_id;
const sourceChapterTitle: string | undefined = body.sourceChapterTitle ?? body.source_chapter_title;
const isExpansion = !!parentPodcastId;

if (isExpansion && !sourceChapterTitle) {
  return c.json({ error: "sourceChapterTitle required when parentPodcastId set" }, 400);
}
```

- [ ] **Step 3: Add a parent-lookup helper above the route handler**

```ts
interface ParentContext {
  topic: string;
  chapter_markers: Array<{ timestampSeconds: number; title: string }>;
  chapter_transcripts: Record<string, string> | null;
  research_document: Record<string, unknown>;
}

async function fetchParentContext(
  serviceClient: ReturnType<typeof createClient>,
  parentId: string,
  userId: string,
): Promise<ParentContext | null> {
  const { data, error } = await serviceClient
    .from("podcasts")
    .select("user_id, topic, chapter_markers, chapter_transcripts, research_contexts(research_document)")
    .eq("id", parentId)
    .is("deleted_at", null)
    .single();
  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  // research_contexts is joined as an object via the supabase relationship
  const researchDoc =
    (Array.isArray((data as any).research_contexts)
      ? (data as any).research_contexts[0]?.research_document
      : (data as any).research_contexts?.research_document) ?? {};
  return {
    topic: data.topic,
    chapter_markers: data.chapter_markers ?? [],
    chapter_transcripts: data.chapter_transcripts ?? null,
    research_document: researchDoc,
  };
}

function buildResearchDigest(researchDocument: Record<string, unknown>): string {
  const sections = (researchDocument as any).sections;
  if (!Array.isArray(sections) || sections.length === 0) return "(no parent research available)";
  return sections
    .map((s: any) => {
      const title = String(s.title ?? "");
      const firstSentence = String(s.content ?? "")
        .split(/(?<=[.!?])\s/)[0]
        .slice(0, 240);
      return `- ${title}: ${firstSentence}`;
    })
    .join("\n");
}
```

- [ ] **Step 4: Insert expansion validation block**

After the subscription check, BEFORE the credit deduction, insert:

```ts
let expansionContext: {
  parent: ParentContext;
  parentChapterTranscript: string;
  parentResearchDigest: string;
} | null = null;

if (isExpansion) {
  const parent = await fetchParentContext(serviceClient, parentPodcastId!, user.id);
  if (!parent) {
    return c.json({ error: "Parent podcast not found" }, 404);
  }

  const titles = parent.chapter_markers.map((m) => m.title);
  if (!titles.includes(sourceChapterTitle!)) {
    return c.json({ error: "Source chapter not found in parent" }, 400);
  }

  // Check idempotency — same (parent, chapter) already expanded and active?
  const { data: existing } = await serviceClient
    .from("podcasts")
    .select("id")
    .eq("parent_podcast_id", parentPodcastId!)
    .eq("source_chapter_title", sourceChapterTitle!)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    return c.json({ podcastId: existing.id, status: "exists" }, 409);
  }

  // Look up chapter transcript
  const chapterTranscript = parent.chapter_transcripts?.[sourceChapterTitle!];
  if (!chapterTranscript) {
    return c.json(
      { error: "This podcast can't be expanded — regenerate it to enable expansions." },
      400,
    );
  }

  expansionContext = {
    parent,
    parentChapterTranscript: chapterTranscript,
    parentResearchDigest: buildResearchDigest(parent.research_document),
  };
}
```

- [ ] **Step 5: Update the podcast insert to include expansion fields**

In the `.insert({...})` call:

```ts
.insert({
  user_id: user.id,
  topic: isExpansion ? `${expansionContext!.parent.topic}: ${sourceChapterTitle}` : topic,
  clarifying_answers: clarifyingAnswers || [],
  status: "queued",
  has_ads: hasAds,
  voice,
  parent_podcast_id: parentPodcastId ?? null,
  source_chapter_title: sourceChapterTitle ?? null,
})
```

Why the synthesized topic for expansions: gives the library row a sensible title without needing a separate display logic ("AI environmental impact: Data center energy" reads naturally). Mobile can still override via the parent-subtitle pattern.

- [ ] **Step 6: Flip `has_used_expand` after successful insert**

After `await serviceClient.from("credit_transactions").insert({...})`:

```ts
if (isExpansion) {
  await serviceClient
    .from("profiles")
    .update({ has_used_expand: true })
    .eq("id", user.id)
    .eq("has_used_expand", false);
  // idempotent — no-op if already true
}
```

- [ ] **Step 7: Look up `has_used_expand` for the pipeline (always, even on new podcasts)**

Before the `jobManager.enqueue` call:

```ts
const { data: profileRow } = await serviceClient
  .from("profiles")
  .select("has_used_expand")
  .eq("id", user.id)
  .single();
const hasUsedExpand = profileRow?.has_used_expand ?? false;
// NOTE: for an expansion submission, this still reads false PRE-flip because
// the update above and this query don't serialize. Cosmetic — the coach-mark
// only fires on PARENT podcasts (state.parentPodcastId === null), so a stale
// false here on an expansion submission is harmless. For the next parent
// generation, the flag will be true and coach-mark skipped.
```

- [ ] **Step 8: Pass expansion fields to `jobManager.enqueue`**

Update the `enqueue` payload:

```ts
jobManager.enqueue(podcast.id, {
  podcastId: podcast.id,
  userId: user.id,
  topic,
  clarifyingAnswers: clarifyingAnswers || [],
  hasAds,
  tier: subscription.tier,
  voice,
  parentPodcastId: parentPodcastId ?? null,
  sourceChapterTitle: sourceChapterTitle ?? null,
  parentResearchDigest: expansionContext?.parentResearchDigest ?? null,
  parentResearchDocument: expansionContext?.parent.research_document ?? null,
  parentChapterTranscript: expansionContext?.parentChapterTranscript ?? null,
  hasUsedExpand,
});
```

- [ ] **Step 9: Update doc comment at top of file**

```ts
/**
 * POST /api/submit-podcast
 *
 * Validates credits, deducts one credit (CAS), creates podcast record,
 * enqueues pipeline run via job manager.
 *
 * Request body: { topic, clarifyingAnswers?, parentPodcastId?, sourceChapterTitle? }
 *   - parentPodcastId + sourceChapterTitle set: this is a chapter expansion.
 *     Server validates parent ownership, chapter existence, idempotency
 *     (one expansion per parent+chapter), and the parent has chapter_transcripts
 *     populated. Flips profiles.has_used_expand to true after successful submit.
 *
 * Response (new podcast): { podcastId, status: "queued" }
 * Response (existing expansion): 409 { podcastId, status: "exists" }
 */
```

- [ ] **Step 10: Write integration tests**

Append to `pipeline/tests/integration/api.test.ts`:

```ts
describe("POST /api/submit-podcast — expansions", () => {
  // Use the existing test scaffold (admin user, JWT, etc.)

  it("creates an expansion with parent_podcast_id + source_chapter_title set", async () => {
    // Setup: insert a parent podcast with chapter_transcripts populated
    const parentId = await insertParentPodcast({ /* test fixture helper */ });

    const res = await fetch(`${BASE_URL}/api/submit-podcast`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "x",
        parentPodcastId: parentId,
        sourceChapterTitle: "Opening",
      }),
    });
    expect(res.status).toBe(200);
    const { podcastId } = await res.json();
    // Verify DB row
    const { data: row } = await admin.from("podcasts").select("*").eq("id", podcastId).single();
    expect(row.parent_podcast_id).toBe(parentId);
    expect(row.source_chapter_title).toBe("Opening");
  });

  it("returns 404 when parent is owned by a different user (don't leak existence)", async () => {
    const otherParentId = await insertParentForOtherUser(/* ... */);
    const res = await fetch(`${BASE_URL}/api/submit-podcast`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", parentPodcastId: otherParentId, sourceChapterTitle: "X" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when source chapter title doesn't match parent.chapter_markers", async () => {
    const parentId = await insertParentPodcast({ /* fixture with markers [Opening, Middle, Closer] */ });
    const res = await fetch(`${BASE_URL}/api/submit-podcast`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", parentPodcastId: parentId, sourceChapterTitle: "DoesNotExist" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 with existing podcastId when same (parent, chapter) already expanded", async () => {
    const parentId = await insertParentPodcast({ /* ... */ });
    // First submission succeeds
    const firstRes = await fetch(/* ... sourceChapterTitle: "Opening" */);
    const { podcastId: firstId } = await firstRes.json();
    // Second submission with same parent + chapter
    const secondRes = await fetch(/* ... same body */);
    expect(secondRes.status).toBe(409);
    expect((await secondRes.json()).podcastId).toBe(firstId);
  });

  it("returns 400 when parent has no chapter_transcripts (legacy podcast)", async () => {
    const legacyParentId = await insertParentPodcast({ chapter_transcripts: null });
    const res = await fetch(/* ... parentPodcastId: legacyParentId, sourceChapterTitle: "Opening" */);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/regenerate/);
  });

  it("flips profiles.has_used_expand to true on first expansion submit", async () => {
    // Verify pre-state: profile has_used_expand = false
    const parentId = await insertParentPodcast({ /* ... */ });
    await fetch(/* ... successful expansion submit */);
    const { data: profile } = await admin.from("profiles").select("has_used_expand").eq("id", userId).single();
    expect(profile.has_used_expand).toBe(true);
  });
});
```

The `insertParentPodcast` helper sets up a complete parent (status=complete, chapter_markers, chapter_transcripts populated, research_contexts row) for the user owning `userJwt`. Mirror the pattern in the existing `api.test.ts` fixtures.

- [ ] **Step 11: Run tests + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run tests/integration/api.test.ts 2>&1 | tail -20 && git add pipeline/src/routes/submitPodcast.ts pipeline/tests/integration/api.test.ts && git commit -m "$(cat <<'EOF'
feat(submit-podcast): accept parentPodcastId + sourceChapterTitle

Implements the expansion submit path:
- 404 on parent not found / not owned (no leak)
- 400 on chapter title not in parent.chapter_markers
- 409 on duplicate expansion (returns existing podcastId)
- 400 on legacy parent missing chapter_transcripts
- Flips profiles.has_used_expand=true after successful expansion submit
- Passes parentResearchDigest, parentResearchDocument, parentChapterTranscript,
  hasUsedExpand into pipeline state via jobManager.enqueue
EOF
)"
```

---

## Chunk 9: jobManager — accept expansion fields

### Task 10: Pipeline state forwarding

**Files:**
- Modify: `pipeline/src/jobs/jobManager.ts` (verify input shape passes through; existing implementation may already accept arbitrary Partial<PipelineStateType>)

- [ ] **Step 1: Verify jobManager handles the new fields**

```bash
grep -n "Partial<PipelineStateType>" "/Users/isuru/personal/AI Podcast App/pipeline/src/jobs/jobManager.ts"
```

The existing `enqueue(podcastId, input: Partial<PipelineStateType>)` already accepts any subset of the pipeline state. Once we added the expansion fields to `PipelineState` in Chunk 3, the type signature flows through automatically.

No code change needed. Just verify the type-check passes.

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean exit.

- [ ] **Step 3: Skip commit if no changes**

If `git status --short pipeline/src/jobs/jobManager.ts` is empty, no commit needed. Move to Chunk 10.

---

## Chunk 10: End-to-end smoke test

### Task 11: Generate a parent + an expansion via curl

**Files:** none modified.

- [ ] **Step 1: Generate a fresh parent podcast on test account**

Use mobile app or curl to submit a podcast. Wait for `status='complete'`. Note the podcast id (call it `PARENT_ID`) and one of its `chapter_markers[].title` strings (call it `CHAPTER`).

- [ ] **Step 2: Verify the parent has chapter_transcripts populated**

```sql
SELECT id, jsonb_object_keys(chapter_transcripts) AS titles
FROM podcasts WHERE id = '<PARENT_ID>';
```

Expected: returns one row per chapter title.

- [ ] **Step 3: Submit an expansion via curl**

```bash
JWT=<user-jwt-from-mobile-or-supabase-auth>
PARENT_ID=<parent-id>
CHAPTER=<chapter-title-exact-match>

curl -X POST "https://podcasts-production-3b07.up.railway.app/api/submit-podcast" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"topic\":\"\",\"parentPodcastId\":\"$PARENT_ID\",\"sourceChapterTitle\":\"$CHAPTER\"}"
```

Expected: `200 OK { podcastId, status: "queued" }`.

- [ ] **Step 4: Watch pipeline progress in Langfuse**

Open Langfuse, find the new podcast trace. Verify:
- briefBuilder uses the EXPANSION prompt (look for "CONTINUATION" in the system message)
- Planner sees parent context block
- Synthesizer sees parent priors block
- scriptWriter uses EXPANSION prompt
- Script opens with a callback to the source chapter

- [ ] **Step 5: Verify resulting DB row**

```sql
SELECT id, parent_podcast_id, source_chapter_title, topic, status, has_ads
FROM podcasts WHERE parent_podcast_id = '<PARENT_ID>';
```

Expected: one row with the new podcast, `status='complete'` after pipeline finishes, sensible synthesized topic.

```sql
SELECT has_used_expand FROM profiles WHERE id = '<USER_ID>';
```

Expected: `true`.

- [ ] **Step 6: Idempotency check — submit the SAME expansion request again**

```bash
curl -X POST ... # same body
```

Expected: `409 { podcastId: <existing>, status: "exists" }`.

- [ ] **Step 7: Listen to the audio (manual)**

Pull the signed `audio_url` from DB, play it. Verify:
- Opens with a callback to the source chapter ("back in the chapter on..." or similar)
- Doesn't re-introduce the topic from scratch
- Stays within Gemini's safe zone (no rushing — should hold ~150-180 WPM)

---

## What ships at the end of v15

- Server can accept expansion requests end-to-end
- Pipeline produces continuation-style scripts that build on parent
- DB has the schema for the rest of the work
- All existing tests still pass; new tests cover the expansion path
- No mobile UI yet — v16 ships the user-facing expand button + ActionSheet + library subtitle + chapter state machine
- No coach-mark + no re-engagement push — v17

## Phase exit criteria

Before declaring v15 done:

- `npx vitest run` in pipeline: all tests green (including new ones, ~165+)
- `npx tsc --noEmit` in pipeline + mobile: both clean
- Manual smoke test (Chunk 10) passes: expansion submit → pipeline runs → audio plays as continuation
- Migration 00019 applied to remote (`mcp__supabase__list_migrations` shows it)
- No remaining `TODO` or `FIXME` markers in the modified files

## Reverting if needed

If something goes badly wrong post-deploy:

1. Re-deploy Railway from a commit before this plan landed
2. Migration is additive (new columns nullable, new table) — leaves existing rows intact, can be rolled back via `DROP TABLE playback_events; ALTER TABLE podcasts DROP COLUMN parent_podcast_id, DROP COLUMN source_chapter_title, DROP COLUMN expansion_prompt_sent_at, DROP COLUMN chapter_transcripts; ALTER TABLE profiles DROP COLUMN has_used_expand;` if necessary, but greenfield with no real users means we'd just fix forward
