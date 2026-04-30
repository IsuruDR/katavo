# Product

## Register

product

## Users

Curious minds. People who hear about a topic in passing (a podcast guest, a Hacker News thread, something a friend mentioned at dinner) and want a thoughtful 10-minute explainer instead of skimming Wikipedia or queueing a 90-minute YouTube essay.

Context when they open the app: in transit, between meetings, walking, half-distracted. Often one-handed. Often listening through one earbud. Their attention is partial; the UI has to survive that.

Job to be done: turn a flicker of curiosity into a custom, research-grounded podcast they can listen to today. Optionally, while listening, dig deeper on a specific chapter without losing their place.

Not the target: power-users running a workflow, professionals managing a content pipeline, teams collaborating on research. One person, one curiosity, one tap.

## Product Purpose

Katavo turns a typed topic into a 10-minute deep-dive podcast. Type a topic, answer 2-3 clarifying questions, get a researched, scripted, narrated podcast in 5 to 15 minutes. Paid tiers can voice-chat with an AI agent grounded in the podcast's research while listening, to push deeper on a specific chapter.

Success: a first-time user finishes their first podcast and walks away saying "that was smart and handy", then comes back tomorrow with a new topic.

## Brand Personality

Sharp, quick, quietly clever. Pocket-tool feel, not platform feel. Linear mobile is the closest reference: navigation is obvious, every screen has one job, and the craft shows up in small precision rather than decoration.

Voice: direct, confident, no hedging. We don't explain what the app is. We assume you get it. Copy is short and matter-of-fact. No "AI-powered", no "let's", no marketing register inside the app.

The intelligence shows up in the questions we ask, the structure of the chapters, the precision of the typography. Not in glow effects, gradient text, sparkle animations, or "powered by AI" badges.

## Anti-references

What this should never look like:

- The current dark plus indigo treatment we ship today. Generic AI-app slop. Both the dark theme and the `#6366f1` accent are tells. Replace.
- NotebookLM's generic Google-product look. Commodity tool. Nothing memorable.
- ChatGPT-clone chat surfaces. Bot-bubble UI implies "the chat is the product". For us, the podcast is the product, the chat is a setup step.
- Headspace and Calm wellness aesthetic. Pastel gradients, illustrated mascots, floaty type. Wrong register entirely.
- Spotify green, Apple Podcasts purple, Pocket Casts orange. We are not a podcast platform; we are a researcher that hands you a podcast. Copying their visual language commodifies us.
- Audible's overstuffed audiobook-store density. Cards on cards on rows on rows. We are the opposite of that.

## Design Principles

1. **Obvious wins over clever.** Linear-mobile rule. Where you are, what you can do, what just happened, all readable in one glance. If a user has to hunt for an action, the design failed, regardless of how elegant it looks.

2. **Pocket-weight, not dashboard-weight.** Every screen is a hand tool. One job, finished cleanly. No cards inside cards, no nav inside nav, no "advanced" panels. If a screen has more than one primary action, split it.

3. **The smartness lives in the type, the questions, and the chapters.** Not in chrome. No animated AI shimmer, no gradient text, no sparkle. Restraint is the signal that we know what we're doing.

4. **Listening is the verb.** The player is the destination. The library and generate flow are paths to it. Generate should feel like a quick errand. Library should feel like a shelf you trust. Player should feel like the reward.

5. **Trust the material.** The topic and its chapters are the content. Everything else is a frame. Generous space around content, decisive hierarchy, nothing competing with what the user actually came for.

## Accessibility & Inclusion

Target WCAG AA. Respect `prefers-reduced-motion` (no parallax, no decorative motion when disabled). Support iOS Dynamic Type and Android font scaling up to large accessibility sizes without breaking layout.

Never encode state in color alone. Status, errors, and active states need a non-color cue (icon, weight, position, or text).

Two real-world constraints that should shape every screen:

- One-handed reach. Primary actions belong in the bottom third. Top-of-screen back buttons are fine, but nothing critical lives up there.
- Glanceable while distracted. Type sizes and tap targets need to work for someone walking, on a bus, with one earbud. Not optimized for inspection in a quiet room.

No specific user-needs research yet. Revisit once we have real usage to learn from.

## User Flow

The canonical user flow lives at `../docs/user-flow.md` (relative to this file). Three Mermaid diagrams:

1. **Generation flow**: topic input, clarifying questions, submit, async pipeline (brief, deep research, quality gate, script, ads, audio, metadata), push notification, playback.
2. **Status state machine**: `queued` → `researching` → `scripting` → `generating_audio` → `complete`, with `failed` from any node and auto-refund on terminal failure.
3. **Deep Dive flow** (Plus/Pro): pause podcast, start session, voice Q&A grounded in research, end session, resume at saved position.

Read that file before any shape or craft work. The visual design must serve these flows, not the other way around.

