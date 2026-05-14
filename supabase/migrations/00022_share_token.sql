-- 00022_share_token.sql
-- Adds public share-link support for podcasts.
--
-- One column (share_token) on podcasts marks a podcast as shareable.
-- One SECURITY DEFINER RPC (get_shared_tree) returns the matched
-- podcast plus its live, completed descendants in one round-trip.
-- The RPC is callable only by service_role; anon and authenticated
-- cannot reach it, so the public share route on the pipeline server
-- is the only path to the data.

ALTER TABLE public.podcasts
  ADD COLUMN share_token text;

CREATE UNIQUE INDEX podcasts_share_token_unique
  ON public.podcasts (share_token)
  WHERE share_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_shared_tree(p_token text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  parent_podcast_id uuid,
  topic text,
  has_cover boolean,
  chapter_markers jsonb,
  duration_seconds int,
  status text,
  is_root boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT p.id, p.user_id, p.parent_podcast_id, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, true AS is_root
    FROM podcasts p
    WHERE p.share_token = p_token
      AND p.deleted_at IS NULL
      AND p.status = 'complete'
    UNION ALL
    SELECT p.id, p.user_id, p.parent_podcast_id, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, false AS is_root
    FROM podcasts p
    INNER JOIN tree t ON p.parent_podcast_id = t.id
    WHERE p.deleted_at IS NULL
      AND p.status = 'complete'
  )
  SELECT id, user_id, parent_podcast_id, topic, has_cover,
         chapter_markers, duration_seconds, status, is_root
  FROM tree;
$$;

REVOKE ALL ON FUNCTION public.get_shared_tree(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_tree(text) TO service_role;
