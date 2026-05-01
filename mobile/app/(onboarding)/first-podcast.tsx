// mobile/app/(onboarding)/first-podcast.tsx
/**
 * FirstPodcast — onboarding step 3.
 *
 * Pre-fills the topic with a rotated placeholder so new users see an example
 * of the kind of query that produces good output. Runs the same two-phase
 * generate flow as the Generate tab: topic → clarifying questions → submit.
 *
 * After submit, shows a "Researching now" alert with the expected wait time,
 * then requests push notification permission contextually on dismissal before
 * routing to the main tab navigator.
 */
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useSubscription } from "../../src/hooks/useSubscription";
import { ClarifyingForm } from "../../src/components/ClarifyingForm";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { generateQuestions, submitPodcast } from "../../src/services/podcast";
import { pickOnboardingPlaceholder } from "../../src/lib/podcastPlaceholders";
import { color, font, space, text } from "../../src/theme/tokens";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function FirstPodcast() {
  const router = useRouter();
  const { subscription, refresh: refreshSub } = useSubscription();
  const [topic, setTopic] = useState(pickOnboardingPlaceholder);
  const [phase, setPhase] = useState<Phase>("input");
  const [questions, setQuestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const credits = subscription?.creditsRemaining ?? 0;

  const handleStartGeneration = async () => {
    if (!topic.trim()) return;
    setError(null);
    setPhase("loading-questions");
    try {
      const qs = await generateQuestions(topic.trim());
      setQuestions(qs);
      setPhase("clarifying");
    } catch (e: any) {
      setError(e?.message || "Couldn't read your topic. Try again.");
      setPhase("input");
    }
  };

  const handleClarifyingSubmit = async (
    answers: Array<{ q: string; a: string }>,
  ) => {
    setError(null);
    setPhase("submitting");
    try {
      await submitPodcast(topic.trim(), answers);
      refreshSub();
      Alert.alert(
        "Researching now",
        "This usually takes about 15 minutes. We'll send you a notification when your podcast is ready.",
        [
          {
            text: "OK",
            onPress: async () => {
              await Notifications.requestPermissionsAsync().catch(() => {});
              router.replace("/(tabs)");
            },
          },
        ],
      );
    } catch (e: any) {
      setError(e?.message || "Couldn't send your topic. Try again.");
      setPhase("input");
    }
  };

  const handleClarifyingBack = () => {
    setPhase("input");
  };

  if (phase === "loading-questions") {
    return <LoadingOverlay message="Reading your topic..." />;
  }
  if (phase === "submitting") {
    return <LoadingOverlay message="Starting generation..." />;
  }

  if (phase === "clarifying") {
    return (
      <ClarifyingForm
        questions={questions}
        creditsRemaining={credits}
        onSubmit={handleClarifyingSubmit}
        onBack={handleClarifyingBack}
      />
    );
  }

  // Phase: input
  const canTap = topic.trim().length > 0;

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.body}>
          {error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.headline}>Your first podcast</Text>
          <Text style={styles.subtitle}>
            Here's a topic to start with — or write your own.
          </Text>

          <TextInput
            style={styles.topicInput}
            value={topic}
            onChangeText={(v) => {
              if (error) setError(null);
              setTopic(v);
            }}
            placeholder="What do you want to learn about?"
            placeholderTextColor={color.inkTertiary}
            multiline
            autoCorrect
            accessibilityLabel="Topic to research"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.cost}>Uses 1 credit. {credits} remaining.</Text>
          <Pressable
            onPress={handleStartGeneration}
            disabled={!canTap}
            style={({ pressed }) => [
              styles.submit,
              !canTap && styles.submitDisabled,
              pressed && canTap && styles.submitPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Generate podcast"
            accessibilityState={{ disabled: !canTap }}
          >
            <Text style={styles.submitLabel}>Generate podcast (1 credit)</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    gap: space.base,
  },
  error: {
    ...text.bodySmall,
    color: color.warning,
  },
  headline: {
    ...text.displaySerif,
    fontSize: 30,
    lineHeight: 38,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  topicInput: {
    fontFamily: font.serifMedium,
    fontSize: 22,
    lineHeight: 30,
    color: color.ink,
    minHeight: 96,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineStrong,
    textAlignVertical: "top",
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.base,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  cost: {
    ...text.bodySmall,
    color: color.inkSecondary,
    textAlign: "center",
  },
  submit: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  submitDisabled: {
    backgroundColor: color.hairlineStrong,
  },
  submitPressed: {
    opacity: 0.85,
  },
  submitLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
});
