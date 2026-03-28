import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#6366f1",
        tabBarStyle: { backgroundColor: "#0a0a0a", borderTopColor: "#1a1a1a" },
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Library", tabBarLabel: "Library" }} />
      <Tabs.Screen name="generate" options={{ title: "Generate", tabBarLabel: "New" }} />
      <Tabs.Screen name="sources" options={{ title: "Sources", tabBarLabel: "Sources" }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarLabel: "Account" }} />
    </Tabs>
  );
}
