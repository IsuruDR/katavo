# Deep Dive Feature & Pipeline Simplification — Design Spec

## Overview

Two changes to the AI Podcast App:

1. **Pipeline simplification** — Replace the 3-node research phase (researchPlanner + deepResearcher + factChecker) with a single `deepResearch` node powered by OpenAI's Deep Research API (`o4-mini-deep-research`). Reduces the pipeline from 8 to 5 core nodes.

2. **Deep Dive feature** — Allow paid users (Plus/Pro) to start a real-time voice conversation with an ElevenLabs Conversational AI agent during podcast playback, grounded in the full research document. Available per-chapter with a monthly minute allowance.

**Changes from the original spec (2026-03-27):**
- Interactive Q&A is renamed to "Deep Dive" and expanded from Pro-only to **Plus + Pro** (was Pro-only in Section 5/9.1 of original spec).
- Trusted Sources remains Pro-only (unchanged).
- The `fact_checking` podcast status value is kept in the enum for backward compatibility with any existing records, but is no longer set by the pipeline.

---

## 1. Pipeline Simplification

### 1.1 New Pipeline Architecture

```
briefBuilder → deepResearch → qualityGate → scriptWriter → adInjector → audioProducer → metadataWriter
```

**Removed nodes:** `researchPlanner`, `deepResearcher`, `factChecker`

**New node:** `deepResearch` (replaces all three)

### 1.2 `deepResearch` Node

Calls OpenAI's Deep Research API via the Responses API:

```typescript
const response = await openai.responses.create({
  model: "o4-mini-deep-research",
  input: researchPrompt,
  background: true,
  tools: [{ type: "web_search_preview" }],
  max_tool_calls: maxToolCalls,
});
```

**Input:** Research brief from `briefBuilder` — includes topic, scope, angle, depth, key questions, and optionally trusted source URLs (Pro tier).

**Output:**
- `researchDocument`: The full research output with inline citations
- `sources`: Extracted list of `{ url, title }` from citation annotations
- `credibilityScore`: Computed from citation density (unique sources / key questions ratio, normalized to 0-1)
- `credibilityReport`: Summary of source coverage and any identified gaps
- `status`: Set to `"scripting"` on success

**Polling for completion:** Since `background: true` returns immediately, the node must poll for completion:

```typescript
// Poll until complete
let result = response;
while (result.status === "in_progress" || result.status === "queued") {
  await new Promise(resolve => setTimeout(resolve, 10_000)); // 10s interval
  result = await openai.responses.retrieve(result.id);
}
// Timeout after 15 minutes
```

The node blocks within LangGraph's execution while polling. This is acceptable since podcast generation is already async (user gets a push notification when done). A 15-minute timeout triggers a failure with a retryable error.

**Cost control:** Use `max_tool_calls` parameter:
- Free/Plus tier: `max_tool_calls: 20`
- Pro tier: `max_tool_calls: 40`

Note: `max_tool_calls` limits breadth of search, not dollar cost directly. However, since each tool call is a bounded operation (search, page fetch), this provides reasonable cost control. Unlike the previous `RESEARCH_COST_CEILING` which required token counting, `max_tool_calls` is simpler and the Deep Research API's pricing is per-request rather than per-token for the research phase.

**Retry support:** If `qualityGate` triggers a retry, the node receives the previous research and gap description. It re-calls Deep Research with additional context: "Previous research had these gaps: [gaps]. Focus on filling them."

**Trusted sources (Pro):** When `trustedSourceUrls` is provided, the prompt includes: "Prioritize information from these sources: [urls]". The Deep Research API will discover and use these during its autonomous browsing.

### 1.3 Updated `qualityGate` Node

Simplified — no longer needs a separate LLM fact-checking call:

- Checks if the research document has sufficient citations (minimum 3 unique sources)
- Checks if the key questions from the brief are addressed (keyword/semantic match)
- Computes `credibilityScore` from citation density if not already set by `deepResearch`
- Generates `credibilityReport` summarizing coverage quality and any gaps
- If insufficient: sets `shouldRetry = true` with gap description in `credibilityReport`
- If sufficient: sets `status = "scripting"`
- After max retries (2): proceeds with `needsDisclaimer = true`

