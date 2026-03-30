import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface SubscriptionRow {
  tier: "free" | "plus" | "pro";
  credits_remaining: number;
  credits_per_month: number;
  deep_dive_minutes_remaining: number;
  deep_dive_minutes_per_month: number;
  status: string;
  renewal_date: string | null;
}

/** App-level type — camelCase */
export interface Subscription {
  tier: "free" | "plus" | "pro";
  creditsRemaining: number;
  creditsPerMonth: number;
  deepDiveMinutesRemaining: number;
  deepDiveMinutesPerMonth: number;
  status: string;
  renewalDate: string | null;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    tier: row.tier,
    creditsRemaining: row.credits_remaining,
    creditsPerMonth: row.credits_per_month,
    deepDiveMinutesRemaining: row.deep_dive_minutes_remaining,
    deepDiveMinutesPerMonth: row.deep_dive_minutes_per_month,
    status: row.status,
    renewalDate: row.renewal_date,
  };
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("subscriptions")
      .select(
        "tier, credits_remaining, credits_per_month, deep_dive_minutes_remaining, deep_dive_minutes_per_month, status, renewal_date",
      )
      .eq("user_id", user.id)
      .single();
    if (data) setSubscription(toSubscription(data as unknown as SubscriptionRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const refresh = useCallback(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  return { subscription, loading, refresh };
}
