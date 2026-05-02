---
name: Katavo
description: Pocket research that hands you a 10-minute podcast on anything you want to learn about
colors:
  paper: "#FBF8F1"
  paper-warm: "#F4EFE3"
  ink: "#1A1B1F"
  ink-secondary: "#84858C"
  ink-tertiary: "#B8B7B0"
  hairline: "#E8E2D2"
  hairline-strong: "#D9D2BE"
  library-green: "#2D5040"
  library-green-wash: "#EAEFEC"
  brick-ink: "#8C4A3D"
  brick-wash: "#F1E4E1"
typography:
  display:
    fontFamily: "IBM Plex Serif, Georgia, serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "38px"
    letterSpacing: "-0.4px"
  title:
    fontFamily: "IBM Plex Serif, Georgia, serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.2px"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  body-small:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.6px"
rounded:
  sm: "6px"
  md: "12px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.library-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
    height: "56px"
    typography: "{typography.body}"
  button-primary-disabled:
    backgroundColor: "{colors.hairline-strong}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
    height: "56px"
  button-play:
    backgroundColor: "{colors.library-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    width: "64px"
    height: "64px"
  button-play-mini:
    backgroundColor: "{colors.library-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "36px"
  chip-credit:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body-small}"
    padding: "4px 0"
  chip-minutes:
    backgroundColor: "{colors.library-green-wash}"
    textColor: "{colors.library-green}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    typography: "{typography.label}"
  pill-dive:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.library-green}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  input-bottom-rule:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "8px 0"
  row-podcast:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "20px 0"
---

# Design System: Katavo

## 1. Overview

**Creative North Star: "The Margin Note"**

Katavo's interface is a pocket-sized printed page. The primary surface is warm paper, type carries the page, and the only persistent ornament is a single ink-stamp green rule used to mark the user's voice, the active row, the call to action. Every screen reads like a stamped, well-edited fragment of a notebook: nothing decorative, nothing announcing itself, but everything precisely placed.

Density is deliberately low. Whitespace and rhythm carry hierarchy more than weight or color. We trust the topic and the chapter list to do the talking; the chrome stays out of the way. When the user opens a podcast, the page should feel less like an app screen and more like the book it could have been. Linear mobile is the reference for navigation obviousness; Reeder is the reference for typographic confidence; Things 3 is the reference for one-screen-one-job pacing.

This system explicitly rejects: dark-with-indigo-accent AI-app slop, NotebookLM's commodity-Google look, ChatGPT-clone bubble UIs, Headspace pastel wellness aesthetics, Spotify-green and Apple-Podcasts-purple platform clichés, and Audible-style stacked-card density.

**Key Characteristics:**
- Warm paper everywhere. Never `#fff`, never grey-blue.
- Editorial Plex Serif for content type. Plex Sans for UI.
- Single ink-stamp green accent at less than 10% of any surface.
- Hairline rules and spacing rhythm, not card backgrounds.
- Typographic state, not iconographic state. Status reads in the type.
- Light theme only. Dark mode is not in scope.

## 2. Colors

A warm-paper neutral system with one decisive accent. The accent is rare on purpose; it earns its place when it appears.

### Primary
- **Library Green** (`#2D5040` — `oklch(0.36 0.06 160)`): the only accent. Used on the play button, the current chapter timestamp, the Dive arrow circle, the user's leading rule in transcripts, the lock-screen artwork's hairline, and the primary CTA fill. Reads as ink-stamp / Penguin-Classics-cousin / library-coded. Never used for decorative tinting, gradients, or large surfaces.

