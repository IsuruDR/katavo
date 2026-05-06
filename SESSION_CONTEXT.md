# AI Podcast App — Session Context

> Use this file to resume work in a new Claude session. It captures all decisions, architecture, and current state.

## Project Overview

A mobile-first app where users type a topic, answer clarifying questions, and receive a custom 10-minute deep-dive podcast. Users can start real-time voice conversations ("Deep Dive") with an AI agent during playback to go deeper on specific chapters.

## Architecture

```
Mobile App (React Native Expo)
    ↓ fetch() with Supabase JWT
Hono API Server on Railway ($5/mo)
    ├── /api/generate-questions     → GPT-4o clarifying questions
    ├── /api/submit-podcast         → enqueues pipeline via job manager
    ├── /api/start-deep-dive        → validates session, returns research context
    ├── /api/end-deep-dive          → deducts minutes, server-authoritative duration
    ├── /api/revenucat-webhook      → subscription + credit management
    └── /api/notify-complete        → push notifications via Expo
    
Pipeline (in-process, same server):
    briefBuilder → deepResearch (OpenAI o4-mini-deep-research)
        → qualityGate → scriptWriter → adInjector
        → audioProducer (OpenAI gpt-4o-mini-tts) → metadataWriter

Supabase: auth, Postgres, storage, realtime ($25/mo)
Langfuse Cloud: observability (free tier)
ElevenLabs: Deep Dive voice conversations ($0.10/min)
```

## Directory Structure

