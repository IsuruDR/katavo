/**
 * Onboarding step 2 — voice pick.
 *
 * Editorial paper page wrapping the reusable VoicePicker. Tap a voice to
 * hear a sample, tap Continue to persist and advance.
 */
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { VoicePicker } from "../../src/components/VoicePicker";
import { useProfile } from "../../src/hooks/useProfile";
import { pickOnboardingPlaceholder } from "../../src/lib/podcastPlaceholders";
import { color, space, text } from "../../src/theme/tokens";

export default function VoiceOnboarding() {
  const router = useRouter();
  const { profile, setPreferredVoice } = useProfile();

  // Kill-relaunch case: user has a voice set but somehow landed back on
  // this screen. Bounce them into Generate so onboarding doesn't loop.
  // (The root layout no longer auto-redirects out of onboarding, so this
  // self-bounce covers the edge case.)
  useEffect(() => {
    if (profile?.preferredVoice) {
      router.replace("/(tabs)");
    }
  }, [profile?.preferredVoice, router]);

  const handleSelect = async (voice: string) => {
    await setPreferredVoice(voice);
    // Navigate straight to the Generate tab with a placeholder topic
    // pre-filled. router.replace so the back stack doesn't keep onboarding.
    router.replace({
      pathname: "/(tabs)/generate",
      params: { placeholder: pickOnboardingPlaceholder() },
    });
  };

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Pick your voice</Text>
        <Text style={styles.subtitle}>
          Tap one to hear a sample. You can change it later in your account.
        </Text>
      </View>
      <View style={styles.body}>
        <VoicePicker onSelect={handleSelect} ctaLabel="Continue" />
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
    paddingTop: space.lg,
    paddingBottom: space.base,
    gap: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 30,
    lineHeight: 36,
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
