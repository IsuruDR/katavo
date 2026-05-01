import { View, Text, StyleSheet, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { VoicePicker } from "../src/components/VoicePicker";
import { useProfile } from "../src/hooks/useProfile";
import { LoadingOverlay } from "../src/components/LoadingOverlay";

export default function VoiceSettings() {
  const router = useRouter();
  const { profile, loading, setPreferredVoice } = useProfile();

  if (loading) return <LoadingOverlay message="Loading..." />;

  const handleSelect = async (voice: string) => {
    try {
      await setPreferredVoice(voice);
      router.back();
    } catch (err: any) {
      Alert.alert("Couldn't save", err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Voice",
          headerTintColor: "#fff",
          headerStyle: { backgroundColor: "#0a0a0a" },
        }}
      />
      <Text style={styles.title}>Choose your voice</Text>
      <VoicePicker
        initialValue={profile?.preferredVoice ?? undefined}
        onSelect={handleSelect}
        ctaLabel="Save"
        helperText="Future podcasts only — existing podcasts keep their original voice."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
});
