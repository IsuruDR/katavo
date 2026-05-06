# AI Podcast Generator — Product & Technical Design Spec

**Date:** 2026-03-27
**Status:** Draft
**Author:** Isuru + Claude

---

## 1. Product Vision

A mobile-first app where users type a topic, answer a few clarifying questions, and receive a custom 10-minute deep-dive podcast — no doc uploads, no scripting, no editing. The app does the research, writes the script, generates the audio, and notifies the user when it's ready.

### Target Users

- **Busy professionals** — want to stay current on industry topics without reading articles
- **Curious minds** — casual users who want engaging audio on topics they're exploring

### Core Value Proposition

Zero-effort deep-dive podcasts. Type a topic, get a podcast. No competitor offers this on mobile.

### Key Differentiators vs. Competition

| Feature | NotebookLM | Jellypod | ElevenLabs GenFM | This App |
|---------|-----------|----------|-----------------|----------|
| Mobile app | No | No | Yes | Yes |
| Zero-effort (topic only) | No (upload docs) | No (upload + script) | No (upload content) | Yes |
| Deep research | No | No | No | Yes |
| Interactive voice Q&A | Yes (web, type-only) | No | No | Yes (voice-out) |
| Trusted sources | No | No | No | Yes |

---

## 2. User Experience

### 2.1 Core Flow

1. **Topic input** — user types a topic (e.g., "the impact of quantum computing on cryptography")
2. **Clarifying Q&A** — the app asks 2-3 targeted questions to refine scope, depth, and angle (similar to ChatGPT deep research). This happens in-app as a quick chat interaction.
3. **Generation kicks off** — user sees a progress indicator. They can close the app and go about their day.
4. **Push notification** — "Your podcast is ready!" when generation completes (typically 5-15 minutes).
5. **Listen** — user opens the app, taps play. Full audio player with chapter markers.
6. **Interactive Q&A (Pro)** — while listening, user taps "Ask a Question" button. Podcast pauses. User types or speaks a question. Gets a voice response from an AI agent loaded with the podcast's research context. Taps "Resume" to continue the podcast.

### 2.2 App Screens

1. **Home / Library** — list of user's generated podcasts with status indicators (generating, ready, failed). Pull-to-refresh + real-time updates via Supabase Realtime.
2. **Generate** — topic input field. After submission, transitions to clarifying Q&A chat. Shows credit cost and remaining balance before confirming.
3. **Player** — play/pause, seek bar, chapter markers (tappable), episode title/summary. Prominent "Ask a Question" button (Pro users). Background audio + lock screen controls.
4. **Interactive Q&A Mode (Pro)** — overlay on the player. Chat-like interface with type or mic input. Voice responses via ElevenLabs. "Resume Podcast" button to exit.
5. **Trusted Sources (Pro)** — manage URL/publication collections. Select which collection to use per generation.
6. **Account / Subscription** — current tier, credits remaining, buy extra credits, upgrade/manage subscription.

---

## 3. System Architecture

### 3.1 High-Level Components

```
┌─────────────────────┐
│   Mobile App        │
│   (React Native /   │
│    Expo)            │
└────────┬────────────┘
         │
    ┌────▼────┐
    │Supabase │──── Auth (SSO), Postgres DB, Storage (audio),
    │         │     Realtime (job status), RLS, Edge Functions
    └────┬────┘
         │ webhook
    ┌────▼──────────┐
    │ LangGraph     │──── Research-to-podcast pipeline
    │ Cloud         │     Observed via LangSmith
    └────┬──────────┘
         │
    ┌────▼──────────────────────────┐
    │ External APIs                 │
    │ ┌──────────┐ ┌─────────────┐ │
    │ │ OpenAI   │ │ Google      │ │
    │ │ o4-mini  │ │ WaveNet TTS │ │
    │ │ deep     │ └─────────────┘ │
    │ │ research │ ┌─────────────┐ │
    │ └──────────┘ │ ElevenLabs  │ │
    │              │ Conv. AI    │ │
    │              │ (Q&A only)  │ │
    │              └─────────────┘ │
    └──────────────────────────────┘
```

### 3.2 Clarifying Q&A Flow

Clarifying questions are generated **client-side via a Supabase Edge Function** that calls GPT-4o. This keeps the LangGraph pipeline fully asynchronous — it never needs to wait for user input. Flow:

