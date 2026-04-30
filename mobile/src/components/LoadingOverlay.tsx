/**
 * LoadingOverlay — paper-light typographic loading state.
 * No spinner. A single ink-secondary line above a breathing hairline.
 *
 * Props:
 *   - message: string. Quiet sentence-case copy ending in ellipsis.
 *
 * Reduced motion: hairline opacity stays at 1.0, no animation.
 */
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { color, motion, space, text } from "../theme/tokens";

interface Props {
  message: string;
}

export function LoadingOverlay({ message }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current;

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
            toValue: 0.4,
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
    <View style={styles.root}>
      <View style={styles.center}>
        {message.length > 0 && <Text style={styles.message}>{message}</Text>}
        <Animated.View style={[styles.hairline, { opacity }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.paper,
    justifyContent: "center",
    alignItems: "center",
  },
  center: {
    alignItems: "center",
    paddingHorizontal: space.xxl,
  },
  message: {
    ...text.body,
    color: color.inkSecondary,
    textAlign: "center",
    marginBottom: space.base,
  },
  hairline: {
    height: 1,
    width: 56,
    backgroundColor: color.accent,
  },
});