This is a lightweight heuristic check rather than an LLM call, since the Deep Research API already produces well-cited research. The `credibilityScore` and `credibilityReport` fields are now populated by the combination of `deepResearch` (initial values) and `qualityGate` (validation/override).

### 1.4 Updated `scriptWriter` Node

New responsibility: generate `chapterResearchMap` alongside the script.

After generating the script with `[CHAPTER: Title]` markers, the script writer also outputs a mapping from each chapter to the research sections and sources it drew from:

```json
{
  "chapterResearchMap": {
    "The Quantum Threat": { "researchSections": [0, 1], "sourceIndexes": [0, 1, 2] },
    "Breaking RSA": { "researchSections": [1, 2], "sourceIndexes": [0, 3, 5] },
    "Post-Quantum Crypto": { "researchSections": [3, 4], "sourceIndexes": [1, 2, 7] }
  }
}
```

This is generated via a single prompt that includes both script generation and chapter-to-research mapping instructions.

**Validation:** If the LLM returns indexes that are out of bounds for `researchDocument.sections[]` or `sources[]`, clamp them to valid ranges. If the mapping is entirely malformed (unparseable JSON), set `chapterResearchMap` to `null` — the podcast still works, but Deep Dive will fall back to using the full research document without chapter-specific highlighting.

### 1.5 Pipeline State Changes

Remove fields:
- `researchPlan` (no longer needed — Deep Research plans its own queries)

Add fields:
- `chapterResearchMap`: `Record<string, { researchSections: number[], sourceIndexes: number[] }> | null`

Keep (now populated by `deepResearch` + `qualityGate`):
- `researchBrief`, `researchDocument`, `sources`, `credibilityScore`, `credibilityReport`, `researchIterations`

### 1.6 Config Changes

Remove:
- `RESEARCH_PLANNER_PROMPT`
- `FACT_CHECKER_PROMPT`
- `RESEARCH_COST_CEILING` (replaced by `max_tool_calls`)

Add:
- `DEEP_RESEARCH_PROMPT`: Prompt template for the Deep Research API call
- `MAX_TOOL_CALLS`: `{ free: 20, plus: 20, pro: 40 }`
- `MIN_SOURCES_THRESHOLD: 3` — minimum unique sources for quality gate
- `DEEP_RESEARCH_POLL_INTERVAL: 10_000` — ms between polling attempts
- `DEEP_RESEARCH_TIMEOUT: 900_000` — 15-minute timeout

---

## 2. Deep Dive Feature

### 2.1 Overview

Paid users (Plus/Pro) can start a real-time voice conversation during podcast playback to go deeper on the current chapter. The conversation is powered by an ElevenLabs Conversational AI agent loaded with the full research document, with the current chapter's research sections highlighted as priority context.

### 2.2 Tier Allocations

| Tier | Deep Dive Access | Minutes/Month | Max Session Duration |
|------|-----------------|---------------|---------------------|
| Free | No | 0 | — |
| Plus | Yes | 15 | 15 min (full allowance) |
| Pro | Yes | 45 | 15 min |

Minutes do not roll over. Reset to tier allocation on subscription renewal (same as credits).

**Rate limits:** One active Deep Dive session per user at a time. No per-day session limit — the monthly minute pool is the only constraint.

**Max session duration:** 15 minutes per session (matching original spec). If a user has more remaining minutes, they can start another session. This prevents accidental minute burn in a single sitting.

**Minute rounding:** Sessions are billed in whole minutes, rounded up. A 61-second session costs 2 minutes. This is a product decision for simplicity — fractional minute tracking adds complexity with minimal user benefit.

**Cost basis:** ElevenLabs Conversational AI at $0.10/min.

| Tier | Monthly Revenue | Deep Dive Cost (max) | % of Revenue |
|------|----------------|---------------------|-------------|
| Plus ($14.99) | $14.99 | $1.50 | 10% |
| Pro ($29.99) | $29.99 | $4.50 | 15% |

### 2.3 User Flow

