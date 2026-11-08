-- DEOS schema: identity & access, content, per-user data, gamification.
-- Security (grants, RLS, functions) lives in 20261105000002_access.sql.

create extension if not exists pgcrypto;
create schema if not exists private;  -- never exposed through the Supabase API

-- =========================================================================
-- Identity & access
-- =========================================================================
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  display_name     text check (char_length(display_name) <= 80),
  timezone         text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  active_level     smallint check (active_level between 1 and 3),
  hours_per_topic  numeric(4,1) not null default 3 check (hours_per_topic between 0.5 and 40),
  hours_per_day    numeric(4,1) not null default 2 check (hours_per_day between 0.5 and 24),
  interview_date   date,
  email_reminders  boolean not null default true,
  onboarded_at     timestamptz,
  disabled_at      timestamptz,
  last_active_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

create table public.roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  is_admin   boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.level_grants (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  level       smallint not null check (level between 1 and 3),
  granted_by  uuid references public.profiles(id) on delete set null, -- null = onboarding/system
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,
  source      text not null default 'admin' check (source in ('onboarding','admin','request','bootstrap','import')),
  note        text check (char_length(note) <= 500),
  check (expires_at is null or expires_at > granted_at)
);
-- At most one non-revoked grant row per user and level (expired rows are revoked before regranting).
create unique index level_grants_one_open on public.level_grants (user_id, level) where revoked_at is null;
create index level_grants_user_idx on public.level_grants (user_id);

create type public.request_status as enum ('pending','approved','denied','cancelled');
create table public.level_requests (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  requested_level smallint not null check (requested_level between 1 and 3),
  status          public.request_status not null default 'pending',
  note            text check (char_length(note) <= 500),        -- user's reason
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text check (char_length(decision_note) <= 500),
  created_at      timestamptz not null default now()
);
create unique index level_requests_one_pending on public.level_requests (user_id, requested_level) where status = 'pending';

create table public.admin_audit_log (
  id              bigint generated always as identity primary key,
  actor_id        uuid,             -- null = system (e.g. ADMIN_EMAILS bootstrap); no FK so history survives deletions
  action          text not null,
  target_user_id  uuid,
  entity_type     text,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_user_id);

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Server-side config written only by the server with the service role (e.g. ADMIN_EMAILS).
create table private.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Postgres-backed rate limiter (no paid Redis): one row per key and window.
create table private.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

-- =========================================================================
-- Content (admin-editable, versioned)
-- =========================================================================
create table public.levels (
  level       smallint primary key check (level between 1 and 3),
  key         text not null unique,
  name        text not null,
  icon        text not null,
  description text not null
);

create table public.domains (
  slug       text primary key,
  name       text not null,
  icon       text not null,
  sort_order integer not null,
  archived_at timestamptz
);

create table public.modules (
  domain_slug text not null references public.domains(slug) on update cascade,
  slug        text not null,
  name        text not null,
  sort_order  integer not null,
  primary key (domain_slug, slug)
);

create table public.topics (
  id            text primary key,              -- 'databricks/acid' or 'custom/<uuid>'
  domain_slug   text not null references public.domains(slug) on update cascade,
  module_slug   text not null,
  slug          text not null,
  name          text not null check (char_length(name) <= 160),
  sort_order    integer not null default 0,
  min_level     smallint not null default 1 check (min_level between 1 and 3),
  pareto_levels smallint[] not null default '{}' check (pareto_levels <@ array[1,2,3]::smallint[]),
  owner_id      uuid references public.profiles(id) on delete cascade, -- non-null = a user's private custom topic
  provenance    jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  archived_at   timestamptz,
  updated_at    timestamptz not null default now(),
  foreign key (domain_slug, module_slug) references public.modules(domain_slug, slug) on update cascade,
  -- A topic can't be core for a level that can't see it.
  check (pareto_levels <@ (case min_level when 1 then '{1,2,3}' when 2 then '{2,3}' else '{3}' end)::smallint[])
);

create table public.subtopics (
  id          text primary key,               -- '<topic_id>#<slug>'
  topic_id    text not null references public.topics(id) on delete cascade on update cascade,
  slug        text not null,
  name        text not null,
  sort_order  integer not null,
  archived_at timestamptz,
  unique (topic_id, slug)
);

create table public.cards (
  id                 text primary key,
  deck               text not null,
  question           text not null,
  answer             text not null,
  topic_id           text not null references public.topics(id) on update cascade,
  min_level_override smallint check (min_level_override between 1 and 3), -- null = inherit topic.min_level
  sort_order         integer not null,
  version            integer not null default 1,
  archived_at        timestamptz,
  updated_at         timestamptz not null default now()
);

