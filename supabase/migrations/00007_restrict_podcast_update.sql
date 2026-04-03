-- 00007_restrict_podcast_update.sql
-- Restrict podcast UPDATE policy to soft-delete only.
-- The previous policy allowed updating ANY column on owned podcasts.
-- This tightened policy ensures WITH CHECK requires deleted_at IS NOT NULL,
-- so the only valid update is setting the deleted_at timestamp (soft-delete).

DROP POLICY IF EXISTS "Users can soft-delete own podcasts" ON public.podcasts;

CREATE POLICY "Users can soft-delete own podcasts"
  ON public.podcasts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND deleted_at IS NOT NULL);