1. User types a topic in the app
2. App calls a Supabase Edge Function (`generate-questions`) which uses GPT-4o to produce 2-3 clarifying questions
3. User answers in the chat UI
4. App calls another Edge Function (`submit-podcast`) which: validates credits, deducts a credit, writes a job record to `podcasts` table, and calls the LangGraph Cloud API to start the pipeline
5. LangGraph runs the full pipeline asynchronously (see Section 4)
6. Final audio is stored in Supabase Storage, job record updated to "complete"
7. The `metadata_writer` node (final pipeline step) calls a Supabase Edge Function (`notify-complete`) which sends a push notification via Expo Push API
8. App receives real-time update via Supabase Realtime (websockets) if open, or user opens via push notification
9. User plays podcast. Pro users can enter Q&A mode which initializes an ElevenLabs Conversational AI agent with the research context.

### 3.3 Failure Handling & Refunds

- If the pipeline fails at any node, the job status is set to `failed` with an `error_message` field
- **Status ownership:** Only LangGraph sets the status to `failed` — it does so after exhausting its own internal retries (checkpointing handles transient failures). The app never sees intermediate failures, only the final outcome.
- **Automatic credit refund:** A Supabase database trigger on `podcasts` status change to `failed` inserts a refund record into `credit_transactions` and increments `subscriptions.credits_remaining`
- **User sees:** Failed status in library with message "Generation failed — your credit has been refunded." Option to retry (one tap, deducts credit again).
- **Partial failures** (e.g., research succeeded but TTS failed): still a full refund. No partial credits.

### 3.4 Key Design Decisions

- **Supabase Realtime** for job status (websockets) — battery-friendly, no polling
- **Audio in Supabase Storage** (S3-compatible) — integrated with auth/RLS
- **Credits checked and deducted before dispatching** to LangGraph — prevents abuse
- **Rate limits** enforce fair usage (see Section 3.6)
- **LangGraph handles retry/failure logic** internally — app only sees job states
- **TTS provider abstracted** behind an interface — enables future migration from Google WaveNet to ElevenLabs without rewrite
- **RevenueCat** for in-app purchases/subscriptions — handles both App Store and Play Store billing, webhooks sync to Supabase

### 3.5 RevenueCat Integration

A Supabase Edge Function (`revenucat-webhook`) handles RevenueCat webhook events:

| Event | Action |
|-------|--------|
| `INITIAL_PURCHASE` | Create/update `subscriptions` row, allocate credits |
| `RENEWAL` | Reset `credits_remaining` to tier allocation, update `renewal_date` |
| `CANCELLATION` | Set subscription status to `cancelled`, keep access until `renewal_date` |
| `BILLING_ISSUE` | Set status to `billing_issue`, notify user in-app |
| `EXPIRATION` | Set tier to `free`, set credits to 1 |
| `PRODUCT_CHANGE` (upgrade/downgrade) | Update tier immediately on upgrade, at next renewal on downgrade |

**Credit lifecycle:** No rollover — unused credits expire at renewal. Credits reset to the tier allocation on each renewal via the webhook handler.

### 3.6 Rate Limits & Abuse Protection

| Limit | Free | Plus | Pro |
|-------|------|------|-----|
| Max concurrent generations | 1 | 2 | 3 |
| Max Q&A session duration | — | — | 15 minutes |
| Max Q&A sessions per day | — | — | 10 |
| Max trusted source collections | — | — | 10 |
| Max URLs per collection | — | — | 50 |
| Deep research cost ceiling | $3 | $3 | $5 |

The deep research cost ceiling truncates the o4-mini research if token/cost usage exceeds the threshold, to prevent cost spikes on complex topics. Truncated research proceeds through the normal quality gate — if the partial research is insufficient, the quality gate catches it and triggers a targeted retry (within the same cost ceiling). These events are logged in LangSmith for monitoring.

---

## 4. LangGraph Pipeline

### 4.1 Graph Nodes

```
brief_builder ──► research_planner ──► deep_researcher ──► fact_checker
                                                               │
                                                          ┌────▼────┐
                                                          │ Quality │
                                                          │  Gate   │
                                                          └────┬────┘
                                                               │
                                              ┌────────────────┼───────────┐
                                              │ credibility    │ credibility│
                                              │ below          │ above      │
                                              │ threshold      │ threshold  │
                                              ▼                ▼            │
                                    research_planner    script_writer       │
                                    (targeted retry,    ──► ad_injector     │
                                     max 2 retries)     ──► audio_producer  │
                                                        ──► metadata_writer │
```

