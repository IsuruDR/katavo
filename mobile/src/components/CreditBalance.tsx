/**
 * CreditBalance — shows remaining credits and tier.
 * Displays a warning when credits are low.
 */
import { View, Text, StyleSheet } from "react-native";
import type { Subscription } from "../hooks/useSubscription";

interface Props {
  subscription: Subscription;
}

export function CreditBalance({ subscription }: Props) {
  const isLow = subscription.creditsRemaining <= 1;
  return (
    <View style={[styles.container, isLow && styles.low]}>
      <Text style={styles.credits}>{subscription.creditsRemaining}</Text>
      <Text style={styles.label}>
        credits remaining ({subscription.tier})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  low: { borderColor: "#ff6b6b", borderWidth: 1 },
  credits: { fontSize: 24, fontWeight: "700", color: "#6366f1" },
  label: { fontSize: 14, color: "#888" },
});
