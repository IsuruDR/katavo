// mobile/app/(tabs)/account.tsx
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditBalance } from "../../src/components/CreditBalance";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

const CREDIT_PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

export default function Account() {
  const { user, signOut } = useAuth();
  const { subscription, loading } = useSubscription();

  if (loading) return <LoadingOverlay message="Loading account..." />;

  const creditPrice = CREDIT_PRICES[subscription?.tier || "free"];
  const hasDeepDive = subscription && subscription.tier !== "free";

  const handleBuyCredit = () => {
    Alert.alert("Coming Soon", "Credit purchases will be available via in-app purchase.");
  };

  const handleUpgrade = () => {
    Alert.alert("Coming Soon", "Subscription upgrades will be available soon.");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.email}>{user?.email}</Text>

      {subscription && <CreditBalance subscription={subscription} />}

      {hasDeepDive && (
        <View style={styles.deepDiveCard}>
          <Text style={styles.deepDiveLabel}>Deep Dive</Text>
          <Text style={styles.deepDiveMinutes}>
            {subscription.deepDiveMinutesRemaining} / {subscription.deepDiveMinutesPerMonth} min
          </Text>
          {subscription.renewalDate && (
            <Text style={styles.deepDiveRenewal}>
              Resets {new Date(subscription.renewalDate).toLocaleDateString()}
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.buyButton} onPress={handleBuyCredit}>
        <Text style={styles.buyText}>Buy Extra Credit (${creditPrice})</Text>
      </TouchableOpacity>

      {subscription?.tier === "free" && (
        <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>Upgrade to Plus — $14.99/mo</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 16 },
  email: { fontSize: 16, color: "#888", marginBottom: 8 },
  deepDiveCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#6366f140",
  },
  deepDiveLabel: { fontSize: 14, color: "#888", marginBottom: 4 },
  deepDiveMinutes: { fontSize: 20, fontWeight: "700", color: "#6366f1" },
  deepDiveRenewal: { fontSize: 12, color: "#555", marginTop: 4 },
  buyButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  buyText: { color: "#6366f1", fontSize: 16, fontWeight: "600" },
  upgradeButton: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  upgradeText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  signOutButton: { marginTop: "auto", padding: 16, alignItems: "center" },
  signOutText: { color: "#ff6b6b", fontSize: 16 },
});
