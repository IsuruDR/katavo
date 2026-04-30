// mobile/src/components/ChapterMarkers.tsx
/**
 * ChapterMarkers — flat list of chapters in editorial style.
 *
 * Each chapter is a row, not a card: timestamp left, title middle. Past
 * chapters dim to 0.4. Current chapter gets accent timestamp, weight-600
 * title, and a hairline-green "NOW PLAYING" eyebrow.
 *
 * The Dive action lives on the persistent DiveBar in the player layout,
 * not inside the row. That keeps the chapter list pure-content and lets
 * Dive feel like a confident second-to-play CTA.
 */
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { color, font, space } from "../theme/tokens";

interface Chapter {
  timestampSeconds: number;
  title: string;
}

interface Props {
  chapters: Chapter[];
  currentPosition: number;
  onChapterPress: (seconds: number) => void;
}

function formatTime(seconds: number | undefined | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ChapterMarkers({
  chapters,
  currentPosition,
  onChapterPress,
}: Props) {
  const currentChapterIndex = chapters.reduce((acc, ch, i) => {
    if (currentPosition >= ch.timestampSeconds) return i;
    return acc;
  }, 0);

  return (
    <View>
      {chapters.map((item, index) => {
        const past = index < currentChapterIndex;
        const current = index === currentChapterIndex;

        return (
          <TouchableOpacity
            key={`${index}-${item.timestampSeconds}`}
            style={[styles.row, past && styles.rowPast]}
            onPress={() => onChapterPress(item.timestampSeconds)}
            activeOpacity={0.55}
            accessibilityRole="button"
            accessibilityLabel={`Chapter ${index + 1}: ${item.title}, ${formatTime(item.timestampSeconds)}`}
          >
            <Text style={[styles.timestamp, current && styles.timestampCurrent]}>
              {formatTime(item.timestampSeconds)}
            </Text>
            <View style={styles.body}>
              <Text style={current ? styles.titleCurrent : styles.title}>
                {item.title}
              </Text>
              {current && <Text style={styles.nowPlaying}>Now playing</Text>}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: space.md,
    gap: space.base,
  },
  rowPast: {
    opacity: 0.4,
  },
  timestamp: {
    fontFamily: font.sansMedium,
    fontSize: 13,
    color: color.inkSecondary,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
    width: 46,
    paddingTop: 2,
  },
  timestampCurrent: {
    color: color.accent,
    fontFamily: font.sansSemiBold,
  },
  body: {
    flex: 1,
    gap: space.xxs,
  },
  title: {
    fontFamily: font.serifMedium,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
  },
  titleCurrent: {
    fontFamily: font.serifSemiBold,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
  },
  nowPlaying: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: color.accent,
    marginTop: space.xxs,
  },
});
