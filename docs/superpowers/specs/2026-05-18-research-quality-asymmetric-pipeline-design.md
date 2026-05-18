# Research Quality — Asymmetric Pipeline Design

ChatGPT Deep Research produces long, dense reports. Our research docs are much shorter, and expansions shrink further still. Today's pipeline runs a single planner → subagents → synthesizer loop with hard token caps. Subagents reason over 200-char Tavily snippets, not full articles. Expansion mode injects the entire parent research doc into the synthesizer prompt as anti-duplication context, eating 2–4K of the 16K cap before new findings are even processed.

This spec replaces that with two separate subgraphs: a breadth pipeline for parent episodes and a depth pipeline for expansions. The depth pipeline runs iterative deepening — round 1 always, round 2 gated by an LLM auditor that flags thin claims. Search routing across Tavily, Exa, and web_fetch happens upstream in the planner. Free tier gets every feature, just with tighter budgets.

## Why asymmetric

Parent episodes need breadth — distinct angles, wide coverage, the survey shape that lets a 20-minute podcast feel like a tour. Expansions need depth — the user already heard the parent's claim about Topic X and tapped expand because they want the rabbit hole, not the summary.

Today's pipeline treats them the same and adds `expansion` mode flags inside shared nodes. The flag approach makes both modes mediocre. Splitting into two subgraphs that share only utility helpers (search clients, web_fetch, parent-context builders) means we can tune breadth and depth independently and the trace is readable.

## Relationship to existing qualityGate

Today's `qualityGate` node (`pipeline/src/podcast_pipeline/nodes/qualityGate.ts`) is a credibility-score retry loop — it runs after `deepResearchAgent`, and if `credibilityScore < 0.7` it loops back for up to 2 retries before forcing `needsDisclaimer`. That loop is a band-aid for thin research; the new design solves thinness structurally (asymmetric pipelines, web_fetch, iterative deepening on expansions).

**Remove `qualityGate` entirely.** Both subgraphs route directly from synthesizer (breadth) or merge (depth) to `scriptWriter`. State fields driving the old loop disappear: `credibilityScore`, `credibilityReport`, `researchIterations`, `shouldRetry`, `needsDisclaimer`.

The one job qualityGate did that still needs a home is the empty-research check (`hasNoResearchMaterial`). That moves into a small helper called at the end of each pipeline: if `sources.length === 0 && sections.length === 0`, set `status: "failed"` with the same error message and let the existing failure handler refund the credit. No disclaimer state needed — script writer no longer cares about disclaimer flags.

## Architecture

Two subgraphs branch via a conditional edge **after** `briefBuilder` based on whether `parentPodcastId` is set. `briefBuilder` itself stays a single node — it already handles the expansion-prompt swap. The split happens at the outgoing edge.

```mermaid
flowchart TD
    Start[briefBuilder] -->|parentPodcastId unset| Breadth
    Start -->|parentPodcastId set| Depth

    subgraph Breadth[Breadth Pipeline - Parent Episodes]
        BP[Planner: N questions per tier<br/>see Tier mapping<br/>+ provider routing per task]
        BS[Subagents: Tavily-heavy<br/>+ web_fetch on cited URLs]
        BY[Synthesizer: single pass<br/>specificity-enforced]
        BP --> BS --> BY
    end

    subgraph Depth[Depth Pipeline - Expansions]
        DP[Planner: 3-5 narrow questions<br/>+ covered-ground filter<br/>+ provider routing]
        DS1[Subagents Round 1: Exa-heavy<br/>findSimilar seed + web_fetch]
        DY1[Synthesizer v1]
        DA[Auditor: score claims<br/>flag 3-5 thinnest]
        DG{Quality gate<br/>passes?}
        DS2[Subagents Round 2:<br/>drill flagged items]
        DY2[Synthesizer: merge v1 + v2]
        DP --> DS1 --> DY1 --> DA --> DG
        DG -->|yes| Done1[ResearchDocument]
        DG -->|no| DS2 --> DY2 --> Done1
    end

    BY --> Out[ResearchDocument]
    Done1 --> Out
```

Each subagent task carries a `searchProvider: 'tavily' | 'exa'` field set once by the planner. No runtime provider decision later. Subagent loop: search → web_fetch top-N cited URLs → reflect over full article text → cite. The fetched content threads through to synthesizer and auditor with a `kind` discriminator (`tavily-fetched | exa-fetched | tavily-snippet | exa-snippet`) so downstream nodes know what source they're working from.

