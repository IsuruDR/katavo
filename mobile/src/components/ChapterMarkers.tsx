// mobile/src/components/ChapterMarkers.tsx
/**
 * ChapterMarkers — tappable list of chapters with timestamps.
 * Highlights the currently playing chapter.
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
}

export function ChapterMarkers({ chapters, currentPosition, onChapterPress }: Props) {
  const currentChapterIndex = chapters.reduce((acc, ch, i) => {
    if (currentPosition >= ch.timestampSeconds) return i;
    return acc;
  }, 0);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <FlatList
      data={chapters}
      keyExtractor={(_, i) => i.toString()}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={[styles.chapter, index === currentChapterIndex && styles.active]}
          onPress={() => onChapterPress(item.timestampSeconds)}
        >
          <Text style={styles.timestamp}>{formatTime(item.timestampSeconds)}</Text>
          <Text style={[styles.title, index === currentChapterIndex && styles.activeText]}>
            {item.title}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chapter: { flexDirection: "row", padding: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" },
  active: { backgroundColor: "#6366f120" },
  timestamp: { color: "#888", fontSize: 14, width: 50 },
  title: { color: "#fff", fontSize: 15, flex: 1 },
  activeText: { color: "#6366f1", fontWeight: "600" },
});
