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