### 4.2 Node Descriptions

1. **`brief_builder`** — Takes the user's topic + clarifying answers (already gathered in the app UI via Edge Function, see Section 3.2). Packages them into a structured research brief with scope, angle, depth, and any trusted source constraints.

2. **`research_planner`** — Takes the research brief + optional trusted sources. Produces a research plan: what questions to answer, what angles to cover, what sources to prioritize. If this is a retry pass, receives the fact-checker's gap report and generates targeted queries.

3. **`deep_researcher`** — Executes the research plan using OpenAI o4-mini-deep-research. For trusted sources (Pro), constrains search scope to user-curated URLs. Produces a structured research document with citations.

4. **`fact_checker`** — Cross-references key claims against multiple sources. Outputs a structured credibility assessment: per-claim confidence, source diversity score, contradiction count.

5. **Quality gate (LLM-as-judge)** — Evaluates the fact-checker's report:
   - **Above threshold** → proceed to script writing
   - **Below threshold** → feed gap report back to `research_planner` for targeted re-research
   - **Max 2 retries** — after 3 total cycles, proceed with disclaimers in the script ("sources on this topic are limited/conflicting")

6. **`script_writer`** — Generates a single-narrator podcast script in English from the research document. Includes natural chapter breaks, transitions, and conversational tone. Targets ~1,500 words (~10 minutes at 150 wpm, approximately 7,500-9,000 characters). Exact character target should be calibrated empirically against the chosen WaveNet voice's speaking rate.

7. **`ad_injector`** (conditional — **free tier only**, skipped for Plus/Pro based on `has_ads` flag) — Inserts ad placement markers into the script timeline: pre-roll slot (before content) and mid-roll slot (at a natural chapter break). Does not generate ad content — markers indicate where pre-recorded ad clips will be stitched.

8. **`audio_producer`** — Sends script to Google Cloud WaveNet TTS API. If `has_ads` is true, stitches pre-recorded ad audio clips into the marked slots. Stores final audio file to Supabase Storage.

9. **`metadata_writer`** — Generates episode title, summary, chapter markers (timestamps for key sections). Stores transcript + full research context to `research_contexts` table (used later for interactive Q&A). Updates the job record in Supabase to "complete."

### 4.3 State Management

LangGraph's built-in checkpointing ensures that if any node fails (e.g., API rate limit, timeout), the pipeline resumes from the last successful node rather than restarting.

### 4.4 Observability

All pipeline runs traced via LangSmith. Key metrics to monitor:
- Research quality scores over time
- Retry rates (how often the quality gate triggers re-research)
- End-to-end generation time
- Per-node latency and cost

---

## 5. Interactive Q&A (Pro Feature)

### 5.1 Flow

1. User is listening to a podcast in the player
2. User taps "Ask a Question" button
3. Podcast audio pauses, playback position is saved
4. App initializes an ElevenLabs Conversational AI agent session, loaded with:
   - The podcast's research document (from `research_contexts` table)
   - The podcast transcript
   - The user's original topic and clarifying answers
5. User interacts via text (typing) or voice (microphone button)
6. Agent responds with voice (ElevenLabs TTS)
7. User taps "Resume Podcast" — agent session ends, podcast resumes from saved position

### 5.2 Voice Mismatch

The podcast plays in a Google WaveNet voice; Q&A responds in an ElevenLabs voice. Since Q&A is a distinct mode that the user explicitly enters (different UI, different interaction pattern), this is acceptable for MVP. The framing: the podcast narrator is one entity, the Q&A agent is another — "talk to the researcher behind the podcast."

### 5.3 Cost

~$0.55 per 5-minute Q&A session ($0.10/min ElevenLabs + LLM context). LLM costs currently absorbed by ElevenLabs.

---

## 6. Ad Support

### 6.1 Strategy

- Free tier podcasts include ads; paid tiers are ad-free
- Ads are **pre-recorded audio clips** stitched into the podcast audio via dynamic ad insertion
- The AI voice does NOT read ads — ads are separate audio segments

### 6.2 Ad Slots

- **Pre-roll (15s)** — before podcast content begins
- **Mid-roll (30s)** — at a natural chapter break (determined by `ad_injector` node)

### 6.3 Revenue Estimate

- Targeted niche content (tech, business, education) CPM: $15-25
- 2 ad slots per listen: ~$0.03-0.05 revenue per listen
- Primary purpose: offset free-tier generation costs, not primary revenue

