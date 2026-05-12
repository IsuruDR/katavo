-- 00020_failure_diagnostics.sql
-- Preserve diagnostic data when the pipeline fails. Currently errorHandler
-- writes only status + error_message; rich rawResearchResponse from
-- deepResearchAgent (planner tasks + per-subagent findings/status/notes)
-- is lost, leaving floor-gate failures undebuggable without live logs.
--
-- This column is populated only on failures that carry diagnostic data
-- (e.g. floor-gate trip after deepResearchAgent). Null elsewhere.

ALTER TABLE public.podcasts
  ADD COLUMN failure_diagnostics jsonb;

COMMENT ON COLUMN public.podcasts.failure_diagnostics IS
  'Captured at pipeline failure time: rawResearchResponse (planner tasks + per-subagent findings/status/notes) when deepResearchAgent fails. Null on success and on failures that happen before deepResearchAgent runs.';