## Why Tavily and Exa, not one

They're good at different things. Tavily — keyword search, cheap, optimized for fresh news and mainstream web. Returns clean scraped content tuned for LLM consumption. Exa — neural/semantic search, finds pages by meaning, strong on long-form essays, primary sources, expert writing. Has `findSimilar` (give it a great URL, get more like it).

Parent episodes lean Tavily for the cheap broad questions; a couple of Exa subagents pick up "find the canonical long-form piece." Expansions lean Exa, with `findSimilar` seeded by the strongest cited source from the parent doc. web_fetch sits on top of either provider and is the single biggest quality lever — most of today's thinness comes from synthesizing snippets, not articles.

## Components

```
pipeline/src/podcast_pipeline/
├── nodes/research/
│   ├── breadth/
│   │   ├── planner.ts          [NEW] tier-scaled question count, provider-tagged
│   │   └── synthesizer.ts      [NEW] single-pass, specificity-enforced; sets status="scripting"
│   ├── depth/
│   │   ├── planner.ts          [NEW] tier-scaled, covered-ground aware
│   │   ├── synthesizerV1.ts    [NEW] round 1 synthesis
│   │   ├── auditor.ts          [NEW] pure-LLM claim scoring + drill questions
│   │   ├── qualityGate.ts      [NEW] pure fn, decides if round 2 fires
│   │   └── synthesizerMerge.ts [NEW] merges v1 + round 2; exports buildRound2Tasks(); sets status="scripting"
│   ├── subagent.ts             [REFACTORED] provider-agnostic, web_fetch-enabled
│   └── prompts.ts              [REWRITTEN] specificity + narrative voice
├── tools/
│   ├── tavilySearch.ts         [KEEP] unchanged
│   ├── exaSearch.ts            [NEW] search() + findSimilar()
│   ├── webFetch.ts             [NEW] URL fetch + readability extract
│   └── claimScorer.ts          [NEW] shared between auditor and any future quality hooks
├── lib/
│   └── parentContext.ts        [REFACTORED] buildChapterSection() + buildCoveredGroundDigest()
└── graph.ts                    [REFACTORED] two subgraphs, conditional routing at briefBuilder
```

Auditor and quality gate stay separate. Auditor is the LLM-powered "find the gaps" step; quality gate is a tiny pure function that decides whether the gaps are big enough to warrant round 2. Splitting them means we can swap the auditor without touching threshold logic and the gate is exhaustively unit-testable.

`claimScorer.ts` lives in `tools/` not `depth/` — even though only depth uses it today, it's the kind of thing we'll want as a quality hook on breadth later. Reusable from the start.

## Data flow

LangGraph state shape changes:

**Removed** (with `qualityGate`): `credibilityScore`, `credibilityReport`, `researchIterations`, `shouldRetry`, `needsDisclaimer`.

**Kept** (still set at enqueue time by `submitPodcast` / `recoverStuckJobs`, consumed by `briefBuilder`): `parentPodcastId`, `sourceChapterTitle`, `parentResearchDigest`, `parentResearchDocument`, `parentChapterTranscript`. The digest stays as `briefBuilder` input; `parentResearchDocument` is the input to the new `parentContext` derivation.

**Added** (intermediate state inside the research subgraphs):

```ts
type StateAdditions = {
  // breadth pipeline
  subagentTasks?: SubagentTask[],
  findings?: SubagentFinding[],

  // depth pipeline
  chapterSection?: string,           // sliced parent section, not full doc
  coveredGroundDigest?: string,      // bullet list of parent claims (tighter than parentResearchDigest)
  subagentTasksR1?: SubagentTask[],
  findingsR1?: SubagentFinding[],
  researchDocumentV1?: ResearchDocument,
  auditFindings?: AuditedClaim[],
  subagentTasksR2?: SubagentTask[],
  findingsR2?: SubagentFinding[],
}
```

Final output (`researchDocument`, `sources`) is unchanged from today's schema.

Depth pipeline sequence — breadth is a strict subset (skip parentContext and everything from auditor onward):