### 6.4 Implementation

Ad serving can start with a simple approach (static ad pool) and evolve to programmatic ad insertion (e.g., via a service like Targetspot or similar podcast ad networks) as the user base grows.

---

## 7. Data Model (Supabase / Postgres)

### 7.1 Tables

**`profiles`** (extends Supabase Auth users)
- user_id (FK to auth.users)
- display_name
- notification_preferences (JSONB)
- expo_push_token (nullable text — registered on app launch, updated on token refresh)
- created_at, updated_at

**`subscriptions`**
- id, user_id
- tier (enum: free, plus, pro)
- status (enum: active, cancelled, expired)
- billing_period (enum: monthly, annual)
- credits_per_month (int: 1, 8, or 20)
- credits_remaining (int)
- renewal_date (timestamp)
- revenucat_subscription_id

**`credit_transactions`**
- id, user_id
- type (enum: allocation, purchase, deduction, refund)
- amount (int, positive for additions, negative for deductions)
- price_paid (nullable, for purchases)
- podcast_id (nullable, FK for deductions)
- created_at

**`podcasts`**
- id, user_id
- topic (text)
- clarifying_answers (JSONB — the Q&A exchange)
- status (enum: queued, researching, fact_checking, scripting, generating_audio, complete, failed)
- error_message (nullable text — populated on failure)
- audio_url (nullable)
- transcript (nullable, text)
- duration_seconds (nullable)
- chapter_markers (JSONB array of {timestamp_seconds, title})
- has_ads (boolean)
- langgraph_run_id
- created_at
- deleted_at (nullable timestamp — soft delete)

**`research_contexts`**
- id, podcast_id (FK)
- research_document (JSONB — structured research with sections, claims, and citations)
- sources (JSONB array of {url, title, snippet, credibility_score})
- overall_credibility_score (float)
- research_iterations (int — how many quality gate loops)
- created_at

**`trusted_sources`**
- id, user_id
- name (text — collection name)
- urls (JSONB array of {url, label, category})
- created_at, updated_at

**`qa_sessions`**
- id, podcast_id (FK), user_id
- started_at (timestamp)
- ended_at (nullable timestamp)
- duration_seconds (nullable, computed on end)
- elevenlabs_session_id
- estimated_cost (nullable float, computed from duration × $0.10/min + LLM)
- created_at

### 7.2 Row-Level Security

All tables have RLS policies ensuring users can only read/write their own data. The LangGraph pipeline uses a service role key to update job records.

### 7.3 Real-time

Supabase Realtime subscription on `podcasts.status` column — the app listens for status changes to update UI and trigger push notifications.

---

## 8. Voice Provider Strategy

### 8.1 MVP (Phase 1)

| Use Case | Provider | Rationale |
|----------|----------|-----------|
| Podcast TTS | Google Cloud WaveNet | $0.14/podcast, good quality, English |
| Interactive Q&A | ElevenLabs Conversational AI | $0.10/min, built-in agent framework, voice responses |

### 8.2 Scale (Phase 2 — Future)

Migrate podcast TTS to ElevenLabs Scale plan ($330/mo for 2M credits) when:
- Volume exceeds ~100 podcasts/month (cost justification)
- Multi-voice formats are needed (two-host, interview)
- Voice consistency between podcast and Q&A matters

### 8.3 Abstraction

TTS generation is abstracted behind a provider interface in the `audio_producer` node. Switching from Google WaveNet to ElevenLabs is a configuration change, not a rewrite.

---

## 9. Pricing & Monetization

### 9.1 Subscription Tiers

| Tier | Monthly | Annual | Included Podcasts | Extra Credits | Ads | Features |
|------|---------|--------|-------------------|---------------|-----|----------|
| Free | $0 | — | 1/month | $5 each | Yes | Single narrator |
| Plus | $14.99 | $9.99/mo ($119.88/yr) | 8/month | $4 each | No | Single narrator |
| Pro | $29.99 | $19.99/mo ($239.88/yr) | 20/month | $3 each | No | + Interactive Q&A, trusted sources |

### 9.2 Extra Credits

Users on any tier can purchase additional credits once they exhaust their monthly allocation:
- Free tier: $5 per credit
- Plus tier: $4 per credit
- Pro tier: $3 per credit

No bulk discounts. One price per tier. Simple.

### 9.3 Unit Economics

**Per-podcast generation cost: ~$1.88 average**

