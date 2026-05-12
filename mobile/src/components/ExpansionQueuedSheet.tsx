/**
 * ExpansionQueuedSheet — paper-light celebration after a chapter
 * expansion is successfully submitted. Same choreography family as
 * UpgradedSheet and CreditAddedSheet: staggered reveal, accent-coloured
 * editorial title, hairline bloom, ink-stamp dot. Reduced-motion safe.
 *
 * The CTA dismisses without navigation — the user is on the parent
 * player and the chapter marker just flipped to "Researching…". Likely
 * they want to keep listening to the parent while the expansion cooks.
 */
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, font, motion, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

const STAGGER = 80;

export function ExpansionQueuedSheet({ visible, onDismiss }: Props) {
  const eyebrowAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.96)).current;
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const ctaAnim = useRef(new Animated.Value(0)).current;
  const ruleProgress = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      eyebrowAnim.setValue(0);
      titleAnim.setValue(0);
      titleScale.setValue(0.96);
      bodyAnim.setValue(0);
      ctaAnim.setValue(0);
      ruleProgress.setValue(0);
      stampScale.setValue(0);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        eyebrowAnim.setValue(1);
        titleAnim.setValue(1);
        titleScale.setValue(1);
        bodyAnim.setValue(1);
        ctaAnim.setValue(1);
        ruleProgress.setValue(1);
        stampScale.setValue(1);
        return;
      }

      const outQuart = Easing.bezier(...motion.easing.out);

      Animated.parallel([
        Animated.timing(eyebrowAnim, {
          toValue: 1,
          duration: 220,
          easing: outQuart,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(STAGGER),
          Animated.parallel([
            Animated.timing(titleAnim, {
              toValue: 1,
              duration: 350,
              easing: outQuart,
              useNativeDriver: true,
            }),
            Animated.timing(titleScale, {
              toValue: 1,
              duration: 350,
              easing: outQuart,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(STAGGER * 2),
          Animated.timing(bodyAnim, {
            toValue: 1,
            duration: 220,
            easing: outQuart,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(STAGGER * 3),
          Animated.timing(ctaAnim, {
            toValue: 1,
            duration: 220,
            easing: outQuart,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          Animated.timing(ruleProgress, {
            toValue: 1,
            duration: 600,
            easing: outQuart,
            useNativeDriver: false,
          }).start();
        }, 560),
      );

      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          Animated.sequence([
            Animated.timing(stampScale, {
              toValue: 1.2,
              duration: 150,
              easing: outQuart,
              useNativeDriver: true,
            }),
            Animated.timing(stampScale, {
              toValue: 1,
              duration: 100,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start();
        }, 1160),
      );
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const fadeUpStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [6, 0],
        }),
      },
    ],
  });

  const ruleWidth = ruleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, RULE_TRACK_WIDTH],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={onDismiss} />
        <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>

          <View style={styles.body}>
            <Animated.Text style={[styles.eyebrow, fadeUpStyle(eyebrowAnim)]}>
              Expansion queued
            </Animated.Text>

            <Animated.Text
              style={[
                styles.title,
                {
                  opacity: titleAnim,
                  transform: [
                    {
                      translateY: titleAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, 0],
                      }),
                    },
                    { scale: titleScale },
                  ],
                },
              ]}
            >
              On its way.
            </Animated.Text>

            <Animated.Text style={[styles.copy, fadeUpStyle(bodyAnim)]}>
              Researching deeper now. We'll let you know when it's ready.
            </Animated.Text>

            <View style={styles.ruleRow}>
              <Animated.View style={[styles.rule, { width: ruleWidth }]} />
              <Animated.View
                style={[styles.stamp, { transform: [{ scale: stampScale }] }]}
              />
            </View>
          </View>

          <Animated.View style={[styles.footer, fadeUpStyle(ctaAnim)]}>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Got it"
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
              ]}
            >
              <Text style={styles.ctaLabel}>Got it</Text>
            </Pressable>
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const STAMP_SIZE = 6;
const RULE_TRACK_WIDTH = 64;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(26, 27, 31, 0.45)",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
  },
  grabRow: {
    alignItems: "center",
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairlineStrong,
  },
  body: {
    paddingTop: space.base,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 36,
    lineHeight: 42,
    color: color.accent,
  },
  copy: {
    ...text.body,
    color: color.inkSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: space.xs,
  },
  ruleRow: {
    height: STAMP_SIZE,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: space.lg,
  },
  rule: {
    height: 1,
    backgroundColor: color.accent,
  },
  stamp: {
    width: STAMP_SIZE,
    height: STAMP_SIZE,
    borderRadius: STAMP_SIZE / 2,
    backgroundColor: color.accent,
    marginLeft: space.xs,
  },
  footer: {
    paddingTop: space.base,
    paddingBottom: space.base,
    alignItems: "center",
  },
  cta: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
});