### Neutral
- **Warm Paper** (`#FBF8F1` — `oklch(0.985 0.005 80)`): the canonical surface. Every screen uses this as background. Never `#fff`.
- **Aged Paper** (`#F4EFE3` — `oklch(0.96 0.008 80)`): slightly deeper paper for skeletal placeholders or gently-pressed states. Used sparingly.
- **Ink** (`#1A1B1F` — `oklch(0.18 0.01 240)`): primary type. Slightly cool near-black, never pure black.
- **Smoke** (`#84858C` — `oklch(0.55 0.005 240)`): secondary type for status, metadata, time readouts, captions, ink-secondary contexts.
- **Pencil** (`#B8B7B0` — `oklch(0.74 0.005 80)`): tertiary type for placeholders, disabled labels.
- **Tea Stain** (`#E8E2D2` — `oklch(0.92 0.005 80)`): default hairline divider color.
- **Vellum** (`#D9D2BE`): stronger hairline, used for input bottom rules and skeletons that need more presence.

### Status
- **Brick Ink** (`#8C4A3D` — `oklch(0.50 0.10 30)`): brick-warning color for low-minutes state, refunded podcast metadata, and error language. Desaturated, never bright red, never alarmist.

### Named Rules

**The One Voice Rule.** The accent is used on no more than 10% of any rendered screen. Its rarity is the point. If a designer is tempted to add a second accent, the answer is to remove an existing one.

**The Paper Rule.** Surfaces are never `#fff`. Backgrounds are always Warm Paper. Off-paper neutrals (cards, modals) drift toward Aged Paper, never toward grey or blue.

**The Status-In-Type Rule.** State is conveyed through type weight, color, and position, not through icons or backgrounds. A failed row is type-only Brick Ink. A working row is type-only Smoke with a 2px Library Green leading rule. No badges, no dots, no icons.

## 3. Typography

**Display Font:** IBM Plex Serif (with Georgia, serif fallback)
**Body Font:** IBM Plex Sans (with system-ui fallback)

**Character:** A pairing that signals "designed by someone who cares about ideas". Plex Serif's slab-leaning serifs read as scholarly without being old-world; Plex Sans's Industrial Sans body reads as quietly technical, never trendy. The combination evokes a trade paperback published this year by a small press, not a SaaS dashboard.

### Hierarchy
- **Display** (Plex Serif Bold, 32px, 38px line-height, -0.4 tracking): topic titles on the lock-screen artwork, the Library section header, the Generate input prompt. Reserved for one moment per screen.
- **Title** (Plex Serif SemiBold, 19px, 26px line-height, -0.2 tracking): row titles in the library, current chapter title, clarifying-question prompts. The workhorse of the editorial register.
- **Body** (Plex Sans Medium, 16px, 24px line-height): primary UI text, transcript user-side, button labels.
- **Body Small** (Plex Sans Regular, 14px, 20px line-height): metadata, status lines, durations, captions, secondary copy.
- **Mono** (Plex Sans Medium, 14px, with `tabular-nums` font-variant): timestamps, durations, numeric figures. Same family as Body but locked to tabular numerals so figures align across rows.
- **Label** (Plex Sans SemiBold, 11px, 14px line-height, 0.6 letter-spacing, uppercase): eyebrow labels (`NOW PLAYING`, `DIVE INTO`, `RESEARCHER IS SPEAKING`). Used as a typographic state marker, not a heading.

### Named Rules

**The Two-Family Rule.** Two type families and only two. A Plex variant is the answer; a third typeface is not.

**The Serif-For-Content Rule.** Topic titles, chapter titles, transcript responses from the researcher all use Plex Serif. UI chrome (buttons, time stamps, status, navigation) uses Plex Sans. The serif is the sound of the user's curiosity and the agent's reply; the sans is the frame around them.

**The Tabular-Numerals Rule.** Any digit that appears in a row alongside other digits gets `font-variant: tabular-nums`. Timestamps, durations, "X min", "X chapters" all align across rows.

## 4. Elevation

The system is flat. No shadows, no elevation steps, no z-axis hierarchy at all. Depth is conveyed through hairline rules, paper-tinted backgrounds when needed, and pure spacing rhythm.

There are no `box-shadow` values to catalogue. The card-shaped containers in the legacy implementation were anti-pattern and have been removed. Where a previous version would have used a card with a soft shadow, this system uses spacing alone (the chapter list, the library list) or a single hairline-thick top border (the audio dock, the mini-player, the Dive bar).

### Named Rules

