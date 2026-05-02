/**
 * Onboarding step 1 — welcome.
 *
 * Editorial paper page. Two serif headlines stack the value prop. A subtle
 * breathing hairline below the "Tap anywhere to start" hint signals that
 * the entire screen is the affordance.
 */
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { color, font, motion, space, text } from "../../src/theme/tokens";

export default function Welcome() {
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        opacity.setValue(1);
        return;
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: motion.ambient / 2,
            easing: Easing.bezier(...motion.easing.inOut),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.5,
            duration: motion.ambient / 2,
            easing: Easing.bezier(...motion.easing.inOut),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Pressable
      style={styles.root}
      onPress={() => router.push("/(onboarding)/voice")}
      accessibilityRole="button"
      accessibilityLabel="Tap to start onboarding"
    >
      <SafeAreaView
        style={styles.safe}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Katavo</Text>
          <View style={styles.lines}>
            <Text style={styles.headline}>Pick a topic.</Text>
            <Text style={styles.headline}>Get a 10-minute podcast.</Text>
          </View>
          <Text style={styles.subline}>No scripts. No editing.</Text>
        </View>

        <View style={styles.footer}>
          <Animated.View style={[styles.hairline, { opacity }]} />
          <Text style={styles.tap}>Tap anywhere to start</Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  safe: {
    flex: 1,
    paddingHorizontal: space.xl,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    gap: space.lg,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  lines: {
    gap: space.xxs,
  },
  headline: {
    ...text.displaySerif,
    fontSize: 36,
    lineHeight: 42,
  },
  subline: {
    ...text.body,
    color: color.inkSecondary,
    fontFamily: font.serifRegular,
    fontSize: 17,
    lineHeight: 24,
  },
  footer: {
    alignItems: "center",
    paddingBottom: space.xl,
    gap: space.md,
  },
  hairline: {
    height: 1,
    width: 56,
    backgroundColor: color.accent,
  },
  tap: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
});
