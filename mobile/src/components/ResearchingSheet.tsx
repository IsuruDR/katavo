// mobile/src/components/ResearchingSheet.tsx
/**
 * Researching-now bottom sheet — confirms a podcast was queued and sets
 * the user up for the wait. Same paper-light bottom sheet vocabulary as
 * SubscriptionModal: grab indicator, eyebrow, editorial title, quiet
 * body copy, single accent CTA.
 *
 * Replaces the legacy Alert.alert that fired post-submit. The dismiss
 * handler is owned by the caller — Generate uses it to request push
 * permission, reset state, and navigate to Library.
 */
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function ResearchingSheet({ visible, onDismiss }: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={onDismiss} />
        <SafeAreaView
          style={styles.sheet}
          edges={["left", "right", "bottom"]}
        >
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>

          <View style={styles.body}>
            <Text style={styles.eyebrow}>Researching now</Text>
            <Text style={styles.title}>On its way.</Text>
            <Text style={styles.subtitle}>
              This usually takes about 15 minutes. We'll send a notification
              when your podcast is ready.
            </Text>
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Got it"
            >
              <Text style={styles.ctaLabel}>Got it</Text>
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
  body: {
    paddingTop: space.base,
    paddingBottom: space.lg,
    gap: space.xs,
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
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
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
