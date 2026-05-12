/**
 * Inline status component for in-flight podcasts (parents or expansions).
 * Maps the raw podcasts.status enum to short human-readable labels.
 *
 * Motion: a 24px x 1px Library Green hairline next to the label breathes
 * opacity 0.4↔1 over 1.6s — same ambient timing family as LoadingOverlay
 * and PodcastRow's leading rule. No spinner, no progress bar, per
 * DESIGN.md.
 *
 * Used in:
 *   - ChapterMarkers (when an expansion of this chapter is in flight)
 *   - PodcastRow (when the podcast itself isn't complete yet — future use)
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
import { color, font, motion, space } from "../theme/tokens";

export type PodcastStatus =
  | "queued"
  | "researching"
  | "fact_checking"
  | "scripting"
  | "generating_audio"
  | "complete"
  | "failed";

const LABELS: Record<PodcastStatus, string> = {
  queued: "Queued",
  researching: "Researching…",
  fact_checking: "Checking facts…",
  scripting: "Writing…",
  generating_audio: "Recording…",
  complete: "Ready",
  failed: "Failed",
};

interface Props {
  status: PodcastStatus;
}

export function PipelineStatusStrip({ status }: Props) {
  const isFailed = status === "failed";
  const isComplete = status === "complete";
  const inFlight = !isFailed && !isComplete;

  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!inFlight) {
      pulse.setValue(1);
      return;
    }
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        pulse.setValue(1);
        return;
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: motion.ambient / 2,
            easing: Easing.bezier(...motion.easing.inOut),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
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
  }, [inFlight, pulse]);

  return (
    <View style={styles.row}>
      <Text style={[styles.label, isFailed && styles.failed]}>
        {LABELS[status] ?? status}
      </Text>
      {inFlight && (
        <Animated.View style={[styles.rule, { opacity: pulse }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  label: {
    fontFamily: font.sansMedium,
    fontSize: 12,
    color: color.inkSecondary,
  },
  failed: {
    color: color.warning,
  },
  rule: {
    width: 24,
    height: 1,
    backgroundColor: color.accent,
  },
});
