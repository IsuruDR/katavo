-- 00016_gemini_voice_migration.sql
-- Switch from OpenAI voices to Gemini voices. Greenfield project (zero users)
-- so we clear all existing voice preferences and force re-onboarding.

UPDATE public.profiles SET preferred_voice = NULL WHERE preferred_voice IS NOT NULL;
UPDATE public.podcasts SET voice = NULL WHERE voice IS NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN preferred_voice SET DEFAULT 'Sulafat';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_voice_check
  CHECK (preferred_voice IS NULL OR preferred_voice IN ('Sulafat', 'Charon', 'Sadaltager', 'Achird'));

COMMENT ON COLUMN public.profiles.preferred_voice IS
  'Gemini TTS voice name (Sulafat|Charon|Sadaltager|Achird). Default: Sulafat. Reset by v14 Gemini TTS migration on 2026-05-07.';

COMMENT ON COLUMN public.podcasts.voice IS
  'Gemini voice this podcast was rendered with. Snapshot from profiles.preferred_voice at submit-podcast time. NULL on legacy rows = pipeline default (Sulafat).';
