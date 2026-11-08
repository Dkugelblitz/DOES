-- DEOS access control. Principles:
--  * Supabase grants ALL on public tables to anon/authenticated by default, so we revoke
--    everything and grant back only what each role needs (column-level where it matters).
--  * Every table has RLS. Users read/write only their own rows; admins get read access
--    to progress-type data, never to private note text/links/attachments unless shared.
--  * Level access is computed from level_grants on every query (never from the JWT).
--  * Disabled accounts resolve to "no user": they see and can change nothing.

-- Postgres grants EXECUTE on every new function to PUBLIC by default. Turn that off for
-- functions created by the migration role, so each function must be granted explicitly.
alter default privileges revoke execute on functions from public;

-- =========================================================================
-- Helper functions (private schema; SECURITY DEFINER with empty search_path)
-- =========================================================================
create or replace function private.active_uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.id = auth.uid() and p.disabled_at is null
$$;

create or replace function private.is_admin(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roles r join public.profiles p on p.id = r.user_id
    where r.user_id = p_uid and r.is_admin and p.disabled_at is null)
$$;

-- Levels the user currently holds. Admins hold all three. Disabled users hold none.
create or replace function private.held_levels(p_uid uuid default auth.uid()) returns smallint[]
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.profiles p where p.id = p_uid and p.disabled_at is null) then '{}'::smallint[]
    when private.is_admin(p_uid) then '{1,2,3}'::smallint[]
    else coalesce((
      select array_agg(distinct g.level order by g.level) from public.level_grants g
      where g.user_id = p_uid and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    ), '{}'::smallint[])
  end
$$;

-- Roadmaps nest: holding level N shows every topic with min_level <= N.
create or replace function private.max_level(p_uid uuid default auth.uid()) returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(l) from unnest(private.held_levels(p_uid)) l), 0)::smallint
$$;

create or replace function private.topic_visible(p_topic_id text, p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.topics t
    where t.id = p_topic_id and t.archived_at is null
      and ((t.owner_id is null and t.min_level <= private.max_level(p_uid)) or (t.owner_id = p_uid and private.active_uid() = p_uid)))
$$;

create or replace function private.subtopic_visible(p_subtopic_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subtopics s where s.id = p_subtopic_id and s.archived_at is null and private.topic_visible(s.topic_id))
$$;

create or replace function private.card_level(p_card_id text) returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce(c.min_level_override, t.min_level) from public.cards c join public.topics t on t.id = c.topic_id where c.id = p_card_id
$$;

create or replace function private.sprint_item_visible(p_item_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sprint_items i join public.sprint_blocks b on b.id = i.block_id
    where i.id = p_item_id and b.archived_at is null and b.min_level <= private.max_level() and i.min_level <= private.max_level())
$$;

create or replace function private.topic_shared(p_user uuid, p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.topic_shares s where s.user_id = p_user and s.topic_id = p_topic)
$$;

