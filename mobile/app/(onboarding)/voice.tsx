import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { VoicePicker } from "../../src/components/VoicePicker";
import { useProfile } from "../../src/hooks/useProfile";

export default function VoiceOnboarding() {
  const router = useRouter();
  const { setPreferredVoice } = useProfile();

  const handleSelect = async (voice: string) => {
    await setPreferredVoice(voice);
    router.push("/(onboarding)/first-podcast");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick your voice</Text>
      <Text style={styles.subtitle}>
        Tap a voice to hear a sample. You can change this later in your account.
      </Text>
      <VoicePicker onSelect={handleSelect} ctaLabel="Continue" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#aaa", marginBottom: 12 },
});
