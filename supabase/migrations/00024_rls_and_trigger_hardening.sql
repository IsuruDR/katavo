-- 00024_rls_and_trigger_hardening.sql
--
-- Three findings from the 2026-05-15 security review, bundled because they
-- all live in the same DB-policy/trigger surface:
--
-- SEC-5: profile UPDATE policy was missing WITH CHECK. The PK constraint
--   makes an id-rewrite impossible in practice today, but the gap would
--   silently turn into a real bug if constraints relax. Add WITH CHECK.
--
-- SEC-7: cascade_soft_delete_expansions() ran as the calling user with no
--   SECURITY DEFINER and no search_path. Two consequences:
--     (a) defense-in-depth gap, a malicious function shadowing
--         public.podcasts in the user's search path could redirect the
--         trigger's writes;
--     (b) restore-cascade was unreachable in practice. Restoring a parent
--         requires UPDATE podcasts SET deleted_at = NULL, which the
--         00007 WITH CHECK rejects. The mobile undo flow's UPDATE has
--         been silently failing in production; the local UI bounces back
--         from the optimistic stash but the server row never restores.
--   Fix: lift the trigger to SECURITY DEFINER + search_path, scope the
--   inner UPDATE to user_id = NEW.user_id (defensive), AND introduce a
--   restore_podcast(p_id uuid) RPC so the mobile undo flow can actually
--   un-soft-delete via a SECURITY DEFINER path that owns the WITH CHECK
--   bypass. The cascade trigger then fires on the parent UPDATE and the
--   restore reaches descendants too.
--
-- SEC-8: handle_podcast_failure() in 00003 had no SECURITY DEFINER set on
--   the migration source. Live prod has had it patched (verified via
--   pg_proc.prosecdef = true + proconfig contains search_path), but the
--   migration source-of-truth was stale. Re-CREATE the function here so
--   any future bootstrap from migration files matches prod.

-- ---- SEC-5: profiles UPDATE with WITH CHECK ---------------------------

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---- SEC-7: cascade trigger hardened + restore_podcast RPC ------------

CREATE OR REPLACE FUNCTION cascade_soft_delete_expansions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- Cascade soft-delete to descendants belonging to the same owner.
    UPDATE public.podcasts
       SET deleted_at = NEW.deleted_at
     WHERE parent_podcast_id = NEW.id
       AND user_id = NEW.user_id
       AND deleted_at IS NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- Cascade restore: only rows that were taken down by this same
    -- cascade group (timestamp match), preserving rows independently
    -- soft-deleted at an earlier time.
    UPDATE public.podcasts
       SET deleted_at = NULL
     WHERE parent_podcast_id = NEW.id
       AND user_id = NEW.user_id
       AND deleted_at = OLD.deleted_at;
  END IF;
  RETURN NEW;
END;
$$;

-- Restore RPC. SECURITY DEFINER so it can bypass the soft-delete-only
-- WITH CHECK on podcasts UPDATE policy. Asserts ownership inside the
-- function body so the bypass is scoped. Returns the new state to the
-- caller as a sanity-check value.
CREATE OR REPLACE FUNCTION public.restore_podcast(p_id uuid)
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
     SET deleted_at = NULL
   WHERE podcasts.id = p_id
     AND podcasts.user_id = v_uid
     AND podcasts.deleted_at IS NOT NULL
  RETURNING podcasts.id, podcasts.deleted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_podcast(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_podcast(uuid) TO authenticated;

-- ---- SEC-8: bring handle_podcast_failure source back in sync with prod -

CREATE OR REPLACE FUNCTION public.handle_podcast_failure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
    INSERT INTO public.credit_transactions (user_id, type, amount, podcast_id)
    VALUES (NEW.user_id, 'refund', 1, NEW.id);

    UPDATE public.subscriptions
       SET credits_remaining = credits_remaining + 1
     WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
