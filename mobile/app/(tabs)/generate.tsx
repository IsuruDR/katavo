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
import { useState } from "react";
import {
  Keyboard,
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
import { useRouter } from "expo-router";
import { useSubscription } from "../../src/hooks/useSubscription";
import { useProfile } from "../../src/hooks/useProfile";
import { CreditChip } from "../../src/components/CreditChip";
import { ClarifyingForm } from "../../src/components/ClarifyingForm";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { ResearchingSheet } from "../../src/components/ResearchingSheet";
import {
  generateQuestions,
  submitPodcast,
} from "../../src/services/podcast";
import { emitPending } from "../../src/state/pendingPodcasts";
import { color, font, layout, space, text } from "../../src/theme/tokens";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function Generate() {
  const router = useRouter();
  const { subscription, refresh: refreshSub } = useSubscription();
  const { profile, setOnboardingComplete } = useProfile();
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [showResearching, setShowResearching] = useState(false);

  // Combined balance: monthly (resets on RevenueCat events) + bonus (non-
  // expiring signup credit, migration 00025). All gates check the total;
  // CreditChip renders them separately for transparency.
  const monthlyCredits = subscription?.creditsRemaining ?? 0;
  const bonusCredits = subscription?.bonusCredits ?? 0;
  const credits = monthlyCredits + bonusCredits;
  const hasCredits = credits >= 1;
  // Back link is hidden during focused onboarding (intentional one-way
  // flow until the user submits their first podcast). After that, the
  // link is visible in the header so the user can escape the screen
  // when the keyboard hides the tab bar.
  const showBack = profile?.onboardingComplete === true;

  const handleBack = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

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
      const trimmedTopic = topic.trim();
      const { podcastId } = await submitPodcast({
        topic: trimmedTopic,
        clarifyingAnswers: answers,
      });
      // Optimistic insert into Library so the row appears the moment the
      // user lands there — no waiting for Supabase realtime INSERT to
      // propagate. Library's usePodcasts clears this entry once the real
      // row arrives via realtime or refetch.
      const now = new Date().toISOString();
      emitPending({
        id: podcastId,
        topic: trimmedTopic,
        status: "queued",
        audioUrl: null,
        coverUrl: null,
        durationSeconds: null,
        chapterMarkers: [],
        hasAds: false,
        createdAt: now,
        errorMessage: null,
        statusStartedAt: now,
        parentPodcastId: null,
        sourceChapterTitle: null,
        shareToken: null,
        clarifyingAnswers: answers,
      });
      refreshSub();
      // First successful submit ends focused-onboarding mode; the tab bar
      // appears from here on. Idempotent on subsequent submits.
      setOnboardingComplete(true).catch(() => {});
      // Drop loading overlay so the sheet has a clean paper backdrop.
      setPhase("input");
      setShowResearching(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't send your topic. Try again.");
      setPhase("input");
    }
  };

  const handleResearchingDismiss = async () => {
    setShowResearching(false);
    // The sheet just promised "we'll send a notification" — request
    // permission now while the consent context is fresh. Idempotent.
    Notifications.requestPermissionsAsync().catch(() => {});
    setTopic("");
    setQuestions([]);
    router.push("/(tabs)");
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
        bonusCredits={bonusCredits}
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
        <Pressable
          style={styles.flex}
          onPress={Keyboard.dismiss}
          accessible={false}
        >
        <View style={styles.header}>
          {showBack ? (
            <Pressable
              onPress={handleBack}
              hitSlop={layout.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Text style={styles.back}>Back</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <CreditChip count={credits} bonus={bonusCredits} />
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
        </Pressable>
      </KeyboardAvoidingView>

      <ResearchingSheet
        visible={showResearching}
        onDismiss={handleResearchingDismiss}
      />
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
  back: {
    ...text.body,
    color: color.inkSecondary,
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
