# Migrate Deep Dive from ElevenLabs to Gemini Live API

**Status:** Roadmap — not active. Trigger conditions below.
**Last reviewed:** 2026-05-11

## Why this lives on the roadmap

Deep Dive currently runs on ElevenLabs Conversational AI at ~$0.10/min. Gemini Live API (`gemini-2.5-flash-native-audio-preview-12-2025`) does the same job at ~$0.012/min — about 8x cheaper. Same vendor as our Gemini podcast TTS, which means consistent voice across the podcast and the Deep Dive session.

We didn't migrate at audit time (2026-05-11) because:

- Live API is still preview; we just shipped retry handling for `gemini-2.5-flash-preview-tts` 503 spikes. Live API likely has similar reliability profile, magnified by long-lived sessions.
- No official React Native SDK for Live API yet. Migration needs either a native module bridge or a community RN/WebSocket implementation — both real engineering investments.
- Pre-launch with no paying users, the absolute cost gap is theoretical.
- The existing ElevenLabs setup is shipped, debugged, and works.

The pattern is sound — NotebookLM's Interactive Mode is built on the same stack — so this isn't a "research project," it's a "wait for the right moment" call.

## Trigger conditions (do this when at least two are true)

1. **Live API moves to GA** or has been preview-stable for 6+ months
2. **Official Firebase AI Logic RN SDK ships** (Google has been actively shipping RN bindings; this is plausible)
3. **~100+ paying users with active Deep Dive usage** — at that point cost savings (~$200-300/mo) start covering the engineering investment, and we'd have real reliability data on the preview API
4. **You decide voice continuity (same host across podcast + Deep Dive) is a product priority worth a week of engineering**

## Cost math (refresh before acting)

For a typical 50/50 user/model back-and-forth conversation:

| Provider | Per-minute cost |
|---|---|
| ElevenLabs (current) | $0.10 |
| Gemini Live (`gemini-2.5-flash-native-audio-preview-12-2025`) | ~$0.012 |

Per-user-month at current tier allocations:

| Tier | Minutes/mo | ElevenLabs | Gemini Live | Per-user savings |
|---|---|---|---|---|
| Plus | 15 | $1.50 | $0.18 | $1.32 |
| Pro | 45 | $4.50 | $0.54 | $3.96 |

At 1000 paying subscribers with mixed usage averaging ~25 min/month: **~$2200/month savings = ~$26K/year**.

## Implementation paths (evaluated 2026-05-11)

### Path 1 — Native module bridge to Firebase AI Logic (recommended when trigger hits)

Firebase AI Logic provides Google-maintained `LiveModel` SDKs for iOS (Swift) and Android (Kotlin), exposing `connect()` / `sendAudioRealtime()` / streaming callbacks. We wrap them in small native modules and expose a unified TypeScript interface to RN — same architecture `@elevenlabs/react-native` uses internally.

- iOS: ~1.5 days for the Swift native module
- Android: ~1.5 days for the Kotlin native module
- RN bridge + `useDeepDive` rewrite: ~1 day
- Testing + reliability hardening: ~1-2 days
- **Total: ~4-5 days**

Why this path: lowest ongoing maintenance (Google handles session lifecycle, audio buffering, voice activity detection, interrupts), low risk (battle-tested SDKs), best reliability story.

Sample Swift call shape:
```swift
let liveModel = FirebaseAI.firebaseAI(backend: .googleAI()).liveModel(
  modelName: "gemini-2.5-flash-native-audio-preview-12-2025",
  generationConfig: LiveGenerationConfig(responseModalities: [.audio])
)
let session = try await liveModel.connect()
await session.sendAudioRealtime(audioFile.data)
```

### Path 2 — Pure-RN WebSocket implementation