create table public.designs (
  id          text primary key,
  title       text not null,
  min_level   smallint not null check (min_level between 1 and 3),
  points      text[] not null,
  topic_ids   text[] not null default '{}',
  sort_order  integer not null,
  version     integer not null default 1,
  archived_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.sprint_blocks (
  id          text primary key,
  day         smallint not null,
  day_title   text not null,
  title       text not null,
  minutes     integer not null check (minutes > 0),
  min_level   smallint not null check (min_level between 1 and 3),
  topic_ids   text[] not null default '{}',
  sort_order  integer not null,
  version     integer not null default 1,
  archived_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.sprint_items (
  id          text primary key,
  block_id    text not null references public.sprint_blocks(id) on delete cascade on update cascade,
  text        text not null,
  min_level   smallint not null check (min_level between 1 and 3),
  sort_order  integer not null
);

-- Singleton documents: design framework, HackerRank module, gamification rules,
-- messages, settings, sprint intro. Each has its own min_level.
create table public.content_documents (
  key        text primary key,
  data       jsonb not null,
  min_level  smallint not null default 1 check (min_level between 1 and 3),
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

create table public.badges (
  id         text primary key,
  name       text not null,
  icon       text not null,
  rule       jsonb not null,
  sort_order integer not null
);

-- Append-only history of every content edit (seed loads and admin edits).
create table public.content_versions (
  id          bigint generated always as identity primary key,
  entity_type text not null,
  entity_id   text not null,
  version     integer not null,
  data        jsonb not null,
  edited_by   uuid,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id, version)
);

-- =========================================================================
-- Per-user data (keyed by topic, so progress is shared across levels and
-- survives revoking a level)
-- =========================================================================
create table public.topic_progress (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  topic_id        text not null references public.topics(id) on delete cascade on update cascade,
  status          smallint not null default 0 check (status between 0 and 2), -- 0 not started, 1 in progress, 2 done
  done_at         timestamptz,
  first_done_at   timestamptz,
  last_revised_at timestamptz,
  revision_cycle  integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table public.subtopic_progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  subtopic_id text not null references public.subtopics(id) on delete cascade on update cascade,
  done        boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, subtopic_id)
);

create table public.notes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id   text not null references public.topics(id) on delete cascade on update cascade,
  body_md    text not null default '' check (char_length(body_md) <= 100000),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- A user explicitly shares a topic's notes, links and attachments with admins.
create table public.topic_shares (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  topic_id  text not null references public.topics(id) on delete cascade on update cascade,
  shared_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  topic_id      text not null references public.topics(id) on delete cascade on update cascade,
  storage_path  text not null unique,
  thumb_path    text,
  mime_type     text not null,
  bytes         integer not null check (bytes > 0),
  original_name text not null check (char_length(original_name) <= 255),
  created_at    timestamptz not null default now()
);
create index attachments_user_idx on public.attachments (user_id, topic_id);

create table public.links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id   text not null references public.topics(id) on delete cascade on update cascade,
  kind       text not null check (kind in ('Link','Article','Video','Doc')),
  title      text check (char_length(title) <= 300),
  url        text check (url ~* '^https?://' and char_length(url) <= 2000),
  excerpt    text check (char_length(excerpt) <= 20000),
  created_at timestamptz not null default now(),
  check (coalesce(title, url, excerpt) is not null)
);
create index links_user_idx on public.links (user_id, topic_id);

create table public.bookmarks (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id   text not null references public.topics(id) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id   text references public.topics(id) on delete set null on update cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  minutes    integer check (minutes between 0 and 240),
  status     text not null default 'running' check (status in ('running','closed')),
  check ((status = 'running') = (ended_at is null))
);
create unique index study_sessions_one_running on public.study_sessions (user_id) where status = 'running';
create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);

create table public.revisions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id   text not null references public.topics(id) on delete cascade on update cascade,
  cycle      integer not null,
  was_due    boolean not null,
  revised_at timestamptz not null default now()
);
create index revisions_user_idx on public.revisions (user_id, revised_at desc);

create table public.sprint_progress (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_id    text not null references public.sprint_items(id) on delete cascade on update cascade,
  done       boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.card_mastery (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  card_id    text not null references public.cards(id) on delete cascade on update cascade,
  mastered   boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- =========================================================================
-- Gamification (written only by server-side functions)
-- =========================================================================
create table public.xp_events (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('topic_done','revision','note','attachment','study_minute')),
  points          integer not null check (points >= 0),
  idempotency_key text not null,
  ref             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)   -- the same action can never be counted twice
);

create table public.user_badges (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  badge_id   text not null references public.badges(id) on update cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- Per-user, per-local-day activity used for streaks and the 7-day chart.
create table public.activity_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,          -- in the user's profile timezone
  minutes integer not null default 0,
  events  integer not null default 0,
  primary key (user_id, day)
);

-- Denormalised totals for fast dashboards; maintained by server functions.
create table public.user_stats (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  xp             integer not null default 0,
  topics_done    integer not null default 0,
  study_minutes  integer not null default 0,
  revisions      integer not null default 0,
  notes          integer not null default 0,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  updated_at     timestamptz not null default now()
);
