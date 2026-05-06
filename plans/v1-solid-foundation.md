# Plan 1: Foundation — Supabase Backend & Project Scaffolding

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the complete Supabase backend (schema, auth, RLS, Edge Functions, triggers) and scaffold both the mobile app and pipeline projects so all subsequent plans have a working foundation to build on.

**Architecture:** Supabase handles auth, Postgres DB, file storage, real-time subscriptions, and serverless Edge Functions. The mobile app is a React Native Expo project. The pipeline is a TypeScript LangGraph.js project. This plan wires up the database, auth, and all Edge Functions that the pipeline and app depend on.

**Tech Stack:** Supabase (Postgres, Auth, Storage, Edge Functions, Realtime), React Native (Expo), TypeScript, LangGraph.js (@langchain/langgraph)

**Spec reference:** `docs/superpowers/specs/2026-03-27-ai-podcast-app-design.md`

---

## Project Structure

```
AI Podcast App/
├── mobile/                          # React Native Expo app
│   ├── app/                         # Expo Router screens (Plan 3)
│   ├── src/
│   │   ├── lib/
│   │   │   └── supabase.ts          # Supabase client init
│   │   └── types/
│   │       └── database.ts          # Generated DB types
│   ├── app.json
│   ├── tsconfig.json
│   └── package.json
├── pipeline/                        # LangGraph.js TypeScript project
│   ├── src/
│   │   └── podcast_pipeline/
│   │       └── graph.ts
│   ├── tests/
│   │   └── graph.test.ts
│   ├── langgraph.json
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── supabase/                        # Supabase local project
│   ├── migrations/
│   │   └── 00001_initial_schema.sql
│   ├── functions/
│   │   ├── generate-questions/
│   │   │   └── index.ts
│   │   ├── submit-podcast/
│   │   │   └── index.ts
│   │   ├── notify-complete/
│   │   │   └── index.ts
│   │   └── revenucat-webhook/
│   │       └── index.ts
│   ├── seed.sql
│   └── config.toml
├── docs/
└── plans/
```

---

## Chunk 1: Project Scaffolding

### Task 1: Initialize the monorepo and Supabase project

**Files:**
- Create: `supabase/config.toml`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize git repo**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git init
```

- [ ] **Step 2: Create .gitignore**

```gitignore
# Dependencies
node_modules/

# Environment
.env
.env.local
.env.*.local

# Build
dist/
build/

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Supabase
supabase/.temp/
supabase/.branches/

# Expo
mobile/.expo/
mobile/ios/
mobile/android/

# Superpowers
.superpowers/
```

- [ ] **Step 3: Create root .env.example**

```env
# Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI
OPENAI_API_KEY=your-openai-key

# Google Cloud TTS
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json

# ElevenLabs
ELEVENLABS_API_KEY=your-elevenlabs-key

# RevenueCat
REVENUCAT_WEBHOOK_SECRET=your-revenucat-secret

# Expo Push
EXPO_ACCESS_TOKEN=your-expo-token

# LangGraph Cloud
LANGGRAPH_API_KEY=your-langgraph-key
LANGGRAPH_API_URL=your-langgraph-url
LANGSMITH_API_KEY=your-langsmith-key
```

- [ ] **Step 4: Initialize Supabase project**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase init
```

Expected: creates `supabase/` directory with `config.toml`

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example supabase/config.toml
git commit -m "chore: initialize monorepo with Supabase project"
```

### Task 2: Scaffold the Expo mobile app

**Files:**
- Create: `mobile/` (Expo scaffolding)
- Create: `mobile/src/lib/supabase.ts`
- Create: `mobile/src/types/database.ts`

- [ ] **Step 1: Create Expo app**

```bash
cd "/Users/isuru/personal/AI Podcast App"
npx create-expo-app@latest mobile --template blank-typescript
```

- [ ] **Step 2: Install core dependencies**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile"
npx expo install @supabase/supabase-js react-native-url-polyfill @react-native-async-storage/async-storage
npx expo install expo-notifications expo-device expo-constants
npm install react-native-track-player
```

- [ ] **Step 3: Create Supabase client**

Create `mobile/src/lib/supabase.ts`:

```typescript
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 4: Create placeholder database types**

Create `mobile/src/types/database.ts`:

```typescript
// Auto-generated types will replace this file.
// Run: supabase gen types typescript --local > src/types/database.ts
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git add mobile/
git commit -m "chore: scaffold Expo mobile app with Supabase client"
```

### Task 3: Scaffold the TypeScript LangGraph.js pipeline project

**Files:**
- Create: `pipeline/package.json`
- Create: `pipeline/tsconfig.json`
- Create: `pipeline/langgraph.json`
- Create: `pipeline/.env.example`
- Create: `pipeline/src/podcast_pipeline/graph.ts`
- Create: `pipeline/tests/graph.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "podcast-pipeline",
  "version": "0.1.0",
  "private": true,
  "description": "LangGraph.js pipeline for AI podcast generation",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/podcast_pipeline/graph.ts"
  },
  "dependencies": {
    "@langchain/langgraph": "^0.2.0",
    "@langchain/core": "^0.3.0",
    "@langchain/openai": "^0.3.0",
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "overrides": {
    "@langchain/core": "^0.3.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create langgraph.json**

```json
{
  "node_version": "20",
  "dependencies": ["."],
  "graphs": {
    "podcast_pipeline": "./src/podcast_pipeline/graph.ts:graph"
  },
  "env": ".env"
}
```

- [ ] **Step 4: Create pipeline .env.example**

```env
OPENAI_API_KEY=your-openai-key
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LANGSMITH_API_KEY=your-langsmith-key
```

- [ ] **Step 5: Create placeholder graph and test files**

Create `pipeline/src/podcast_pipeline/graph.ts`:

```typescript
/**
 * AI Podcast Generation Pipeline — LangGraph.js orchestration.
 * Placeholder graph to be implemented in Plan 2.
 */
import { Annotation, StateGraph } from "@langchain/langgraph";

const PipelineState = Annotation.Root({
  podcastId: Annotation<string>,
  userId: Annotation<string>,
  topic: Annotation<string>,
  clarifyingAnswers: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  hasAds: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => true,
  }),
  trustedSourceUrls: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  tier: Annotation<string>,
  status: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "queued",
  }),
});

function placeholder(state: typeof PipelineState.State) {
  return { status: "complete" };
}

const builder = new StateGraph(PipelineState)
  .addNode("placeholder", placeholder)
  .addEdge("__start__", "placeholder")
  .addEdge("placeholder", "__end__");

export const graph = builder.compile();
```

Create `pipeline/tests/graph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { graph } from "../src/podcast_pipeline/graph.js";

describe("podcast pipeline graph", () => {
  it("should compile and run placeholder graph", async () => {
    const result = await graph.invoke({
      podcastId: "test-id",
      userId: "test-user",
      topic: "test topic",
      tier: "free",
    });
    expect(result.status).toBe("complete");
  });
});
```

- [ ] **Step 6: Install dependencies**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline"
npm install
```

- [ ] **Step 7: Run test to verify scaffold works**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline"
npm test
```

Expected: 1 test passing.

- [ ] **Step 8: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git add pipeline/
git commit -m "chore: scaffold TypeScript LangGraph.js pipeline project"
```

---

## Chunk 2: Database Schema & Migrations

### Task 4: Write the initial migration with all tables

**Files:**
- Create: `supabase/migrations/00001_initial_schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 00001_initial_schema.sql
-- AI Podcast App — initial database schema

-- Enable required extensions
create extension if not exists "uuid-ossp";

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
  id uuid primary key default uuid_generate_v4(),
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
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type credit_transaction_type not null,
  amount integer not null, -- positive for additions, negative for deductions
  price_paid numeric(10,2), -- nullable, for purchases
  podcast_id uuid, -- FK added after podcasts table created
  created_at timestamptz default now() not null
);

-- Podcasts
create table public.podcasts (
  id uuid primary key default uuid_generate_v4(),
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
  id uuid primary key default uuid_generate_v4(),
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
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  urls jsonb not null default '[]',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- QA sessions
create table public.qa_sessions (
  id uuid primary key default uuid_generate_v4(),
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
```

- [ ] **Step 2: Apply migration locally**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase start
supabase db reset
```

Expected: All tables created successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00001_initial_schema.sql
git commit -m "feat: add initial database schema with all tables"
```

### Task 5: Add Row-Level Security policies

**Files:**
- Create: `supabase/migrations/00002_rls_policies.sql`

- [ ] **Step 1: Create RLS migration**

```sql
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
```

- [ ] **Step 2: Apply migration**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase db reset
```

Expected: RLS policies applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00002_rls_policies.sql
git commit -m "feat: add Row-Level Security policies for all tables"
```

### Task 6: Add auto-profile creation and refund triggers

**Files:**
- Create: `supabase/migrations/00003_triggers.sql`

- [ ] **Step 1: Create triggers migration**

```sql
-- 00003_triggers.sql
-- Database triggers for business logic

-- Auto-create profile + free subscription on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));

  insert into public.subscriptions (user_id, tier, status, credits_per_month, credits_remaining)
  values (new.id, 'free', 'active', 1, 1);

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-refund credit on podcast generation failure
create or replace function public.handle_podcast_failure()
returns trigger as $$
begin
  if new.status = 'failed' and old.status != 'failed' then
    -- Insert refund transaction
    insert into public.credit_transactions (user_id, type, amount, podcast_id)
    values (new.user_id, 'refund', 1, new.id);

    -- Increment credits remaining
    update public.subscriptions
    set credits_remaining = credits_remaining + 1
    where user_id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_podcast_status_failed
  after update of status on public.podcasts
  for each row execute function public.handle_podcast_failure();
```

- [ ] **Step 2: Apply migration**

```bash
supabase db reset
```

Expected: Triggers created. When a user signs up, profile + free subscription are auto-created. When a podcast status changes to `failed`, credit is auto-refunded.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00003_triggers.sql
git commit -m "feat: add user signup and podcast failure triggers"
```

### Task 7: Create Supabase storage bucket for audio

**Files:**
- Create: `supabase/migrations/00004_storage.sql`

- [ ] **Step 1: Create storage migration**

```sql
-- 00004_storage.sql
-- Storage bucket for podcast audio files

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'podcast-audio',
  'podcast-audio',
  false,
  52428800, -- 50MB max
  array['audio/mpeg', 'audio/mp3', 'audio/wav']
);

-- Users can read their own audio files
create policy "Users can read own audio"
  on storage.objects for select
  using (
    bucket_id = 'podcast-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Service role can insert audio (pipeline writes via service key)
-- No insert policy for users — only the pipeline writes audio
```

- [ ] **Step 2: Apply migration**

```bash
supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00004_storage.sql
git commit -m "feat: add podcast-audio storage bucket with RLS"
```

---

## Chunk 3: Edge Functions

### Task 8: Create the generate-questions Edge Function

**Files:**
- Create: `supabase/functions/generate-questions/index.ts`

- [ ] **Step 1: Create function**

```typescript
// supabase/functions/generate-questions/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const MODERATION_BLOCKLIST = [
  // Content moderation patterns — expand before App Store submission
  "how to make a bomb",
  "how to harm",
  // Add more patterns as needed
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Topic is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Content moderation — input filtering
    const lowerTopic = topic.toLowerCase();
    for (const pattern of MODERATION_BLOCKLIST) {
      if (lowerTopic.includes(pattern)) {
        return new Response(
          JSON.stringify({ error: "This topic is not supported. Please try a different topic." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Call OpenAI to generate clarifying questions
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are helping a user create a personalized podcast on a topic they've chosen. Generate exactly 2-3 short, focused clarifying questions to understand what angle, depth, and specific aspects they want covered. Return a JSON array of strings. Example: ["What specific aspect interests you most?", "What's your familiarity level with this topic?"]`,
          },
          {
            role: "user",
            content: `Topic: ${topic}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
    });

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    const questions = content.questions || content;

    return new Response(
      JSON.stringify({ questions }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to generate questions" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Test locally**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase functions serve generate-questions --env-file .env
```

In another terminal:
```bash
curl -X POST http://localhost:54321/functions/v1/generate-questions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"topic": "quantum computing in drug discovery"}'
```

Expected: JSON response with 2-3 clarifying questions.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-questions/
git commit -m "feat: add generate-questions Edge Function with content moderation"
```

### Task 9: Create the submit-podcast Edge Function

**Files:**
- Create: `supabase/functions/submit-podcast/index.ts`

- [ ] **Step 1: Create function**

```typescript
// supabase/functions/submit-podcast/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LANGGRAPH_API_URL = Deno.env.get("LANGGRAPH_API_URL")!;
const LANGGRAPH_API_KEY = Deno.env.get("LANGGRAPH_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { topic, clarifying_answers, trusted_source_id } = await req.json();

    // Service client for privileged operations
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check subscription and credits
    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subscription || subscription.credits_remaining < 1) {
      return new Response(
        JSON.stringify({ error: "No credits remaining. Purchase more credits to continue." }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check concurrent generation limit
    const tierLimits: Record<string, number> = { free: 1, plus: 2, pro: 3 };
    const maxConcurrent = tierLimits[subscription.tier] || 1;

    const { count } = await serviceClient
      .from("podcasts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "researching", "fact_checking", "scripting", "generating_audio"]);

    if ((count || 0) >= maxConcurrent) {
      return new Response(
        JSON.stringify({ error: `Maximum ${maxConcurrent} concurrent generations allowed. Please wait for current podcasts to finish.` }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // Determine if podcast has ads (free tier only)
    const hasAds = subscription.tier === "free";

    // Deduct credit
    await serviceClient
      .from("subscriptions")
      .update({ credits_remaining: subscription.credits_remaining - 1 })
      .eq("user_id", user.id);

    // Create podcast record
    const { data: podcast, error: insertError } = await serviceClient
      .from("podcasts")
      .insert({
        user_id: user.id,
        topic,
        clarifying_answers: clarifying_answers || [],
        status: "queued",
        has_ads: hasAds,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Record credit deduction
    await serviceClient
      .from("credit_transactions")
      .insert({
        user_id: user.id,
        type: "deduction",
        amount: -1,
        podcast_id: podcast.id,
      });

    // Load trusted sources if specified
    let trustedSourceUrls: string[] = [];
    if (trusted_source_id && subscription.tier === "pro") {
      const { data: sources } = await serviceClient
        .from("trusted_sources")
        .select("urls")
        .eq("id", trusted_source_id)
        .eq("user_id", user.id)
        .single();
      if (sources) {
        trustedSourceUrls = sources.urls.map((s: { url: string }) => s.url);
      }
    }

    // Dispatch to LangGraph Cloud
    const lgResponse = await fetch(`${LANGGRAPH_API_URL}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": LANGGRAPH_API_KEY,
      },
      body: JSON.stringify({
        assistant_id: "podcast_pipeline",
        input: {
          podcast_id: podcast.id,
          user_id: user.id,
          topic,
          clarifying_answers: clarifying_answers || [],
          has_ads: hasAds,
          trusted_source_urls: trustedSourceUrls,
          tier: subscription.tier,
        },
      }),
    });

    const lgData = await lgResponse.json();

    // Store LangGraph run ID
    await serviceClient
      .from("podcasts")
      .update({ langgraph_run_id: lgData.run_id })
      .eq("id", podcast.id);

    return new Response(
      JSON.stringify({ podcast_id: podcast.id, status: "queued" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to submit podcast" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/submit-podcast/
git commit -m "feat: add submit-podcast Edge Function with credit validation and LangGraph dispatch"
```

### Task 10: Create the notify-complete Edge Function

**Files:**
- Create: `supabase/functions/notify-complete/index.ts`

- [ ] **Step 1: Create function**

```typescript
// supabase/functions/notify-complete/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN")!;

serve(async (req) => {
  try {
    const { podcast_id, status, error_message } = await req.json();

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get podcast and user's push token
    const { data: podcast } = await serviceClient
      .from("podcasts")
      .select("user_id, topic")
      .eq("id", podcast_id)
      .single();

    if (!podcast) {
      return new Response(
        JSON.stringify({ error: "Podcast not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("expo_push_token")
      .eq("id", podcast.user_id)
      .single();

    if (!profile?.expo_push_token) {
      return new Response(
        JSON.stringify({ message: "No push token, skipping notification" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Send push notification
    const title = status === "complete"
      ? "Your podcast is ready!"
      : "Podcast generation failed";
    const body = status === "complete"
      ? `"${podcast.topic}" is ready to listen.`
      : `"${podcast.topic}" failed. Your credit has been refunded.`;

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${EXPO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: profile.expo_push_token,
        title,
        body,
        data: { podcast_id, status },
        sound: "default",
      }),
    });

    return new Response(
      JSON.stringify({ message: "Notification sent" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/notify-complete/
git commit -m "feat: add notify-complete Edge Function for push notifications"
```

### Task 11: Create the RevenueCat webhook Edge Function

**Files:**
- Create: `supabase/functions/revenucat-webhook/index.ts`

- [ ] **Step 1: Create function**

```typescript
// supabase/functions/revenucat-webhook/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REVENUCAT_WEBHOOK_SECRET = Deno.env.get("REVENUCAT_WEBHOOK_SECRET")!;

const TIER_CREDITS: Record<string, { tier: string; credits: number }> = {
  "plus_monthly": { tier: "plus", credits: 8 },
  "plus_annual": { tier: "plus", credits: 8 },
  "pro_monthly": { tier: "pro", credits: 20 },
  "pro_annual": { tier: "pro", credits: 20 },
};

serve(async (req) => {
  try {
    // Verify webhook signature
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${REVENUCAT_WEBHOOK_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const event = await req.json();
    const { type, app_user_id, product_id, expiration_at_ms } = event.event;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userId = app_user_id; // RevenueCat app_user_id maps to our auth.users.id

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        const config = TIER_CREDITS[product_id];
        if (!config) break;

        await serviceClient
          .from("subscriptions")
          .update({
            tier: config.tier,
            status: "active",
            credits_per_month: config.credits,
            credits_remaining: config.credits, // Reset on renewal
            renewal_date: expiration_at_ms
              ? new Date(expiration_at_ms).toISOString()
              : null,
            revenucat_subscription_id: event.event.id,
          })
          .eq("user_id", userId);

        // Record credit allocation
        await serviceClient
          .from("credit_transactions")
          .insert({
            user_id: userId,
            type: "allocation",
            amount: config.credits,
          });
        break;
      }

      case "CANCELLATION": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("user_id", userId);
        break;
      }

      case "BILLING_ISSUE": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "billing_issue" })
          .eq("user_id", userId);
        break;
      }

      case "EXPIRATION": {
        await serviceClient
          .from("subscriptions")
          .update({
            tier: "free",
            status: "active",
            credits_per_month: 1,
            credits_remaining: 1,
            revenucat_subscription_id: null,
          })
          .eq("user_id", userId);
        break;
      }

      case "PRODUCT_CHANGE": {
        const config = TIER_CREDITS[product_id];
        if (!config) break;

        // Get current subscription to check upgrade vs downgrade
        const { data: current } = await serviceClient
          .from("subscriptions")
          .select("tier")
          .eq("user_id", userId)
          .single();

        const tierRank: Record<string, number> = { free: 0, plus: 1, pro: 2 };
        const isUpgrade = tierRank[config.tier] > tierRank[current?.tier || "free"];

        if (isUpgrade) {
          // Immediate upgrade
          await serviceClient
            .from("subscriptions")
            .update({
              tier: config.tier,
              credits_per_month: config.credits,
              credits_remaining: config.credits,
            })
            .eq("user_id", userId);
        }
        // Downgrade takes effect at next renewal (handled by RENEWAL event)
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/revenucat-webhook/
git commit -m "feat: add RevenueCat webhook Edge Function for subscription management"
```

---

## Chunk 4: Generate Database Types & Seed Data

### Task 12: Generate TypeScript types and create seed data

**Files:**
- Modify: `mobile/src/types/database.ts`
- Create: `supabase/seed.sql`

- [ ] **Step 1: Generate types**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase gen types typescript --local > mobile/src/types/database.ts
```

- [ ] **Step 2: Create seed data for local development**

```sql
-- supabase/seed.sql
-- Seed data for local development

-- Create a test user (password: testpassword123)
-- Note: In local dev, use Supabase dashboard or auth API to create users.
-- The handle_new_user trigger will auto-create profile + subscription.

-- Sample trusted sources for testing
-- (Insert after creating a test user via the auth API)
```

- [ ] **Step 3: Verify the full setup**

```bash
cd "/Users/isuru/personal/AI Podcast App"
supabase db reset
supabase functions serve --env-file .env
```

In Supabase Studio (http://localhost:54323), verify:
1. All 7 tables exist with correct columns
2. RLS is enabled on all tables
3. Storage bucket `podcast-audio` exists
4. Edge Functions are listed

- [ ] **Step 4: Commit**

```bash
git add mobile/src/types/database.ts supabase/seed.sql
git commit -m "feat: generate database types and add seed data"
```

---

## Summary

After completing this plan, you will have:
- Git repo initialized with monorepo structure
- Expo mobile app scaffolded with Supabase client
- TypeScript LangGraph.js pipeline project scaffolded with placeholder graph and passing test
- Complete Postgres schema (7 tables, enums, indexes)
- RLS policies on all tables
- Auto-profile + auto-subscription trigger on user signup
- Auto-refund trigger on podcast failure
- Storage bucket for podcast audio
- 4 Edge Functions: generate-questions, submit-podcast, notify-complete, revenucat-webhook
- Generated TypeScript database types

**Next:** Plan 2 (Pipeline) builds the LangGraph.js research-to-podcast pipeline in TypeScript on top of this foundation.