Direct WebSocket connection to `wss://generativelanguage.googleapis.com/...` from React Native. Felipe Lujan documented a working version in [this Medium article](https://felipelujan.medium.com/gemini-live-api-proactive-in-next-js-and-react-native-expo-26d070dafff9). Uses `react-native-audio-api` for native audio handling.

Documented gotchas to budget for:
- "Chipmunk effect" from sample rate mismatch (same root cause as the audio drift we fixed for TTS — PCM 16-bit, 16kHz mono input vs 24kHz output)
- Android crashes after ~30 seconds without `AudioBufferQueueSourceNode` chunk-batching to keep the RN bridge from choking
- Requires a backend proxy to keep the API key out of the mobile bundle

- **Total: ~3-4 days**, lower upfront cost than Path 1 but more long-term maintenance.

Pick this if Firebase AI Logic still doesn't have RN bindings when triggers hit AND we want to avoid the native module path for some reason.

### Path 3 — Wait for an official RN SDK

Google has been shipping Firebase AI Logic SDKs through 2025-2026. RN bindings via @react-native-firebase are plausible. **Zero engineering effort but unknown timeline.** Worth checking the Firebase AI Logic docs once a quarter.

## Migration scope (when we do it)

Files to touch:
- `mobile/src/services/elevenlabs.ts` → replace with `geminiLive.ts` (same `TTSProvider`-style interface)
- `mobile/src/hooks/useDeepDive.ts` → swap underlying provider call
- `mobile/src/components/DiveBar.tsx` → no change expected (UI is provider-agnostic)
- `mobile/app/player/deep-dive.tsx` → minor — voice picker / connection state
- `pipeline/src/routes/startDeepDive.ts` + `endDeepDive.ts` → minor; minute deduction logic unchanged
- `pipeline/package.json` → drop `@elevenlabs/react-native`, add Firebase AI Logic native modules (or `react-native-audio-api` for Path 2)
- `mobile/app.json` → register native modules for Path 1

What stays the same:
- `qa_sessions` DB table — session tracking is provider-agnostic
- Tier-based minute allocation + Plus/Pro gating
- The DB-side `deep_dive_minutes_remaining` flow
- Realtime subscription updates on the mobile side

## Voice continuity caveat

The user-facing argument for migration is "same voice across podcast and Deep Dive." That's only partial:

- Our podcast TTS uses Gemini voices: `Sulafat`, `Charon`, `Sadaltager`, `Achird`
- Gemini Live API voices: separate list (verify when triggered; `Charon` known to overlap, others uncertain)

If we want full continuity, either:
- Restrict the voice picker to voices present in both Live API and TTS catalogs
- Default new users to a known-overlap voice (`Charon` confirmed in both as of 2026-05-11)

Verify the exact Live API voice list when triggers hit — it may have grown.

## Sources (verified 2026-05-11)

- [Android Developers — Gemini Live API](https://developer.android.com/ai/gemini/live) — official confirmation that this is the production pattern
- [Firebase AI Logic — Live API guide](https://firebase.google.com/docs/ai-logic/live-api) — Swift/Kotlin/Dart/Unity SDK references with sample code
- [Gemini Live API overview — Gemini API docs](https://ai.google.dev/gemini-api/docs/live-api) — protocol, tools, system instructions
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — verify current rates before any decision
- [NotebookLM Interactive Mode announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-new-features-december-2024/) — proof of pattern at Google scale
- [Felipe Lujan — Gemini Live API in RN/Expo (Medium)](https://felipelujan.medium.com/gemini-live-api-proactive-in-next-js-and-react-native-expo-26d070dafff9) — Path 2 reference implementation
- [google-gemini/live-api-web-console](https://github.com/google-gemini/live-api-web-console) — official React starter
- [GoogleCloudPlatform/generative-ai — multimodal-live-api React demo](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/native-audio-websocket-demo-apps/react-demo-app) — official React demo

## Pre-migration checks (run before acting on this doc)

When you come back to this:

1. Is `gemini-2.5-flash-native-audio-preview-*` still the right model name? (preview suffixes shift)
2. Does Firebase AI Logic have official RN bindings yet? (re-check [@react-native-firebase docs](https://rnfirebase.io))
3. Have prices moved? (Live API is still preview as of this writing; rates may change before GA)
4. What's the current Live API voice list, and how many overlap with our Gemini TTS voices?
5. What's the current Live API session-duration cap? (preview limits typically 10-15 min; if we have Pro users with 45 min sessions, reconnect handling needs design)
6. Is ElevenLabs's pricing or quality story different by then? (they iterate too)
