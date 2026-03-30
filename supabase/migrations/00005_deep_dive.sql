-- 00005_deep_dive.sql
-- Adds deep dive minute tracking, chapter-research mapping, and chapter reference for Q&A.

-- Deep dive minute tracking on subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN deep_dive_minutes_per_month integer NOT NULL DEFAULT 0,
  ADD COLUMN deep_dive_minutes_remaining integer NOT NULL DEFAULT 0;

-- Chapter-to-research mapping on podcasts (indexes into research_contexts)
ALTER TABLE public.podcasts
  ADD COLUMN chapter_research_map jsonb;

-- Chapter reference on Q&A sessions
ALTER TABLE public.qa_sessions
  ADD COLUMN chapter_title text,
  ADD COLUMN elevenlabs_session_id text;
