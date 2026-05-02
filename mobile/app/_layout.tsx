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
import { useProfile } from "../src/hooks/useProfile";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { configureRevenueCat } from "../src/services/revenucat";
import { LoadingOverlay } from "../src/components/LoadingOverlay";
import { PlayingPodcastProvider } from "../src/state/PlayingPodcastContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <PlayingPodcastProvider>
        <RootLayoutInner />
      </PlayingPodcastProvider>
    </AuthProvider>
  );
}

function RootLayoutInner() {
  const { session, loading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
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
    const inOnboardingGroup = segments[0] === "(onboarding)";

    // Not signed in → bounce to sign-in unless we're already there
    if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
      return;
    }

    // Signed in but in auth group → out
    if (session && inAuthGroup) {
      router.replace("/(tabs)");
      return;
    }

    // Onboarding gate. One-way: only push INTO onboarding when voice is null.
    // The reverse (onboarding -> tabs once voice is set) is handled by the
    // onboarding screens themselves (voice.tsx redirects to /(tabs)/generate
    // with a placeholder param). Auto-redirecting here races with that
    // navigation and lands the user on the default tab (Library) without
    // the placeholder. Edge case where the user kills the app on the voice
    // screen with voice already set is handled by voice.tsx itself.
    if (session && !profileLoading) {
      const needsOnboarding = !profile?.preferredVoice;

      if (needsOnboarding && !inOnboardingGroup && !inAuthGroup) {
        router.replace("/(onboarding)/welcome");
        return;
      }
    }
  }, [session, loading, fontsLoaded, segments, profile, profileLoading]);

  if (loading || !fontsLoaded) return <LoadingOverlay message="" />;

  return (
    <ConversationProvider>
      <Slot />
    </ConversationProvider>
  );
}
