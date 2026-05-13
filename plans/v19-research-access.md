# v19 , Research Access for Paid Plans Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the research data (sections, sources, cited prose) behind every completed podcast to Plus+ users via a single "Research" NavRow in the player. Tap opens a chapter-by-chapter view with clickable global-numbered citations and a "Coverage gaps" footer when applicable.

**Architecture:** Mobile-only. New `useResearchContext` hook does a lazy Supabase read of `research_contexts` joined with `podcasts.chapter_research_map`. Module-scoped cache clears on auth signOut. UI is a NavRow below the chapter list (player) plus a dedicated route at `/player/[id]/research`. Citations live in a tiny `parseCitations` utility for testability and clarity.

**Tech Stack:** React Native, Expo Router, supabase-js, `Linking.openURL` for source taps. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-13-research-access-design.md`

**Ships as:** Single mobile-side PR. No pipeline changes. No DB migration. No new env vars. Reload bundle in dev, EAS build for production.

**Note on tests:** the mobile package has no test framework configured today (verified: no `tests/` directory, no `vitest`/`jest` in `package.json`). The spec's test plan stays as future state. This plan verifies via `tsc --noEmit` + a documented manual smoke test. The pure `parseCitations` utility lands as exported so tests can plug in trivially once the harness exists.

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `mobile/src/hooks/useResearchContext.ts` | Lazy fetch + module-scoped cache + signOut clear |
| `mobile/src/lib/parseCitations.ts` | Pure utility splitting prose into text + `[N]` citation segments |
| `mobile/src/components/ResearchNavRow.tsx` | NavRow under the chapter list. Tier-gated rendering, hidden when status not complete |
| `mobile/src/components/ResearchCitation.tsx` | Inline `[N]` citation with `hitSlop` + `Linking.openURL` |
| `mobile/src/components/ResearchSourceRow.tsx` | One source: global index + title + url, tappable to open externally |
| `mobile/src/components/ResearchChapterSection.tsx` | One chapter's heading + cited prose paragraphs + per-chapter sources subsection |
| `mobile/app/player/[id]/research.tsx` | Research screen route , header, chapter sections, coverage gaps footer, empty/loading/error states |

### Modified files

| Path | What changes |
|---|---|
| `mobile/src/lib/tiers.ts` | Add `research: "plus"` to `FEATURE_MIN_TIER` |
| `mobile/app/player/[id].tsx` | **Renamed to `app/player/[id]/index.tsx`** to make room for a nested `/research` route. Same content. Then import + mount `<ResearchNavRow ... />` inside the chapter ScrollView's contentContainer, after the chapter list. |

**Route layout reason:** expo-router can't have both `app/player/[id].tsx` (file) and `app/player/[id]/research.tsx` (file inside directory) , `[id]` collides with itself. The convention is to convert the leaf to `[id]/index.tsx` and put siblings alongside.

### Unaffected

- Pipeline (`pipeline/src/podcast_pipeline/*`). `research_contexts` + `chapter_research_map` already populated by metadataWriter on every successful run including expansions.
- Database. No new tables, columns, RLS policies, or migrations.
- Free-user experience on other surfaces. The tier-gate is local to this NavRow + screen.

---

## Chunk 1: Tier gate + data hook

### Task 1: Add `research` to `FEATURE_MIN_TIER`

**Files:**
- Modify: `mobile/src/lib/tiers.ts`

- [ ] **Step 1: Add the entry**

Find the existing `FEATURE_MIN_TIER` constant. Add a `research` key:

```ts
export type LockableFeature = "deepDive" | "noAds" | "cheaperCredits" | "research";

export const FEATURE_MIN_TIER: Record<LockableFeature, Tier> = {
  deepDive: "plus",
  noAds: "plus",
  cheaperCredits: "plus",
  research: "plus",
};
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 2: Create `useResearchContext` hook

**Files:**
- Create: `mobile/src/hooks/useResearchContext.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * Lazy fetch of the research artifact for a single podcast.
 *
 * Reads research_contexts joined with podcasts.chapter_research_map +
 * chapter_markers in one round-trip. Module-scoped Map cache returns
 * cached data immediately, then refreshes in the background. Cache
 * clears on auth SIGNED_OUT so user-switch on the same device doesn't
 * flash the previous user's research.
 *
 * RLS scopes ownership server-side (own-row only). Tier gate is purely
 * client-side; this hook doesn't check tier , callers do.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export interface ResearchSource {
  url: string;
  title: string;
}

export interface ResearchSection {
  title: string;
  content: string;
}

export interface ResearchClaim {
  text: string;
  sourceIndexes: number[];
}

export interface ResearchDocument {
  sections: ResearchSection[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  droppedQuestions: string[];
}

export interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

export type ChapterResearchMap = Record<string, ChapterResearchEntry>;

export interface ChapterMarker {
  timestampSeconds: number;
  title: string;
}

export interface ResearchContext {
  researchDocument: ResearchDocument;
  chapterResearchMap: ChapterResearchMap | null;
  chapterMarkers: ChapterMarker[];
}

// Module-scoped cache. Cleared via auth-state subscription below.
const cache = new Map<string, ResearchContext>();

// Subscribe once at module load. Clears the cache on SIGNED_OUT so a
// device-shared user switch never serves stale data. (RLS would block
// the server read for the new user, but the cached object would still
// flash before that.)
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    cache.clear();
  }
});

export interface UseResearchContextResult {
  data: ResearchContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useResearchContext(
  podcastId: string | null,
): UseResearchContextResult {
  const [data, setData] = useState<ResearchContext | null>(
    podcastId ? cache.get(podcastId) ?? null : null,
  );
  const [loading, setLoading] = useState(!data && podcastId !== null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFresh = useCallback(async () => {
    if (!podcastId) return;
    setError(null);
    try {
      const { data: rc, error: rcErr } = await supabase
        .from("research_contexts")
        .select("research_document")
        .eq("podcast_id", podcastId)
        .maybeSingle();
      if (rcErr) throw rcErr;

      const { data: pod, error: podErr } = await supabase
        .from("podcasts")
        .select("chapter_research_map, chapter_markers")
        .eq("id", podcastId)
        .maybeSingle();
      if (podErr) throw podErr;

      if (!rc?.research_document) {
        // Legacy podcast or failed-mid-pipeline. data stays null; caller
        // renders the "Research isn't available" empty state.
        if (mountedRef.current) {
          setData(null);
          setLoading(false);
        }
        cache.delete(podcastId);
        return;
      }

      const ctx: ResearchContext = {
        researchDocument: rc.research_document as ResearchDocument,
        chapterResearchMap:
          (pod?.chapter_research_map as ChapterResearchMap | null) ?? null,
        chapterMarkers:
          (pod?.chapter_markers as ChapterMarker[] | null) ?? [],
      };
      cache.set(podcastId, ctx);
      if (mountedRef.current) {
        setData(ctx);
        setLoading(false);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err?.message ?? "Couldn't load research");
        setLoading(false);
      }
    }
  }, [podcastId]);

  useEffect(() => {
    if (!podcastId) {
      setData(null);
      setLoading(false);
      return;
    }
    // Stale-while-revalidate: render cached immediately, refetch in
    // background.
    const cached = cache.get(podcastId);
    setData(cached ?? null);
    setLoading(!cached);
    void fetchFresh();
  }, [podcastId, fetchFresh]);

  return {
    data,
    loading,
    error,
    refresh: fetchFresh,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit Chunk 1**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/lib/tiers.ts mobile/src/hooks/useResearchContext.ts && git commit -m "feat(mobile): tier gate + lazy useResearchContext hook"
```

---

## Chunk 2: Player NavRow

### Task 3: Create `ResearchNavRow`

**Files:**
- Create: `mobile/src/components/ResearchNavRow.tsx`

- [ ] **Step 1: Write the component**

Mirror the editorial NavRow pattern used in `app/(tabs)/account.tsx` (eyebrow + value + chevron, divider hairline above).

```tsx
/**
 * ResearchNavRow , sits below the chapter list in the player.
 *
 * Tier-gated: free users see "Research · Plus" eyebrow and route to
 * /plans. Plus+ users see "Research" and route to the research screen.
 *
 * Hidden when podcastStatus !== "complete" (in-flight or failed
 * podcasts have no research to surface).
 *
 * The hook handles the "no research_contexts row" empty state on the
 * screen itself; we don't pre-check here.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSubscription } from "../hooks/useSubscription";
import { isFeatureUnlocked } from "../lib/tiers";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  podcastId: string;
  podcastStatus: string;
}

export function ResearchNavRow({ podcastId, podcastStatus }: Props) {
  const router = useRouter();
  const { subscription } = useSubscription();

  if (podcastStatus !== "complete") return null;

  const tier = subscription?.tier ?? "free";
  const unlocked = isFeatureUnlocked("research", tier);

  const onPress = () => {
    if (unlocked) {
      router.push(`/player/${podcastId}/research`);
    } else {
      router.push("/plans");
    }
  };

  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          unlocked
            ? "Open research and sources behind this episode"
            : "Research is a Plus feature. Upgrade to access."
        }
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>
            {unlocked ? "Research" : "Research · Plus"}
          </Text>
          <Text style={styles.title}>Sources behind this episode</Text>
        </View>
        <Feather name="chevron-right" size={20} color={color.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rowPressed: {
    opacity: 0.55,
  },
  body: {
    flex: 1,
    gap: space.xxs,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  title: {
    ...text.titleSerif,
    fontSize: 19,
    lineHeight: 26,
  },
});
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean. If `text.titleSerif` doesn't exist, check `mobile/src/theme/tokens.ts` for the closest serif-title token and substitute. If `space.xxs` doesn't exist, fall back to `space.xs`.

### Task 4: Rename player file and mount the NavRow

**Files:**
- Rename: `mobile/app/player/[id].tsx` → `mobile/app/player/[id]/index.tsx`
- Modify: the renamed file

- [ ] **Step 1: Rename the file**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && mkdir -p app/player/\[id\] && git mv app/player/\[id\].tsx app/player/\[id\]/index.tsx
```

Verify the URL still works: `/player/<some-id>` should resolve to `app/player/[id]/index.tsx` in expo-router.

- [ ] **Step 2: Fix relative imports inside the renamed file**

The file moved one directory deeper. All `../../src/...` imports become `../../../src/...`. Open the renamed file and update each relative import. Look for any other relative paths (e.g., to `app/_layout` if referenced). tsc will catch breakage.

- [ ] **Step 3: Add the ResearchNavRow import**

```tsx
import { ResearchNavRow } from "../../../src/components/ResearchNavRow";
```

- [ ] **Step 4: Mount below the chapter list (inside the ScrollView)**

The NavRow goes INSIDE the chapters ScrollView's content container, after the `<ChapterMarkers ... />`. This puts the trigger at the bottom of the editorial scroll , the user reads chapters, then encounters Research as the next thing.

Find this block:

```tsx
        <ScrollView ...>
          {chapters.length > 0 && (
            <ChapterMarkers ... />
          )}
        </ScrollView>
```

Insert the NavRow inside the ScrollView, after ChapterMarkers:

```tsx
        <ScrollView ...>
          {chapters.length > 0 && (
            <ChapterMarkers ... />
          )}
          <ResearchNavRow
            podcastId={String(id)}
            podcastStatus={podcast.status}
          />
        </ScrollView>
```

The `podcast.status` field already exists on the local `podcast` state. The NavRow hides itself when status is not `complete`, so an in-flight podcast won't render a visible row inside the ScrollView (returns null).

- [ ] **Step 3: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Commit Chunk 2**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/components/ResearchNavRow.tsx mobile/app/player/\[id\].tsx && git commit -m "feat(mobile): ResearchNavRow in player, tier-gated to Plus+"
```

---

## Chunk 3: Citation primitives

### Task 5: Pure `parseCitations` utility

**Files:**
- Create: `mobile/src/lib/parseCitations.ts`

- [ ] **Step 1: Write the parser**

```ts
/**
 * Splits cited prose into a sequence of plain-text and citation segments.
 *
 * Input: "Bezzera filed [1] in 1901 [2]."
 * Output: [
 *   { type: "text", value: "Bezzera filed " },
 *   { type: "citation", n: 1 },
 *   { type: "text", value: " in 1901 " },
 *   { type: "citation", n: 2 },
 *   { type: "text", value: "." },
 * ]
 *
 * Citation numbers are 1-indexed (matching the synthesizer prompt's
 * emit format). Renderer converts to 0-indexed when looking up sources
 * (sources[n - 1]).
 *
 * Edge cases:
 *   - "[10]" , multi-digit accepted
 *   - "[1][2]" , adjacent citations split into two segments
 *   - "[0]" , invalid (synthesizer emits 1-indexed only); we still
 *     parse it as citation n=0, renderer can treat as plain text.
 *   - "[abc]" , bracketed non-digit not parsed as citation; stays
 *     as plain text.
 *   - "no citations" , single text segment returned.
 */
