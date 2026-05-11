# Chapter Expansions (Series of Episodes) — design spec

**Date:** 2026-05-12
**Status:** Draft
**Ships as:** v15-v17 (foundation → mobile → re-engagement, three plans)
**Replaces:** Deep Dive (voice Q&A) UI surface — code stays for future revival.

## Why this exists

The Deep Dive feature (voice Q&A grounded in research, gated to Plus/Pro) is sunset from the UI. In its place, a feature that maps better to the brand promise and naturally drives both within-session depth and cross-session return:

Once a user finishes a podcast, any chapter they care about can be **expanded into its own full-length podcast** — a continuation episode that picks up from the parent chapter and goes deeper. Chapters of expansions can themselves be expanded. The library accumulates as a personal series feed.

Two user behaviors this serves simultaneously:

- **Depth-on-demand**: user finishes a podcast and immediately taps an interesting chapter to keep going. Continuous binge.
- **Episodic engagement**: 2 days later, a push notification suggests deepening a specific chapter. User comes back with curiosity already primed.

The expansion replaces Deep Dive's role as the paid-tier wedge. Plus/Pro spend monthly credits on expansions (fungible with new podcasts). Free users can pay-as-they-go via extra credit purchase or upgrade.

## Final UX

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant L as Library tab
  participant P as Player
  participant API as Pipeline
  participant N as Push

  Note over U,P: Day 1 — depth-on-demand
  U->>P: type topic → get parent podcast (unchanged shape)
  U->>P: listen, tap Expand on chapter 3
  P->>API: enqueue (parent_id=Y, source_chapter="…")
  API-->>U: push "Chapter 3 deep dive ready"
  U->>P: open expansion — opens with callback to parent ch.3
  Note over U,P: Same session — recursion
  U->>P: in the expansion, tap Expand on its chapter 2
  Note over U,L: 2 days later — episodic engagement
  N-->>U: "Chapter 1 deeper? Energy economics."
  U->>L: open app — flat library shows all podcasts
  U->>P: tap notification deep-link → ExpandActionSheet pre-opened on chapter 1
```

### What changes vs today

- **Parent podcast**: no script-level change. Same ~10-40 min target, same 4-6 chapters, same cold-open-to-closer arc.
- **Expansion podcast** (new): same length target, but **B-mode script** — opens with a callback to the source chapter. Continuation, not standalone. Assumes you heard the parent.
- **Library tab**: flat list of all podcasts (parent + expansions interleaved by recency). Expansion rows get a one-line subtitle: "from \<parent topic\> · chapter X".
- **Player**: each chapter marker gets an inline Expand affordance. Taps open ExpandActionSheet. State-aware: shows "Expand" if not yet expanded, "Open expansion ›" if already done, "Generating…" if mid-flight.
- **First parent only**: an audio post-roll coach-mark explains the expand feature. Plays once, never again.
- **Push notifications**: 2 days after a parent podcast, if the user hasn't expanded any chapter yet, fire a single suggestion push.

### What goes away (UI only)

- `DiveBar.tsx` hidden from player
- Deep Dive section hidden from `account.tsx`
- All other Deep Dive infrastructure (routes, hook, qa_sessions table, ElevenLabs deps, RC webhook deep-dive logic) stays untouched

## Data model

### Migration `00019_chapter_expansions.sql`

```sql
-- 1. Expansion relationship on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN parent_podcast_id uuid REFERENCES public.podcasts(id) ON DELETE SET NULL,
  ADD COLUMN source_chapter_title text,
  ADD COLUMN expansion_prompt_sent_at timestamptz,
  ADD CONSTRAINT podcasts_expansion_consistency
    CHECK (parent_podcast_id IS NULL OR source_chapter_title IS NOT NULL);

-- 2. Idempotency: a chapter can be expanded exactly once per parent
--    (excluding soft-deleted expansions so users can re-roll a bad one)
CREATE UNIQUE INDEX idx_podcasts_unique_expansion
  ON public.podcasts (parent_podcast_id, source_chapter_title)
  WHERE parent_podcast_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Lookup index for "what expansions has this podcast spawned?"
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

### Relationships

