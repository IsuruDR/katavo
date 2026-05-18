// mobile/src/components/ClarifyingForm.tsx
/**
 * ClarifyingForm — all questions visible at once on a single scrollable
 * page. Replaces the prior one-at-a-time stepper because the questions
 * themselves are the proof of intelligence; showing all of them up front
 * says "we thought about your topic and asked these specific things."
 *
 * Self-contained screen. Owns its own answer state, header, scroll, and
 * sticky bottom CTA. Parent supplies the questions and receives the
 * answer array on submit.
 */
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreditChip } from "./CreditChip";
import { color, font, layout, motion, space, text } from "../theme/tokens";

/**
 * Reveal — fade + tiny lift on mount, with an optional stagger delay.
 * Editorial type-appearing effect, not flashy. Reduced motion jumps to
 * the final state with no animation.
 */
function Reveal({
  delay = 0,
  children,
  style,
}: {
  delay?: number;
  children: React.ReactNode;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          delay,
          easing: Easing.bezier(...motion.easing.out),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 450,
          delay,
          easing: Easing.bezier(...motion.easing.out),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [delay, opacity, translateY]);

  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}

interface Props {
  questions: string[];
  /** Combined balance (monthly + bonus). Drives the cost-line + CTA. */
  creditsRemaining: number;
  /** Bonus portion of the balance; passed through to CreditChip for the
   * split-display variant. Defaults to 0 (legacy single-number display). */
  bonusCredits?: number;
  onSubmit: (answers: Array<{ q: string; a: string }>) => void;
  onBack: () => void;
}

export function ClarifyingForm({
  questions,
  creditsRemaining,
  bonusCredits = 0,
  onSubmit,
  onBack,
}: Props) {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const [answers, setAnswers] = useState<string[]>(() =>
    safeQuestions.map(() => ""),
  );
  const inputRefs = useRef<Array<TextInput | null>>([]);

  const setAnswer = (index: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const canSubmit = answers.some((a) => a.trim().length > 0);
  const numWord =
    safeQuestions.length === 1
      ? "One quick question"
      : safeQuestions.length === 2
        ? "Two quick questions"
        : safeQuestions.length === 3
          ? "Three quick questions"
          : `${safeQuestions.length} quick questions`;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(
      safeQuestions.map((q, i) => ({ q, a: answers[i].trim() })),
    );
  };

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Back to topic"
          >
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <CreditChip count={creditsRemaining} bonus={bonusCredits} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Reveal delay={0}>
            <Text style={styles.intro}>{numWord} to refine the brief.</Text>
          </Reveal>

          {safeQuestions.map((q, i) => (
            <Reveal
              key={i}
              delay={140 + i * 110}
              style={styles.questionBlock}
            >
              <Text style={styles.question}>{q}</Text>
              <TextInput
                ref={(r) => {
                  inputRefs.current[i] = r;
                }}
                style={styles.answerInput}
                value={answers[i]}
                onChangeText={(v) => setAnswer(i, v)}
                placeholder="Your answer"
                placeholderTextColor={color.inkTertiary}
                multiline
                autoFocus={i === 0}
                returnKeyType="next"
                onSubmitEditing={() => {
                  inputRefs.current[i + 1]?.focus();
                }}
                blurOnSubmit={i === safeQuestions.length - 1}
                accessibilityLabel={`Answer to question ${i + 1}`}
              />
            </Reveal>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.cost}>
            Uses 1 credit. {creditsRemaining}{" "}
            {creditsRemaining === 1 ? "remaining" : "remaining"}.
          </Text>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitDisabled,
              pressed && canSubmit && styles.submitPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Generate podcast"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitLabel}>Generate podcast</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  backLabel: {
    ...text.body,
    color: color.inkSecondary,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingTop: space.base,
    paddingBottom: space.huge,
  },
  intro: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginBottom: space.xxl,
  },
  questionBlock: {
    marginBottom: space.xxl,
    gap: space.sm,
  },
  question: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  answerInput: {
    fontFamily: font.sansRegular,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
    minHeight: 48,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineStrong,
    textAlignVertical: "top",
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.base,
    paddingBottom: space.sm,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    backgroundColor: color.paper,
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
  submitPressed: {
    opacity: 0.85,
  },
  submitDisabled: {
    backgroundColor: color.hairlineStrong,
  },
  submitLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
});