export type CitationSegment =
  | { type: "text"; value: string }
  | { type: "citation"; n: number };

const CITATION_PATTERN = /\[(\d+)\]/g;

export function parseCitations(content: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_PATTERN.lastIndex = 0;
  while ((match = CITATION_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "citation", n: parseInt(match[1], 10) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments;
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 6: `ResearchCitation` component

**Files:**
- Create: `mobile/src/components/ResearchCitation.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * Inline tappable [N] citation. Receives the already-parsed n + the
 * source URL it points to. Uses hitSlop to give a comfortable hit
 * area on a small bracketed glyph.
 *
 * On tap: opens the URL externally via Linking.openURL. Falls back
 * silently if the URL is malformed or canOpenURL is false.
 */
import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { color, font, layout } from "../theme/tokens";

interface Props {
  n: number;
  sourceUrl: string | null;
}

export function ResearchCitation({ n, sourceUrl }: Props) {
  const onPress = async () => {
    if (!sourceUrl) return;
    try {
      const supported = await Linking.canOpenURL(sourceUrl);
      if (supported) {
        await Linking.openURL(sourceUrl);
      }
    } catch {
      // Silent failure , leave the user with no surface error since
      // they can tap again or open the same source from the per-chapter
      // sources list below.
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={layout.hitSlop}
      accessibilityRole="link"
      accessibilityLabel={`Source ${n}`}
    >
      <Text style={styles.citation}>{`[${n}]`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  citation: {
    fontFamily: font.sansSemiBold,
    color: color.accent,
    fontSize: 14,
  },
});
```

NOTE: `Pressable` inline with `Text` is tricky in React Native , `Pressable` is a block-level View by default. To inline, the parent ChapterSection will render text + citation segments in a `<Text>` parent with each citation wrapped in nothing more than `<Text style={styles.citation} onPress={...}>` (a regular Text with onPress works inline and is the idiomatic RN pattern for inline tappable text). Update the component accordingly:

```tsx
import { Linking, StyleSheet, Text } from "react-native";
import { color, font } from "../theme/tokens";

interface Props {
  n: number;
  sourceUrl: string | null;
}

export function ResearchCitation({ n, sourceUrl }: Props) {
  const onPress = async () => {
    if (!sourceUrl) return;
    try {
      const supported = await Linking.canOpenURL(sourceUrl);
      if (supported) await Linking.openURL(sourceUrl);
    } catch {
      // silent , user can use the per-chapter sources list below
    }
  };

  return (
    <Text
      style={styles.citation}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Source ${n}`}
    >{` [${n}]`}</Text>
  );
}

