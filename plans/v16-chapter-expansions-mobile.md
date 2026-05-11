# v16 — Chapter Expansions Mobile UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile UX for chapter expansions — library subtitle on expansion rows, in-player Expand affordance with state machine, ExpandActionSheet (paid + free variants), inline pipeline-status indicator for in-flight expansions, deep-link handler, playback event tracking.

**Architecture:** New components/hooks slot into existing player + library surfaces. ChapterMarkers gets state-aware affordances; PodcastRow renders the parent subtitle; ExpandActionSheet wraps the existing SubscriptionModal + PaywallScreen for free-user paths. All reads scope through existing RLS. Playback events insert directly via supabase-js (own-row RLS).

**Tech Stack:** React Native, Expo Router, supabase-js, RevenueCat, Expo Audio, design-token system (`mobile/src/theme/tokens`).

**Spec reference:** `docs/superpowers/specs/2026-05-12-chapter-expansions-design.md`

**Depends on:** v15 (server foundation) must be deployed first — mobile can't submit expansions until the server accepts them.

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `mobile/src/components/ExpandActionSheet.tsx` | Bottom sheet — paid variant (confirm + generate) vs free variant (buy credit / upgrade to Plus) |
| `mobile/src/components/PipelineStatusStrip.tsx` | Inline "Researching… → Scripting… → Recording…" status component for in-flight expansions, reusable in library cards |
| `mobile/src/hooks/useChapterExpansions.ts` | Fetch + subscribe to expansion states for a parent podcast |
| `mobile/src/hooks/useExpansionSubmit.ts` | Wrap submit-podcast API call with expansion args + error handling |
| `mobile/src/hooks/usePlaybackEvents.ts` | Fire-and-forget skip-back / skip-forward inserts to `playback_events` |

### Modified files

| Path | What changes |
|---|---|
| `mobile/src/components/ChapterMarkers.tsx` | State-aware Expand affordance per chapter |
| `mobile/src/components/PodcastRow.tsx` | Render parent-topic subtitle when `parent_podcast_id` set |
| `mobile/src/components/AudioPlayer.tsx` | Fire `recordSkipBack` / `recordSkipForward` from existing 10s skip buttons |
| `mobile/src/hooks/usePodcasts.ts` | Self-join on `parent_podcast_id` for parent topic |
| `mobile/src/services/podcast.ts` | Add expansion signature (`parentPodcastId`, `sourceChapterTitle`) |
| `mobile/app/player/[id].tsx` | Handle `?expand=<chapter_index>` deep-link query param, mount ExpandActionSheet, wire useChapterExpansions |

---

## Chunk 1: Service + hook foundation

### Task 1: Update podcast service signature

**Files:**
- Modify: `mobile/src/services/podcast.ts`

- [ ] **Step 1: Add expansion args to `submitPodcast`**

Replace the existing `submitPodcast` function:

```ts
export interface SubmitPodcastArgs {
  topic: string;
  clarifyingAnswers?: Array<{ q: string; a: string }>;
  parentPodcastId?: string;
  sourceChapterTitle?: string;
}

export async function submitPodcast(
  args: SubmitPodcastArgs,
): Promise<{ podcastId: string; status: "queued" | "exists" }> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(`${API_URL}/api/submit-podcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(args),
  });

  // 409 = expansion already exists; not an error — caller navigates to existing
  if (response.status === 409) {
    const { podcastId } = await response.json();
    return { podcastId, status: "exists" };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? "Failed to submit podcast");
  }

  const { podcastId } = await response.json();
  return { podcastId, status: "queued" };
}
```

- [ ] **Step 2: Update call sites**

`mobile/app/(tabs)/generate.tsx` calls `submitPodcast(topic.trim(), answers)`. Update to `submitPodcast({ topic: topic.trim(), clarifyingAnswers: answers })`.

- [ ] **Step 3: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/services/podcast.ts mobile/app/\(tabs\)/generate.tsx && git commit -m "feat(mobile): podcast service accepts expansion args + handles 409 exists"
```

### Task 2: useChapterExpansions hook

