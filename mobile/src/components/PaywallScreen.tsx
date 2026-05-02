// mobile/src/components/PaywallScreen.tsx
/**
 * Paywall — page-sheet modal listing subscription packages from RevenueCat.
 *
 * Each package is a flat row, hairline-divided. Tap to start the in-app
 * purchase flow. iOS presents this as a card sheet over the previous
 * screen; Android falls back to a fullscreen modal. Either way the user
 * can dismiss without committing.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { PurchasesPackage } from "react-native-purchases";
import { LoadingOverlay } from "./LoadingOverlay";
import { getOfferings, purchasePackage } from "../services/revenucat";
import { color, font, layout, space, text } from "../theme/tokens";

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
        Alert.alert("Couldn't complete purchase", error.message);
      }
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={styles.root}
        edges={["top", "left", "right", "bottom"]}
      >
        {loading && <LoadingOverlay message="Loading plans" />}
        {purchasing && <LoadingOverlay message="Processing purchase" />}

        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>Upgrade</Text>
            <Text style={styles.title}>More podcasts. Fewer limits.</Text>
            <Text style={styles.subtitle}>
              Plus or Pro. Cancel anytime from your account.
            </Text>
          </View>

          {!loading && packages.length === 0 && (
            <Text style={styles.emptyState}>
              We couldn't load plans right now. Try again in a moment.
            </Text>
          )}

          {packages.map((pkg, i) => (
            <PackageRow
              key={pkg.identifier}
              pkg={pkg}
              showDivider={i > 0}
              onPress={() => handlePurchase(pkg)}
            />
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
          >
            <Text style={styles.notNow}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

interface RowProps {
  pkg: PurchasesPackage;
  showDivider: boolean;
  onPress: () => void;
}

function PackageRow({ pkg, showDivider, onPress }: RowProps) {
  return (
    <View>
      {showDivider && <View style={styles.divider} />}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Subscribe to ${pkg.product.title} for ${pkg.product.priceString} per month`}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{pkg.product.title}</Text>
          <Text style={styles.rowPrice}>{pkg.product.priceString}/mo</Text>
          {!!pkg.product.description && (
            <Text style={styles.rowDescription}>{pkg.product.description}</Text>
          )}
        </View>
        <View style={styles.rowArrow}>
          <Feather name="arrow-right" size={20} color={color.accent} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  close: {
    ...text.body,
    color: color.inkSecondary,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  titleBlock: {
    paddingTop: space.sm,
    paddingBottom: space.xl,
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
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
    paddingVertical: space.lg,
  },
  rowPressed: {
    opacity: 0.55,
  },
  rowBody: {
    flex: 1,
    gap: space.xxs,
  },
  rowTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  rowPrice: {
    fontFamily: font.serifMedium,
    fontSize: 16,
    color: color.accent,
    fontVariant: ["tabular-nums"],
  },
  rowDescription: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  rowArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    ...text.bodySmall,
    color: color.inkSecondary,
    paddingTop: space.xl,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.lg,
    alignItems: "center",
  },
  notNow: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
});