-- Fixed-window rate limiter. Returns true if the call is allowed.
create or replace function private.rate_limit(p_bucket text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); v_hits integer;
begin
  insert into private.rate_limits as r (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_max;
end $$;

-- Raise a standard "forbidden" error unless the caller is an admin.
create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;

-- =========================================================================
-- Table privileges: start from nothing
-- =========================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
revoke all on all tables in schema private from anon, authenticated, service_role;

-- Identity & access (writes go through SECURITY DEFINER functions)
grant select on public.profiles to authenticated;
grant update (display_name, timezone, hours_per_topic, hours_per_day, interview_date, email_reminders) on public.profiles to authenticated;
grant select on public.roles, public.level_grants, public.level_requests to authenticated;
grant select on public.admin_audit_log to authenticated;      -- RLS: admins only
grant select, update (read_at) on public.notifications to authenticated;

-- Content: read-only for users. Pareto flags are NOT directly readable (see my_topic_flags()).
grant select on public.levels, public.domains, public.modules, public.badges to authenticated;
grant select (id, domain_slug, module_slug, slug, name, sort_order, min_level, owner_id, archived_at, updated_at) on public.topics to authenticated;
grant select on public.subtopics, public.cards, public.designs, public.sprint_blocks, public.sprint_items, public.content_documents to authenticated;
grant select on public.content_versions to authenticated;     -- RLS: admins only

-- Per-user data the user edits directly (bounded by RLS + triggers)
grant select, insert (user_id, topic_id, status), update (status) on public.topic_progress to authenticated;
grant select, insert, update (done), delete on public.subtopic_progress to authenticated;
grant select, insert (user_id, topic_id, body_md), update (body_md), delete on public.notes to authenticated;
grant select, insert (user_id, topic_id), delete on public.topic_shares to authenticated;
grant select, insert (user_id, topic_id, storage_path, thumb_path, mime_type, bytes, original_name), delete on public.attachments to authenticated;
grant select, insert (user_id, topic_id, kind, title, url, excerpt), update (kind, title, url, excerpt), delete on public.links to authenticated;
grant select, insert (user_id, topic_id), delete on public.bookmarks to authenticated;
grant select, insert, update (done), delete on public.sprint_progress to authenticated;
grant select, insert, update (mastered), delete on public.card_mastery to authenticated;

-- Server-computed data: read-only for users
grant select on public.study_sessions, public.revisions, public.xp_events, public.user_badges, public.activity_days, public.user_stats to authenticated;

-- =========================================================================
-- Row-level security
-- =========================================================================
do $$ declare t text; begin
  foreach t in array array['profiles','roles','level_grants','level_requests','admin_audit_log','notifications','levels','domains','modules',
    'topics','subtopics','cards','designs','sprint_blocks','sprint_items','content_documents','badges','content_versions','topic_progress',
    'subtopic_progress','notes','topic_shares','attachments','links','bookmarks','study_sessions','revisions','sprint_progress','card_mastery',
    'xp_events','user_badges','activity_days','user_stats'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Identity & access
create policy profiles_read on public.profiles for select to authenticated using (id = (select private.active_uid()) or (select private.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select private.active_uid())) with check (id = (select private.active_uid()));
create policy roles_read on public.roles for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy grants_read on public.level_grants for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy requests_read on public.level_requests for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy audit_read on public.admin_audit_log for select to authenticated using ((select private.is_admin()));
create policy notifications_own on public.notifications for select to authenticated using (user_id = (select private.active_uid()));
create policy notifications_mark_read on public.notifications for update to authenticated using (user_id = (select private.active_uid())) with check (user_id = (select private.active_uid()));

-- Content gated by level
create policy levels_read on public.levels for select to authenticated using ((select private.active_uid()) is not null);
create policy domains_read on public.domains for select to authenticated using ((select private.active_uid()) is not null and archived_at is null);
create policy modules_read on public.modules for select to authenticated using ((select private.active_uid()) is not null);
create policy badges_read on public.badges for select to authenticated using ((select private.active_uid()) is not null);
create policy topics_read on public.topics for select to authenticated using (archived_at is null and (
  (owner_id is null and min_level <= (select private.max_level())) or owner_id = (select private.active_uid())));
create policy subtopics_read on public.subtopics for select to authenticated using (archived_at is null and private.topic_visible(topic_id));
create policy cards_read on public.cards for select to authenticated using (archived_at is null and private.card_level(id) <= (select private.max_level()));
create policy designs_read on public.designs for select to authenticated using (archived_at is null and min_level <= (select private.max_level()));
create policy sprint_blocks_read on public.sprint_blocks for select to authenticated using (archived_at is null and min_level <= (select private.max_level()));
create policy sprint_items_read on public.sprint_items for select to authenticated using (private.sprint_item_visible(id));
-- Gamification rules, messages and settings are needed by every signed-in user (min_level 1);
-- higher-level documents are gated like any other content.
create policy documents_read on public.content_documents for select to authenticated using (min_level <= (select private.max_level()));
create policy versions_read on public.content_versions for select to authenticated using ((select private.is_admin()));

-- Progress-type data: owner reads/writes; admins may read (per-user detail view).
create policy progress_read on public.topic_progress for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy progress_insert on public.topic_progress for insert to authenticated with check (user_id = (select private.active_uid()) and private.topic_visible(topic_id));
create policy progress_update on public.topic_progress for update to authenticated using (user_id = (select private.active_uid()) and private.topic_visible(topic_id)) with check (user_id = (select private.active_uid()));

create policy subprogress_read on public.subtopic_progress for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy subprogress_write on public.subtopic_progress for insert to authenticated with check (user_id = (select private.active_uid()) and private.subtopic_visible(subtopic_id));
create policy subprogress_update on public.subtopic_progress for update to authenticated using (user_id = (select private.active_uid()) and private.subtopic_visible(subtopic_id)) with check (user_id = (select private.active_uid()));
create policy subprogress_delete on public.subtopic_progress for delete to authenticated using (user_id = (select private.active_uid()));

-- Private material: owner only; admins only for topics the owner has shared.
create policy notes_read on public.notes for select to authenticated using (user_id = (select private.active_uid()) or ((select private.is_admin()) and private.topic_shared(user_id, topic_id)));
create policy notes_insert on public.notes for insert to authenticated with check (user_id = (select private.active_uid()) and private.topic_visible(topic_id));
create policy notes_update on public.notes for update to authenticated using (user_id = (select private.active_uid())) with check (user_id = (select private.active_uid()));
create policy notes_delete on public.notes for delete to authenticated using (user_id = (select private.active_uid()));

create policy shares_read on public.topic_shares for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy shares_insert on public.topic_shares for insert to authenticated with check (user_id = (select private.active_uid()) and private.topic_visible(topic_id));
create policy shares_delete on public.topic_shares for delete to authenticated using (user_id = (select private.active_uid()));

create policy attachments_read on public.attachments for select to authenticated using (user_id = (select private.active_uid()) or ((select private.is_admin()) and private.topic_shared(user_id, topic_id)));
create policy attachments_insert on public.attachments for insert to authenticated with check (
  user_id = (select private.active_uid()) and private.topic_visible(topic_id) and storage_path like user_id::text || '/%');
create policy attachments_delete on public.attachments for delete to authenticated using (user_id = (select private.active_uid()));

create policy links_read on public.links for select to authenticated using (user_id = (select private.active_uid()) or ((select private.is_admin()) and private.topic_shared(user_id, topic_id)));
create policy links_insert on public.links for insert to authenticated with check (user_id = (select private.active_uid()) and private.topic_visible(topic_id));
create policy links_update on public.links for update to authenticated using (user_id = (select private.active_uid())) with check (user_id = (select private.active_uid()));
create policy links_delete on public.links for delete to authenticated using (user_id = (select private.active_uid()));

-- Bookmarks, sprint checklist and card mastery: owner only.
create policy bookmarks_own on public.bookmarks for select to authenticated using (user_id = (select private.active_uid()));
create policy bookmarks_insert on public.bookmarks for insert to authenticated with check (user_id = (select private.active_uid()) and private.topic_visible(topic_id));
create policy bookmarks_delete on public.bookmarks for delete to authenticated using (user_id = (select private.active_uid()));
create policy sprint_own on public.sprint_progress for select to authenticated using (user_id = (select private.active_uid()));
create policy sprint_insert on public.sprint_progress for insert to authenticated with check (user_id = (select private.active_uid()) and private.sprint_item_visible(item_id));
create policy sprint_update on public.sprint_progress for update to authenticated using (user_id = (select private.active_uid()) and private.sprint_item_visible(item_id)) with check (user_id = (select private.active_uid()));
create policy sprint_delete on public.sprint_progress for delete to authenticated using (user_id = (select private.active_uid()));
create policy mastery_own on public.card_mastery for select to authenticated using (user_id = (select private.active_uid()));
create policy mastery_insert on public.card_mastery for insert to authenticated with check (user_id = (select private.active_uid()) and private.card_level(card_id) <= (select private.max_level()));
create policy mastery_update on public.card_mastery for update to authenticated using (user_id = (select private.active_uid()) and private.card_level(card_id) <= (select private.max_level())) with check (user_id = (select private.active_uid()));
create policy mastery_delete on public.card_mastery for delete to authenticated using (user_id = (select private.active_uid()));

-- Server-computed: owner and admins read; nobody writes directly.
create policy sessions_read on public.study_sessions for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy revisions_read on public.revisions for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy xp_read on public.xp_events for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy user_badges_read on public.user_badges for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy activity_read on public.activity_days for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));
create policy stats_read on public.user_stats for select to authenticated using (user_id = (select private.active_uid()) or (select private.is_admin()));

