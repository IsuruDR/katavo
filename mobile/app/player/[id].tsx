// mobile/app/player/[id].tsx
/**
 * Player screen — chapter-focused layout with compact bottom controls.
 * Shows "Dive" button on current chapter for paid users with minutes remaining.
 */
import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { usePlayer } from "../../src/hooks/usePlayer";
import { useSubscription } from "../../src/hooks/useSubscription";
import { AudioPlayer } from "../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../src/components/ChapterMarkers";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import type { Podcast } from "../../src/hooks/usePodcasts";

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);
  const { subscription } = useSubscription();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("podcasts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setPodcast(data as unknown as Podcast);
      setLoading(false);
    })();
  }, [id]);

  const player = usePlayer(
    podcast?.id || "",
    podcast?.audioUrl || "",
    podcast?.topic || "",
  );

  const isPaidTier =
    !!subscription && (subscription.tier === "plus" || subscription.tier === "pro");
  const hasMinutes =
    isPaidTier && subscription!.deepDiveMinutesRemaining > 0;

  const handleDive = useCallback(
    (chapterTitle: string) => {
      if (!isPaidTier) {
        Alert.alert(
          "Upgrade Required",
          "Deep Dive requires a Plus or Pro subscription.",
        );
        return;
      }

      if (!hasMinutes) {
        const renewalText = subscription?.renewalDate
          ? `Resets ${new Date(subscription.renewalDate).toLocaleDateString()}.`
          : "";
        Alert.alert(
          "Minutes Used Up",
          `Deep dive minutes used up. ${renewalText}`,
        );
        return;
      }

      // Pause playback and navigate to deep dive
      player.pause();
      router.push({
        pathname: "/player/deep-dive",
        params: {
          podcastId: podcast!.id,
          chapterTitle,
          position: String(Math.floor(player.progress.position)),
        },
      });
    },
    [isPaidTier, hasMinutes, subscription, player, podcast, router],
  );

  if (loading || !podcast) return <LoadingOverlay message="Loading podcast..." />;
  if (!player.ready) return <LoadingOverlay message="Preparing audio..." />;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>Back</Text>
        </TouchableOpacity>
        {isPaidTier && (
          <Text style={styles.minutesBadge}>
            {subscription.deepDiveMinutesRemaining} min
          </Text>
        )}
      </View>

      {/* Title section */}
      <View style={styles.titleSection}>
        <Text style={styles.topic}>{podcast.topic}</Text>
        <Text style={styles.meta}>
          {Math.ceil((podcast.durationSeconds ?? 0) / 60)} min
        </Text>
      </View>

      {/* Chapter list (main scrollable area) */}
      <ScrollView style={styles.chapterList} contentContainerStyle={styles.chapterListContent}>
        {(podcast.chapterMarkers ?? []).length > 0 && (
          <ChapterMarkers
            chapters={podcast.chapterMarkers ?? []}
            currentPosition={player.progress.position}
            onChapterPress={player.seekTo}
            onDive={isPaidTier ? handleDive : undefined}
            diveEnabled={hasMinutes}
          />
        )}
      </ScrollView>

      {/* Compact bottom player */}
      <View style={styles.bottomPlayer}>
        <AudioPlayer
          isPlaying={player.isPlaying}
          position={player.progress.position}
          duration={player.progress.duration}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 8,
  },
  backButton: { color: "#6366f1", fontSize: 16 },
  minutesBadge: {
    color: "#6366f1",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "#6366f115",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  titleSection: { paddingHorizontal: 16, paddingBottom: 16 },
  topic: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 30,
    marginBottom: 4,
  },
  meta: { fontSize: 14, color: "#666" },
  chapterList: { flex: 1 },
  chapterListContent: { paddingBottom: 16 },
  bottomPlayer: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#0a0a0a",
  },
});