**The No-Shadow Rule.** Shadows do not exist in this system. Surfaces meet via spacing or hairline rules, never via diffuse drop shadows or glassmorphism.

**The Hairline-Or-Whitespace Rule.** When two regions need to feel distinct, they get a 1px hairline divider in Tea Stain, OR they get spacing that does the same job. Never both. Never a panel.

## 5. Components

Every component leads with the same rules: paper background, hairline-or-whitespace separation, accent reserved.

### Buttons

**Primary CTA (button-primary).** A 56px-tall pill (`rounded.pill`) filled Library Green with Plex Sans SemiBold paper-colored 16px label. Used for the Generate submit, Generate-podcast submit at the end of clarifying, and any future single-action commitment. Disabled state swaps fill to Hairline-Strong while keeping paper text and the same shape. There is exactly one primary CTA per screen at any time.

**Play button (button-play).** A 64px circular Library Green disc with a Plex-paper triangle (or double-bar when playing). Optical-aligns the play icon by 2px to the right. Press scales to 0.92 over 100ms, returns over 150ms.

**Mini play (button-play-mini).** The same disc shape at 36px, used in the persistent mini-player. Echoes the larger play button so the affordance reads instantly even at smaller scale.

**Skip transport (`−10` / `+10`).** Pure typographic buttons. Plex Sans SemiBold 22px. Press scales to 0.84 with a parallel ink-to-accent color flash on the label over ~400ms. Disabled state dims to 0.3 opacity but stays visible so the layout doesn't shift.

### Chips

**Credit chip (chip-credit).** No background, no border. Just `{N} credits` in Plex Sans Medium 13px Smoke. Swaps to Brick Ink when count is 0. The most under-styled component in the system.

**Minutes chip (chip-minutes).** A small pill with a Library-Green-Wash background (the accent at ~8% opacity) and Library Green Plex Sans SemiBold 12px label. Used on the player and Deep Dive screens to surface remaining deep-dive minutes. Swaps wash and label to Brick at the warning threshold.

**Dive pill (pill-dive).** Hairline-bordered Library Green pill with Library Green Plex Sans SemiBold 13px label. No fill. Used inline on the persistent DiveBar as the affordance the user taps to start a Deep Dive.

### Cards / Containers

**There are no cards.** Containers are absent by default. Where a section needs to read as distinct (the audio dock, the Dive bar, the mini-player), it gets a 1px Tea Stain hairline at its top edge, no fill, no shadow, no border-radius beyond what the contained children request. Internal padding follows the spacing scale: rows are `lg` vertical (20px), bars are `base` vertical (16px), screens have `xl` horizontal (24px).

### Inputs

**Bottom-rule field (input-bottom-rule).** A multi-line text input with no surrounding background, no top/left/right borders, just a 1px Vellum hairline at the bottom. Type is Plex Serif Medium 17–22px depending on context (clarifying answers use 17px; topic input uses 22px). Placeholder is Pencil. No focus ring; focus is conveyed by the keyboard appearing and the cursor blinking.

### Navigation

**Tab bar.** Paper background with a 1px Tea Stain top border. Active tab uses Library Green icon and label. Inactive tabs use Smoke. Icons are Feather (`book-open`, `feather`, `bookmark`, `user`) at 22px. Labels are Plex Sans SemiBold 11px with 0.4 letter-spacing.

**Back link.** Plex Sans Medium 16px Smoke text reading "Back". No chevron, no icon. Lives top-left on stack screens.

### Signature components

**Leading-edge rule.** A 2px-wide vertical accent rule on the leading edge of a row, full row height. On podcast rows in the library, it pulses opacity 0.4 ↔ 1 over 1.6 seconds when the row is in flight, sits transparent when complete, sits static Brick Ink when failed. On Deep Dive transcript user-turns, the same shape marks the user's voice. This is the system's signature pattern — a printed margin annotation.

