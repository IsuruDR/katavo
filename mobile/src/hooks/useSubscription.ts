import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface SubscriptionRow {
  tier: "free" | "plus" | "pro";
  credits_remaining: number;
  credits_per_month: number;
  status: string;
}

/** App-level type — camelCase */
export interface Subscription {
  tier: "free" | "plus" | "pro";
  creditsRemaining: number;
  creditsPerMonth: number;
  status: string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    tier: row.tier,
    creditsRemaining: row.credits_remaining,
    creditsPerMonth: row.credits_per_month,
    status: row.status,
  };
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("subscriptions")
      .select("tier, credits_remaining, credits_per_month, status")
      .eq("user_id", user.id)
      .single();
    if (data) setSubscription(toSubscription(data as SubscriptionRow));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const refresh = useCallback(() => { fetch(); }, [fetch]);

  return { subscription, loading, refresh };
}