```mermaid
erDiagram
  PROFILES ||--o{ PODCASTS : owns
  PODCASTS ||--o{ PODCASTS : "parent_of (parent_podcast_id)"
  PODCASTS ||--o| RESEARCH_CONTEXTS : has
  PODCASTS ||--o{ CREDIT_TRANSACTIONS : tracks
  PODCASTS ||--o{ PLAYBACK_EVENTS : "logs"

  PROFILES {
    uuid id PK
    text preferred_voice
    boolean has_used_expand "NEW"
  }
  PODCASTS {
    uuid id PK
    uuid user_id FK
    uuid parent_podcast_id FK "NEW: null=parent, set=expansion"
    text source_chapter_title "NEW: which parent chapter"
    timestamptz expansion_prompt_sent_at "NEW: once-per-podcast push gate"
    text topic
    text transcript
    jsonb chapter_markers
    text status
  }
  PLAYBACK_EVENTS {
    uuid id PK
    uuid user_id FK
    uuid podcast_id FK
    text event_type "skip_back | skip_forward"
    integer timestamp_seconds
  }
```

### RLS

**No new RLS migrations needed for `podcasts`.** Existing policies already scope all reads to `user_id = auth.uid()`. Expansions inherit their user's `user_id`, so they're naturally visible only to their owner. Parent self-joins (for the library subtitle) work because the user owns both rows. The lookup query "which chapters of this podcast are expanded" filters by `parent_podcast_id` and is naturally scoped by user.

**The only new RLS** is on `playback_events` (above) — own-row SELECT + INSERT, standard pattern.

**Server-side ownership check (critical)**: `submitPodcast` must verify supplied `parent_podcast_id` belongs to the requesting user before insert, and the supplied `source_chapter_title` exists in `parent.chapter_markers`. Otherwise user A could expand user B's podcast. Existing service-role-only insert pattern means there's no DB-level INSERT policy to defend us — server code is the trust boundary.

### Cascade behavior

- Parent soft-deleted (`deleted_at` set) → expansions still exist, still readable, still playable. Subtitle in library shows source chapter name. RLS view filter (`deleted_at IS NULL`) hides only the parent.
- Parent hard-deleted → `ON DELETE SET NULL` orphans expansions, preserves `source_chapter_title` as metadata. UI handles null parent gracefully ("from a deleted podcast").
- Expansion soft-deleted → its row stays but `deleted_at IS NOT NULL` excludes it from the partial unique index, so user can re-expand the same chapter.

## Pipeline

The graph topology is unchanged. Each node behaves differently when `state.parentPodcastId` is set.

### New `PipelineState` fields

```ts
parentPodcastId: Annotation<string | null>,
sourceChapterTitle: Annotation<string | null>,
parentResearchDocument: Annotation<Record<string, unknown> | null>,
parentChapterTranscript: Annotation<string | null>,
hasUsedExpand: Annotation<boolean>,
```

All default null/false. Populated in `submitPodcast` from request payload + parent lookup. Self-contained — pipeline nodes don't re-query Supabase for parent context.

### `submitPodcast` route changes

Accept optional `parentPodcastId` + `sourceChapterTitle`. When set:

