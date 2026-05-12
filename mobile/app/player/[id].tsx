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
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { usePlayer } from "../../src/hooks/usePlayer";
import { useSubscription } from "../../src/hooks/useSubscription";
import { AudioPlayer } from "../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../src/components/ChapterMarkers";
import { DiveBar } from "../../src/components/DiveBar";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import {
  toPodcast,
  type Podcast,
  type PodcastRow,
} from "../../src/hooks/usePodcasts";
import { usePlayingPodcast } from "../../src/state/PlayingPodcastContext";
import { color, font, layout, space, text } from "../../src/theme/tokens";

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Hand the podcast to the global context once we have it. If it's already
  // the loaded track (e.g. user came in from the mini-player), context.load
  // is a no-op and playback position is preserved.
  useEffect(() => {
    if (!podcast?.audioUrl) return;
    load({
      id: podcast.id,
      topic: podcast.topic,
      audioUrl: podcast.audioUrl,
      coverUrl: podcast.coverUrl,
      durationSeconds: podcast.durationSeconds,
      chapterMarkers: podcast.chapterMarkers ?? [],
    });
  }, [podcast?.id, podcast?.audioUrl, load]);

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
            />
          )}
        </ScrollView>

        {currentChapter && (
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
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
          onSkipBack={player.skipBack}
          onSkipForward={player.skipForward}
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