```
AI Podcast App/
├── mobile/                     # React Native Expo app
│   ├── app/                    # Expo Router screens
│   │   ├── (auth)/             # sign-in, sign-up
│   │   ├── (tabs)/             # library, generate, sources, account
│   │   └── player/             # [id].tsx, deep-dive.tsx
│   └── src/
│       ├── components/         # PodcastCard, AudioPlayer, ChapterMarkers, etc.
│       ├── hooks/              # useAuth, usePodcasts, useSubscription, usePlayer, useDeepDive, usePushNotifications
│       ├── services/           # podcast.ts, elevenlabs.ts, revenucat.ts, player.ts
│       ├── config/             # revenucat.ts
│       ├── lib/                # supabase.ts
│       └── types/              # database.ts, index.ts
├── pipeline/                   # Hono API server + LangGraph.js pipeline
│   ├── src/
│   │   ├── server.ts           # Hono entry point
│   │   ├── routes/             # 6 route handlers (migrated from Edge Functions)
│   │   ├── middleware/         # auth.ts (userAuth, webhookAuth, internalAuth)
│   │   ├── jobs/               # jobManager.ts (in-memory queue + retry + backoff)
│   │   └── podcast_pipeline/   # LangGraph.js pipeline
│   │       ├── graph.ts        # Pipeline graph + runPipeline()
│   │       ├── state.ts        # Annotation.Root state schema
│   │       ├── config.ts       # Prompts, thresholds, TTS config
│   │       ├── nodes/          # 7 nodes + errorHandler
│   │       └── providers/      # langfuseClient, ttsOpenai, ttsBase, supabaseClient
│   ├── tests/                  # 62 vitest tests
│   ├── Dockerfile              # Multi-stage build (node:20-slim + ffmpeg)
│   └── package.json
├── supabase/
│   ├── migrations/             # 00001-00007 (schema, RLS, triggers, storage, deep dive, session index, restricted update)
│   ├── seed.sql
│   └── config.toml
├── docs/
│   └── superpowers/
│       ├── 2026-03-27-ai-podcast-app-design.md    # Original app spec
│       ├── specs/                                   # Design specs
│       │   ├── 2026-03-28-deep-dive-and-pipeline-simplification-design.md
│       │   ├── 2026-04-09-langfuse-migration-design.md
│       │   └── 2026-04-10-api-server-consolidation-design.md
│       └── plans/                                   # Implementation plans (copies)
├── plans/                      # Implementation plans (primary)
│   ├── v1-solid-foundation.md
│   ├── v2-research-engine.md
│   ├── v3-mobile-experience.md
│   ├── v4-monetize-and-converse.md
│   ├── v5-deep-dive-pipeline.md
│   ├── v6-langfuse-openai-tts.md
│   └── v7-api-server-consolidation.md
└── .env.example
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native, Expo (managed), TypeScript, Expo Router |
| API Server | Hono, @hono/node-server, TypeScript |
| Pipeline | LangGraph.js (@langchain/langgraph), @langchain/openai |
| LLM | OpenAI (o4-mini-deep-research, GPT-4o, gpt-4o-mini-tts) |
| Database | Supabase (Postgres, Auth, Storage, Realtime) |
| Observability | Langfuse (cloud free tier) |
| Voice Conversations | ElevenLabs Conversational AI (@elevenlabs/react-native) |
| Payments | RevenueCat (react-native-purchases) |
| Hosting | Railway (Hobby $5/mo) |

## Subscription Tiers

| Tier | Monthly | Podcasts | Credits | Deep Dive | Ads |
|------|---------|----------|---------|-----------|-----|
| Free | $0 | 1/mo | $5 each | No | Yes |
| Plus | $14.99 | 8/mo | $4 each | 15 min/mo | No |
| Pro | $29.99 | 20/mo | $3 each | 45 min/mo | No |

## Database Schema (7 migrations)

- `profiles` — user profiles (extends auth.users)
- `subscriptions` — tier, credits, deep dive minutes, billing
- `credit_transactions` — ledger of all credit movements
- `podcasts` — generated podcasts with status, audio, transcript, chapter_research_map
- `research_contexts` — full research document + sources per podcast
- `trusted_sources` — Pro-only user-defined source collections
- `qa_sessions` — Deep Dive voice session tracking

Key patterns:
- CAS (compare-and-swap) for credit deduction in submit-podcast
- Optimistic concurrency for minute deduction in end-deep-dive
- Partial unique index for concurrent session prevention
- DB trigger auto-refunds credits on podcast failure
- DB trigger auto-creates profile + free subscription on signup

## Pipeline (7 nodes)

```
briefBuilder → deepResearch → qualityGate → scriptWriter → adInjector → audioProducer → metadataWriter
```

- `deepResearch`: OpenAI Deep Research API with background polling (up to 15 min)
- `qualityGate`: Heuristic check (source count + credibility score), retry loop (max 2), disclaimer fallback
- `scriptWriter`: Generates script + chapter-to-research mapping
- `audioProducer`: OpenAI gpt-4o-mini-tts + ffmpeg stitching + Supabase Storage upload (signed URLs)
- Job manager: in-memory, retry with exponential backoff (30s/60s/120s), max 3 attempts, crash recovery on startup

## Key Design Decisions

1. **No LangGraph Cloud** — pipeline runs in-process on the Hono server
2. **No Supabase Edge Functions** — all API routes consolidated into one Hono server
3. **No LangSmith** — replaced with Langfuse Cloud (free tier)
4. **No Google WaveNet** — replaced with OpenAI gpt-4o-mini-tts (instruction-following, same cost)
5. **ElevenLabs kept** for Deep Dive voice conversations (better quality + latency than OpenAI Realtime)
6. **handlePipelineFailure only on final retry attempt** — prevents premature credit refunds
7. **notify-complete is a direct function import** — no HTTP loopback for internal calls
8. **Auth via Supabase JWT** — mobile sends same token, Hono middleware validates via supabase.auth.getUser()

## Current State

- **99 commits** on main
- **62 pipeline tests** passing (vitest)
- **Mobile TypeScript** compiles clean
- **4 code review rounds** completed — all critical/important issues resolved
- **Approved for production** with minor suggestions remaining

## Deployment Status

- **Railway**: Need to deploy API server (Hobby plan, `railway up` from pipeline/)
- **Langfuse Cloud**: Sign up at cloud.langfuse.com, get API keys
- **Supabase**: Migrations need `supabase db push` to remote
- **Mobile**: Needs `EXPO_PUBLIC_API_URL` env var pointing to Railway URL
- **RevenueCat**: Webhook URL needs to point to Railway API
- **ElevenLabs**: Need to create Conversational AI agent

## Remaining Minor Items (not blocking)

- Silent catch blocks in route handlers (add console.error logging)
- Expo push response not checked in sendPodcastNotification
- `sendContextualUpdate` vs proper user message API in useDeepDive (verify with ElevenLabs docs)
- CORS could be tightened from `*` to specific origins
- Timing-safe secret comparison for webhook/internal auth
- Graceful shutdown handler (SIGTERM/SIGINT)
- Singleton Supabase service client in route handlers (currently creates new per request)

## Environment Variables Needed

### Railway (API Server)
```
PORT=3000
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PIPELINE_CALLBACK_SECRET=
REVENUCAT_WEBHOOK_SECRET=
EXPO_ACCESS_TOKEN=
ELEVENLABS_API_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
MAX_CONCURRENT_JOBS=10
```

### Mobile (Expo)
```
EXPO_PUBLIC_API_URL=https://your-railway-url.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

## Plans Executed

| Plan | Description | Tasks | Commits |
|------|-------------|-------|---------|
| V1 | Foundation (Supabase schema, scaffolding) | 12 | 12 |
| V2 | Research Engine (LangGraph.js pipeline) | 13 | 13 |
| V3 | Mobile Experience (React Native screens) | 7 | 9 |
| V4 | Monetize & Converse (RevenueCat) | 4 (3 skipped, done by V5) | 3 |
| V5 | Deep Dive + Pipeline Simplification | 15 | 17 |
| V6 | Langfuse + OpenAI TTS | 7 | 7 |
| V7 | API Server Consolidation | 12 | 12 |
| — | Code review fixes (4 rounds) | — | 26 |