**Files:**
- Create: `mobile/src/hooks/useChapterExpansions.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * For a given parent podcast id, fetch the set of chapter expansions
 * the user has spawned and subscribe to realtime updates so the
 * UI flips chapter affordances as generation completes.
 *
 * Returns:
 *   Map<chapterTitle, { podcastId, status }>
 *
 * Skips listing if the parent has no chapter_transcripts (legacy podcast
 * predating migration 00019) — caller hides the Expand affordance entirely.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export type ExpansionStatus =
  | "queued"
  | "researching"
  | "fact_checking"
  | "scripting"
  | "generating_audio"
  | "complete"
  | "failed";

export interface ExpansionEntry {
  podcastId: string;
  status: ExpansionStatus;
}

export type ExpansionMap = Map<string, ExpansionEntry>;

export interface UseChapterExpansionsResult {
  expansions: ExpansionMap;
  /** Parent itself can't be expanded — show no Expand affordance at all. */
  parentExpandable: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useChapterExpansions(parentPodcastId: string | null): UseChapterExpansionsResult {
  const [expansions, setExpansions] = useState<ExpansionMap>(new Map());
  const [parentExpandable, setParentExpandable] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    if (!parentPodcastId) {
      setExpansions(new Map());
      setParentExpandable(false);
      setLoading(false);
      return;
    }

    // Parent expandability — null chapter_transcripts means legacy
    const { data: parent } = await supabase
      .from("podcasts")
      .select("chapter_transcripts")
      .eq("id", parentPodcastId)
      .single();
    setParentExpandable(!!parent?.chapter_transcripts);

    // Existing expansions (active only)
    const { data: rows } = await supabase
      .from("podcasts")
      .select("id, source_chapter_title, status")
      .eq("parent_podcast_id", parentPodcastId)
      .is("deleted_at", null);

    const map: ExpansionMap = new Map();
    for (const r of rows ?? []) {
      if (r.source_chapter_title) {
        map.set(r.source_chapter_title, {
          podcastId: r.id,
          status: r.status as ExpansionStatus,
        });
      }
    }
    setExpansions(map);
    setLoading(false);
  }, [parentPodcastId]);

  useEffect(() => {
    fetchOnce();
    if (!parentPodcastId) return;

    // Subscribe to INSERT + UPDATE on this parent's expansions
    const channel = supabase
      .channel(`expansions-${parentPodcastId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "podcasts",
          filter: `parent_podcast_id=eq.${parentPodcastId}`,
        },
        () => {
          fetchOnce(); // simple re-fetch; payload could be diffed but small N
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parentPodcastId, fetchOnce]);

  return { expansions, parentExpandable, loading, refresh: fetchOnce };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/hooks/useChapterExpansions.ts && git commit -m "feat(mobile): useChapterExpansions hook with realtime subscription"
```

### Task 3: useExpansionSubmit hook

**Files:**
- Create: `mobile/src/hooks/useExpansionSubmit.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * Submits a chapter expansion. Handles 409 (already exists — caller
 * should navigate to the existing podcast id) and surfaces errors
 * for the caller to render.
 */
import { useState, useCallback } from "react";
import { submitPodcast } from "../services/podcast";

export interface UseExpansionSubmitResult {
  submit: (parentPodcastId: string, sourceChapterTitle: string) => Promise<{
    podcastId: string;
    alreadyExisted: boolean;
  }>;
  submitting: boolean;
  error: string | null;
}