| Component | Cost |
|-----------|------|
| Clarifying Q&A (GPT-4o) | $0.03 |
| Deep Research (o4-mini) | $1.45 (avg) |
| Fact-check + Script (GPT-4o) | $0.20 (avg) |
| Google WaveNet TTS (9,000 chars) | $0.14 |
| Ad injection + infra | $0.06 |
| **Total** | **~$1.88** |

**Margin analysis:**

| Revenue Source | Revenue/pod | Cost | Margin |
|---------------|------------|------|--------|
| Free extra credit ($5) | $5.00 | $1.88 | 62% |
| Plus extra credit ($4) | $4.00 | $1.88 | 53% |
| Pro extra credit ($3) | $3.00 | $1.88 | 37% |
| Plus subscription (5 used of 8) | $3.00 | $1.88 | 37% |
| Pro subscription (12 used of 20) | $2.50 | $1.88 | 25% |

### 9.4 Monthly Fixed Costs (Infrastructure)

| Service | Cost |
|---------|------|
| Supabase Pro | $25/mo |
| LangSmith Plus (1 seat) | $39/mo |
| LangGraph Prod Deployment (24/7) | ~$156/mo |
| Apple Developer + Play Store | ~$10/mo |
| **Total** | **~$230/mo** |

### 9.5 Free Tier Acquisition Cost

1 custom podcast/month × $1.88 generation cost − $0.04 ad revenue = **$1.84/user/month** customer acquisition cost.

---

## 10. Technical Stack Summary

| Layer | Technology |
|-------|-----------|
| Mobile app | React Native (Expo managed workflow) |
| Audio playback | react-native-track-player (background audio, lock screen controls, offline support) |
| Auth + DB + Storage | Supabase (Postgres, Auth with SSO, Storage, Realtime, Edge Functions) |
| Pipeline orchestration | LangGraph Cloud |
| Observability | LangSmith |
| Deep research | OpenAI o4-mini-deep-research |
| Script generation | OpenAI GPT-4o |
| Podcast TTS | Google Cloud WaveNet |
| Interactive Q&A | ElevenLabs Conversational AI agents |
| Payments | RevenueCat (iOS + Android) |
| Push notifications | Expo Notifications |

---

## 11. MVP Scope

### In Scope

- Topic input with clarifying Q&A
- Async podcast generation with push notification
- Single narrator, 10-minute episodes, English only
- Full audio player with chapter markers
- Interactive voice Q&A (Pro)
- Trusted sources (Pro)
- Ad-supported free tier (pre-roll + mid-roll, stitched audio clips)
- Subscription management (Free / Plus / Pro) with annual billing
- Extra credit purchases (tiered pricing by subscription level)
- LLM-as-judge quality gate with retry loop

### Out of Scope (Future)

- Multilingual support
- Multi-voice formats (two-host, interview) — deferred to ElevenLabs migration
- Auto note-taking during Q&A sessions
- Social features (sharing, public podcast profiles)
- Podcast distribution (RSS, Spotify)
- Web app version
- Offline download for playback without connectivity

### Content Moderation

Required for App Store approval. MVP approach:
- **Input filtering:** The clarifying Q&A Edge Function checks the topic against a blocklist (hate speech, illegal content, CSAM-related). Rejects with a user-facing message.
- **Output filtering:** The `script_writer` node includes a system prompt constraint against harmful content. The script is checked via OpenAI's moderation endpoint before proceeding to TTS.
- **Policy:** No podcasts on topics that violate Apple/Google content guidelines. Specific policy document to be drafted before App Store submission.

### Podcast Retention

- All tiers: podcasts retained for 1 year from creation
- Soft-delete: user can delete podcasts from their library (marks `deleted_at`, audio cleaned up via a scheduled Supabase Edge Function)
- Storage cleanup: a weekly cron purges audio files for soft-deleted podcasts older than 30 days and expired podcasts older than 1 year

---

## 12. Open Questions

1. **Ad partner** — which podcast ad network to integrate for programmatic ad insertion at scale?
2. **App name** — TBD
3. **Voice selection** — which specific Google WaveNet voice(s) to use as the narrator? Needs A/B testing.
4. **Generation time SLA** — what's the maximum acceptable wait time before users get frustrated? Should we show progress stages in the notification?
5. **Q&A initialization latency** — loading research context into ElevenLabs agent may take a few seconds. Need to test and optimize context size, add loading indicator.
