/**
 * Voice settings — post-onboarding voice editing.
 *
 * Same VoicePicker, paper-light wrapper with a quiet text Back link in the
 * header. Helper line under the title clarifies that the change applies
 * only to future generations.
 */
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { VoicePicker } from "../src/components/VoicePicker";
import { useProfile } from "../src/hooks/useProfile";
import { LoadingOverlay } from "../src/components/LoadingOverlay";
import { color, layout, space, text } from "../src/theme/tokens";

export default function VoiceSettings() {
  const router = useRouter();
  const { profile, loading, setPreferredVoice } = useProfile();

  if (loading) return <LoadingOverlay message="Loading voice settings" />;

  const handleSelect = async (voice: string) => {
    try {
      await setPreferredVoice(voice);
      router.back();
    } catch (err: any) {
      Alert.alert("Couldn't save", err.message);
    }
  };

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>Choose your voice</Text>
        <Text style={styles.subtitle}>
          Future podcasts only. Existing podcasts keep their original voice.
        </Text>
      </View>
      <View style={styles.body}>
        <VoicePicker
          initialValue={profile?.preferredVoice ?? undefined}
          onSelect={handleSelect}
          ctaLabel="Save"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  backLabel: {
    ...text.body,
    color: color.inkSecondary,
  },
  titleBlock: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
});
