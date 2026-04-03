// mobile/src/components/PaywallScreen.tsx
/**
 * PaywallScreen — displays subscription options.
 * Shows Plus and Pro tiers with monthly/annual toggle.
 * Props:
 *   - onClose: () => void
 *   - onPurchased: () => void
 */
import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { PurchasesPackage } from "react-native-purchases";
import { getOfferings, purchasePackage } from "../services/revenucat";
import { LoadingOverlay } from "./LoadingOverlay";

interface Props {
  onClose: () => void;
  onPurchased: () => void;
}

export function PaywallScreen({ onClose, onPurchased }: Props) {
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    (async () => {
      const offering = await getOfferings();
      if (offering) setPackages(offering.availablePackages);
      setLoading(false);
    })();
  }, []);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setPurchasing(true);
    try {
      await purchasePackage(pkg);
      onPurchased();
    } catch (error: any) {
      if (!error.userCancelled) {
        Alert.alert("Purchase Failed", error.message);
      }
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading plans..." />;
  if (purchasing) return <LoadingOverlay message="Processing purchase..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Upgrade Your Experience</Text>
      <Text style={styles.subtitle}>Generate more podcasts. No ads. Premium features.</Text>

      {packages.map((pkg) => (
        <TouchableOpacity
          key={pkg.identifier}
          style={styles.packageCard}
          onPress={() => handlePurchase(pkg)}
        >
          <Text style={styles.packageTitle}>{pkg.product.title}</Text>
          <Text style={styles.packagePrice}>{pkg.product.priceString}/mo</Text>
          <Text style={styles.packageDesc}>{pkg.product.description}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity onPress={onClose}>
        <Text style={styles.closeText}>Maybe later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: "700", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 16, color: "#888", textAlign: "center", marginBottom: 16 },
  packageCard: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: "#6366f1",
  },
  packageTitle: { fontSize: 18, fontWeight: "600", color: "#fff" },
  packagePrice: { fontSize: 24, fontWeight: "700", color: "#6366f1", marginTop: 4 },
  packageDesc: { fontSize: 14, color: "#888", marginTop: 8 },
  closeText: { color: "#888", textAlign: "center", marginTop: 16, fontSize: 16 },
});