export function useExpansionSubmit(): UseExpansionSubmitResult {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (parentPodcastId: string, sourceChapterTitle: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitPodcast({
          topic: "", // ignored on expansion path
          parentPodcastId,
          sourceChapterTitle,
        });
        return {
          podcastId: result.podcastId,
          alreadyExisted: result.status === "exists",
        };
      } catch (err: any) {
        setError(err?.message ?? "Expansion failed");
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submit, submitting, error };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/hooks/useExpansionSubmit.ts && git commit -m "feat(mobile): useExpansionSubmit hook with 409 handling"
```

### Task 4: usePlaybackEvents hook

**Files:**
- Create: `mobile/src/hooks/usePlaybackEvents.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * Fire-and-forget inserts to playback_events. Used by the player to log
 * skip-back / skip-forward taps, which feed the re-engagement push
 * chapter-selection heuristic (skip-back density = "user wanted to
 * re-hear this chapter").
 *
 * Failures are silently swallowed — losing one data point is acceptable;
 * blocking the UI for a telemetry call is not.
 */
import { useCallback } from "react";
import { supabase } from "../lib/supabase";

export type PlaybackEventType = "skip_back" | "skip_forward";

export interface UsePlaybackEventsResult {
  record: (eventType: PlaybackEventType, timestampSeconds: number) => void;
}

export function usePlaybackEvents(podcastId: string | null): UsePlaybackEventsResult {
  const record = useCallback(
    (eventType: PlaybackEventType, timestampSeconds: number) => {
      if (!podcastId) return;
      // Fire-and-forget — don't await, don't block UI on telemetry
      void supabase
        .from("playback_events")
        .insert({
          podcast_id: podcastId,
          event_type: eventType,
          timestamp_seconds: Math.max(0, Math.round(timestampSeconds)),
        })
        .then(({ error }) => {
          if (error) {
            // Log but don't surface — the heuristic falls back to research density
            console.warn("[playback_events] insert failed:", error.message);
          }
        });
    },
    [podcastId],
  );

  return { record };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/hooks/usePlaybackEvents.ts && git commit -m "feat(mobile): usePlaybackEvents fire-and-forget logger"
```

---

## Chunk 2: Library — parent subtitle

### Task 5: Update usePodcasts query for parent join

**Files:**
- Modify: `mobile/src/hooks/usePodcasts.ts`

- [ ] **Step 1: Update the select**

Find the existing `.select(...)` call in `usePodcasts.ts`. Add the new columns and the self-join:

```ts
.select(`
  id, topic, status, duration_seconds, audio_url, cover_url, created_at,
  has_ads, deleted_at,
  parent_podcast_id, source_chapter_title,
  parent:parent_podcast_id (topic)
`)
```

- [ ] **Step 2: Update the Podcast type to include the new fields + nested parent**

Wherever `Podcast` (or whatever the local interface is called) is defined:

```ts
export interface Podcast {
  // ... existing fields
  parent_podcast_id: string | null;
  source_chapter_title: string | null;
  parent: { topic: string } | null;
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/hooks/usePodcasts.ts && git commit -m "feat(mobile): usePodcasts joins parent.topic for series subtitle"
```

### Task 6: PodcastRow subtitle

**Files:**
- Modify: `mobile/src/components/PodcastRow.tsx`

- [ ] **Step 1: Render subtitle when parent is set**

In `PodcastRow.tsx`, after the main `<Text style={styles.title}>{podcast.topic}</Text>` (or similar), conditionally render:

```tsx
{podcast.parent_podcast_id && podcast.source_chapter_title && (
  <Text style={styles.subtitle} numberOfLines={1}>
    {podcast.parent?.topic
      ? `from "${podcast.parent.topic}" · chapter ${podcast.source_chapter_title}`
      : `from a deleted podcast · chapter ${podcast.source_chapter_title}`}
  </Text>
)}
```

- [ ] **Step 2: Add subtitle style**

In the `StyleSheet.create({...})`:

```ts
subtitle: {
  ...text.bodySmall,
  color: color.inkSecondary,
  fontSize: 12,
  marginTop: space.xxs,
},
```

(Adjust to existing token system; check `mobile/src/theme/tokens.ts` for exact spacing/text values.)

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/components/PodcastRow.tsx && git commit -m "feat(mobile): PodcastRow renders parent subtitle for expansions"
```

---

## Chunk 3: PipelineStatusStrip

### Task 7: Build the inline status component

**Files:**
- Create: `mobile/src/components/PipelineStatusStrip.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * Inline status component for in-flight podcasts (parents or expansions).
 * Maps the raw podcasts.status enum to short human-readable labels.
 *
 * Used in:
 *   - ChapterMarkers (when an expansion of this chapter is in flight)
 *   - PodcastRow (when the podcast itself isn't complete yet — future use)
 */
import { Text, View, StyleSheet, ActivityIndicator } from "react-native";
import { color, font, space } from "../theme/tokens";

export type PodcastStatus =
  | "queued"
  | "researching"
  | "fact_checking"
  | "scripting"
  | "generating_audio"
  | "complete"
  | "failed";

const LABELS: Record<PodcastStatus, string> = {
  queued: "Queued",
  researching: "Researching…",
  fact_checking: "Checking facts…",
  scripting: "Writing…",
  generating_audio: "Recording…",
  complete: "Ready",
  failed: "Failed",
};

interface Props {
  status: PodcastStatus;
}

export function PipelineStatusStrip({ status }: Props) {
  const isFailed = status === "failed";
  const isComplete = status === "complete";
  return (
    <View style={styles.row}>
      {!isFailed && !isComplete && (
        <ActivityIndicator size="small" color={color.inkSecondary} style={styles.spinner} />
      )}
      <Text style={[styles.label, isFailed && styles.failed]}>
        {LABELS[status] ?? status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  spinner: {
    transform: [{ scale: 0.8 }],
  },
  label: {
    fontFamily: font.sansMedium,
    fontSize: 12,
    color: color.inkSecondary,
  },
  failed: {
    color: color.warning,
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/components/PipelineStatusStrip.tsx && git commit -m "feat(mobile): PipelineStatusStrip inline status for in-flight podcasts"
```

---

## Chunk 4: ExpandActionSheet

### Task 8: Build the bottom sheet (paid + free variants)

**Files:**
- Create: `mobile/src/components/ExpandActionSheet.tsx`

- [ ] **Step 1: Write the sheet**

```tsx
/**
 * Bottom sheet shown when user taps Expand on a chapter marker.
 *
 * Paid users (Plus/Pro): single Expand CTA → calls useExpansionSubmit.
 * Free users: two-path UI → buy one credit ($5) via SubscriptionModal,
 *             or upgrade to Plus via PaywallScreen.
 */
import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubscriptionModal } from "./SubscriptionModal";
import { PaywallScreen } from "./PaywallScreen";
import { useSubscription } from "../hooks/useSubscription";
import { useExpansionSubmit } from "../hooks/useExpansionSubmit";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  parentPodcastId: string;
  sourceChapterTitle: string;
  onClose: () => void;
  onSubmitted: (podcastId: string, alreadyExisted: boolean) => void;
}

export function ExpandActionSheet({
  visible,
  parentPodcastId,
  sourceChapterTitle,
  onClose,
  onSubmitted,
}: Props) {
  const { subscription } = useSubscription();
  const isFree = subscription?.tier === "free";
  const { submit, submitting, error } = useExpansionSubmit();
  const [showBuyCredit, setShowBuyCredit] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const handleExpand = async () => {
    try {
      const { podcastId, alreadyExisted } = await submit(parentPodcastId, sourceChapterTitle);
      onSubmitted(podcastId, alreadyExisted);
      onClose();
    } catch {
      // Error is surfaced via the `error` state for inline display
    }
  };

  const handleBuyCreditDone = async () => {
    // After successful credit purchase, auto-submit
    setShowBuyCredit(false);
    await handleExpand();
  };

  const handleUpgradeDone = async () => {
    setShowPaywall(false);
    // User now has Plus — submit the expansion
    await handleExpand();
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Pressable style={styles.scrim} onPress={onClose} />
          <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
            <View style={styles.grabRow}>
              <View style={styles.grab} />
            </View>

            <View style={styles.body}>
              <Text style={styles.eyebrow}>Expand this chapter</Text>
              <Text style={styles.title}>{sourceChapterTitle}</Text>

              {error && <Text style={styles.error}>{error}</Text>}

              {isFree ? (
                <>
                  <Text style={styles.subtitle}>Two ways to keep going:</Text>
                  <View style={styles.optionsStack}>
                    <Pressable
                      onPress={() => setShowBuyCredit(true)}
                      style={({ pressed }) => [styles.optionOutline, pressed && styles.optionPressed]}
                    >
                      <Text style={styles.optionTitle}>Buy one credit ($5)</Text>
                      <Text style={styles.optionMeta}>Use for this episode</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setShowPaywall(true)}
                      style={({ pressed }) => [styles.optionFilled, pressed && styles.optionPressed]}
                    >
                      <Text style={styles.optionTitleFilled}>Upgrade to Plus</Text>
                      <Text style={styles.optionMetaFilled}>
                        $14.99/mo · 8 credits, no ads, expansions included
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.subtitle}>
                    Uses 1 credit · ~10 min to generate
                  </Text>
                  <Pressable
                    onPress={handleExpand}
                    disabled={submitting}
                    style={({ pressed }) => [
                      styles.cta,
                      submitting && styles.ctaDisabled,
                      pressed && !submitting && styles.ctaPressed,
                    ]}
                  >
                    <Text style={styles.ctaLabel}>
                      {submitting ? "Submitting…" : "Expand chapter"}
                    </Text>
                  </Pressable>
                </>
              )}

              <Pressable
                onPress={onClose}
                hitSlop={layout.hitSlop}
                style={styles.cancelRow}
              >
                <Text style={styles.cancel}>
                  {isFree ? "Maybe later" : "Cancel"}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <SubscriptionModal
        visible={showBuyCredit}
        tier={subscription?.tier ?? "free"}
        onClose={() => setShowBuyCredit(false)}
        onPurchased={handleBuyCreditDone}
      />

      {showPaywall && (
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onPurchased={handleUpgradeDone}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(26, 27, 31, 0.45)",
  },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
  },
  grabRow: {
    alignItems: "center",
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairlineStrong,
  },
  body: {
    paddingBottom: space.lg,
    gap: space.sm,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
    marginBottom: space.md,
  },
  error: {
    ...text.bodySmall,
    color: color.warning,
    marginVertical: space.sm,
  },
  optionsStack: {
    gap: space.md,
  },
  optionOutline: {
    borderWidth: 1,
    borderColor: color.accent,
    borderRadius: 16,
    padding: space.lg,
    gap: space.xs,
  },
  optionFilled: {
    backgroundColor: color.accent,
    borderRadius: 16,
    padding: space.lg,
    gap: space.xs,
  },
  optionPressed: { opacity: 0.85 },
  optionTitle: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.accent,
  },
  optionTitleFilled: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.paper,
  },
  optionMeta: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  optionMetaFilled: {
    ...text.bodySmall,
    color: color.paper,
    opacity: 0.85,
  },
  cta: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
    marginTop: space.sm,
  },
  ctaDisabled: { backgroundColor: color.hairlineStrong },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
  cancelRow: {
    alignItems: "center",
    paddingTop: space.md,
  },
  cancel: {
    ...text.bodySmall,
    color: color.inkSecondary,
    paddingVertical: space.sm,
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/components/ExpandActionSheet.tsx && git commit -m "feat(mobile): ExpandActionSheet with paid + free variants"
```

---

## Chunk 5: ChapterMarkers — state-aware expand affordance

### Task 9: Wire useChapterExpansions into ChapterMarkers

**Files:**
- Modify: `mobile/src/components/ChapterMarkers.tsx`

- [ ] **Step 1: Read current ChapterMarkers structure**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/src/components/ChapterMarkers.tsx"
```

- [ ] **Step 2: Take parentPodcastId via props, add expansion state**

Add prop `parentPodcastId` to the existing props interface. At top of component:

```tsx
import { useChapterExpansions } from "../hooks/useChapterExpansions";
import { PipelineStatusStrip } from "./PipelineStatusStrip";
import type { ExpansionStatus } from "../hooks/useChapterExpansions";

interface Props {
  // existing props…
  chapterMarkers: Array<{ timestampSeconds: number; title: string }>;
  parentPodcastId: string; // the CURRENT podcast id (each chapter belongs to it)
  onExpandTapped: (chapterTitle: string) => void;
  onOpenExpansion: (expansionPodcastId: string) => void;
}

export function ChapterMarkers({ chapterMarkers, parentPodcastId, onExpandTapped, onOpenExpansion, ...rest }: Props) {
  const { expansions, parentExpandable } = useChapterExpansions(parentPodcastId);
  // …existing render…
}
```

- [ ] **Step 3: Render per-chapter affordance**

Inside the chapter row render, after the existing title/timestamp:

```tsx
{parentExpandable && (() => {
  const entry = expansions.get(chapter.title);
  if (!entry) {
    return (
      <Pressable
        onPress={() => onExpandTapped(chapter.title)}
        hitSlop={layout.hitSlop}
        style={styles.expandPill}
      >
        <Text style={styles.expandPillLabel}>Expand</Text>
      </Pressable>
    );
  }
  if (entry.status === "complete") {
    return (
      <Pressable
        onPress={() => onOpenExpansion(entry.podcastId)}
        hitSlop={layout.hitSlop}
      >
        <Text style={styles.openExpansionLink}>Open expansion ›</Text>
      </Pressable>
    );
  }
  if (entry.status === "failed") {
    return (
      <Pressable
        onPress={() => onExpandTapped(chapter.title)}
        hitSlop={layout.hitSlop}
      >
        <Text style={styles.tryAgainLink}>Try again</Text>
      </Pressable>
    );
  }
  // queued / researching / scripting / generating_audio / fact_checking
  return <PipelineStatusStrip status={entry.status} />;
})()}
```

- [ ] **Step 4: Add styles**

```ts
expandPill: {
  borderWidth: 1,
  borderColor: color.accent,
  borderRadius: 999,
  paddingHorizontal: space.sm,
  paddingVertical: space.xxs,
},
expandPillLabel: {
  fontFamily: font.sansSemiBold,
  fontSize: 12,
  color: color.accent,
},
openExpansionLink: {
  fontFamily: font.sansMedium,
  fontSize: 13,
  color: color.inkSecondary,
},
tryAgainLink: {
  fontFamily: font.sansMedium,
  fontSize: 13,
  color: color.warning,
},
```

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/components/ChapterMarkers.tsx && git commit -m "feat(mobile): ChapterMarkers state-aware Expand affordance per chapter"
```

---

## Chunk 6: AudioPlayer — fire playback events

### Task 10: Wire playback event recording to skip buttons

**Files:**
- Modify: `mobile/src/components/AudioPlayer.tsx`

- [ ] **Step 1: Take podcastId via props if not already**

Confirm `AudioPlayer` already receives `podcastId`. If not, add it. Then:

```tsx
import { usePlaybackEvents } from "../hooks/usePlaybackEvents";

// inside component
const { record } = usePlaybackEvents(podcastId);
```

- [ ] **Step 2: Hook into skip handlers**

Find the existing `onPress` for the -10s and +10s buttons. Add one line each:

```tsx
// -10s button
onPress={() => {
  record("skip_back", currentPositionSeconds);
  // existing skip logic…
}}

// +10s button
onPress={() => {
  record("skip_forward", currentPositionSeconds);
  // existing skip logic…
}}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/src/components/AudioPlayer.tsx && git commit -m "feat(mobile): AudioPlayer fires playback_events on skip-10s buttons"
```

---

## Chunk 7: Player screen — ExpandActionSheet wiring + deep link

### Task 11: Mount ExpandActionSheet + handle ?expand= query

**Files:**
- Modify: `mobile/app/player/[id].tsx`

- [ ] **Step 1: Wire ExpandActionSheet state**

```tsx
import { ExpandActionSheet } from "../../src/components/ExpandActionSheet";
import { useLocalSearchParams, useRouter } from "expo-router";

// …inside the player component, near other useState:
const router = useRouter();
const params = useLocalSearchParams<{ id: string; expand?: string }>();
const [expandTarget, setExpandTarget] = useState<string | null>(null);

const handleExpandTapped = (chapterTitle: string) => {
  setExpandTarget(chapterTitle);
};

const handleOpenExpansion = (expansionId: string) => {
  router.push(`/player/${expansionId}`);
};

const handleSubmitted = (podcastId: string, alreadyExisted: boolean) => {
  if (alreadyExisted) {
    // 409 — navigate to the existing expansion's player instead of staying in the sheet
    router.push(`/player/${podcastId}`);
  }
  // For new submissions, ChapterMarkers' realtime sub will flip the affordance
  // as generation progresses; nothing else to do here.
};
```

- [ ] **Step 2: Pass props down to ChapterMarkers**

Find the `<ChapterMarkers ... />` render and pass:

```tsx
<ChapterMarkers
  chapterMarkers={podcast.chapter_markers ?? []}
  parentPodcastId={params.id}
  onExpandTapped={handleExpandTapped}
  onOpenExpansion={handleOpenExpansion}
  /* …existing props… */
/>
```

- [ ] **Step 3: Mount ExpandActionSheet at the bottom of the screen**

```tsx
{expandTarget && (
  <ExpandActionSheet
    visible
    parentPodcastId={params.id}
    sourceChapterTitle={expandTarget}
    onClose={() => setExpandTarget(null)}
    onSubmitted={handleSubmitted}
  />
)}
```

- [ ] **Step 4: Handle the ?expand= deep-link query param**

After the podcast has loaded:

```tsx
useEffect(() => {
  if (!podcast || !params.expand) return;
  const idx = parseInt(params.expand, 10);
  const chapter = podcast.chapter_markers?.[idx];
  if (chapter?.title) {
    setExpandTarget(chapter.title);
  }
  // Clear the param so we don't re-trigger on every render
  router.setParams({ expand: undefined });
}, [podcast, params.expand]);
```

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5 && git add mobile/app/player/\[id\].tsx && git commit -m "feat(mobile): player mounts ExpandActionSheet + handles ?expand= deep-link"
```

---

## Chunk 8: Smoke test

### Task 12: Manual end-to-end on a paid account

**Files:** none modified.

Prerequisite: v15 deployed to Railway; mobile dev client installed; you're signed in as a Plus or Pro account.

- [ ] **Step 1: Open a parent podcast (preferably one generated AFTER v15 shipped — has chapter_transcripts populated)**

Verify each chapter marker now shows an "Expand" pill.

- [ ] **Step 2: Tap Expand on a middle chapter**

ExpandActionSheet slides up. Title shows the chapter name. CTA reads "Expand chapter".

- [ ] **Step 3: Tap "Expand chapter"**

Sheet dismisses. The chapter marker for that chapter shows "Researching…" status strip.

- [ ] **Step 4: Wait for completion**

Realtime subscription flips the chapter marker to "Open expansion ›" when status hits `complete`. Tap it. Player navigates to the new expansion.

- [ ] **Step 5: Verify the expansion plays**

- Topic in player header reads like `<parent topic>: <chapter title>`
- Subtitle row in player or library shows "from <parent topic> · chapter X"
- Audio opens with a callback to the source chapter
- Player chapter markers show this expansion's own chapters (which themselves have Expand pills — recursion works)

- [ ] **Step 6: Test idempotency — go back to parent, tap Expand on the same chapter again**

Should navigate directly to the existing expansion player, not generate again. ExpandActionSheet either doesn't appear or shows the "already exists" path.

- [ ] **Step 7: Test free-user variant (sign out, sign in as a free account)**

Tap Expand on a chapter. Two-path bottom sheet appears with both options. Don't actually purchase — just confirm the sheet renders correctly.

- [ ] **Step 8: Test skip-back event firing**

In an active player session, tap the -10s button 2-3 times. Open Supabase and verify rows in `playback_events`:

```sql
SELECT * FROM playback_events
WHERE podcast_id = '<test_podcast_id>'
ORDER BY created_at DESC LIMIT 10;
```

Expected: rows with `event_type='skip_back'`, sensible `timestamp_seconds`.

---

## What ships at the end of v16

- Mobile users can tap Expand on any chapter and successfully generate an expansion
- Free users see the two-path bottom sheet
- Generation progress flips chapter markers in realtime
- Completed expansions are navigable, with parent context shown in library and player
- Playback events are logged for future heuristic use
- Deep Dive still visible in the UI (sunset happens in v17)

## Phase exit criteria

- `npx tsc --noEmit` in mobile: clean
- Manual smoke test (Chunk 8) passes end-to-end on both paid + free accounts
- Deep-link from a notification (`/player/<id>?expand=N`) opens the player and auto-opens the ExpandActionSheet — testable via `npx uri-scheme open` or pasting the deep-link in a sandbox push payload
- No remaining `TODO` or `FIXME` markers in the modified files
- No mobile-side console errors or warnings during the smoke test
