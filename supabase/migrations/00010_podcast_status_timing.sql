-- 00010_podcast_status_timing.sql
-- Status lifecycle bookkeeping so the mobile UI can show "researching for 4m"
-- and so we can compute median per-stage duration for ETA hints later.
ALTER TABLE public.podcasts
  ADD COLUMN status_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.podcasts.status_started_at IS
  'When the current status began. Reset on every transition.';

COMMENT ON COLUMN public.podcasts.status_history IS
  'Append-only log of {status, at} entries, one per transition. Used for stage timing UI and ETA computation.';

-- Trigger to keep status_started_at + status_history in sync with status changes.
-- Fires on UPDATE OR INSERT so the initial 'queued' row also gets a history entry.
CREATE OR REPLACE FUNCTION public.handle_podcast_status_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_history = jsonb_build_array(
      jsonb_build_object('status', NEW.status, 'at', now())
    );
    NEW.status_started_at = now();
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_history = COALESCE(OLD.status_history, '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('status', NEW.status, 'at', now()));
    NEW.status_started_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER on_podcast_status_transition
  BEFORE INSERT OR UPDATE OF status ON public.podcasts
  FOR EACH ROW EXECUTE FUNCTION public.handle_podcast_status_transition();

REVOKE EXECUTE ON FUNCTION public.handle_podcast_status_transition() FROM PUBLIC, anon, authenticated;

-- Backfill existing rows: seed history with their current status.
UPDATE public.podcasts
SET status_history = jsonb_build_array(
  jsonb_build_object('status', status, 'at', created_at)
)
WHERE status_history = '[]'::jsonb;
