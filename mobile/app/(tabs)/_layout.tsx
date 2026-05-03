import { Feather } from "@expo/vector-icons";
import { BottomTabBar } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { useProfile } from "../../src/hooks/useProfile";
import { color, font } from "../../src/theme/tokens";

export default function TabLayout() {
  const { profile } = useProfile();
  // Default to "show" while profile loads so returning users don't see a
  // brief flash of the bar disappearing. New users have onboardingComplete
  // = false from the trigger default and stay focused on Generate.
  const showTabBar = profile?.onboardingComplete ?? true;

  return (
    <Tabs
      tabBar={
        showTabBar
          ? (props) => (
              <View>
                <MiniPlayer />
                <BottomTabBar {...props} />
              </View>
            )
          : () => null
      }
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.inkSecondary,
        tabBarStyle: {
          backgroundColor: color.paper,
          borderTopColor: color.hairline,
          borderTopWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontFamily: font.sansSemiBold,
          fontSize: 11,
          letterSpacing: 0.4,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: "Library",
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="book-open" size={size - 2} color={tint} />
          ),
        }}
      />
      <Tabs.Screen
        name="generate"
        options={{
          tabBarLabel: "Generate",
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="feather" size={size - 2} color={tint} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarLabel: "Account",
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="user" size={size - 2} color={tint} />
          ),
        }}
      />
    </Tabs>
  );
}
