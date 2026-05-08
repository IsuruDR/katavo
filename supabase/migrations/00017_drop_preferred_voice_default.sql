-- 00017_drop_preferred_voice_default.sql
-- Restore NULL semantics for profiles.preferred_voice so the mobile
-- onboarding gate (_layout.tsx: !profile.preferredVoice) correctly
-- identifies new users who haven't picked a voice. Migration 00016
-- introduced DEFAULT 'Sulafat' which silently filled the column on every
-- insert via the handle_new_user trigger, masking the new-user signal
-- and causing the gate to skip onboarding for fresh sign-ups (Apple +
-- Google both affected — the trigger doesn't care which provider).
--
-- Pipeline already handles NULL preferred_voice via its own Sulafat
-- fallback (see the comment on podcasts.voice in 00016) so dropping the
-- column default is safe.

ALTER TABLE public.profiles
  ALTER COLUMN preferred_voice DROP DEFAULT;

COMMENT ON COLUMN public.profiles.preferred_voice IS
  'Gemini TTS voice name (Sulafat|Charon|Sadaltager|Achird). NULL means voice onboarding has not been completed; pipeline falls back to Sulafat at submit-podcast time when this is NULL.';
