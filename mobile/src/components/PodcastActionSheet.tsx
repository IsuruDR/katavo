/**
 * PodcastActionSheet — paper bottom sheet shown on long-press of a
 * podcast row. Same visual vocabulary as ResearchingSheet (grab pill,
 * paper background, hairline-divided rows) but framed as a generic
 * action menu rather than a confirmation surface.
 *
 * Two actions only:
 *   Delete podcast  — Plex Sans SemiBold, Brick Ink (status warning ink,
 *                     not alarmist red, per Status-In-Type rule)
 *   Cancel          — Plex Sans Medium, Smoke
 *
 * The sheet trusts the caller's row-level confirmation strategy: tapping
 * Delete commits immediately. The undo banner is the safety net, so we
 * deliberately do not stack a "Are you sure?" inside the sheet.
 */
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, font, space } from "../theme/tokens";

interface Props {
  visible: boolean;
  topic: string;
  onDelete: () => void;
  onDismiss: () => void;
}

export function PodcastActionSheet({
  visible,
  topic,
  onDelete,
  onDismiss,
}: Props) {
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

          <View style={styles.header}>
            <Text style={styles.topic} numberOfLines={2}>
              {topic}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={onDelete}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.actionPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete podcast"
            >
              <Text style={styles.actionDelete}>Delete podcast</Text>
            </Pressable>

            <View style={styles.divider} />

            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.actionPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.actionCancel}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

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
  header: {
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  topic: {
    fontFamily: font.serifSemiBold,
    fontSize: 17,
    lineHeight: 24,
    color: color.inkSecondary,
    letterSpacing: -0.1,
  },
  actions: {
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  action: {
    height: 56,
    justifyContent: "center",
  },
  actionPressed: {
    opacity: 0.5,
  },
  actionDelete: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.warning,
  },
  actionCancel: {
    fontFamily: font.sansMedium,
    fontSize: 17,
    color: color.inkSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
});