const styles = StyleSheet.create({
  citation: {
    fontFamily: font.sansSemiBold,
    color: color.accent,
  },
});
```

(Note the leading space inside the literal: `[N]` reads better with a leading space-pad so it doesn't crash into the previous word. The parser preserves the space from input, but inline `Text onPress` sometimes loses leading whitespace; explicit pad inside the citation is safer.)

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### Task 7: `ResearchSourceRow` component

**Files:**
- Create: `mobile/src/components/ResearchSourceRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * One entry in a per-chapter sources subsection: [globalIndex+1] · title · host.
 * Tap opens the URL externally.
 */
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  /** 1-indexed citation number (the [N] shown in prose). */
  n: number;
  title: string;
  url: string;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchSourceRow({ n, title, url }: Props) {
  const onPress = async () => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
    } catch {
      // silent
    }
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Source ${n}: ${title}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.number}>{`[${n}]`}</Text>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.host} numberOfLines={1}>
          {hostFromUrl(url)}
        </Text>
      </View>
      <Feather name="external-link" size={16} color={color.inkSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: space.sm,
    gap: space.sm,
  },
  rowPressed: { opacity: 0.55 },
  number: {
    fontFamily: font.sansSemiBold,
    fontSize: 14,
    color: color.accent,
    width: 36,
    paddingTop: 2,
  },
  body: {
    flex: 1,
    gap: space.xxs,
  },
  title: {
    ...text.bodySmall,
    color: color.ink,
    fontFamily: font.sansMedium,
  },
  host: {
    ...text.bodySmall,
    color: color.inkSecondary,
    fontSize: 12,
  },
});
```

### Task 8: `ResearchChapterSection` component

**Files:**
- Create: `mobile/src/components/ResearchChapterSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * One chapter's research block: chapter heading, cited prose
 * paragraphs (with inline ResearchCitation segments), and a
 * per-chapter Sources subsection.
 *
 * Numbering stays global. Per-chapter sources are filtered from the
 * full sources array by `sourceIndexes`, but each row renders with its
 * GLOBAL index + 1 (so [3] in chapter 1's prose matches [3] in chapter
 * 1's sources subsection, and [3] in chapter 4 too if that chapter
 * also cites source index 2).
 */
