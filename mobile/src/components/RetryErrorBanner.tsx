/**
 * RetryErrorBanner — paper bar that surfaces a retry-submit failure
 * (e.g. out of credits) with an optional CTA. Matches UndoBanner's
 * visual language: 56px paper, shrinking accent rule as a typographic
 * countdown, single-line label, accent-colored action.
 *
 * Mounted/unmounted by the library screen based on an error state.
 * Auto-dismisses via the parent's timeout — this component just
 * renders + animates while it's mounted.
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
import { color, font, layout, space } from "../theme/tokens";

export interface RetryErrorAction {
  label: string;
  onPress: () => void;
}

interface Props {
  message: string;
  action?: RetryErrorAction;
  durationMs: number;
}

export function RetryErrorBanner({ message, action, durationMs }: Props) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    progress.setValue(1);
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      Animated.timing(progress, {
        toValue: 0,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [durationMs, progress, message]);

  const ruleWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={styles.label} numberOfLines={2}>
          {message}
        </Text>
        {action && (
          <Pressable
            onPress={action.onPress}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => pressed && styles.actionPressed}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      <Animated.View style={[styles.rule, { width: ruleWidth }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.paper,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 32,
  },
  label: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.warning,
  },
  action: {
    fontFamily: font.sansSemiBold,
    fontSize: 14,
    color: color.accent,
    letterSpacing: 0.2,
  },
  actionPressed: {
    opacity: 0.5,
  },
  rule: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 1,
    backgroundColor: color.warning,
  },
});
