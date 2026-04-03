-- Ensure only one active deep dive session per user at a time
CREATE UNIQUE INDEX idx_qa_sessions_one_active_per_user
ON public.qa_sessions (user_id) WHERE ended_at IS NULL;