import { StyleSheet, Text, View } from "react-native";
import { parseCitations } from "../lib/parseCitations";
import { ResearchCitation } from "./ResearchCitation";
import { ResearchSourceRow } from "./ResearchSourceRow";
import type { ResearchSection, ResearchSource } from "../hooks/useResearchContext";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  chapterTitle: string;
  /** Sections that feed this chapter, in order. */
  sections: ResearchSection[];
  /** Full sources array , citation lookup uses global indexes. */
  sources: ResearchSource[];
  /** Global source indexes cited by this chapter (used to filter the
   *  per-chapter sources subsection). */
  citedSourceIndexes: number[];
}

export function ResearchChapterSection({
  chapterTitle,
  sections,
  sources,
  citedSourceIndexes,
}: Props) {
  const dedupedCited = Array.from(new Set(citedSourceIndexes)).sort((a, b) => a - b);

  return (
    <View style={styles.section}>
      <Text style={styles.chapterTitle}>{chapterTitle}</Text>

      {sections.map((s, i) => (
        <View key={i} style={styles.subsection}>
          {s.title ? <Text style={styles.sectionTitle}>{s.title}</Text> : null}
          <Text style={styles.body}>
            {parseCitations(s.content).map((seg, j) => {
              if (seg.type === "text") {
                return <Text key={j}>{seg.value}</Text>;
              }
              // Out-of-range citation indexes (e.g. [0] or [99] when
              // sources has 10 entries) render as plain text rather
              // than a broken green-tap-no-op affordance.
              if (seg.n < 1 || seg.n > sources.length) {
                return <Text key={j}>{` [${seg.n}]`}</Text>;
              }
              return (
                <ResearchCitation
                  key={j}
                  n={seg.n}
                  sourceUrl={sources[seg.n - 1].url}
                />
              );
            })}
          </Text>
        </View>
      ))}

      {dedupedCited.length > 0 && (
        <View style={styles.sourcesBlock}>
          <Text style={styles.sourcesEyebrow}>Sources</Text>
          {dedupedCited.map((idx) => {
            const source = sources[idx];
            if (!source) return null;
            return (
              <ResearchSourceRow
                key={idx}
                n={idx + 1}
                title={source.title}
                url={source.url}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: space.lg,
    gap: space.md,
  },
  chapterTitle: {
    ...text.titleSerif,
    fontSize: 22,
    lineHeight: 28,
    color: color.ink,
  },
  subsection: {
    gap: space.xs,
  },
  sectionTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
  },
  body: {
    ...text.body,
    color: color.ink,
    lineHeight: 24,
  },
  sourcesBlock: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: space.xxs,
  },
  sourcesEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.xs,
  },
});
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit Chunk 3**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/lib/parseCitations.ts mobile/src/components/ResearchCitation.tsx mobile/src/components/ResearchSourceRow.tsx mobile/src/components/ResearchChapterSection.tsx && git commit -m "feat(mobile): citation primitives + chapter section component"
```

---

## Chunk 4: Research screen

### Task 9: Create the research route

**Files:**
- Create: `mobile/app/player/[id]/research.tsx`

- [ ] **Step 1: Confirm expo-router can serve nested dynamic routes**

The path `app/player/[id]/research.tsx` creates a nested route under the existing dynamic `[id]` segment. expo-router supports this out of the box. No layout file needed; the screen inherits from the root stack.

- [ ] **Step 2: Write the screen**

```tsx
/**
 * Research screen , chapter-by-chapter view of the podcast's research,
 * with clickable citations and an optional Coverage gaps footer.
 *
 * Tier-gated: redirects free users to /plans on mount. Empty state
 * for podcasts without a research_contexts row (legacy, race). Error
 * state with pull-to-refresh on network failure.
 */
import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSubscription } from "../../../src/hooks/useSubscription";
import { isFeatureUnlocked } from "../../../src/lib/tiers";
import { useResearchContext } from "../../../src/hooks/useResearchContext";
import { ResearchChapterSection } from "../../../src/components/ResearchChapterSection";
import { color, font, layout, space, text } from "../../../src/theme/tokens";

export default function ResearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { subscription, loading: subLoading } = useSubscription();
  const { data, loading, error, refresh } = useResearchContext(id ?? null);

  const tier = subscription?.tier ?? "free";
  const unlocked = isFeatureUnlocked("research", tier);

  // Free deep-link redirect. Wait for subscription to load so we don't
  // bounce a paid user on the first render where tier is still "free"
  // by default.
  useEffect(() => {
    if (subLoading) return;
    if (!unlocked) {
      const t = setTimeout(() => {
        router.replace("/plans");
      }, 600);
      return () => clearTimeout(t);
    }
  }, [unlocked, subLoading, router]);

  // Group sections by chapter using chapter_research_map. Fallback:
  // when chapterResearchMap is null, render sections flat with an
  // "Chapter mapping unavailable" eyebrow.
  const grouped = useMemo(() => {
    if (!data) return null;
    if (!data.chapterResearchMap) return null;
    return data.chapterMarkers.map((chapter) => {
      const entry = data.chapterResearchMap![chapter.title];
      if (!entry) {
        return {
          chapterTitle: chapter.title,
          sections: [],
          citedSourceIndexes: [],
        };
      }
      const sections = entry.researchSections
        .map((i) => data.researchDocument.sections[i])
        .filter(Boolean);
      return {
        chapterTitle: chapter.title,
        sections,
        citedSourceIndexes: entry.sourceIndexes,
      };
    });
  }, [data]);

  if (!unlocked) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.center}>
          <Text style={styles.message}>Research is a Plus feature.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Back to player"
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={color.accent}
            colors={[color.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Research</Text>
        <Text style={styles.title}>Sources behind this episode</Text>

        {loading && !data && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={color.inkSecondary} />
          </View>
        )}

        {error && !loading && (
          <Text style={styles.error}>Couldn't load research. Pull to refresh.</Text>
        )}

        {!loading && !error && !data && (
          <Text style={styles.empty}>Research isn't available for this podcast.</Text>
        )}

        {data && grouped === null && (
          // chapterResearchMap is null: flat list with eyebrow
          <View>
            <Text style={styles.fallbackEyebrow}>Chapter mapping unavailable</Text>
            {data.researchDocument.sections.map((s, i) => (
              <ResearchChapterSection
                key={i}
                chapterTitle={s.title ?? `Section ${i + 1}`}
                sections={[s]}
                sources={data.researchDocument.sources}
                citedSourceIndexes={[]}
              />
            ))}
          </View>
        )}

        {data && grouped && grouped.map((g, i) => (
          <ResearchChapterSection
            key={i}
            chapterTitle={g.chapterTitle}
            sections={g.sections}
            sources={data.researchDocument.sources}
            citedSourceIndexes={g.citedSourceIndexes}
          />
        ))}

        {data && data.researchDocument.droppedQuestions.length > 0 && (
          <View style={styles.gapsBlock}>
            <Text style={styles.gapsEyebrow}>Coverage gaps</Text>
            <Text style={styles.gapsLead}>
              The research didn't manage to answer:
            </Text>
            {data.researchDocument.droppedQuestions.map((q, i) => (
              <Text key={i} style={styles.gapItem}>
                {`· ${q}`}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  header: {
    flexDirection: "row",
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  backLabel: {
    ...text.body,
    color: color.inkSecondary,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
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
    fontSize: 26,
    lineHeight: 32,
    marginBottom: space.lg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: space.xl,
  },
  message: {
    ...text.body,
    color: color.inkSecondary,
    textAlign: "center",
  },
  loadingBlock: {
    paddingVertical: space.xxl,
    alignItems: "center",
  },
  error: {
    ...text.body,
    color: color.warning,
    paddingVertical: space.lg,
  },
  empty: {
    ...text.body,
    color: color.inkSecondary,
    paddingVertical: space.lg,
  },
  fallbackEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.sm,
  },
  gapsBlock: {
    marginTop: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: space.xs,
  },
  gapsEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.sm,
  },
  gapsLead: {
    ...text.body,
    color: color.inkSecondary,
  },
  gapItem: {
    ...text.body,
    color: color.ink,
    marginLeft: space.sm,
  },
});
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean. If `text.titleSerif` or `text.displaySerif` don't exist with those exact names, substitute the closest serif heading token. `text.body` and `text.bodySmall` are confirmed to exist in tokens.ts. `space.xxxl` exists.

- [ ] **Step 3: Commit Chunk 4**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/player/\[id\]/research.tsx && git commit -m "feat(mobile): research screen , chapter grouping, citations, coverage gaps"
```

---

## Chunk 5: End-to-end verification + handoff

### Task 10: Full mobile tsc

**Files:** none modified.

- [ ] **Step 1: Run tsc**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 2: Spot-check imports / file structure**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && ls -la src/hooks/useResearchContext.ts src/lib/parseCitations.ts src/components/Research*.tsx app/player/\[id\]/research.tsx
```

Expected: all 6 new files present. No broken imports (tsc would have caught any).

### Task 11: Manual smoke test handoff

**Files:** none modified.

- [ ] **Step 1: Surface the smoke test plan to the user**

The implementer should not deploy or push autonomously. Mobile changes ship via dev-client bundle reload or EAS build, not Railway. Surface this to the user:

> "v19 ready for smoke test. Reload the bundle in your dev client (or shake → reload). Test plan:
>
> 1. Paid account, completed parent podcast: scroll past chapters → see 'Research' NavRow. Tap. Screen shows chapter-grouped sections with `[N]` citations. Tap a `[1]` → opens the source URL externally.
> 2. Paid account, completed expansion: same flow, but the research shown is the expansion's (deeper) research.
> 3. Free account, completed podcast: NavRow shows 'Research · Plus'. Tap → routes to /plans.
> 4. Free account, deep-link to `/player/<id>/research`: sees 'Research is a Plus feature.' message, then bounces to /plans after ~600ms.
> 5. In-flight podcast (queued, researching, etc.): NavRow hidden.
> 6. Failed podcast: NavRow hidden (status check).
> 7. Coverage gaps: if any podcast had dropped questions, the footer renders. Otherwise it doesn't appear.
> 8. Pull-to-refresh on the research screen → re-fetches.
>
> No tests in mobile/ today; tsc + this smoke run is the bar. If you want, we can set up vitest for mobile in a follow-up plan."

---

## Phase exit criteria

Before declaring v19 done:

- `npx tsc --noEmit` in mobile: clean.
- `npx tsc --noEmit` in pipeline: still clean (we didn't touch it, but verify).
- All 7 manual smoke steps pass on a dev client.
- Citation tap opens an external URL on at least one iOS test.

## Reverting

Single mobile-only branch. Revert path is `git revert <merge-commit-or-range>`. No DB migration, no pipeline change. The new `/player/[id]/research` route returns 404 if the file is gone (expo-router handles cleanly).

## What ships

- Plus + Pro users gain a "Research" entry below the chapter list in every completed podcast's player.
- Tapping opens a paper-light screen with chapter-grouped sections, clickable `[N]` citations, per-chapter sources, and an optional "Coverage gaps" footer.
- Free users see the locked entry and route to /plans on tap.
- Expansion players get their own research surface for free, using the same components.
- No pipeline change, no DB migration, no new env vars.