1. **Parent lookup** — pull parent row (`user_id`, `chapter_markers`, `transcript`) + joined `research_contexts.research_document`. Filter `deleted_at IS NULL`.
2. **Ownership check** — `parent.user_id !== req.user.id` → return 404 (don't leak existence).
3. **Chapter validation** — `source_chapter_title` must match a `parent.chapter_markers[].title`. Else 400.
4. **Idempotency check** — if `(parent_podcast_id, source_chapter_title)` already has an active expansion, return 409 with `{ podcastId: existing.id }`. Mobile navigates instead of generating a duplicate.
5. **Source chapter transcript** — extract the chapter's slice from `parent.transcript` using `chapter_markers[].timestampSeconds` boundaries.
6. **Existing CAS credit deduction** — fungible, no special pricing for expansions.
7. **Insert podcast row** with `parent_podcast_id` + `source_chapter_title` set.
8. **Flag flip** — `UPDATE profiles SET has_used_expand=true WHERE id=user_id AND has_used_expand=false`. Idempotent.
9. **Enqueue** with the expansion fields populated in `PipelineState`.

### Per-node behavior

```mermaid
flowchart TD
  S[submit-podcast] --> BB[briefBuilder]
  BB -->|new prompt OR expansion prompt| DR[deepResearchAgent]
  DR --> QG[qualityGate]
  QG --> SW[scriptWriter]
  SW -->|new prompt OR expansion prompt| TI[tagInjector]
  TI --> AI[adInjector]
  AI --> AP[audioProducer]
  AP -->|isParent && !hasUsedExpand: append coach-mark| MW[metadataWriter]
```

**`briefBuilder`** — new `BRIEF_BUILDER_EXPANSION_PROMPT`. Takes parent topic + chapter title + a **digested** parent research (section titles + 1-2 sentence summaries) + the source chapter transcript. Same output shape (`{ scope, angle, depth, keyQuestions }`) but scoped to the chapter.

**`deepResearchAgent`**:

- **Planner**: when `state.parentResearchDocument` is set, the prompt includes a "What's already known" digest from parent research. Direction: "produce sub-questions that drill DEEPER, don't duplicate." Same `RESEARCH_MAX_TOKENS.planner = 4096` cap.
- **Subagent**: no changes. Each takes a focused question; gpt-4o-mini handles tight queries well.
- **Synthesizer**: when `state.parentResearchDocument` is set, the prompt includes more-complete parent context (sections + claims + sources). Direction: "build a research_document for THIS expansion. Layer on top of parent; don't replicate." Output goes into a fresh `research_contexts` row keyed by the expansion's `podcast_id`.

Input sizes are comfortable for Sonnet 4.6: planner ~5K tokens, synthesizer ~17K tokens — both well within the effective-reasoning zone.

**`scriptWriter`** — new `SCRIPT_WRITER_EXPANSION_PROMPT`. Receives the expansion's `researchDocument` + `parentChapterTranscript`. First chapter opens with a callback ("Back in the chapter on X we touched on Y. Let's go deeper."). Same `TARGET_WORD_COUNT` (40-min target) and 4-6 chapters. Same `chapter_research_map` output so recursion works uniformly — the expansion's own chapters can themselves be expanded.

**`tagInjector` + `adInjector`** — no changes.

**`audioProducer`** — two conditions for the coach-mark post-roll:

```ts
const isParent = !state.parentPodcastId;
const showCoachMark = isParent && !state.hasUsedExpand;
```

When true, append `coachmark_audio/coachmark_expand_<voice>.mp3` as the last file in the concat list. Pre-recorded once (one per voice: Sulafat / Charon / Sadaltager / Achird) via a build script (same pattern as `build-voice-samples`). ~10 sec each, ~$0.002 total one-time cost.

### Recursion bounding

Each expansion only carries its **immediate parent's** chapter transcript and a **digested** parent research, not the entire ancestry. Recursion stays bounded regardless of depth:

- Level-N expansion sees: digest of level-(N-1) research + level-(N-1)'s source chapter transcript
- Total prompt size at the synthesizer stays ~17K tokens regardless of N

No depth caps in v1. Credit cost and diminishing-returns naturally self-regulate.

## Mobile UX

### Library (`mobile/app/(tabs)/index.tsx` + `usePodcasts.ts`)

Flat list, sorted by recency, no nested nav. Query adds parent topic via self-join:

```ts
.select(`
  id, topic, status, duration_seconds, audio_url, cover_url, created_at,
  parent_podcast_id, source_chapter_title,
  parent:parent_podcast_id (topic)
`)
```

`PodcastRow.tsx` renders a one-line subtitle when `parent_podcast_id` is set: `from "<parent.topic>" · chapter <source_chapter_title>`. Styling: `text.caption`, `inkSecondary`, single-line ellipsis. Falls back to `from a deleted podcast · chapter X` when parent is null (orphan).

### Player (`app/player/[id].tsx`)

New hook `useChapterExpansions(podcastId)` fetches expansion state per chapter of the current podcast:

```sql
SELECT id, source_chapter_title, status
FROM podcasts
WHERE parent_podcast_id = $1 AND deleted_at IS NULL
```

Returns `Map<chapterTitle, { podcastId, status }>`. `ChapterMarkers.tsx` reads this and renders state-aware affordances per chapter:

| State | Visual | Tap behavior |
|---|---|---|
| Not yet expanded | Inline "Expand" pill, accent color | Open `ExpandActionSheet` |
| Generation in flight | Spinner + "Generating…" | Show progress, deep-link to in-progress row |
| Ready | "Open expansion ›" link, inkSecondary | Navigate to expansion's player |
| Failed | "Try again" + subtle error | Re-open `ExpandActionSheet` |

Realtime: subscribe to `INSERT`/`UPDATE` on `podcasts` filtered by `parent_podcast_id = currentPodcastId`. Generation completion flips the chapter marker without a manual refresh.

Player also handles the deep-link param `?expand=<chapter_index>` from push notifications — scrolls to that chapter and opens `ExpandActionSheet` automatically.

### `ExpandActionSheet.tsx` (new component)

Bottom sheet, slide-up, paper-light. Two variants based on `subscription.tier`:

**Paid (Plus / Pro):**
- "Expand this chapter" eyebrow
- Chapter title (serif)
- "Uses 1 credit · ~10 min to generate" subtitle
- Filled CTA: "Expand chapter"
- Text-link cancel

On confirm: POST `/api/submit-podcast` with the expansion fields. UI shows in-flight state on the chapter marker.

**Free:**
- Same eyebrow + chapter title
- "Two ways to keep going" subtitle
- Outline option 1: "Buy one credit ($5) · use for this episode" → opens existing `SubscriptionModal` (RC purchase flow). On success, auto-submit the expansion.
- Filled option 2: "Upgrade to Plus · $14.99/mo with 8 credits, no ads" → opens existing `PaywallScreen`. On purchase, return to player and auto-submit.
- Text-link cancel

Both options reuse existing RC components. Only the wrapping sheet is new.

### Playback event tracking

New hook `usePlaybackEvents(podcastId)` exposes `recordSkipBack(seconds)` + `recordSkipForward(seconds)`. Fire-and-forget inserts to `playback_events` via supabase-js with user JWT (RLS allows own-row insert). `AudioPlayer.tsx` calls these from the existing 10-second skip buttons. No new UI; one line added per button.

### Deep Dive sunset (UI-only)

- Hide `<DiveBar />` from player layout
- Hide Deep Dive section in `account.tsx` (minutes-remaining display)
- Don't remove: deep-dive.tsx route, useDeepDive.ts, startDeepDive/endDeepDive endpoints, qa_sessions table, ElevenLabs deps, RC webhook deep-dive logic, DB columns `deep_dive_minutes_*`

One-line render conditionals on the entry points. Reversible in a single PR.

### Files summary

| File | Action |
|---|---|
| `mobile/src/components/ExpandActionSheet.tsx` | Create |
| `mobile/src/hooks/useChapterExpansions.ts` | Create |
| `mobile/src/hooks/useExpansionSubmit.ts` | Create |
| `mobile/src/hooks/usePlaybackEvents.ts` | Create |
| `mobile/src/components/ChapterMarkers.tsx` | Modify — state-aware Expand affordance |
| `mobile/src/components/PodcastRow.tsx` | Modify — parent subtitle |
| `mobile/src/components/AudioPlayer.tsx` | Modify — fire playback events on skip buttons |
| `mobile/src/hooks/usePodcasts.ts` | Modify — self-join on parent_podcast_id |
| `mobile/src/services/podcast.ts` | Modify — expansion submit signature |
| `mobile/app/player/[id].tsx` | Modify — deep-link `?expand=N` handler, hide DiveBar |
| `mobile/app/(tabs)/account.tsx` | Modify — hide Deep Dive section |
| `mobile/src/types/database.ts` | Modify — new columns + playback_events table |

## Re-engagement push

### Eligibility

Fire one push per parent podcast, exactly once, when ALL conditions hold:

- `podcasts.status = 'complete'`
- `podcasts.parent_podcast_id IS NULL` (only push for parents)
- `podcasts.deleted_at IS NULL`
- `podcasts.expansion_prompt_sent_at IS NULL` (once-per-podcast)
- `podcasts.created_at < now() - interval '2 days'`
- `profiles.has_used_expand = false` (don't push to users who have already discovered the feature)
- `profiles.expo_push_token IS NOT NULL`
- No existing expansion of this parent

### Chapter selection heuristic

```ts
// 1. Try playback-engagement signal first
const skipBackEvents = await querySkipBackEvents(podcastId);
const countsByChapter = aggregateByChapter(skipBackEvents, chapter_markers);
// Skip cold-open (idx 0) and closer (last idx) — usually intro/conclusion
const middleCounts = Object.entries(countsByChapter).filter(([idx]) =>
  idx > 0 && idx < chapter_markers.length - 1
);
const topByEngagement = middleCounts.sort((a, b) => b[1] - a[1])[0];

if (topByEngagement && topByEngagement[1] >= 2) {
  // At least 2 go-backs in this chapter — strong signal
  return parseInt(topByEngagement[0]);
}

// 2. Fall back to research density
const map = researchContext.chapterResearchMap;
const candidates = chapter_markers.slice(1, -1).map((m, i) => ({
  title: m.title,
  index: i + 1,
  score: map[m.title]?.sourceIndexes?.length ?? 0,
}));
return candidates.sort((a, b) => b.score - a.score)[0]?.index ?? 1;
```

### Push payload

```ts
{
  to: expo_push_token,
  title: "More on your podcast?",
  body: `Chapter ${idx}: ${title}. Tap to expand.`,
  data: { deepLink: `/player/${podcastId}?expand=${idx}`, podcastId },
  sound: "default",
}
```

### Delivery infrastructure

Pre-launch: **`setInterval` inside the existing Railway server**.

```ts
// pipeline/src/server.ts after server starts:
const HOUR_MS = 60 * 60 * 1000;
setInterval(async () => {
  try {
    await runExpansionPromptsScan();
  } catch (err) {
    console.error("[expansion-prompts cron] failed:", err);
  }
}, HOUR_MS);
```

`runExpansionPromptsScan` queries eligibility, picks chapter, fires Expo push, atomically marks `expansion_prompt_sent_at = now()`. Hourly cadence; the 2-day window ensures we don't miss firing due to server restarts.

**Acceptable pre-launch limitations:**
- Resets on server restart (recovered next hour)
- Single point of failure (one Railway instance)
- Doesn't scale to multi-instance without coordination

**When we scale beyond single-instance**, swap to `pg_cron` on Supabase calling a Railway endpoint via `pg_net`. Logic stays the same; only the trigger changes.

```mermaid
sequenceDiagram
  participant Cron as setInterval (hourly)
  participant DB as Supabase
  participant Expo as Expo Push API
  participant User

  Cron->>DB: SELECT eligible podcasts
  loop per podcast
    Cron->>DB: aggregate skip_back events per chapter
    Cron->>Cron: pick chapter (skip-back signal OR research density)
    Cron->>Expo: send push
    Cron->>DB: UPDATE expansion_prompt_sent_at = now()
  end
  Expo-->>User: notification
  User->>User: tap → deep-link to player ?expand=N
```

## Out of scope for v1

- **Series view / collection filter.** Library stays flat.
- **`series_root_id` denormalization.** Recursive parent traversal on the rare query that needs root identity.
- **Expansion regeneration in-place.** Soft-delete then re-expand pattern is supported via the index design; "re-roll without delete" is not.
- **Depth indicators on player UI.**
- **Cross-podcast similarity suggestions.**
- **`pause` / `chapter_complete` event types.** `event_type` is constrained to `skip_back | skip_forward` for v1; check constraint can be ALTERed to add more types when needed.
- **Per-user A/B testing of push copy.**
- **Do-not-disturb hour awareness.**
- **Offline event queueing on mobile.** Network failures lose individual `playback_events` inserts.

## Testing

**Unit (vitest, additions):**
- `briefBuilder.test.ts` — expansion-prompt branch + state shape
- `planner.test.ts` — narrower task list with `parentResearchDocument` set
- `synthesizer.test.ts` — merged-vs-replaced research_document with parent priors
- `scriptWriter.test.ts` — callback-shaped first chapter with `parentChapterTranscript`
- `audioProducer.test.ts` — coach-mark conditional appendage
- `submitPodcast.test.ts` — parent ownership, chapter validation, idempotency 409, `has_used_expand` flip

**Integration:**
- Full pipeline expansion test: parent → expansion → linked `research_contexts`
- Cron scan with mock eligible podcasts → correct push payload + DB markup
- Chapter selection: skip-back events present → engagement winner; events absent → research density winner

**Manual:**
- Coach-mark plays at end of first parent (per voice: Sulafat / Charon / Sadaltager / Achird)
- Coach-mark does NOT play on second parent after first expansion
- Coach-mark does NOT play on expansion itself
- Push fires 2 days after parent + deep-links correctly
- Two-path bottom sheet for free user round-trips through both buy-credit and upgrade paths
- Recursion: expand a chapter of an expansion, verify parent chain
- Voice continuity: parent + expansion use the same voice from `profiles.preferred_voice`

## Phasing

Three plans for cleaner reviews and incremental ship:

1. **v15-chapter-expansions-foundation.md** — migration 00019, server changes (submitPodcast, pipeline state, briefBuilder/scriptWriter expansion prompts, planner/synthesizer prior handling). No mobile UI yet; server can accept expansion requests via curl.
2. **v16-chapter-expansions-mobile.md** — mobile UX (library subtitle, Expand affordance, ExpandActionSheet, playback event tracking, deep-link handling). Feature usable end-to-end.
3. **v17-chapter-expansions-reengagement.md** — coach-mark per-voice audio assets + audioProducer post-roll, cron endpoint + setInterval scheduler. Deep Dive UI sunset (one-liner per file). The lure-back loop and the feature-discovery surface ship together.

Phase 1 can be tested with curl before any mobile work. Phase 3 is independent of phase 2 and can ship later if needed.

## Open questions

None. All design decisions resolved in this brainstorming pass.
