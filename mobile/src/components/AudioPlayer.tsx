// mobile/src/components/AudioPlayer.tsx
/**
 * AudioPlayer — play/pause button, seek bar, time display.
 * Props:
 *   - isPlaying: boolean
 *   - progress: { position, duration }
 *   - onPlay, onPause, onSeek
 */
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";

interface Props {
  isPlaying: boolean;
  position: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ isPlaying, position, duration, onPlay, onPause, onSeek }: Props) {
  return (
    <View style={styles.container}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration || 1}
        value={position}
        onSlidingComplete={onSeek}
        minimumTrackTintColor="#6366f1"
        maximumTrackTintColor="#333"
        thumbTintColor="#6366f1"
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(position)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
      <TouchableOpacity style={styles.playButton} onPress={isPlaying ? onPause : onPlay}>
        <Text style={styles.playIcon}>{isPlaying ? "||" : ">"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", padding: 24 },
  slider: { width: "100%", height: 40 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  time: { color: "#888", fontSize: 13 },
  playButton: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#6366f1",
    justifyContent: "center", alignItems: "center", marginTop: 16,
  },
  playIcon: { color: "#fff", fontSize: 28, fontWeight: "700" },
});
