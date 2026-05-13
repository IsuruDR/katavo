/**
 * StepDots — minimal completion indicator for in-flight pipelines.
 *
 * Renders `totalSteps` small circular marks horizontally:
 *   • Filled (Library Green): work stage is finished.
 *   • Empty (1px accent border, paper interior): not finished.
 *   • The first empty dot — the current stage — has a solid Library
 *     Green inner circle that fades in and out over 1.6s, so the
 *     outline "fills and empties" as a quiet completion-pending signal.
 *
 * Same ambient timing family as PodcastRow's leading rule and
 * LoadingOverlay's hairline. Reduced-motion users get the static
 * filled state.
 *
 * Used in PodcastRow's metadata line and in PipelineStatusStrip.
 */
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import { color, motion, space } from "../theme/tokens";

interface Props {
  totalSteps: number;
  completedSteps: number;
}

const DOT_SIZE = 6;

export function StepDots({ totalSteps, completedSteps }: Props) {
  const hasCurrent = completedSteps < totalSteps;
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!hasCurrent) {
      fill.setValue(0);
      return;
    }
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        // Settle on filled so the user can still tell which step is current.
        fill.setValue(1);
        return;
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(fill, {
            toValue: 1,
            duration: motion.ambient / 2,
            easing: Easing.bezier(...motion.easing.inOut),
            useNativeDriver: true,
          }),
          Animated.timing(fill, {
            toValue: 0,
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
  }, [hasCurrent, fill]);

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${completedSteps} of ${totalSteps} steps complete`}
    >
      {Array.from({ length: totalSteps }).map((_, i) => {
        const filled = i < completedSteps;
        const isCurrent = i === completedSteps;
        if (filled) {
          return <View key={i} style={styles.dotFilled} />;
        }
        if (isCurrent) {
          return (
            <View key={i} style={styles.dotEmpty}>
              <Animated.View
                style={[styles.dotInnerFill, { opacity: fill }]}
              />
            </View>
          );
        }
        return <View key={i} style={styles.dotEmpty} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  dotFilled: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: color.accent,
  },
  dotEmpty: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.paper,
  },
  dotInnerFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: color.accent,
  },
});
