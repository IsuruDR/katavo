// mobile/app/player/[id].tsx
/**
 * Player — paper-light editorial chapter list above an anchored audio dock,
 * with the persistent DiveBar between them.
 *
 * Three things visible: minimal header (back link + minutes badge), the topic
 * as the page title, and the chapter list as the dominant content. The Dive
 * bar lives just above the audio dock so it reads as a deliberate second
 * action after play. The dock owns audio transport only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../src/lib/supabase";
import { usePlayer } from "../../../src/hooks/usePlayer";
import { useSubscription } from "../../../src/hooks/useSubscription";
import { AudioPlayer } from "../../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../../src/components/ChapterMarkers";
import { ResearchNavRow } from "../../../src/components/ResearchNavRow";
import { ShareNavRow } from "../../../src/components/ShareNavRow";
import { DiveBar } from "../../../src/components/DiveBar";
import { ExpandActionSheet } from "../../../src/components/ExpandActionSheet";
import { ExpansionQueuedSheet } from "../../../src/components/ExpansionQueuedSheet";
import { LoadingOverlay } from "../../../src/components/LoadingOverlay";
import { PurchaseFailureSheet } from "../../../src/components/PurchaseFailureSheet";
import type { SwitchFailure } from "../../../src/lib/switchErrors";
import {
  toPodcast,
  type Podcast,
  type PodcastRow,
} from "../../../src/hooks/usePodcasts";
import { usePlayingPodcast } from "../../../src/state/PlayingPodcastContext";
import { color, font, layout, space, text } from "../../../src/theme/tokens";

export default function PlayerScreen() {
  const { id, expand } = useLocalSearchParams<{ id: string; expand?: string }>();
  const router = useRouter();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandTarget, setExpandTarget] = useState<string | null>(null);
  const [showQueued, setShowQueued] = useState(false);
  const [expandFailure, setExpandFailure] = useState<SwitchFailure | null>(null);
  const [pendingChapter, setPendingChapter] = useState<string | null>(null);
  const { subscription } = useSubscription();
  const { current, ready, load } = usePlayingPodcast();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("podcasts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setPodcast(toPodcast(data as unknown as PodcastRow));
      setLoading(false);
    })();
  }, [id]);

  // Reclaim the global track on every focus, not just on mount. When the
  // user pushes to an expansion and then back, this screen's mount-side
  // effect doesn't re-fire (deps haven't changed), but the context's
  // `current` is now the expansion — leaving us stuck on the
  // "Preparing audio" gate. useFocusEffect runs the claim on initial mount
  // AND every back-navigation, so the parent reclaims itself naturally.
  // `load` short-circuits when currentRef already matches, so re-focusing
  // while still loaded is a cheap setReady(true).
  useFocusEffect(
    useCallback(() => {
      if (!podcast?.audioUrl) return;
      load({
        id: podcast.id,
        topic: podcast.topic,
        audioUrl: podcast.audioUrl,
        coverUrl: podcast.coverUrl,
        durationSeconds: podcast.durationSeconds,
        chapterMarkers: podcast.chapterMarkers ?? [],
      });
    }, [podcast, load]),
  );

  const handleExpandTapped = (chapterTitle: string) => {
    setPendingChapter(chapterTitle);
    setExpandTarget(chapterTitle);
  };

  const handleOpenExpansion = (expansionId: string) => {
    router.push(`/player/${expansionId}`);
  };

  const handleExpandSubmitted = (submittedId: string, alreadyExisted: boolean) => {
    if (alreadyExisted) {
      router.push(`/player/${submittedId}`);
      return;
    }
    // New submission — celebrate. ChapterMarkers' realtime sub will flip
    // the affordance to "Researching…" as generation progresses.
    setShowQueued(true);
  };

  const handleExpandError = (failure: SwitchFailure) => {
    setExpandFailure(failure);
  };

  const handleExpandUpgrade = () => {
    router.push("/plans");
  };

  const handleFailureRetry = () => {
    setExpandFailure(null);
    if (pendingChapter) setExpandTarget(pendingChapter);
  };

  const handleFailureSecondary = () => {
    setExpandFailure(null);
    setPendingChapter(null);
  };

  const handleFailureDismiss = () => {
    setExpandFailure(null);
    setPendingChapter(null);
  };

  // Handle ?expand=N deep-link query param — open the action sheet for the
  // chapter at that index once the podcast is loaded.
  useEffect(() => {
    if (!podcast || !expand) return;
    const idx = parseInt(expand, 10);
    if (Number.isNaN(idx)) return;
    const chapter = podcast.chapterMarkers?.[idx];
    if (chapter?.title) {
      setExpandTarget(chapter.title);
    }
    // Clear the param so we don't re-trigger on every render.
    router.setParams({ expand: "" });
  }, [podcast, expand, router]);

  const player = usePlayer();
  const isCurrentTrack = current?.id === podcast?.id;

  const isPaidTier =
    !!subscription &&
    (subscription.tier === "plus" || subscription.tier === "pro");
  const hasMinutes =
    isPaidTier && subscription!.deepDiveMinutesRemaining > 0;
  const diveLocked = !isPaidTier || !hasMinutes;

  const chapters = podcast?.chapterMarkers ?? [];

  const currentChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    const idx = chapters.reduce((acc, ch, i) => {
      if (player.progress.position >= ch.timestampSeconds) return i;
      return acc;
    }, 0);
    return chapters[idx] ?? null;
  }, [chapters, player.progress.position]);

  // Sticky flag: true once the user has played near the end of the
  // podcast. Drives whether ChapterMarkers exposes the Expand affordance
  // — before this point, showing it is just paywall noise because the
  // user hasn't committed to the content yet. Stays true if they scrub
  // back to listen again. Resets only on screen unmount (next visit
  // re-establishes once playback re-enters the tail).
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  useEffect(() => {
    if (hasReachedEnd) return;
    const { position, duration } = player.progress;
    if (duration > 0 && position >= duration * 0.95) {
      setHasReachedEnd(true);
    }
  }, [player.progress, hasReachedEnd]);

  // Deep Dive UI sunset — feature replaced by chapter expansions (v15-v17).
  // Component file + route + hook + ElevenLabs deps all preserved in the
  // codebase for future revival. To re-enable: flip this to `true`. See spec at
  // docs/superpowers/specs/2026-05-12-chapter-expansions-design.md.
  const SHOW_DEEP_DIVE = false;

  const handleDive = useCallback(() => {
    if (!podcast || !currentChapter) return;
    if (diveLocked) {
      router.push("/plans");
      return;
    }
    player.pause();
    router.push({
      pathname: "/player/deep-dive",
      params: {
        podcastId: podcast.id,
        chapterTitle: currentChapter.title,
        position: String(Math.floor(player.progress.position)),
      },
    });
  }, [diveLocked, player, podcast, currentChapter, router]);

  if (loading || !podcast) return <LoadingOverlay message="Loading podcast" />;
  if (!isCurrentTrack || !ready) {
    return <LoadingOverlay message="Preparing audio" />;
  }

  const totalMinutes = Math.max(
    1,
    Math.round((podcast.durationSeconds ?? 0) / 60),
  );

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.column}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Back to library"
          >
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          {isPaidTier && (
            <View style={styles.minutesBadge}>
              <Text style={styles.minutesText}>
                {subscription?.deepDiveMinutesRemaining} min
              </Text>
            </View>
          )}
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.topic} numberOfLines={3}>
            {podcast.topic}
          </Text>
          <Text style={styles.totalDuration}>{totalMinutes} min</Text>
        </View>

        <ScrollView
          style={styles.chapters}
          contentContainerStyle={styles.chaptersContent}
          showsVerticalScrollIndicator={false}
        >
          {chapters.length > 0 && (
            <ChapterMarkers
              chapters={chapters}
              currentPosition={player.progress.position}
              onChapterPress={player.seekTo}
              parentPodcastId={String(id)}
              onExpandTapped={handleExpandTapped}
              onOpenExpansion={handleOpenExpansion}
              endReached={hasReachedEnd}
            />
          )}
          <ResearchNavRow
            podcastId={String(id)}
            podcastStatus={podcast.status}
          />
          <ShareNavRow
            podcastId={String(id)}
            podcastStatus={podcast.status}
            topic={podcast.topic}
            shareToken={podcast.shareToken}
            onTokenIssued={(token) =>
              setPodcast((p) => (p ? { ...p, shareToken: token } : p))
            }
          />
        </ScrollView>

        {SHOW_DEEP_DIVE && currentChapter && (
          <DiveBar
            chapterTitle={currentChapter.title}
            locked={diveLocked}
            onPress={handleDive}
          />
        )}

        <AudioPlayer
          isPlaying={player.isPlaying}
          position={player.progress.position}
          duration={player.progress.duration}
          podcastId={String(id)}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
          onSkipBack={player.skipBack}
          onSkipForward={player.skipForward}
        />

        {expandTarget && expandFailure === null && (
          <ExpandActionSheet
            visible
            parentPodcastId={String(id)}
            sourceChapterTitle={expandTarget}
            onClose={() => setExpandTarget(null)}
            onSubmitted={handleExpandSubmitted}
            onError={handleExpandError}
            onUpgrade={handleExpandUpgrade}
          />
        )}

        <ExpansionQueuedSheet
          visible={showQueued}
          onDismiss={() => {
            setShowQueued(false);
            setPendingChapter(null);
          }}
        />

        <PurchaseFailureSheet
          visible={expandFailure !== null}
          failure={expandFailure}
          eyebrow="Couldn't expand"
          onRetry={handleFailureRetry}
          onSecondary={handleFailureSecondary}
          onDismiss={handleFailureDismiss}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  column: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  backLabel: {
    ...text.body,
    color: color.inkSecondary,
  },
  minutesBadge: {
    backgroundColor: color.accentSoft,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: 999,
  },
  minutesText: {
    fontFamily: font.sansSemiBold,
    fontSize: 12,
    color: color.accent,
    letterSpacing: 0.3,
  },
  titleBlock: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    gap: space.xs,
  },
  topic: {
    ...text.displaySerif,
    fontSize: 26,
    lineHeight: 32,
  },
  totalDuration: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  chapters: { flex: 1 },
  chaptersContent: {
    paddingHorizontal: space.xl,
    paddingTop: space.xs,
    paddingBottom: space.lg,
  },
});