1. User is listening to a podcast in the Player screen
2. The current chapter shows a "🎙 Dive" button (only the current chapter)
3. User taps "Dive" → podcast auto-pauses, playback position saved
4. **Loading state:** "Connecting to researcher..." overlay with spinner while ElevenLabs agent initializes (typically 1-3 seconds)
5. Deep Dive conversation screen opens:
   - Chapter context banner ("Diving into: Breaking RSA")
   - Live minutes remaining counter (client-side timer: `minutesRemaining - elapsedTime`)
   - Voice + text input (user can speak via mic or type)
   - AI responds with voice (ElevenLabs TTS)
   - Live transcript of the conversation
   - "End & Resume Podcast" button
6. ElevenLabs agent is initialized with context:
   - Full research document (all sections with their sources) — **truncated to 8,000 tokens** if exceeding ElevenLabs context limits. Truncation preserves the chapter-relevant sections in full and summarizes the rest.
   - Chapter-to-research mapping — the specific sections for this chapter highlighted as priority
   - Podcast transcript
   - System prompt: "You are a researcher who produced this podcast. The listener wants to go deeper on [chapter title]. Draw from the full research, especially the sections on [mapped topics]. Cite sources when relevant. Be conversational and clear."
7. Session ends when:
   - User taps "End & Resume Podcast"
   - Session hits 15-minute max duration — show warning at 2 min remaining, allow current AI response to finish then end gracefully
   - Monthly minutes run out — same warning + graceful end
   - Connection drops — see 2.7
8. On session end:
   - Client calls a **Supabase Edge Function** (`end-deep-dive`) with `{ sessionId, podcastId, chapterTitle }`
   - Edge Function fetches ElevenLabs session metadata for authoritative duration
   - Edge Function writes `qa_sessions` record and deducts minutes (server-authoritative, not client-reported)
   - Client receives updated `deep_dive_minutes_remaining`
   - Podcast resumes from saved position

### 2.4 Voice Mismatch

The podcast plays in a Google WaveNet voice; the deep dive agent responds in an ElevenLabs voice. This is acceptable — the framing is "talk to the researcher behind the podcast." Different mode, different voice, different interaction pattern.

### 2.5 Free Tier / Minutes Exhausted

- Free tier: "Dive" button not shown. If they navigate to a deep dive somehow, show upgrade prompt.
- Paid tier with 0 minutes remaining: "Dive" button is disabled/dimmed. Tapping shows "Deep dive minutes used up. Resets on [renewal date]."

### 2.6 Player Screen Redesign

The player screen is redesigned to make chapters the primary content:

- **Top:** Back button + deep dive minutes remaining (paid tiers only)
- **Title section:** Podcast name, duration, date
- **Main area (scrollable):** Chapter list
  - Past chapters: dimmed with checkmark, no dive button
  - Current chapter: highlighted (indigo border), "Now playing" label, "🎙 Dive" button
  - Upcoming chapters: default styling, no dive button
- **Bottom (pinned):** Compact player bar — progress scrubber, skip back/forward, play/pause

### 2.7 Connection Drop Handling

If the ElevenLabs WebSocket connection drops during a Deep Dive:
1. Show "Connection lost. Reconnecting..." overlay (auto-retry 3 times with 2s backoff)
2. If reconnection fails: end session gracefully
3. The `end-deep-dive` Edge Function is called with the ElevenLabs `session_id` — it fetches the authoritative duration from ElevenLabs API regardless of whether the client disconnected cleanly
4. Minutes are deducted for the partial session (rounded up to nearest minute)
5. The user cannot resume the same conversation — they must start a new session
6. Podcast resumes from saved position

### 2.8 Podcast Deleted During Deep Dive

If the podcast or research context is soft-deleted while a Deep Dive is active, the conversation continues until it ends naturally (the agent already has the context loaded). The session is still recorded. On return, the player shows "Podcast not found" and navigates to Library.

---

## 3. Data Model Changes

### 3.1 Schema Migration

```sql
-- 00005_deep_dive.sql

-- Add deep dive minute tracking to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN deep_dive_minutes_per_month integer NOT NULL DEFAULT 0,
  ADD COLUMN deep_dive_minutes_remaining integer NOT NULL DEFAULT 0;

-- Add chapter-to-research mapping to podcasts
ALTER TABLE public.podcasts
  ADD COLUMN chapter_research_map jsonb;

-- Add chapter reference to qa_sessions
ALTER TABLE public.qa_sessions
  ADD COLUMN chapter_title text;
```

