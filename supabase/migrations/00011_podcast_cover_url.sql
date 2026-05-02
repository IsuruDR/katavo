-- 00011_podcast_cover_url.sql
-- Adds a per-podcast cover artwork URL stored in Supabase Storage.
-- Generated server-side at pipeline metadataWriter time and surfaced on
-- the OS lock-screen via TrackPlayer's Now Playing artwork field.
--
-- Nullable: existing podcasts and any future generation that fails the
-- artwork step will simply have no cover and the OS will show its
-- default Now Playing widget. The pipeline never fails on artwork errors.

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- Storage bucket for cover images, parallel to podcast-audio. Service role
-- writes via metadataWriter; mobile clients read via the signed URL stored
-- on the podcast row, so no public RLS policies are required here.
INSERT INTO storage.buckets (id, name, public)
VALUES ('podcast-covers', 'podcast-covers', false)
ON CONFLICT (id) DO NOTHING;
