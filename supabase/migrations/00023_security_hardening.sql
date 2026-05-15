-- 00023_security_hardening.sql
-- Two unrelated security fixes that ride together:
--
-- SEC-1: RevenueCat webhook replay protection. Track every processed
-- event_id; the webhook handler aborts on PK conflict so a retried or
-- replayed event can't double-grant credits.
--
-- SEC-2: rate limit /api/generate-questions to bound OpenAI cost from
-- a free-tier abuser. Per-user daily counter; reset when the stored
-- day != today.

CREATE TABLE public.webhook_events (
  event_id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'revenuecat',
  received_at timestamptz NOT NULL DEFAULT now()
);

-- service_role only (the webhook handler reads/writes here); no public RLS.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies = locked to service_role via the bypassrls grant.

ALTER TABLE public.profiles
  ADD COLUMN generate_questions_count int NOT NULL DEFAULT 0,
  ADD COLUMN generate_questions_day date;
