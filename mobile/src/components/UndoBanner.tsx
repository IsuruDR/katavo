/**
 * UndoBanner — 56px paper bar that confirms a deletion and offers an
 * Undo link for a fixed window. Sits above the MiniPlayer / tab bar.
 *
 * Signature motion: a 1px Library Green hairline at the bottom shrinks
 * from full width to 0 over the undo window, acting as a typographic
 * countdown. No spinner, no circular progress, no toast icon. Honours
 * reduced-motion by keeping the rule full-width and relying on the
 * timer alone.
 *
 * Owner is responsible for mounting/unmounting based on a pending
 * delete; this component just renders + animates while it's mounted.
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

interface Props {
  topic: string;
  onUndo: () => void;
  durationMs: number;
}

export function UndoBanner({ topic, onUndo, durationMs }: Props) {
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
  }, [durationMs, progress, topic]);

  const ruleWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={styles.label} numberOfLines={1}>
          Removed “{topic}”
        </Text>
        <Pressable
          onPress={onUndo}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel={`Undo deleting ${topic}`}
          style={({ pressed }) => pressed && styles.undoPressed}
        >
          <Text style={styles.undo}>Undo</Text>
        </Pressable>
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
    color: color.inkSecondary,
  },
  undo: {
    fontFamily: font.sansSemiBold,
    fontSize: 14,
    color: color.accent,
    letterSpacing: 0.2,
  },
  undoPressed: {
    opacity: 0.5,
  },
  rule: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 1,
    backgroundColor: color.accent,
  },
});
