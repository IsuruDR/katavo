-- 00008_research_raw_response.sql
-- Stash the full OpenAI Deep Research response on research_contexts so
-- Deep Dive can later use annotation positions, web_search_call queries,
-- or reconstruct citation footnotes from the raw output.
ALTER TABLE public.research_contexts
  ADD COLUMN raw_response jsonb;

COMMENT ON COLUMN public.research_contexts.raw_response IS
  'Full OpenAI Deep Research API response object. Source of truth for Deep Dive features that need citation positions, search queries, or unparsed text.';
