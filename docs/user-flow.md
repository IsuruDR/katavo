# AI Podcast App — User Flow

Three diagrams covering the full user-visible journey: generation, podcast status lifecycle, and Deep Dive (mid-playback voice Q&A).

## Generation flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Mobile)
    participant API as Hono API (Railway)
    participant JM as Job Manager (in-process)
    participant P as Pipeline Nodes
    participant DB as Supabase Postgres
    participant ST as Supabase Storage
    participant RT as Supabase Realtime
    participant AI as OpenAI
    participant PUSH as Expo Push

    U->>API: POST /api/generate-questions {topic}
    API->>AI: GPT-4o (clarifying questions)
    AI-->>API: 2-3 questions
    API-->>U: {questions[]}

    U->>U: Answers in chat UI

    U->>API: POST /api/submit-podcast {topic, answers}
    API->>DB: SELECT subscription
    API->>DB: UPDATE credits_remaining (CAS, -1)
    API->>DB: INSERT podcasts {status: 'queued'}
    API->>JM: enqueue(podcastId, input)
    API-->>U: {podcastId, status: 'queued'}

    Note over U: User backgrounds the app

    JM->>P: briefBuilder
    P->>AI: GPT-4o (build brief)
    P->>DB: UPDATE status = 'researching'
    DB-->>RT: status change
    RT-->>U: live update (if app open)

    P->>AI: o4-mini-deep-research (background mode)
    loop poll every 10s, up to 15 min
        P->>AI: responses.retrieve(id)
    end
    AI-->>P: 20+ sources, citations
    P->>P: qualityGate (score >= 0.7?)
    P->>DB: UPDATE status = 'scripting'

    P->>AI: GPT-4o (script + chapter map)
    P->>P: adInjector (skipped for paid tiers)

    P->>DB: UPDATE status = 'generating_audio'
    P->>AI: gpt-4o-mini-tts per segment
    P->>P: ffmpeg concat
    P->>ST: upload mp3 + signed URL
    P->>DB: UPDATE podcast (audio_url, transcript, chapters, status='complete')
    P->>DB: INSERT research_contexts (sources, doc, score)

    P->>PUSH: Expo Push "Your podcast is ready"
    PUSH-->>U: notification

    U->>API: (via supabase-js) SELECT podcast
    U->>ST: GET signed audio URL
    U->>U: play with chapter markers
```

## Status state machine

```mermaid
stateDiagram-v2
    [*] --> queued: submit-podcast
    queued --> researching: briefBuilder done (~10s)
    researching --> scripting: deepResearch + qualityGate (~5-15 min)
    researching --> researching: qualityGate retry (max 2x)
    scripting --> generating_audio: scriptWriter done (~30s)
    generating_audio --> complete: TTS + ffmpeg + upload (~1-2 min)
    queued --> failed: any node throws (after 3 retries)
    researching --> failed
    scripting --> failed
    generating_audio --> failed
    failed --> [*]: trigger auto-refunds credit
    complete --> [*]
```

## Deep Dive flow (Plus/Pro, mid-playback)

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Mobile)
    participant API as Hono API
    participant DB as Supabase
    participant EL as ElevenLabs Conv. AI

    U->>U: Listening, taps "Deep Dive" on a chapter
    U->>U: Pause podcast, save position
    U->>API: POST /api/start-deep-dive {podcastId, chapterTitle}
    API->>DB: check tier (plus/pro), minutes > 0, no active session
    API->>DB: SELECT research_context for podcast
    API->>DB: INSERT qa_sessions (partial unique idx blocks concurrent)
    API-->>U: {sessionId, researchDocument, chapterResearchMap, transcript}

    U->>EL: connect to agent with research context
    loop voice conversation
        U->>EL: speak
        EL-->>U: voice response (grounded in research)
    end
    U->>EL: end session
    U->>API: POST /api/end-deep-dive {sessionId, elevenlabsSessionId}
    API->>EL: fetch authoritative duration
    API->>DB: UPDATE qa_sessions (ended_at, duration, cost)
    API->>DB: UPDATE subscription (CAS, -minutes)
    API-->>U: {durationSeconds, minutesUsed, deepDiveMinutesRemaining}
    U->>U: Resume podcast at saved position
```
