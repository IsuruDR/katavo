-- 00025_signup_bonus_credits.sql
-- First-signup bonus credit that doesn't expire.
--
-- Today new users get credits_remaining = 2 from handle_new_user. That value
-- lives in the same column RevenueCat overwrites on INITIAL_PURCHASE (set
-- to 8 plus / 20 pro), RENEWAL, and EXPIRATION (set back to 2). So any
-- "starter" amount in that column is wiped the moment a user upgrades or
-- churns.
--
-- This migration carves out a second bucket: subscriptions.bonus_credits.
-- It's never touched by RevenueCat webhooks, so it survives every lifecycle
-- event. submitPodcast deducts from credits_remaining first (use-it-or-lose-it,
-- since monthly gets reset on subscription events) and falls back to
-- bonus_credits when monthly is empty. handle_podcast_failure refunds always
-- to credits_remaining; if a podcast was paid from bonus and then fails, the
-- refund lands in monthly. The ledger nets correctly either way.
--
-- handle_new_user now also seeds bonus_credits = 1. A one-shot backfill
-- grants the same bonus to existing free-tier users so launch-day signups
-- aren't punished for being early. Paid users do not get the bonus,
-- treating it strictly as a welcome credit for new free accounts.

-- ---- Schema -----------------------------------------------------------

ALTER TABLE public.subscriptions
  ADD COLUMN bonus_credits int NOT NULL DEFAULT 0;

-- ---- Trigger re-CREATE ------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.subscriptions (
    user_id, tier, status, credits_per_month, credits_remaining, bonus_credits
  )
  VALUES (NEW.id, 'free', 'active', 2, 2, 1);

  RETURN NEW;
END;
$$;

-- ---- Backfill --------------------------------------------------------
-- One-shot grant to existing free-tier users. Idempotent: only touches
-- rows that currently have bonus_credits = 0 so re-running this migration
-- is a no-op. Paid users are excluded; the bonus is a welcome credit, not
-- a tenure reward.

WITH granted AS (
  UPDATE public.subscriptions
     SET bonus_credits = 1
   WHERE bonus_credits = 0
     AND tier = 'free'
  RETURNING user_id
)
INSERT INTO public.credit_transactions (user_id, type, amount)
SELECT user_id, 'allocation', 1
  FROM granted;
