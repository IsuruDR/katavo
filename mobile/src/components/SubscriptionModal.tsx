// mobile/src/components/SubscriptionModal.tsx
/**
 * SubscriptionModal — modal for purchasing extra credits.
 * Shows tier-specific pricing.
 */
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal } from "react-native";
import { purchaseCredit } from "../services/revenucat";
import { useState } from "react";
import { LoadingOverlay } from "./LoadingOverlay";

interface Props {
  visible: boolean;
  tier: "free" | "plus" | "pro";
  onClose: () => void;
  onPurchased: () => void;
}

const PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

export function SubscriptionModal({ visible, tier, onClose, onPurchased }: Props) {
  const [loading, setLoading] = useState(false);
  const price = PRICES[tier];

  const handleBuy = async () => {
    setLoading(true);
    try {
      await purchaseCredit(tier);
      onPurchased();
      onClose();
    } catch (error: any) {
      if (!error.userCancelled) {
        Alert.alert("Purchase Failed", error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        {loading && <LoadingOverlay message="Processing..." />}
        <View style={styles.modal}>
          <Text style={styles.title}>Buy Extra Credit</Text>
          <Text style={styles.subtitle}>Generate one additional podcast</Text>

          <View style={styles.priceBox}>
            <Text style={styles.price}>${price}</Text>
            <Text style={styles.perCredit}>per credit</Text>
          </View>

          <TouchableOpacity style={styles.buyButton} onPress={handleBuy}>
            <Text style={styles.buyText}>Purchase for ${price}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: "#1a1a1a", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 16,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#888", textAlign: "center" },
  priceBox: { alignItems: "center", paddingVertical: 16 },
  price: { fontSize: 48, fontWeight: "700", color: "#6366f1" },
  perCredit: { fontSize: 14, color: "#888" },
  buyButton: { backgroundColor: "#6366f1", borderRadius: 12, padding: 16, alignItems: "center" },
  buyText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancelText: { color: "#888", textAlign: "center", fontSize: 16 },
});
