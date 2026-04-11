-- 00001_initial_schema.sql
-- AI Podcast App — initial database schema

-- gen_random_uuid() is built-in since PostgreSQL 13, no extension needed

-- Enums
create type subscription_tier as enum ('free', 'plus', 'pro');
create type subscription_status as enum ('active', 'cancelled', 'expired', 'billing_issue');
create type billing_period as enum ('monthly', 'annual');
create type credit_transaction_type as enum ('allocation', 'purchase', 'deduction', 'refund');
create type podcast_status as enum (
  'queued', 'researching', 'fact_checking', 'scripting',
  'generating_audio', 'complete', 'failed'
);

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  notification_preferences jsonb default '{}',
  expo_push_token text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Subscriptions
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier subscription_tier not null default 'free',
  status subscription_status not null default 'active',
  billing_period billing_period default 'monthly',
  credits_per_month integer not null default 1,
  credits_remaining integer not null default 1,
  renewal_date timestamptz,
  revenucat_subscription_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint one_subscription_per_user unique (user_id)
);

-- Credit transactions (ledger)
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type credit_transaction_type not null,
  amount integer not null, -- positive for additions, negative for deductions
  price_paid numeric(10,2), -- nullable, for purchases
  podcast_id uuid, -- FK added after podcasts table created
  created_at timestamptz default now() not null
);

-- Podcasts
create table public.podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  clarifying_answers jsonb default '[]',
  status podcast_status not null default 'queued',
  error_message text,
  audio_url text,
  transcript text,
  duration_seconds integer,
  chapter_markers jsonb default '[]',
  has_ads boolean not null default true,
  langgraph_run_id text,
  created_at timestamptz default now() not null,
  deleted_at timestamptz
);

-- Add FK from credit_transactions to podcasts
alter table public.credit_transactions
  add constraint fk_credit_transactions_podcast
  foreign key (podcast_id) references public.podcasts(id) on delete set null;

-- Research contexts
create table public.research_contexts (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references public.podcasts(id) on delete cascade,
  research_document jsonb not null default '{}',
  sources jsonb not null default '[]',
  overall_credibility_score real,
  research_iterations integer not null default 1,
  created_at timestamptz default now() not null,
  constraint one_context_per_podcast unique (podcast_id)
);

-- Trusted sources
create table public.trusted_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  urls jsonb not null default '[]',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- QA sessions
create table public.qa_sessions (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references public.podcasts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  elevenlabs_session_id text,
  estimated_cost numeric(10,4),
  created_at timestamptz default now() not null
);

-- Indexes
create index idx_podcasts_user_id on public.podcasts(user_id);
create index idx_podcasts_status on public.podcasts(status);
create index idx_podcasts_user_not_deleted on public.podcasts(user_id) where deleted_at is null;
create index idx_credit_transactions_user_id on public.credit_transactions(user_id);
create index idx_trusted_sources_user_id on public.trusted_sources(user_id);
create index idx_qa_sessions_user_podcast on public.qa_sessions(user_id, podcast_id);

-- Updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.handle_updated_at();

create trigger set_trusted_sources_updated_at
  before update on public.trusted_sources
  for each row execute function public.handle_updated_at();
