-- 00026_soft_delete_podcast_rpc.sql
--
-- Bug: mobile soft-delete was silently failing in production. DB had zero
-- rows with deleted_at set despite users actively tapping delete. After a
-- refresh, deleted podcasts reappeared because the server-side UPDATE never
-- persisted.
--
-- Root cause: the mobile client's `.update({ deleted_at: ... })` round-trip
-- goes through PostgREST/supabase-js, which appends RETURNING to the UPDATE.
-- Postgres applies the SELECT policy's USING clause to the RETURNING row
-- when an UPDATE returns rows. Our SELECT policy is:
--   ((auth.uid() = user_id) AND (deleted_at IS NULL))
-- After setting deleted_at to a timestamp, the row is no longer visible to
-- SELECT, so Postgres rejects the UPDATE with sqlstate 42501 "new row
-- violates row-level security policy". The mobile client doesn't surface
-- the error (fire-and-forget await), so the failure is invisible.
--
-- Fix: introduce soft_delete_podcast(p_id uuid) as a SECURITY DEFINER RPC
-- that asserts ownership and performs the UPDATE bypassing RLS, mirroring
-- the restore_podcast RPC from migration 00024. The mobile client calls
-- the RPC instead of a direct UPDATE.
--
-- The 00007 WITH CHECK policy stays intact (still locks any user-direct
-- writes to soft-delete-only); soft-delete now flows entirely through the
-- RPC.

CREATE OR REPLACE FUNCTION public.soft_delete_podcast(p_id uuid)
RETURNS TABLE (
  id uuid,
  deleted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.podcasts
     SET deleted_at = now()
   WHERE podcasts.id = p_id
     AND podcasts.user_id = v_uid
     AND podcasts.deleted_at IS NULL
  RETURNING podcasts.id, podcasts.deleted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_podcast(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_podcast(uuid) TO authenticated;
