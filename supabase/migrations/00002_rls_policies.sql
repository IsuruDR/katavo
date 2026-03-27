-- 00002_rls_policies.sql
-- Row Level Security policies

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.podcasts enable row level security;
alter table public.research_contexts enable row level security;
alter table public.trusted_sources enable row level security;
alter table public.qa_sessions enable row level security;

-- Profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Subscriptions: users can read their own subscription
create policy "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Credit transactions: users can read their own
create policy "Users can view own transactions"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

-- Podcasts: users can read/soft-delete their own (not deleted)
create policy "Users can view own podcasts"
  on public.podcasts for select
  using (auth.uid() = user_id and deleted_at is null);

create policy "Users can soft-delete own podcasts"
  on public.podcasts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Research contexts: users can read for their own podcasts
create policy "Users can view own research contexts"
  on public.research_contexts for select
  using (
    exists (
      select 1 from public.podcasts
      where podcasts.id = research_contexts.podcast_id
        and podcasts.user_id = auth.uid()
    )
  );

-- Trusted sources: full CRUD on own sources
create policy "Users can view own trusted sources"
  on public.trusted_sources for select
  using (auth.uid() = user_id);

create policy "Users can create trusted sources"
  on public.trusted_sources for insert
  with check (auth.uid() = user_id);

create policy "Users can update own trusted sources"
  on public.trusted_sources for update
  using (auth.uid() = user_id);

create policy "Users can delete own trusted sources"
  on public.trusted_sources for delete
  using (auth.uid() = user_id);

-- QA sessions: users can read their own
create policy "Users can view own qa sessions"
  on public.qa_sessions for select
  using (auth.uid() = user_id);

create policy "Users can create qa sessions"
  on public.qa_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own qa sessions"
  on public.qa_sessions for update
  using (auth.uid() = user_id);
