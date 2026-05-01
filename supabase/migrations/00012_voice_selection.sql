-- 00012_voice_selection.sql
-- Per-user voice preference (set during onboarding) + per-podcast voice snapshot
-- (so changes to preferred_voice never retro-affect past episodes).

ALTER TABLE public.profiles
  ADD COLUMN preferred_voice text;

COMMENT ON COLUMN public.profiles.preferred_voice IS
  'Voice ID (coral|sage|ash|ballad) the user picked during onboarding. NULL means onboarding has not been completed.';

ALTER TABLE public.podcasts
  ADD COLUMN voice text;

COMMENT ON COLUMN public.podcasts.voice IS
  'Voice this podcast was rendered with. Snapshot from profiles.preferred_voice at submit-podcast time. NULL on legacy rows = pipeline default (TTS_VOICE).';

-- Add profiles to the realtime publication so cross-device voice changes
-- propagate via the existing useProfile subscription pattern.
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
