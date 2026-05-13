-- Cascade soft-delete down the expansion tree.
--
-- When a parent podcast's deleted_at flips from NULL to a timestamp, every
-- descendant (expansions of it, expansions of expansions, etc.) gets the
-- same timestamp stamped on its deleted_at. The trigger recurses naturally
-- because the cascading UPDATE on each child re-fires this trigger.
--
-- On restore (timestamp -> NULL via the undo flow in mobile/src/hooks/
-- usePodcasts.ts), descendants whose deleted_at matches the parent's
-- previous value are restored together. Descendants that were soft-deleted
-- independently at an earlier time keep their own deleted_at and stay
-- deleted — only the cascade group bounces back.
--
-- Library-side, mobile filters podcasts to parent_podcast_id IS NULL, so
-- live expansions never appear in the user's list. The cascade means
-- orphan rows (expansions whose parent was soft-deleted) don't exist as a
-- visible state — there's nothing to surface in the library or anywhere
-- else once the parent is gone.

CREATE OR REPLACE FUNCTION cascade_soft_delete_expansions()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- Parent just soft-deleted. Stamp descendants with the same timestamp.
    UPDATE public.podcasts
       SET deleted_at = NEW.deleted_at
     WHERE parent_podcast_id = NEW.id
       AND deleted_at IS NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- Parent just restored. Restore the descendants that were taken down
    -- by THIS cascade (timestamp match), leaving independently-deleted
    -- rows alone.
    UPDATE public.podcasts
       SET deleted_at = NULL
     WHERE parent_podcast_id = NEW.id
       AND deleted_at = OLD.deleted_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_soft_delete_expansions_trigger ON public.podcasts;

CREATE TRIGGER cascade_soft_delete_expansions_trigger
AFTER UPDATE OF deleted_at ON public.podcasts
FOR EACH ROW
EXECUTE FUNCTION cascade_soft_delete_expansions();
