// mobile/src/components/AudioPlayer.tsx
/**
 * AudioPlayer — bottom-anchored transport dock.
 *
 * Three controls only: scrubber + time, then a transport row of −10, play,
 * +10. Editorial type for skip labels, ink-stamp green play circle with
 * paper arrow. Each control gives visual press feedback (scale + color
 * flash on skips). Disabled but visible when the action is out of bounds
 * (skip past 0 or duration).
 */
import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Feather } from "@expo/vector-icons";
import { color, font, layout, motion, space } from "../theme/tokens";
import { usePlaybackEvents } from "../hooks/usePlaybackEvents";

interface Props {
  isPlaying: boolean;
  position: number;
  duration: number;
  podcastId: string | null;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  isPlaying,
  position,
  duration,
  podcastId,
  onPlay,
  onPause,
  onSeek,
  onSkipBack,
  onSkipForward,
}: Props) {
  const { record } = usePlaybackEvents(podcastId);

  const handleSkipBack = () => {
    record("skip_back", position);
    onSkipBack();
  };

  const handleSkipForward = () => {
    record("skip_forward", position);
    onSkipForward();
  };

  const skipBackDisabled = position < 10;
  const skipForwardDisabled = duration > 0 && position + 10 > duration;

  return (
    <View style={styles.container}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration || 1}
        value={position}
        onSlidingComplete={onSeek}
        minimumTrackTintColor={color.accent}
        maximumTrackTintColor={color.hairlineStrong}
        thumbTintColor={color.accent}
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(position)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>

      <View style={styles.transport}>
        <SkipButton
          label="−10"
          disabled={skipBackDisabled}
          onPress={handleSkipBack}
          accessibilityLabel="Skip back ten seconds"
        />
        <PlayButton
          isPlaying={isPlaying}
          onPress={isPlaying ? onPause : onPlay}
        />
        <SkipButton
          label="+10"
          disabled={skipForwardDisabled}
          onPress={handleSkipForward}
          accessibilityLabel="Skip forward ten seconds"
        />
      </View>
    </View>
  );
}

interface SkipProps {
  label: string;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * Scale runs on the outer Animated.View (native driver). Color flash runs
 * on the inner Animated.Text (JS driver, since color isn't native-eligible).
 * Splitting into two nodes is what avoids the "node moved to native" crash.
 */
function SkipButton({ label, disabled, onPress, accessibilityLabel }: SkipProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    if (disabled) return;
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.84,
        duration: motion.fast,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: motion.base,
        useNativeDriver: true,
      }),
    ]).start();
    Animated.sequence([
      Animated.timing(flash, {
        toValue: 1,
        duration: motion.fast,
        useNativeDriver: false,
      }),
      Animated.timing(flash, {
        toValue: 0,
        duration: motion.slow,
        useNativeDriver: false,
      }),
    ]).start();
    onPress();
  };

  const animatedColor = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [color.ink, color.accent],
  });

  return (
    <Pressable
      hitSlop={layout.hitSlop}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Animated.View
        style={{
          transform: [{ scale }],
          opacity: disabled ? 0.3 : 1,
        }}
      >
        <Animated.Text style={[styles.skipLabel, { color: animatedColor }]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

interface PlayProps {
  isPlaying: boolean;
  onPress: () => void;
}

function PlayButton({ isPlaying, onPress }: PlayProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.92,
        duration: motion.fast,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: motion.base,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? "Pause" : "Play"}
    >
      <Animated.View style={[styles.playButton, { transform: [{ scale }] }]}>
        <Feather
          name={isPlaying ? "pause" : "play"}
          size={26}
          color={color.paper}
          style={isPlaying ? undefined : styles.playIconOptical}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  slider: {
    width: "100%",
    height: 32,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.xs,
  },
  time: {
    fontFamily: font.sansMedium,
    fontSize: 12,
    color: color.inkSecondary,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
  },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xxl,
    marginTop: space.sm,
  },
  skipLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  playIconOptical: {
    marginLeft: 2,
  },
});
