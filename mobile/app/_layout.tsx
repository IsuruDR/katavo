import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
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
import { ProfileProvider, useProfile } from "../src/hooks/useProfile";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { configureRevenueCat } from "../src/services/revenucat";
import { LoadingOverlay } from "../src/components/LoadingOverlay";
import { PlayingPodcastProvider } from "../src/state/PlayingPodcastContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <ProfileProvider>
        <PlayingPodcastProvider>
          <RootLayoutInner />
        </PlayingPodcastProvider>
      </ProfileProvider>
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

    // Onboarding gate. One-way: only push INTO onboarding when voice is
    // null. The reverse (onboarding -> tabs once voice is set) happens
    // via voice.tsx's explicit router.replace after the user picks a
    // voice. Auto-redirecting here would race that navigation and land
    // the user on the default tab without the placeholder param.
    //
    // The cold-start race that used to fire this gate spuriously
    // (profile=null because auth was still loading) is fixed in
    // useProfile.tsx by gating its fetch on auth being settled. The
    // gate here can trust profileLoading to be true until both auth and
    // the profile fetch have actually returned.
    if (session && !profileLoading) {
      const needsOnboarding = !profile?.preferredVoice;

      if (needsOnboarding && !inOnboardingGroup && !inAuthGroup) {
        router.replace("/(onboarding)/welcome");
        return;
      }
    }
  }, [session, loading, fontsLoaded, segments, profile, profileLoading]);

  if (loading || !fontsLoaded) return <LoadingOverlay message="" />;

  // Root Stack (not Slot) so non-tab routes — voice-settings, player/[id],
  // player/deep-dive — push ON TOP of the (tabs) group with the active tab
  // preserved. With Slot, every navigation swap remounted (tabs) from
  // scratch and the Tabs navigator defaulted to its first tab on back,
  // breaking back-from-voice-settings (landed on Library instead of
  // Account) and similarly for the player.
  return (
    <ConversationProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ConversationProvider>
  );
}
