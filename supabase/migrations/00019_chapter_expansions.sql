-- 00019_chapter_expansions.sql
-- Foundation for chapter expansions: parent-child relationship on podcasts,
-- per-chapter transcript storage so expansions can extract just the relevant
-- chapter as scriptWriter callback context, has_used_expand flag for coach-mark
-- gating, playback_events log for re-engagement chapter selection.

-- 1. Expansion relationship + per-chapter transcript on podcasts
ALTER TABLE public.podcasts
  ADD COLUMN parent_podcast_id uuid REFERENCES public.podcasts(id) ON DELETE SET NULL,
  ADD COLUMN source_chapter_title text,
  ADD COLUMN expansion_prompt_sent_at timestamptz,
  ADD COLUMN chapter_transcripts jsonb,
  ADD CONSTRAINT podcasts_expansion_consistency
    CHECK (parent_podcast_id IS NULL OR source_chapter_title IS NOT NULL);

-- 2. Idempotency: a chapter can be expanded exactly once per parent
--    (excluding soft-deleted expansions so users can re-roll a bad one)
CREATE UNIQUE INDEX idx_podcasts_unique_expansion
  ON public.podcasts (parent_podcast_id, source_chapter_title)
  WHERE parent_podcast_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Lookup index for "which expansions has this podcast spawned?"
CREATE INDEX idx_podcasts_parent
  ON public.podcasts (parent_podcast_id)
  WHERE parent_podcast_id IS NOT NULL;

-- 4. Feature-introduced flag on profiles (coach-mark gate)
ALTER TABLE public.profiles
  ADD COLUMN has_used_expand boolean NOT NULL DEFAULT false;

-- 5. Playback event log (drives chapter selection heuristic for the push)
CREATE TABLE public.playback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  timestamp_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playback_event_type_valid CHECK (event_type IN ('skip_back', 'skip_forward'))
);

CREATE INDEX idx_playback_events_podcast ON public.playback_events(podcast_id);
CREATE INDEX idx_playback_events_user ON public.playback_events(user_id);

ALTER TABLE public.playback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own playback events"
  ON public.playback_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own playback events"
  ON public.playback_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