```mermaid
sequenceDiagram
    participant BB as briefBuilder
    participant PC as parentContext lib
    participant DP as depth/planner
    participant SA1 as Subagents R1
    participant SV1 as synthesizerV1
    participant AU as auditor
    participant QG as qualityGate
    participant SA2 as Subagents R2
    participant SM as synthesizerMerge

    BB->>PC: load parent doc + chapter title + transcript
    PC-->>BB: chapterSection, coveredGroundDigest
    BB->>DP: state with parent context
    DP-->>SA1: 3-5 SubagentTasks (Exa-heavy)
    loop per subagent
        SA1->>SA1: search → web_fetch top URLs → reflect
    end
    SA1-->>SV1: findingsR1[]
    SV1-->>AU: researchDocumentV1
    AU-->>QG: auditFindings (3-5 weak claims)
    alt Round 2 fires
        QG-->>SA2: drill questions as SubagentTasks
        SA2-->>SM: findingsR2[]
        SM-->>SM: merge v1 + R2, renumber sources
        SM-->>Out: ResearchDocument
    else v1 passes gate
        QG-->>Out: ResearchDocument = v1
    end
```

Round 2 subagents are dispatched from the auditor's drill questions, not re-planned from scratch. The auditor already knows what's thin and why; planner involvement would just add a hop. Source renumbering happens in `synthesizerMerge` — round 1 and round 2 produce overlapping source sets and the final doc needs a single unified citation index. Round 1 sources flow into round 2 via `originatingSourceIndexes` on each `AuditedClaim`, which `buildRound2Tasks` resolves into `seedUrls` so primary sources stay consistent if they show up again.

## Parent context fix

Today, expansion mode `JSON.stringify`s the full parent `research_document` and inlines it into the synthesizer prompt as anti-duplication context. The full doc eats 2–4K tokens of the 16K cap before new findings are processed.

Replace with two narrower inputs built by `buildChapterSection()` and `buildCoveredGroundDigest()`:

- `chapterSection`: the parent doc's section that corresponds to the source chapter. Full content, no truncation. This is what the new research is *expanding from*.
- `coveredGroundDigest`: a bullet list of one-sentence claim summaries from the rest of the parent doc (all sections except the source one), capped at ~800 tokens. This is what the new research should *not duplicate*. If the parent has many sections and the digest exceeds the cap, drop sections by descending position (later sections first) until under budget. Section titles are kept short — title + first sentence per section, no further trimming.

**Section matching is approximate.** `chapter_markers[].title` and `research_document.sections[].title` come from different generation paths and aren't 1:1. `findRelevantSection(chapterTitle, sections)` resolves in this order:

1. Case-insensitive substring match (either direction)
2. Keyword-overlap score on token sets, pick highest score above a 0.3 threshold
3. Fall back to the first section, and log a `parent_context.section_match_fallback` event

The covered-ground digest is built from all sections *except* the matched one. If we fell back to "first section", the digest still excludes that fallback to avoid duplication.

Synthesizer prompt receives both with clear separation. Frees ~2–3K tokens of synthesizer budget for new findings.

## Subagent loop

Subagent today is Tavily-hardcoded and synthesizes from snippets only. New shape:

```ts
type SubagentTask = {
  question: string;
  searchProvider: 'tavily' | 'exa';
  seedUrls?: string[];          // optional; see below
  maxSearches: number;
  maxReflections: number;
  fetchCitedUrls: boolean;      // top-3, 4K tokens per URL cap
};
```

**`seedUrls` provenance**:
- Breadth: always undefined.
- Depth round 1: optional. The depth planner may extract 1–2 high-citation URLs from `chapterSection` and seed them on Exa subagents to drive `findSimilar`. If the parent has no usable URLs, undefined.
- Depth round 2: set by the round-2 task builder (see Auditor section), seeded from the round 1 source that supported the weak claim being drilled.

Per iteration: dispatch search via the provider, accumulate cited claims, pick top-3 URLs by citation strength, run `webFetch` against each, then reflect. The reflection step sees both snippet results and full-article extracts; final cited sources carry the right `kind` discriminator.

`SearchResult` is a common shape both providers normalize to. Otherwise provider-specific shapes leak downstream and the inevitable third provider gets ugly.

## Auditor

Pure LLM (Sonnet 4.6). Takes `researchDocumentV1` plus the source chapter context. Returns:

```ts
type AuditedClaim = {
  originalClaim: string;          // verbatim from v1
  weakness: 'specificity' | 'sourcing' | 'depth';
  drillQuestion: string;          // a real search query, not a gap description
  originatingSourceIndexes: number[]; // indexes into researchDocumentV1.sources
};
```

Prompt directs it to find 3–5 claims that are vague (no specific number/date/name), undersourced (one source or none), or shallow (one-sentence treatment of something the chapter is asking us to drill). Drill questions are framed as search queries, not abstract gap descriptions.

