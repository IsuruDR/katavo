/**
 * PodcastCard — displays a single podcast in the library list.
 * Shows status (generating/ready/failed), topic, and duration.
 * Tappable when status is "complete" to navigate to player.
 */
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { Podcast } from "../hooks/usePodcasts";

interface Props {
  podcast: Podcast;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "Queued", color: "#ffd43b" },
  researching: { label: "Researching...", color: "#ffd43b" },
  fact_checking: { label: "Fact-checking...", color: "#ffd43b" },
  scripting: { label: "Writing script...", color: "#ffd43b" },
  generating_audio: { label: "Generating audio...", color: "#ffd43b" },
  complete: { label: "Ready", color: "#51cf66" },
  failed: { label: "Failed", color: "#ff6b6b" },
};

export function PodcastCard({ podcast }: Props) {
  const router = useRouter();
  const status = STATUS_LABELS[podcast.status] || { label: podcast.status, color: "#888" };
  const isReady = podcast.status === "complete";
  const isFailed = podcast.status === "failed";

  const handlePress = () => {
    if (isReady) router.push(`/player/${podcast.id}`);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  return (
    <TouchableOpacity
      style={[styles.card, !isReady && styles.cardDisabled]}
      onPress={handlePress}
      disabled={!isReady}
    >
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={2}>{podcast.topic}</Text>
        <View style={[styles.statusBadge, { backgroundColor: status.color + "20" }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      {isFailed && podcast.errorMessage && (
        <Text style={styles.errorText}>Credit refunded. Tap to retry.</Text>
      )}
      {isReady && (
        <Text style={styles.duration}>{formatDuration(podcast.durationSeconds)}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: "#2a2a2a",
  },
  cardDisabled: { opacity: 0.7 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  topic: { fontSize: 16, fontWeight: "600", color: "#fff", flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  duration: { fontSize: 14, color: "#888", marginTop: 8 },
  errorText: { fontSize: 13, color: "#ff6b6b", marginTop: 8 },
});
