import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { ConversationProvider } from "@elevenlabs/react-native";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  useFonts as useSansFonts,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  IBMPlexSerif_400Regular,
  IBMPlexSerif_500Medium,
  IBMPlexSerif_600SemiBold,
  IBMPlexSerif_700Bold,
} from "@expo-google-fonts/ibm-plex-serif";
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

  const [fontsLoaded] = useSansFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexSerif_400Regular,
    IBMPlexSerif_500Medium,
    IBMPlexSerif_600SemiBold,
    IBMPlexSerif_700Bold,
  });

  useEffect(() => {
    if (session?.user) {
      configureRevenueCat(session.user.id);
    }
  }, [session]);

  useEffect(() => {
    if (loading || !fontsLoaded) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, loading, fontsLoaded, segments]);

  if (loading || !fontsLoaded) return <LoadingOverlay message="" />;

  return (
    <ConversationProvider>
      <Slot />
    </ConversationProvider>
  );
}