### 3.2 `chapter_research_map` Format

```json
{
  "The Quantum Threat": {
    "researchSections": [0, 1],
    "sourceIndexes": [0, 1, 2]
  },
  "Breaking RSA — How Close Are We?": {
    "researchSections": [1, 2],
    "sourceIndexes": [0, 3, 5]
  }
}
```

Indexes reference positions in `research_contexts.research_document.sections[]` and `research_contexts.sources[]`.

### 3.3 Trigger Updates

**`handle_new_user` trigger:** Set `deep_dive_minutes_per_month = 0` and `deep_dive_minutes_remaining = 0` for new users (free tier). No change needed — the column defaults handle this.

**`revenucat-webhook` Edge Function:** On RENEWAL and INITIAL_PURCHASE, set:
- Plus: `deep_dive_minutes_per_month = 15, deep_dive_minutes_remaining = 15`
- Pro: `deep_dive_minutes_per_month = 45, deep_dive_minutes_remaining = 45`

On EXPIRATION (downgrade to free): set both to 0.

### 3.4 `qa_sessions` Table Updates

Add `chapter_title` column (see 3.1).

Session lifecycle:
- **On session start:** Insert row with `started_at = now()`, `podcast_id`, `user_id`, `chapter_title`, `elevenlabs_session_id`. `ended_at` and `duration_seconds` are null.
- **On session end:** The `end-deep-dive` Edge Function updates the row: sets `ended_at`, `duration_seconds` (from ElevenLabs session metadata — **server-authoritative**), `estimated_cost` (duration × $0.10/min).
- **Minute deduction:** The same Edge Function deducts minutes:

```sql
UPDATE public.subscriptions
SET deep_dive_minutes_remaining = GREATEST(0, deep_dive_minutes_remaining - CEIL($duration_seconds / 60.0))
WHERE user_id = $user_id;
```

This runs within the Edge Function using the service role key, not as a database trigger, ensuring server-authoritative duration and avoiding race conditions (only one Edge Function call per session end).

### 3.5 Concurrent Session Prevention

Before starting a Deep Dive, the client calls a `start-deep-dive` Edge Function that:
1. Checks `deep_dive_minutes_remaining > 0`
2. Checks no active session exists (no `qa_sessions` row for this user where `ended_at IS NULL`)
3. Inserts the `qa_sessions` row with `started_at`
4. Returns the session ID

If check #2 fails, returns 409 Conflict. The client shows "You already have an active deep dive session."

### 3.6 Security

- **RLS on `qa_sessions`:** Users can only read/create their own sessions (already configured in Plan 1).
- **Duration is server-authoritative:** The `end-deep-dive` Edge Function fetches duration from ElevenLabs API using the `elevenlabs_session_id`. The client cannot report a shorter duration to save minutes.
- **Research context access:** The `start-deep-dive` Edge Function verifies the user owns the podcast before returning research context. This enforces RLS at the API layer.

---

## 4. Mobile Changes

### 4.1 Player Screen Redesign

Redesign `mobile/app/player/[id].tsx`:
- Remove large artwork
- Compact player controls pinned to bottom
- Chapter list as main scrollable content
- "Dive" button only on current chapter
- Deep dive minutes display in header (paid tiers)

### 4.2 New: Deep Dive Screen

New screen `mobile/app/player/deep-dive.tsx`:
- Full-screen conversation interface
- Loading state: "Connecting to researcher..." spinner
- Voice input (microphone) + text input
- Live transcript with chat bubble layout (researcher = left, user = right)
- Chapter context banner
- Live minutes remaining counter (counts down)
- "End & Resume Podcast" button
- Warning overlay at 2 minutes remaining
- Connection lost overlay with retry

### 4.3 New: `useDeepDive` Hook

`mobile/src/hooks/useDeepDive.ts`:
- Call `start-deep-dive` Edge Function to validate and create session
- Initialize ElevenLabs Conversational AI agent with research context
- Manage session lifecycle (connecting, active, ending, error)
- Client-side minute countdown timer
- Call `end-deep-dive` Edge Function on session end
- Handle mic permissions
- Handle connection drops (3 retries with backoff)

### 4.4 New: ElevenLabs Service