No heuristic prefilter. Pure LLM is simpler code, fewer test edges, and Sonnet handles this well in single pass.

**Round 2 task construction**: `buildRound2Tasks(audited: AuditedClaim[], state)` is a pure helper exported from `synthesizerMerge.ts`, called by the graph edge from `qualityGate` to round 2 subagents (not its own LangGraph node — keeps the graph shallow). It converts each audited claim to a `SubagentTask`:

```ts
{
  question: audited.drillQuestion,
  searchProvider: 'exa',          // depth is Exa-heavy by default
  seedUrls: audited.originatingSourceIndexes
    .map(i => researchDocumentV1.sources[i]?.url)
    .filter(Boolean),
  maxSearches: TIER_CONFIG[state.tier].searchBudget.maxSearches,
  maxReflections: TIER_CONFIG[state.tier].searchBudget.maxReflections,
  fetchCitedUrls: true,
}
```

Capped at `TIER_CONFIG[state.tier].maxR2Subagents` — if the auditor returns more than the cap, take the first N (auditor is prompted to return them ordered by weakness severity).

## Quality gate

Pure function. Takes `tier` and `auditFindings.length`. Returns `{ fire: boolean }`. The R2 cap is a tier-static config value (`TIER_CONFIG[tier].maxR2Subagents`) — `buildRound2Tasks` reads it directly, the gate doesn't return it.

| Tier | Fire threshold | Max R2 subagents (static cap) |
|------|----------------|------------------------------|
| Free | ≥3 findings | 3 |
| Plus | ≥2 findings | 4 |
| Pro  | ≥1 finding  | 5 |

Tier policy: free gets every feature, tighter budgets. No tier ever gates out a qualitative improvement.

## Tier mapping

Same models and prompts everywhere. Single source of truth — a `TIER_CONFIG` object in `config.ts` that the planners, gate, and `buildRound2Tasks` all read from:

```ts
TIER_CONFIG = {
  free: { breadthQuestions: 5, searchBudget: { maxSearches: 2, maxReflections: 1 }, gateFireThreshold: 3, maxR2Subagents: 3 },
  plus: { breadthQuestions: 6, searchBudget: { maxSearches: 3, maxReflections: 2 }, gateFireThreshold: 2, maxR2Subagents: 4 },
  pro:  { breadthQuestions: 8, searchBudget: { maxSearches: 5, maxReflections: 2 }, gateFireThreshold: 1, maxR2Subagents: 5 },
}
```

Search budgets match today's `RESEARCH_BUDGETS` in `config.ts:28-32` so we don't regress on existing runs. Subagent wallclock per subagent stays at 90s — reuses existing `SUBAGENT_WALLCLOCK_MS` constant.

`hasUsedExpand` state field (Plus-tier expand-once gating) is unrelated to this work and stays as-is.

## Error handling

Principle: degrade research quality before failing the run. Audio synthesis and script writing downstream are expensive — a short research doc is salvageable, a failed job is not.

- **Search provider failures**: subagent retries once with backoff. Second failure → record `searchFailed: true` in the finding, synthesizer treats that section as no-results rather than aborting. If both providers go down simultaneously, planner detects via a health check and falls back to single-provider mode with a logged warning.
- **web_fetch failures (404, paywall, timeout, JS-only page)**: per-URL try with hard 10s timeout. Failure is silent — skip that URL, keep the snippet, mark the source as `*-snippet` not `*-fetched`. Paywall/login-wall detection: readability extract returning <200 chars on a 200-status page is treated as snippet-only.
- **Auditor returns empty**: pass the gate, skip round 2, ship v1. This is success, not failure.
- **Auditor returns malformed JSON**: retry once with stricter prompt. Second failure → skip round 2, ship v1.
- **Round 2 timeout**: 90s wall-clock across all R2 subagents. On timeout, merge partials with v1. Full failure with zero findings → ship v1 unchanged.
- **Partial subagent failures**: if >50% of subagents in a round fail, mark the round failed and apply rules above. <50% failures just thread through with empty sections.

## Observability

Posthog (free tier features only — events, properties, no session replay or feature flags).

Per subagent: provider used, search count actual vs budget, fetch attempts vs successes, snippet vs fetched source count, latency.

Per job: which rounds ran, gate decisions, auditor input/output, final source-kind distribution (% fetched vs snippet — leading indicator of quality), total cost estimate per provider.

