/**
 * Single-source-of-truth profile state via React context.
 *
 * Why context (not a per-call hook): callers in different subtrees
 * (root layout gate + voice screen) need to see the same profile state
 * at the same React tick. With a per-call hook, voice.tsx's
 * setPreferredVoice would only update its own copy; the root layout's
 * gate would still see null until a Realtime event arrived, briefly
 * pushing the user back to /(onboarding)/welcome between voice pick
 * and the navigation to /(tabs)/generate.
 *
 * Mirrors the AuthProvider pattern.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export interface Profile {
  id: string;
  displayName: string | null;
  preferredVoice: string | null;
  onboardingComplete: boolean;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  preferred_voice: string | null;
  onboarding_complete: boolean | null;
}

interface ProfileContextType {
  profile: Profile | null;
  loading: boolean;
  setPreferredVoice: (voice: string) => Promise<void>;
  setOnboardingComplete: (complete: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    preferredVoice: row.preferred_voice,
    onboardingComplete: !!row.onboarding_complete,
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, preferred_voice, onboarding_complete")
      .eq("id", user.id)
      .single();
    if (!error && data) setProfile(toProfile(data as unknown as ProfileRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    // Wait for auth to settle before doing anything. On cold start, `user`
    // is null while supabase.auth.getSession() is in flight; running the
    // fetch's !user branch in that window flips profileLoading to false
    // with profile=null, which made the root-layout onboarding gate
    // misfire when auth eventually resolved with a signed-in session.
    if (authLoading) return;

    setLoading(true);
    fetch();

    if (!user) return;

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          setProfile(toProfile(payload.new as ProfileRow));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, authLoading, fetch]);

  const setPreferredVoice = useCallback(
    async (voice: string) => {
      if (!user) return;
      // Optimistic update — same React tick as the navigation, so the
      // root-layout gate sees the new voice immediately.
      setProfile((prev) =>
        prev
          ? { ...prev, preferredVoice: voice }
          : {
              id: user.id,
              displayName: null,
              preferredVoice: voice,
              onboardingComplete: false,
            },
      );
      const { error } = await supabase
        .from("profiles")
        .update({ preferred_voice: voice })
        .eq("id", user.id);
      if (error) {
        // Roll back from server on failure.
        await fetch();
        throw error;
      }
    },
    [user, fetch],
  );

  const setOnboardingComplete = useCallback(
    async (complete: boolean) => {
      if (!user) return;
      // Skip the round-trip when already in the desired state.
      if (profile?.onboardingComplete === complete) return;
      setProfile((prev) =>
        prev ? { ...prev, onboardingComplete: complete } : prev,
      );
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_complete: complete })
        .eq("id", user.id);
      if (error) {
        await fetch();
        throw error;
      }
    },
    [user, profile, fetch],
  );

  const value = useMemo<ProfileContextType>(
    () => ({
      profile,
      loading,
      setPreferredVoice,
      setOnboardingComplete,
      refresh: fetch,
    }),
    [profile, loading, setPreferredVoice, setOnboardingComplete, fetch],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return ctx;
}
