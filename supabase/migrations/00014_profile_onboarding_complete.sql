-- 00012_profile_onboarding_complete.sql
-- Tracks whether a user has finished initial onboarding (voice picked +
-- first podcast submitted). The mobile tab bar stays hidden until this
-- flips to true so the user can focus on creating their first podcast
-- without distraction.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any user who already has at least one podcast has clearly
-- passed the focused-onboarding moment. Mark them complete so existing
-- accounts don't get hidden tab bars after the mobile deploy.
UPDATE public.profiles p
SET onboarding_complete = TRUE
WHERE EXISTS (
  SELECT 1 FROM public.podcasts pod WHERE pod.user_id = p.id
);
