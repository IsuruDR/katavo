import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { ConversationProvider } from "@elevenlabs/react-native";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { configureRevenueCat } from "../src/services/revenucat";
import { LoadingOverlay } from "../src/components/LoadingOverlay";

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutInner />
    </AuthProvider>
  );
}

function RootLayoutInner() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  usePushNotifications();

  useEffect(() => {
    if (session?.user) {
      configureRevenueCat(session.user.id);
    }
  }, [session]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments]);

  if (loading) return <LoadingOverlay message="Loading..." />;

  return (
    <ConversationProvider>
      <Slot />
    </ConversationProvider>
  );
}
