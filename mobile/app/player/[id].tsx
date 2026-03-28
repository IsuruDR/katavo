// mobile/app/player/[id].tsx
import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { usePlayer } from "../../src/hooks/usePlayer";
import { AudioPlayer } from "../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../src/components/ChapterMarkers";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import type { Podcast } from "../../src/hooks/usePodcasts";

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("podcasts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setPodcast(data as Podcast);
      setLoading(false);
    })();
  }, [id]);

  const player = usePlayer(
    podcast?.id || "",
    podcast?.audioUrl || "",
    podcast?.topic || ""
  );

  if (loading || !podcast) return <LoadingOverlay message="Loading podcast..." />;
  if (!player.ready) return <LoadingOverlay message="Preparing audio..." />;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.topic}>{podcast.topic}</Text>

        <AudioPlayer
          isPlaying={player.isPlaying}
          position={player.progress.position}
          duration={player.progress.duration}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
        />

        {podcast.chapterMarkers.length > 0 && (
          <View style={styles.chapters}>
            <Text style={styles.chaptersTitle}>Chapters</Text>
            <ChapterMarkers
              chapters={podcast.chapterMarkers}
              currentPosition={player.progress.position}
              onChapterPress={player.seekTo}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 24 },
  topic: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 24, lineHeight: 30 },
  chapters: { marginTop: 24 },
  chaptersTitle: { fontSize: 18, fontWeight: "600", color: "#fff", marginBottom: 12 },
});
