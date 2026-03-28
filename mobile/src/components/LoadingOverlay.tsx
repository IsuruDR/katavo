/**
 * LoadingOverlay — full-screen loading indicator.
 * Use for async operations (auth, generation, data fetching).
 * Props:
 *   - message: string — displayed below spinner
 */
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

interface Props {
  message: string;
}

export function LoadingOverlay({ message }: Props) {
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color="#6366f1" />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  message: { color: "#fff", fontSize: 16, marginTop: 16 },
});