Source kind distribution is the metric we'll watch hardest. If we ship and see >40% snippet-only sources, web_fetch is silently failing more than expected and the quality lever isn't pulling.

## Testing

Three layers — deterministic plumbing tests, integration tests with mocked externals, manual golden-doc regression tests.

**Unit (deterministic, fast)** — `exaSearch.ts` and `tavilySearch.ts` request/response normalization and error mapping, `webFetch.ts` readability extraction + paywall detection + timeout + 4K cap, `qualityGate.ts` exhaustive table-driven, `claimScorer.ts` fixture-based, `parentContext.ts` chapter slicing + digest shape, `synthesizerMerge.ts` source renumbering + claim de-dup + schema validity.

**Integration (mocked externals, real graph wiring)** — breadth happy path, depth gate-skips-R2 path, depth gate-fires-R2 path, Tavily 500s → `searchFailed` flow, R2 90s timeout → partial merge, auditor malformed JSON → fallback to v1.

**Golden-doc regression (manual)** — 5–10 frozen briefs in `pipeline/tests/golden/research/`, mix of breadth and depth. Each is a JSON file containing the input brief and the frozen output doc. Not in CI (costs money, LLM output isn't bit-exact). Run before any prompt/model change ships; diff word count, source count, % fetched, gate fire rate, spot-check 2–3 randomly. The auditor is the highest-risk new component for "looks fine in tests, sucks in prod" — at least 3 expansion briefs in the golden set exercise it.

**Live smoke** — `bun run smoke:research <brief>` runs the real pipeline against a single brief, prints doc + telemetry. Dev iteration tool, not a CI artifact.

What we explicitly don't test: LLM output content correctness inside nodes (that's the golden-doc set's job), real HTTP against Tavily/Exa/web_fetch (vendor concern, mocked at boundary), cost (logged via telemetry, not asserted).

## What we're not doing

- Infinite-iteration deepening like ChatGPT Deep Research. Hard cap at 2 rounds. The marginal quality gain past round 2 doesn't justify the cost or latency for a podcast-length output.
- Per-question routing inside the subagent. Provider is decided upstream in the planner. Auto-routing inside the subagent would make traces unreadable.
- Heuristic prefilter for the auditor. Pure LLM is simpler.
- Model quality differentiation by tier. Volume only.
- Cost gates in tests. We log it but don't fail builds on it.

## Migration

No data migration. Existing research_documents in Supabase remain valid against the unchanged `ResearchDocumentSchema`.

**New dependency**: `posthog-node` in the pipeline package. Today's pipeline has no telemetry destination beyond Langfuse traces; the mobile app uses `posthog-react-native` separately. Adding the SDK and bootstrapping a client at pipeline startup is part of this work.

**Code removals** (all in the same PR that ships the new pipelines):

- `pipeline/src/podcast_pipeline/nodes/qualityGate.ts` — entire file. `status: "scripting"` transition that lived here now happens at the end of each new synthesizer (breadth) or merge node (depth).
- `briefBuilder` keeps its `isExpansion` branch (still the right place to swap the brief prompt); the `expansion` mode flags on the *research nodes* are what go away
- `pipeline/src/podcast_pipeline/nodes/research/planner.ts` — current expansion-mode prompt injection
- `pipeline/src/podcast_pipeline/nodes/research/synthesizer.ts` — current full-parent-doc injection
- `graph.ts` — `qualityGate` node and its edges, `routeAfterQualityGate`, `routeAfterDeepResearch`. Replaced by `routeAfterBriefBuilder` (breadth vs depth) and direct edges from each synthesizer to `scriptWriter`. The failed-status short-circuit that `routeAfterDeepResearch` did moves into a final-check helper at the end of each synthesizer (no research material → status="failed", same `handlePipelineFailure` invocation as today via `runPipeline`).
- `state.ts` — `credibilityScore`, `credibilityReport`, `researchIterations`, `shouldRetry`, `needsDisclaimer`
- `config.ts` — `CREDIBILITY_THRESHOLD`, `MAX_RESEARCH_RETRIES`

Rollout: feature flag (`RESEARCH_V12_ASYMMETRIC`) gates the new pipelines per environment. Dev gets it first, then staging with golden-doc set verification, then production. The flag falls back to today's pipeline if either subgraph throws at the entry point. Once we're confident in production (one week of clean runs), remove the flag and the old code in a follow-up PR.
