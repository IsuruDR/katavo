/**
 * PodcastRow — single podcast in the Library list.
 *
 * Editorial serif title above a quiet metadata line. Leading-edge 2px rule
 * encodes status: pulsing ink-stamp green for in-flight, none for complete,
 * static brick for failed. The row carries enough substance (duration,
 * chapter count, relative date) to feel like a library entry, not a draft.
 *
 * Tap behavior:
 *   complete  -> /player/[id]
 *   failed    -> /(tabs)/generate (prefill wiring lands in Generate craft pass)
 *   in-flight -> no-op (status already visible)
 */
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { Podcast } from "../hooks/usePodcasts";
import { color, motion, space, text } from "../theme/tokens";
import { formatStageDuration, getStatusMeta } from "../lib/podcastStatus";

interface Props {
  podcast: Podcast;
}

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function PodcastRow({ podcast }: Props) {
  const router = useRouter();
  const meta = getStatusMeta(podcast.status);
  const isReady = podcast.status === "complete";
  const isFailed = podcast.status === "failed";

  // Tick once a second while in-flight so elapsed time refreshes.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!meta.isWorking) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [meta.isWorking]);

  // Leading-rule pulse — only when in-flight, paused under reduced motion.
  const pulse = useRef(new Animated.Value(meta.isWorking ? 0.4 : 1)).current;
  useEffect(() => {
    if (!meta.isWorking) {
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
  }, [meta.isWorking, pulse]);

  const handlePress = () => {
    if (isReady) {
      router.push(`/player/${podcast.id}`);
    } else if (isFailed) {
      router.push("/(tabs)/generate");
    }
  };

  const ruleColor = isFailed
    ? color.warning
    : meta.isWorking
      ? color.accent
      : "transparent";

  const metadataParts = (() => {
    if (isReady && podcast.durationSeconds != null) {
      const minutes = Math.max(1, Math.round(podcast.durationSeconds / 60));
      const parts = [`${minutes} min`];
      const chapters = podcast.chapterMarkers?.length ?? 0;
      if (chapters > 0) {
        parts.push(`${chapters} chapter${chapters === 1 ? "" : "s"}`);
      }
      const relative = formatRelativeDate(podcast.createdAt);
      if (relative) parts.push(relative);
      return parts;
    }
    if (isFailed) {
      return ["Refunded", "tap to try again"];
    }
    if (meta.isWorking) {
      const elapsed = formatStageDuration(podcast.statusStartedAt);
      return elapsed ? [meta.label, elapsed] : [meta.label];
    }
    return [meta.label];
  })();

  const metadataStyle = isFailed
    ? styles.metadataFailed
    : meta.isWorking
      ? styles.metadataWorking
      : styles.metadata;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={meta.isWorking}
      activeOpacity={0.55}
      accessibilityRole="button"
      accessibilityLabel={`${podcast.topic}, ${metadataParts.join(", ")}`}
      accessibilityState={{ disabled: meta.isWorking }}
    >
      <View style={styles.row}>
        <Animated.View
          style={[styles.rule, { backgroundColor: ruleColor, opacity: pulse }]}
        />
        <View style={styles.content}>
          <Text style={styles.topic} numberOfLines={2}>
            {podcast.topic}
          </Text>
          <Text style={metadataStyle}>{metadataParts.join(" · ")}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rule: {
    width: 2,
    alignSelf: "stretch",
    borderRadius: 1,
  },
  content: {
    flex: 1,
    gap: space.xs,
  },
  topic: {
    ...text.titleSerif,
  },
  metadata: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  metadataWorking: {
    ...text.bodySmall,
    color: color.accent,
  },
  metadataFailed: {
    ...text.bodySmall,
    color: color.warning,
  },
});
