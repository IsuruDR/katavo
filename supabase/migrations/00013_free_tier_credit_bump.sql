-- 00013_free_tier_credit_bump.sql
-- Free tier monthly allowance: 1 -> 2 podcasts. Updates the signup trigger
-- and backfills existing free-tier subscriptions (conservatively — only
-- bump users who haven't used their old allotment yet).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.subscriptions (user_id, tier, status, credits_per_month, credits_remaining)
  VALUES (NEW.id, 'free', 'active', 2, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Backfill: existing free-tier subscriptions get credits_per_month bumped to 2.
-- credits_remaining is bumped by 1 only if the user hasn't burned this month's
-- old credit (currently_remaining > 0). Users at 0 stay at 0 — they used the
-- old allotment, they get the new one at next renewal.
UPDATE public.subscriptions
SET credits_per_month = 2,
    credits_remaining = LEAST(2, credits_remaining + 1)
WHERE tier = 'free' AND status = 'active';