**DiveBar.** A 64px-tall paper bar above the audio dock with a 1px Tea Stain top border. Shows an uppercase Label-style "DIVE INTO" eyebrow over the current chapter title in Plex Serif SemiBold 16px. Right side: a 40px Library Green circle with a paper arrow inside, echoing the play button's affordance at smaller scale. The whole bar is a tap target; the circle is decorative-but-evocative, not a separately-tappable button.

**Mini player.** A 64px-tall paper bar above the tab bar with a 1px Tea Stain top border. Uppercase Label "NOW PLAYING" eyebrow above the topic title in Plex Serif SemiBold 15px. Right side: the 36px mini play button. Tap the bar to navigate to the full player; tap the play button to toggle. Persistent across all `(tabs)` routes.

**LoadingOverlay.** Full-screen Warm Paper background, optional Plex Sans Medium 16px Smoke message, a 56px-wide 1px Library Green hairline below the message that breathes opacity 0.4 ↔ 1 over 1.6 seconds. No spinner. No progress bar. Used wherever a previous design would have used `ActivityIndicator`.

**Lock-screen artwork.** A 1024×1024 PNG generated server-side for every podcast. Warm Paper background. Uppercase 22px Library Green "KATAVO" eyebrow at top with high letter-spacing. Topic in Plex Serif Bold 92px below. "X chapters · Y min" in Plex Sans Medium 30px Smoke at the bottom. A single 220px×4px Library Green hairline rule at the very bottom edge. Treats every podcast as a one-of-one printed pamphlet cover.

## 6. Do's and Don'ts

### Do:
- **Do** use Warm Paper (`#FBF8F1`) as the background of every screen. Never `#fff`.
- **Do** reserve Library Green for the play button, the current-chapter accent, the Dive affordance, the user's leading rule, and the primary CTA fill. Nothing else.
- **Do** use Plex Serif for content type (topics, chapter titles, transcript researcher replies) and Plex Sans for UI chrome (buttons, time stamps, navigation).
- **Do** convey state through the type itself. Status text in Smoke, in flight gets a Library Green leading rule that pulses, complete uses default ink, failed uses Brick Ink.
- **Do** use 1px hairlines (Tea Stain at default, Vellum on inputs and skeletons) when separation is needed. Or use spacing rhythm. Never both.
- **Do** anchor primary CTAs to the bottom of the screen. The screen's reading flows top-to-bottom; the action belongs at the end of the read.
- **Do** apply `font-variant: tabular-nums` to any digit that appears alongside another digit.
- **Do** ease motion out with exponential curves (ease-out-quart). Press feedback is 100ms in, 150ms out. Ambient breathing is 1.6 seconds. Reduced motion is honored everywhere.

### Don't:
- **Don't** use the legacy dark theme with the indigo `#6366f1` accent. That treatment is the explicit anti-reference.
- **Don't** copy NotebookLM's commodity Google-product look. Generic AI tool aesthetics are forbidden.
- **Don't** use ChatGPT-style chat bubbles for the Deep Dive transcript or anywhere else. Transcripts read like printed interviews, with a leading rule on user turns and serif type for the agent.
- **Don't** drift toward Headspace / Calm wellness aesthetics. No pastel gradients, no illustrated mascots, no floaty type.
- **Don't** copy podcast-platform color tells. Spotify green, Apple Podcasts purple, Pocket Casts orange are all forbidden. We are not a podcast platform.
- **Don't** use card-on-card density. The Audible audiobook-store look is the inverse of this system.
- **Don't** add `box-shadow`, glassmorphism, or any decorative blur effect.
- **Don't** use side-stripe borders as accents — except the explicit signature 2px Library Green leading rule on rows and transcript turns. That's the one exception, and it earns it.
- **Don't** use `background-clip: text` for gradient text. Emphasis lives in weight, size, and position, not gradients.
- **Don't** use em dashes in copy. Use commas, colons, semicolons, periods, or parentheses.
- **Don't** add a third type family. Two Plex variants, that's it.
- **Don't** use `#000` or `#fff` anywhere in the code. The neutral system is tinted toward warm paper.
- **Don't** ship icons in inactive states. The tab bar always shows icons; the play button always shows its glyph; the rest of the UI is type-led.
