import { View, Text, TouchableWithoutFeedback, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function Welcome() {
  const router = useRouter();

  const advance = () => router.push("/(onboarding)/voice");

  return (
    <TouchableWithoutFeedback onPress={advance}>
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.headline}>Pick a topic.</Text>
          <Text style={styles.headline}>Get a 10-minute podcast.</Text>
          <Text style={styles.subline}>No scripts, no editing.</Text>
        </View>
        <Text style={styles.tap}>Tap anywhere to start</Text>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 32 },
  center: { flex: 1, justifyContent: "center", gap: 8 },
  headline: { fontSize: 30, fontWeight: "700", color: "#fff", lineHeight: 38 },
  subline: { fontSize: 18, color: "#888", marginTop: 12 },
  tap: { textAlign: "center", color: "#666", fontSize: 13, marginBottom: 32 },
});
