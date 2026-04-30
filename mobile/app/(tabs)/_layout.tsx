import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { color, font } from "../../src/theme/tokens";

export default function TabLayout() {
  return (
    <Tabs
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
        name="sources"
        options={{
          tabBarLabel: "Sources",
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="bookmark" size={size - 2} color={tint} />
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
