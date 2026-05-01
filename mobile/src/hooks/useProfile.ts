/**
 * Selects + caches the signed-in user's profile row. Subscribes to Realtime
 * for cross-device sync (e.g., user changes voice on iPad, iPhone updates).
 *
 * Mirrors the pattern of useSubscription.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export interface Profile {
  id: string;
  displayName: string | null;
  preferredVoice: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  preferred_voice: string | null;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    preferredVoice: row.preferred_voice,
  };
}

export function useProfile() {
  const { user } = useAuth();
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
      .select("id, display_name, preferred_voice")
      .eq("id", user.id)
      .single();
    if (!error && data) setProfile(toProfile(data as unknown as ProfileRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
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
  }, [user, fetch]);

  const setPreferredVoice = useCallback(
    async (voice: string) => {
      if (!user) return;
      // Optimistic update
      setProfile((prev) => (prev ? { ...prev, preferredVoice: voice } : prev));
      const { error } = await supabase
        .from("profiles")
        .update({ preferred_voice: voice })
        .eq("id", user.id);
      if (error) {
        // Roll back on failure
        await fetch();
        throw error;
      }
    },
    [user, fetch],
  );

  return { profile, loading, setPreferredVoice, refresh: fetch };
}
