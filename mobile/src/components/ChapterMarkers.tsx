// mobile/src/components/ChapterMarkers.tsx
/**
 * ChapterMarkers — tappable chapter list with timestamps.
 * Highlights the currently playing chapter.
 * Shows "Dive" button on current chapter when onDive callback is provided.
 *
 * Props:
 * - chapters: array of {timestampSeconds, title}
 * - currentPosition: current playback position in seconds
 * - onChapterPress: seek to chapter timestamp
 * - onDive: optional — callback for Dive button (only shown on current chapter)
 * - diveEnabled: optional — whether Dive button is interactive (false = dimmed)
 */
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";

interface Chapter {
  timestampSeconds: number;
  title: string;
}

interface Props {
  chapters: Chapter[];
  currentPosition: number;
  onChapterPress: (seconds: number) => void;
  onDive?: (chapterTitle: string) => void;
  diveEnabled?: boolean;
}

export function ChapterMarkers({
  chapters,
  currentPosition,
  onChapterPress,
  onDive,
  diveEnabled = true,
}: Props) {
  const currentChapterIndex = chapters.reduce((acc, ch, i) => {
    if (currentPosition >= ch.timestampSeconds) return i;
    return acc;
  }, 0);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isPast = (index: number) => index < currentChapterIndex;
  const isCurrent = (index: number) => index === currentChapterIndex;

  return (
    <FlatList
      data={chapters}
      keyExtractor={(_, i) => i.toString()}
      scrollEnabled={false}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={[
            styles.chapter,
            isCurrent(index) && styles.currentChapter,
            isPast(index) && styles.pastChapter,
          ]}
          onPress={() => onChapterPress(item.timestampSeconds)}
        >
          <View style={styles.chapterContent}>
            <Text style={styles.timestamp}>{formatTime(item.timestampSeconds)}</Text>
            <View style={styles.titleContainer}>
              <Text
                style={[
                  styles.title,
                  isCurrent(index) && styles.currentText,
                  isPast(index) && styles.pastText,
                ]}
              >
                {item.title}
              </Text>
              {isCurrent(index) && (
                <Text style={styles.nowPlaying}>Now playing</Text>
              )}
            </View>
          </View>
          {isCurrent(index) && onDive && (
            <TouchableOpacity
              style={[styles.diveButton, !diveEnabled && styles.diveButtonDisabled]}
              onPress={() => diveEnabled && onDive(item.title)}
              disabled={!diveEnabled}
            >
              <Text
                style={[
                  styles.diveText,
                  !diveEnabled && styles.diveTextDisabled,
                ]}
              >
                Dive
              </Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chapter: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  currentChapter: {
    backgroundColor: "#6366f110",
    borderLeftWidth: 3,
    borderLeftColor: "#6366f1",
  },
  pastChapter: { opacity: 0.5 },
  chapterContent: { flexDirection: "row", flex: 1, gap: 12 },
  timestamp: { color: "#888", fontSize: 14, width: 50 },
  titleContainer: { flex: 1 },
  title: { color: "#fff", fontSize: 15 },
  currentText: { color: "#6366f1", fontWeight: "600" },
  pastText: { color: "#666" },
  nowPlaying: { color: "#6366f1", fontSize: 11, marginTop: 2 },
  diveButton: {
    backgroundColor: "#6366f1",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  diveButtonDisabled: { backgroundColor: "#333" },
  diveText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  diveTextDisabled: { color: "#666" },
});