-- =========================================================================
-- Append-only audit log and content history (blocks even the table owner)
-- =========================================================================
create or replace function private.forbid_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger audit_no_update before update or delete on public.admin_audit_log for each row execute function private.forbid_change();
create trigger audit_no_truncate before truncate on public.admin_audit_log for each statement execute function private.forbid_change();
create trigger versions_no_update before update or delete on public.content_versions for each row execute function private.forbid_change();
create trigger versions_no_truncate before truncate on public.content_versions for each statement execute function private.forbid_change();

-- =========================================================================
-- Data-integrity triggers on user-writable tables
-- =========================================================================
-- Server sets done timestamps; clients only send status.
create or replace function private.progress_timestamps() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 2 and (tg_op = 'INSERT' or old.status is distinct from 2) then
    new.done_at := now();
    new.first_done_at := coalesce(case when tg_op = 'UPDATE' then old.first_done_at end, now());
  elsif new.status <> 2 then
    new.done_at := null;
  end if;
  return new;
end $$;
create trigger topic_progress_timestamps before insert or update on public.topic_progress for each row execute function private.progress_timestamps();

-- Upload type and per-user quota come from the settings document (data-driven).
create or replace function private.check_attachment() returns trigger language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_used bigint;
begin
  select data -> 'uploads' into s from public.content_documents where key = 'settings';
  if s is null then raise exception 'upload settings missing'; end if;
  if not (s -> 'allowed_types') ? new.mime_type then
    raise exception 'file type % not allowed', new.mime_type using errcode = '22023';
  end if;
  if new.mime_type = 'application/pdf' and new.bytes > (s ->> 'max_pdf_bytes')::bigint
     or new.mime_type like 'image/%' and new.bytes > (s ->> 'max_image_bytes')::bigint then
    raise exception 'file too large' using errcode = '22023';
  end if;
  select coalesce(sum(bytes), 0) into v_used from public.attachments where user_id = new.user_id;
  if v_used + new.bytes > (s ->> 'per_user_quota_bytes')::bigint then
    raise exception 'storage quota exceeded' using errcode = '53400';
  end if;
  return new;
