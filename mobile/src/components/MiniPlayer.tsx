// mobile/src/components/MiniPlayer.tsx
/**
 * MiniPlayer — compact persistent bar shown above the tab bar whenever a
 * podcast is loaded into TrackPlayer. Lets the user keep listening while
 * they browse Library, Generate, Sources, Account.
 *
 * Tap the bar (anywhere except the play button) → navigate back to the
 * full player. Tap the play button → toggle playback in place.
 *
 * Visibility is load-based: as soon as a podcast is loaded into the
 * context, the bar appears; it stays visible regardless of playing/paused.
 * Disappears only when a new track replaces this one (no manual close yet).
 */
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePlayer } from "../hooks/usePlayer";
import { usePlayingPodcast } from "../state/PlayingPodcastContext";
import { color, font, space } from "../theme/tokens";

export function MiniPlayer() {
  const { current } = usePlayingPodcast();
  const { isPlaying, play, pause } = usePlayer();
  const router = useRouter();

  if (!current) return null;

  const handleBarPress = () => {
    router.push(`/player/${current.id}`);
  };

  const handlePlayPress = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  return (
    <Pressable
      onPress={handleBarPress}
      accessibilityRole="button"
      accessibilityLabel={`Now playing: ${current.topic}. Tap to open player.`}
    >
      <View style={styles.bar}>
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Now playing</Text>
          <Text style={styles.topic} numberOfLines={1}>
            {current.topic}
          </Text>
        </View>
        <Pressable
          onPress={handlePlayPress}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
          ]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name={isPlaying ? "pause" : "play"}
            size={18}
            color={color.paper}
            style={isPlaying ? undefined : styles.playOptical}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    backgroundColor: color.paper,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 10,
    color: color.accent,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  topic: {
    fontFamily: font.serifSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.ink,
    letterSpacing: -0.1,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  iconButtonPressed: {
    opacity: 0.85,
  },
  playOptical: {
    marginLeft: 1,
  },
});
