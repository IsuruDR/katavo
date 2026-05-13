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
 *   failed    -> onRetry callback (re-submits same topic + answers; library soft-deletes the failed row)
 *   in-flight -> no-op (status already visible)
 *
 * Destructive affordances:
 *   swipe-left   -> reveal a Brick Ink wash with a typographic "Delete"
 *                   action. Tap it to fire onRequestDelete.
 *   long-press   -> calls onLongPress so the parent can open a paper
 *                   action sheet. Both gestures are disabled on
 *                   in-flight rows (pipeline workers still own them).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { Podcast } from "../hooks/usePodcasts";
import { color, font, motion, space, text } from "../theme/tokens";
import {
  formatStageDuration,
  getCompletedSteps,
  getStatusMeta,
  TOTAL_WORK_STEPS,
} from "../lib/podcastStatus";
import { usePlayingPodcast } from "../state/PlayingPodcastContext";
import { StepDots } from "./StepDots";

interface Props {
  podcast: Podcast;
  onRequestDelete?: (podcast: Podcast) => void;
  onLongPress?: (podcast: Podcast) => void;
  /** Called when a failed row is tapped. Re-submits the same topic +
   *  clarifying answers, then soft-deletes the failed row. */
  onRetry?: (podcast: Podcast) => void;
}

const REVEAL_WIDTH = 104;
const OPEN_THRESHOLD = 40;

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

export function PodcastRow({
  podcast,
  onRequestDelete,
  onLongPress,
  onRetry,
}: Props) {
  const router = useRouter();
  const { load } = usePlayingPodcast();
  const meta = getStatusMeta(podcast.status);
  const isReady = podcast.status === "complete";
  const isFailed = podcast.status === "failed";
  const canDelete = !meta.isWorking && (!!onRequestDelete || !!onLongPress);

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

  // Swipe-to-reveal "Delete" action. translateX is driven by PanResponder
  // while dragging, then animated to a snap target on release.
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = (animated = true) => {
    isOpen.current = false;
    if (animated) {
      Animated.timing(translateX, {
        toValue: 0,
        duration: motion.base,
        easing: Easing.bezier(...motion.easing.out),
        useNativeDriver: true,
      }).start();
    } else {
      translateX.setValue(0);
    }
  };

  const open = () => {
    isOpen.current = true;
    Animated.timing(translateX, {
      toValue: -REVEAL_WIDTH,
      duration: motion.base,
      easing: Easing.bezier(...motion.easing.out),
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, gesture) => {
          if (!canDelete) return false;
          // Claim only horizontal swipes; let vertical scroll pass through.
          return Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
        },
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_e, gesture) => {
          const base = isOpen.current ? -REVEAL_WIDTH : 0;
          const next = Math.min(0, base + gesture.dx);
          translateX.setValue(Math.max(next, -REVEAL_WIDTH * 1.4));
        },
        onPanResponderRelease: (_e, gesture) => {
          const base = isOpen.current ? -REVEAL_WIDTH : 0;
          const final = base + gesture.dx;
          if (final < -OPEN_THRESHOLD) {
            open();
          } else {
            close();
          }
        },
        onPanResponderTerminate: () => close(),
      }),
    // translateX / open / close are all stable refs; canDelete is the
    // only meaningful dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDelete],
  );

  const handlePress = () => {
    if (isOpen.current) {
      close();
      return;
    }
    if (isReady) {
      if (podcast.audioUrl) {
        load({
          id: podcast.id,
          topic: podcast.topic,
          audioUrl: podcast.audioUrl,
          coverUrl: podcast.coverUrl,
          durationSeconds: podcast.durationSeconds,
          chapterMarkers: podcast.chapterMarkers ?? [],
        });
      }
      router.push(`/player/${podcast.id}`);
    } else if (isFailed) {
      onRetry?.(podcast);
    }
  };

  const handleDeletePress = () => {
    close(false);
    onRequestDelete?.(podcast);
  };

  const handleLongPress = () => {
    if (!canDelete) return;
    onLongPress?.(podcast);
  };

  const accessibilityActions = canDelete
    ? [{ name: "delete" as const, label: "Delete podcast" }]
    : undefined;

  const handleAccessibilityAction = (event: {
    nativeEvent: { actionName: string };
  }) => {
    if (event.nativeEvent.actionName === "delete") {
      onRequestDelete?.(podcast);
    }
  };

  const ruleColor = isFailed
    ? color.warning
    : meta.isWorking
      ? color.accent
      : "transparent";

  const workingElapsed = meta.isWorking
    ? formatStageDuration(podcast.statusStartedAt)
    : null;

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
      return workingElapsed ? [meta.label, workingElapsed] : [meta.label];
    }
    return [meta.label];
  })();

  const metadataStyle = isFailed
    ? styles.metadataFailed
    : meta.isWorking
      ? styles.metadataWorking
      : styles.metadata;

  return (
    <View style={styles.container}>
      {canDelete && (
        <View style={styles.actionLayer} pointerEvents="box-none">
          <Pressable
            onPress={handleDeletePress}
            style={({ pressed }) => [
              styles.deleteAction,
              pressed && styles.deleteActionPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${podcast.topic}`}
          >
            <Text style={styles.deleteLabel}>Delete</Text>
          </Pressable>
        </View>
      )}

      <Animated.View
        style={[styles.slider, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={400}
          disabled={meta.isWorking}
          accessibilityRole="button"
          accessibilityLabel={`${podcast.topic}, ${metadataParts.join(", ")}`}
          accessibilityState={{ disabled: meta.isWorking }}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={handleAccessibilityAction}
          style={({ pressed }) => [
            styles.pressable,
            pressed && !meta.isWorking && styles.pressed,
          ]}
        >
          <View style={styles.row}>
            <Animated.View
              style={[styles.rule, { backgroundColor: ruleColor, opacity: pulse }]}
            />
            <View style={styles.content}>
              <Text style={styles.topic} numberOfLines={2}>
                {podcast.topic}
              </Text>
              {meta.isWorking ? (
                <View style={styles.metadataRow}>
                  <Text style={metadataStyle}>{meta.label}</Text>
                  <StepDots
                    totalSteps={TOTAL_WORK_STEPS}
                    completedSteps={getCompletedSteps(podcast.status)}
                  />
                  {workingElapsed && (
                    <Text style={metadataStyle}>· {workingElapsed}</Text>
                  )}
                </View>
              ) : (
                <Text style={metadataStyle}>{metadataParts.join(" · ")}</Text>
              )}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.paper,
    overflow: "hidden",
  },
  actionLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.warningSoft,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  deleteAction: {
    width: REVEAL_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteActionPressed: {
    opacity: 0.5,
  },
  deleteLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.warning,
    letterSpacing: -0.1,
  },
  slider: {
    backgroundColor: color.paper,
  },
  pressable: {
    backgroundColor: color.paper,
  },
  pressed: {
    opacity: 0.55,
  },
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
  metadataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
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