end $$;
create trigger attachments_check before insert on public.attachments for each row execute function private.check_attachment();

create or replace function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger notes_touch before update on public.notes for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();

-- =========================================================================
-- Read RPCs the app uses for level-aware views
-- =========================================================================
-- Caller's access summary (is_admin and levels are always read from the database).
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id, 'is_admin', private.is_admin(p.id), 'levels', to_jsonb(private.held_levels(p.id)),
    'active_level', p.active_level, 'onboarded', p.onboarded_at is not null)
  from public.profiles p where p.id = private.active_uid()
$$;

-- Visible topics with Pareto flags limited to the levels the caller holds.
create or replace function public.my_topic_flags()
returns table (topic_id text, min_level smallint, pareto_levels smallint[])
language sql stable security definer set search_path = '' as $$
  select t.id, t.min_level,
         coalesce(array(select l from unnest(t.pareto_levels) l where l = any(private.held_levels()) order by l), '{}')::smallint[]
  from public.topics t
  where private.active_uid() is not null and t.archived_at is null and t.owner_id is null and t.min_level <= private.max_level()
$$;

-- One level's Pareto tab. Refuses levels the caller doesn't hold.
create or replace function public.pareto_topics(p_level smallint)
returns table (topic_id text, domain_slug text, module_slug text, name text, sort_order integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_level is null or not (p_level = any(private.held_levels())) then
    raise exception 'level % not granted', p_level using errcode = '42501';
  end if;
  return query select t.id, t.domain_slug, t.module_slug, t.name, t.sort_order from public.topics t
    where t.archived_at is null and t.owner_id is null and t.min_level <= p_level and p_level = any(t.pareto_levels)
    order by t.domain_slug, t.sort_order;
end $$;

grant execute on function public.my_access(), public.my_topic_flags(), public.pareto_topics(smallint) to authenticated;
