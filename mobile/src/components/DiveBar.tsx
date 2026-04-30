// mobile/src/components/DiveBar.tsx
/**
 * DiveBar — persistent CTA between chapter list and audio dock.
 *
 * Tells the user what they'd be diving into right now (the current chapter)
 * and offers a single decisive action. The accent green circle on the right
 * echoes the play button's affordance — same color, smaller — so Dive reads
 * as second-most-important after play.
 *
 * Locked states (free tier or paid with no minutes left) dim the bar and
 * swap the arrow for a lock icon. Tap navigates to the upgrade route.
 */
import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, font, motion, space } from "../theme/tokens";

interface Props {
  chapterTitle: string;
  locked?: boolean;
  onPress: () => void;
}

export function DiveBar({ chapterTitle, locked = false, onPress }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.98,
        duration: motion.fast,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: motion.base,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? `Dive locked. Tap to upgrade.`
          : `Dive into ${chapterTitle}`
      }
    >
      <Animated.View
        style={[
          styles.bar,
          locked && styles.barLocked,
          { transform: [{ scale }] },
        ]}
      >
        <View style={styles.text}>
          <Text style={styles.eyebrow}>Dive into</Text>
          <Text style={styles.chapter} numberOfLines={1}>
            {chapterTitle}
          </Text>
        </View>
        <View style={styles.circle}>
          <Feather
            name={locked ? "lock" : "arrow-right"}
            size={18}
            color={color.paper}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
    paddingHorizontal: space.xl,
    paddingVertical: space.base,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  barLocked: {
    opacity: 0.55,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    color: color.accent,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  chapter: {
    fontFamily: font.serifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
    letterSpacing: -0.1,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
});
