-- 00027_share_tree_source_chapter.sql
--
-- Adds source_chapter_title to the get_shared_tree RPC's output so the
-- share page can render the parent-chapter genealogy on expansion
-- entries in the "More from this series" section.
--
-- Function signature changes; CREATE OR REPLACE alone isn't enough when
-- the RETURNS TABLE shape changes, so we DROP first.

DROP FUNCTION IF EXISTS public.get_shared_tree(text);

CREATE OR REPLACE FUNCTION public.get_shared_tree(p_token text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  parent_podcast_id uuid,
  source_chapter_title text,
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
    SELECT p.id, p.user_id, p.parent_podcast_id, p.source_chapter_title, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, true AS is_root
    FROM podcasts p
    WHERE p.share_token = p_token
      AND p.deleted_at IS NULL
      AND p.status = 'complete'
    UNION ALL
    SELECT p.id, p.user_id, p.parent_podcast_id, p.source_chapter_title, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, false AS is_root
    FROM podcasts p
    INNER JOIN tree t ON p.parent_podcast_id = t.id
    WHERE p.deleted_at IS NULL
      AND p.status = 'complete'
  )
  SELECT id, user_id, parent_podcast_id, source_chapter_title, topic, has_cover,
         chapter_markers, duration_seconds, status, is_root
  FROM tree;
$$;

REVOKE ALL ON FUNCTION public.get_shared_tree(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_tree(text) TO service_role;
