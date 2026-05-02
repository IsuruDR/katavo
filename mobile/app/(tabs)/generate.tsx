// mobile/app/(tabs)/generate.tsx
/**
 * Generate — two-phase creation flow.
 *
 * Phase 1 — input: editorial title prompt and a bottom-hairline topic field.
 * Phase 2 — clarifying: all questions visible at once via ClarifyingForm.
 *
 * Loading and submitting both render the typographic LoadingOverlay; no
 * spinners. Errors show inline at the top of the input phase rather than as
 * disruptive alerts.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditChip } from "../../src/components/CreditChip";
import { ClarifyingForm } from "../../src/components/ClarifyingForm";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import {
  generateQuestions,
  submitPodcast,
} from "../../src/services/podcast";
import { color, font, space, text } from "../../src/theme/tokens";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function Generate() {
  const router = useRouter();
  const { subscription, refresh: refreshSub } = useSubscription();
  const params = useLocalSearchParams<{ placeholder?: string }>();
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);

  // First arrival from onboarding lands here with ?placeholder=… so the
  // Generate tab opens with a topic already in place. Only seed once, only
  // when the field is empty (don't trample user input on later visits).
  useEffect(() => {
    if (params.placeholder && !topic) {
      setTopic(String(params.placeholder));
      // Clear the param so a tab re-mount doesn't re-seed.
      router.setParams({ placeholder: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.placeholder]);

  const credits = subscription?.creditsRemaining ?? 0;
  const hasCredits = credits >= 1;

  const handleStartGeneration = async () => {
    if (!topic.trim()) return;
    if (!hasCredits) {
      router.push("/(tabs)/account");
      return;
    }
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
              // Request push permission contextually — they just consented
              // to "we'll notify you," the OS dialog asks the same thing.
              // Idempotent: no-op if already granted/denied.
              await Notifications.requestPermissionsAsync().catch(() => {});
              setPhase("input");
              setTopic("");
              setQuestions([]);
              router.push("/(tabs)");
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
    return <LoadingOverlay message="Reading your topic" />;
  }
  if (phase === "submitting") {
    return <LoadingOverlay message="Sending your topic to research" />;
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
  const submitLabel = hasCredits ? "Generate" : "Out of credits. Buy more.";
  const canTap = hasCredits ? topic.trim().length > 0 : true;

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View />
          <CreditChip count={credits} />
        </View>

        <View style={styles.body}>
          {error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.headline}>
            What do you want to learn about?
          </Text>

          <TextInput
            style={styles.topicInput}
            value={topic}
            onChangeText={(v) => {
              if (error) setError(null);
              setTopic(v);
            }}
            placeholder="the impact of quantum computing on cryptography"
            placeholderTextColor={color.inkTertiary}
            multiline
            autoCorrect
            accessibilityLabel="Topic to research"
          />
        </View>

        <View style={styles.footer}>
          {hasCredits && (
            <Text style={styles.cost}>
              Uses 1 credit. {credits} remaining.
            </Text>
          )}
          <Pressable
            onPress={handleStartGeneration}
            disabled={!canTap}
            style={({ pressed }) => [
              styles.submit,
              !canTap && styles.submitDisabled,
              pressed && canTap && styles.submitPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
            accessibilityState={{ disabled: !canTap }}
          >
            <Text style={styles.submitLabel}>{submitLabel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    gap: space.xxl,
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