`mobile/src/services/elevenlabs.ts`:
- ElevenLabs SDK initialization
- Agent configuration with system prompt and context
- Context truncation to 8,000 tokens if research document is too large
- Session management

### 4.5 New: Edge Functions

`supabase/functions/start-deep-dive/index.ts`:
- Validate user has minutes remaining
- Check no concurrent session
- Fetch research context (verify ownership)
- Insert `qa_sessions` row
- Return session info + research context for agent initialization

`supabase/functions/end-deep-dive/index.ts`:
- Fetch authoritative duration from ElevenLabs API
- Update `qa_sessions` row with `ended_at`, `duration_seconds`, `estimated_cost`
- Deduct minutes from `subscriptions`
- Return updated `deep_dive_minutes_remaining`

### 4.6 Updated Components

- `useSubscription` hook: include `deepDiveMinutesRemaining` and `deepDiveMinutesPerMonth`
- Account screen: show deep dive minutes (e.g., "Deep Dive: 12 / 15 min")
- Player `usePlayer` hook: add `pause()` and `getPosition()` for deep dive handoff

### 4.7 New Dependencies

```bash
cd mobile && npm install @11labs/react-native
```

---

## 5. Files Changed Summary

### Pipeline (`pipeline/`)

| File | Action | Description |
|------|--------|-------------|
| `src/podcast_pipeline/state.ts` | Modify | Remove `researchPlan`, add `chapterResearchMap` |
| `src/podcast_pipeline/config.ts` | Modify | Remove old prompts, add `DEEP_RESEARCH_PROMPT`, `MAX_TOOL_CALLS`, `MIN_SOURCES_THRESHOLD`, polling config |
| `src/podcast_pipeline/nodes/deepResearch.ts` | Create | New node using OpenAI Deep Research API with polling |
| `src/podcast_pipeline/nodes/researchPlanner.ts` | Delete | Replaced by deepResearch |
| `src/podcast_pipeline/nodes/deepResearcher.ts` | Delete | Replaced by deepResearch |
| `src/podcast_pipeline/nodes/factChecker.ts` | Delete | Replaced by simplified qualityGate |
| `src/podcast_pipeline/nodes/qualityGate.ts` | Modify | Simplify to heuristic check, populate credibilityScore/credibilityReport |
| `src/podcast_pipeline/nodes/scriptWriter.ts` | Modify | Also output chapterResearchMap with validation |
| `src/podcast_pipeline/nodes/metadataWriter.ts` | Modify | Store chapter_research_map on podcast record |
| `src/podcast_pipeline/nodes/index.ts` | Modify | Update exports |
| `src/podcast_pipeline/graph.ts` | Modify | Rewire: briefBuilder → deepResearch → qualityGate → scriptWriter... |
| `tests/` | Modify | Update tests for new/changed nodes, remove tests for deleted nodes |

### Supabase (`supabase/`)

| File | Action | Description |
|------|--------|-------------|
| `migrations/00005_deep_dive.sql` | Create | Add columns to subscriptions, podcasts, qa_sessions |
| `functions/start-deep-dive/index.ts` | Create | Validate, create session, return research context |
| `functions/end-deep-dive/index.ts` | Create | Server-authoritative duration, deduct minutes |
| `functions/revenucat-webhook/index.ts` | Modify | Handle deep dive minute allocation on renewal |

### Mobile (`mobile/`)

| File | Action | Description |
|------|--------|-------------|
| `app/player/[id].tsx` | Modify | Redesign: compact bottom controls, chapter-focused layout |
| `app/player/deep-dive.tsx` | Create | Deep dive conversation screen |
| `src/hooks/useDeepDive.ts` | Create | ElevenLabs session management |
| `src/services/elevenlabs.ts` | Create | ElevenLabs SDK config + context truncation |
| `src/hooks/useSubscription.ts` | Modify | Include deep dive minutes |
| `app/(tabs)/account.tsx` | Modify | Show deep dive minutes |

---

## 6. Out of Scope

- Deep dive conversation history/replay (can be added later)
- Deep dive on past/upcoming chapters (only current chapter)
- Buying additional deep dive minutes (only monthly allocation)
- Migrating podcast TTS to ElevenLabs (separate initiative per original spec)
- Per-session cost display to users (internal tracking only)
