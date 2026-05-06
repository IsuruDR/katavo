-- 00015_research_raw_response_comment.sql
-- Update column comment to reflect new shape after v11 deep research agent
-- replaced o4-mini-deep-research with self-hosted LangGraph (createReactAgent + Tavily).
COMMENT ON COLUMN public.research_contexts.raw_response IS
  'Subagent findings array from deep research agent: { tasks, subagentFindings, model }. Used by deep-dive feature for granular per-claim source access.';
