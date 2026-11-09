-- Milestone 3: admin console, level grants, level requests, CSV invites.
-- Every admin mutation: (1) checks is_admin from the database, (2) is rate-limited,
-- (3) writes an audit entry in the same transaction as the change.

-- =========================================================================
-- Invites created by CSV import for people who haven't signed up yet.
-- Claimed at onboarding when the user's verified email matches.
-- =========================================================================
create table public.level_invites (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  levels     smallint[] not null check (cardinality(levels) between 1 and 3 and levels <@ array[1,2,3]::smallint[]),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz
);
alter table public.level_invites enable row level security;
grant select on public.level_invites to authenticated;
create policy invites_read on public.level_invites for select to authenticated using ((select private.is_admin()));

-- =========================================================================
-- Helpers
-- =========================================================================
create or replace function private.admin_guard() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_admin();
begin
  if not private.rate_limit('admin:' || v_actor::text, 300, 60) then
    raise exception 'too many admin actions; wait a minute' using errcode = '54000';
  end if;
  return v_actor;
end $$;

-- True if the caller signed in (any method) within p_seconds. Uses the "amr" claim
-- Supabase puts in every access token: [{"method": "...", "timestamp": <unix secs>}].
create or replace function private.recent_auth(p_seconds integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select max((e ->> 'timestamp')::bigint)
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
  ), 0) >= extract(epoch from now())::bigint - p_seconds
$$;

-- Levels actually granted (ignores the implicit all-levels of admins).
create or replace function private.granted_levels(p_uid uuid) returns smallint[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct g.level order by g.level), '{}')::smallint[] from public.level_grants g
  where g.user_id = p_uid and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
$$;

create or replace function private.notify(p_uid uuid, p_kind text, p_payload jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, payload) values (p_uid, p_kind, coalesce(p_payload, '{}'::jsonb))
$$;

create or replace function private.user_access(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', p.id, 'email', p.email, 'is_admin', r.is_admin, 'disabled', p.disabled_at is not null,
    'granted', to_jsonb(private.granted_levels(p.id)), 'levels', to_jsonb(private.held_levels(p.id)), 'active_level', p.active_level)
  from public.profiles p join public.roles r on r.user_id = p.id where p.id = p_uid
$$;

create or replace function private.require_user(p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_uid is null or not exists (select 1 from public.profiles where id = p_uid) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function private.other_active_admins(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.roles r join public.profiles p on p.id = r.user_id
  where r.is_admin and p.disabled_at is null and r.user_id <> p_uid
$$;

-- Grant one level. Returns true if a new grant was created. Expired-but-open rows are closed
-- first so the "one open grant per level" index allows the regrant. Progress is untouched.
create or replace function private.grant_level(p_actor uuid, p_user uuid, p_level smallint, p_expires timestamptz, p_source text, p_note text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_before smallint[] := private.granted_levels(p_user); v_row public.level_grants;
begin
  if p_level is null or p_level not between 1 and 3 then raise exception 'invalid level' using errcode = '22023'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiry must be in the future' using errcode = '22023'; end if;
  update public.level_grants set revoked_at = now()
   where user_id = p_user and level = p_level and revoked_at is null and expires_at is not null and expires_at <= now();
  select * into v_row from public.level_grants where user_id = p_user and level = p_level and revoked_at is null;
  if found then
    if v_row.expires_at is distinct from p_expires then
      update public.level_grants set expires_at = p_expires where id = v_row.id;
      perform private.audit(p_actor, 'change_grant_expiry', p_user, 'level_grant', v_row.id::text,
        jsonb_build_object('level', p_level, 'expires_at', v_row.expires_at), jsonb_build_object('level', p_level, 'expires_at', p_expires));
    end if;
    return false;
  end if;
  insert into public.level_grants (user_id, level, granted_by, source, expires_at, note)
  values (p_user, p_level, p_actor, p_source, p_expires, left(p_note, 500)) returning * into v_row;
  update public.profiles set active_level = coalesce(active_level, p_level) where id = p_user;
  perform private.audit(p_actor, 'grant_level', p_user, 'level_grant', v_row.id::text,
    jsonb_build_object('levels', to_jsonb(v_before)),
    jsonb_build_object('levels', to_jsonb(private.granted_levels(p_user)), 'level', p_level, 'expires_at', p_expires, 'source', p_source));
  perform private.notify(p_user, 'level_granted', jsonb_build_object('level', p_level, 'expires_at', p_expires));
  return true;
end $$;

-- =========================================================================
-- Admin: read
-- =========================================================================
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active_7d', (select count(*) from public.profiles where last_active_at > now() - interval '7 days'),
    'admins', (select count(*) from public.roles where is_admin),
    'disabled', (select count(*) from public.profiles where disabled_at is not null),
    'pending_requests', (select count(*) from public.level_requests where status = 'pending'),
    'open_invites', (select count(*) from public.level_invites where claimed_at is null),
    'by_level', (select jsonb_object_agg(l.level, (select count(distinct g.user_id) from public.level_grants g
                   where g.level = l.level and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())))
                 from public.levels l));
end $$;

create or replace function public.admin_list_users(p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(lower(trim(coalesce(p_search, ''))), ''); v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform private.require_admin();
  return (
    with base as (
      select p.id, p.email, p.display_name, p.created_at, p.last_active_at, p.disabled_at, p.active_level, r.is_admin
      from public.profiles p join public.roles r on r.user_id = p.id
      where v_q is null or strpos(lower(p.email), v_q) > 0 or strpos(lower(coalesce(p.display_name, '')), v_q) > 0
    ), page as (
      select * from base order by created_at desc limit v_lim offset greatest(coalesce(p_offset, 0), 0)
    )
    select jsonb_build_object('total', (select count(*) from base), 'users', coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id, 'email', pg.email, 'display_name', pg.display_name, 'created_at', pg.created_at,
      'last_active_at', pg.last_active_at, 'disabled', pg.disabled_at is not null, 'is_admin', pg.is_admin,
      'granted', to_jsonb(private.granted_levels(pg.id)), 'active_level', pg.active_level,
      'xp', coalesce(s.xp, 0), 'streak', coalesce(s.current_streak, 0),
      'topics_done', (select count(*) from public.topic_progress tp where tp.user_id = pg.id and tp.status = 2)
    ) order by pg.created_at desc), '[]'::jsonb))
    from page pg left join public.user_stats s on s.user_id = pg.id
  );
end $$;

-- Per-user detail for admins. Contains progress, sessions and revision backlog; never note text,
-- links or attachments (those are only visible for topics the user shares).
create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.require_user(p_user);
  return jsonb_build_object(
    'access', private.user_access(p_user),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'timezone', p.timezone, 'created_at', p.created_at,
                 'last_active_at', p.last_active_at, 'onboarded_at', p.onboarded_at, 'disabled_at', p.disabled_at,
                 'interview_date', p.interview_date) from public.profiles p where p.id = p_user),
    'stats', (select to_jsonb(s) - 'user_id' from public.user_stats s where s.user_id = p_user),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'level', g.level, 'granted_at', g.granted_at, 'expires_at', g.expires_at,
                 'revoked_at', g.revoked_at, 'source', g.source, 'granted_by', gb.email, 'revoked_by', rb.email,
                 'active', g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) order by g.granted_at desc)
               from public.level_grants g left join public.profiles gb on gb.id = g.granted_by left join public.profiles rb on rb.id = g.revoked_by
               where g.user_id = p_user), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(q) - 'user_id' order by q.created_at desc) from public.level_requests q where q.user_id = p_user), '[]'::jsonb),
    'progress', (select jsonb_agg(jsonb_build_object('level', l.level, 'domains', (
        select jsonb_agg(jsonb_build_object('domain', d.name, 'icon', d.icon,
          'total', (select count(*) from public.topics t where t.domain_slug = d.slug and t.owner_id is null and t.archived_at is null and t.min_level <= l.level),
          'done', (select count(*) from public.topics t join public.topic_progress tp on tp.topic_id = t.id and tp.user_id = p_user and tp.status = 2
                   where t.domain_slug = d.slug and t.owner_id is null and t.archived_at is null and t.min_level <= l.level),
          'in_progress', (select count(*) from public.topics t join public.topic_progress tp on tp.topic_id = t.id and tp.user_id = p_user and tp.status = 1
                   where t.domain_slug = d.slug and t.owner_id is null and t.archived_at is null and t.min_level <= l.level)
        ) order by d.sort_order) from public.domains d where d.archived_at is null)) order by l.level) from public.levels l),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('started_at', x.started_at, 'minutes', x.minutes, 'topic_id', x.topic_id) order by x.started_at desc)
               from (select * from public.study_sessions where user_id = p_user order by started_at desc limit 20) x), '[]'::jsonb),
    'revision_backlog', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.id, 'name', t.name,
                 'days', floor(extract(epoch from now() - greatest(tp.done_at, coalesce(tp.last_revised_at, tp.done_at))) / 86400)) order by greatest(tp.done_at, coalesce(tp.last_revised_at, tp.done_at)))
               from public.topic_progress tp join public.topics t on t.id = tp.topic_id
               where tp.user_id = p_user and tp.status = 2 and greatest(tp.done_at, coalesce(tp.last_revised_at, tp.done_at)) <= now() - interval '5 days'), '[]'::jsonb),
    'shared_topics', (select count(*) from public.topic_shares where user_id = p_user)
  );
end $$;

-- =========================================================================
-- Admin: mutations
-- =========================================================================
create or replace function public.admin_grant_level(p_user uuid, p_level smallint, p_expires_at timestamptz default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard();
begin
  perform private.require_user(p_user);
  perform private.grant_level(v_actor, p_user, p_level, p_expires_at, 'admin', p_note);
  return private.user_access(p_user);
end $$;

create or replace function public.admin_revoke_level(p_user uuid, p_level smallint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before smallint[]; v_after smallint[];
begin
  perform private.require_user(p_user);
  v_before := private.granted_levels(p_user);
  if not (p_level = any(v_before)) then raise exception 'level % is not granted to this user', p_level using errcode = '22023'; end if;
  if cardinality(v_before) = 1 then
    raise exception 'a user must keep at least one level; grant another level first' using errcode = '22023';
  end if;
  update public.level_grants set revoked_at = now(), revoked_by = v_actor
   where user_id = p_user and level = p_level and revoked_at is null;
  v_after := private.granted_levels(p_user);
  update public.profiles set active_level = v_after[1] where id = p_user and (active_level = p_level or active_level is null);
  perform private.audit(v_actor, 'revoke_level', p_user, 'level_grant', p_level::text,
    jsonb_build_object('levels', to_jsonb(v_before)), jsonb_build_object('levels', to_jsonb(v_after), 'level', p_level));
  perform private.notify(p_user, 'level_revoked', jsonb_build_object('level', p_level));
  return private.user_access(p_user);
end $$;

create or replace function public.admin_bulk_grant(p_users uuid[], p_level smallint, p_expires_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_uid uuid; v_new integer := 0; v_same integer := 0;
begin
  if coalesce(cardinality(p_users), 0) = 0 then raise exception 'select at least one user' using errcode = '22023'; end if;
  if cardinality(p_users) > 500 then raise exception 'at most 500 users at a time' using errcode = '22023'; end if;
  foreach v_uid in array (select array_agg(distinct u) from unnest(p_users) u) loop
    perform private.require_user(v_uid);
    if private.grant_level(v_actor, v_uid, p_level, p_expires_at, 'admin', 'bulk') then v_new := v_new + 1; else v_same := v_same + 1; end if;
  end loop;
  return jsonb_build_object('granted', v_new, 'already_held', v_same);
end $$;

create or replace function public.admin_set_active_level(p_user uuid, p_level smallint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before smallint;
begin
  perform private.require_user(p_user);
  if not (p_level = any(private.held_levels(p_user))) then
    raise exception 'grant level % before making it the active level', p_level using errcode = '22023';
  end if;
  select active_level into v_before from public.profiles where id = p_user;
  if v_before is distinct from p_level then
    update public.profiles set active_level = p_level where id = p_user;
    perform private.audit(v_actor, 'set_active_level', p_user, 'profile', p_user::text,
      jsonb_build_object('active_level', v_before), jsonb_build_object('active_level', p_level));
  end if;
  return private.user_access(p_user);
end $$;

-- Promote or demote. Requires a sign-in within the last 10 minutes. The last active admin
-- can't be demoted. Note: anyone in ADMIN_EMAILS is promoted again at their next sign-in.
create or replace function public.admin_set_admin(p_user uuid, p_is_admin boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before boolean;
begin
  perform private.require_user(p_user);
  if not private.recent_auth(600) then
    raise exception 'reauth required: sign in again to change admin access' using errcode = '42501';
  end if;
  select is_admin into v_before from public.roles where user_id = p_user for update;
  if v_before = coalesce(p_is_admin, false) then return private.user_access(p_user); end if;
  if not coalesce(p_is_admin, false) and private.other_active_admins(p_user) = 0 then
    raise exception 'the last admin cannot be removed' using errcode = '42501';
  end if;
  if coalesce(p_is_admin, false) and exists (select 1 from public.profiles where id = p_user and disabled_at is not null) then
    raise exception 'enable the account before promoting it' using errcode = '22023';
  end if;
  update public.roles set is_admin = p_is_admin, updated_at = now() where user_id = p_user;
  perform private.audit(v_actor, case when p_is_admin then 'promote_admin' else 'demote_admin' end, p_user, 'role', p_user::text,
    jsonb_build_object('is_admin', v_before), jsonb_build_object('is_admin', p_is_admin));
  perform private.notify(p_user, case when p_is_admin then 'admin_granted' else 'admin_removed' end, '{}'::jsonb);
  return private.user_access(p_user);
end $$;

create or replace function public.admin_set_disabled(p_user uuid, p_disabled boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before timestamptz; v_admin boolean;
begin
  perform private.require_user(p_user);
  if p_user = v_actor then raise exception 'you cannot disable your own account' using errcode = '22023'; end if;
  select p.disabled_at, r.is_admin into v_before, v_admin from public.profiles p join public.roles r on r.user_id = p.id where p.id = p_user for update of p;
  if (v_before is not null) = coalesce(p_disabled, false) then return private.user_access(p_user); end if;
  if p_disabled and v_admin and private.other_active_admins(p_user) = 0 then
    raise exception 'the last admin cannot be disabled' using errcode = '42501';
  end if;
  update public.profiles set disabled_at = case when p_disabled then now() end where id = p_user;
  update public.study_sessions set status = 'closed', ended_at = now(),
         minutes = least(240, greatest(0, floor(extract(epoch from now() - started_at) / 60)))::integer
   where user_id = p_user and status = 'running' and p_disabled;
  perform private.audit(v_actor, case when p_disabled then 'disable_user' else 'enable_user' end, p_user, 'profile', p_user::text,
    jsonb_build_object('disabled', v_before is not null), jsonb_build_object('disabled', p_disabled));
  return private.user_access(p_user);
end $$;

create or replace function public.admin_decide_request(p_request bigint, p_approve boolean, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_req public.level_requests;
begin
  select * into v_req from public.level_requests where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'this request was already %', v_req.status using errcode = '22023'; end if;
  if p_approve then
    perform private.grant_level(v_actor, v_req.user_id, v_req.requested_level, null, 'request', p_note);
  end if;
  update public.level_requests set status = case when p_approve then 'approved' else 'denied' end::public.request_status,
         decided_by = v_actor, decided_at = now(), decision_note = left(p_note, 500)
   where id = p_request;
  perform private.audit(v_actor, case when p_approve then 'approve_request' else 'deny_request' end, v_req.user_id, 'level_request', p_request::text,
    jsonb_build_object('status', 'pending', 'level', v_req.requested_level),
    jsonb_build_object('status', case when p_approve then 'approved' else 'denied' end, 'level', v_req.requested_level, 'note', p_note));
  perform private.notify(v_req.user_id, case when p_approve then 'request_approved' else 'request_denied' end,
    jsonb_build_object('level', v_req.requested_level, 'note', p_note));
  return private.user_access(v_req.user_id);
end $$;

-- CSV import. p_rows = [{"email": "...", "levels": [1,2]}, ...] (parsed and validated by the server).
-- Existing users get the levels now; others get an invite claimed at onboarding.
create or replace function public.admin_import_users(p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_row jsonb; v_email text; v_levels smallint[]; v_uid uuid; v_lvl smallint;
        v_granted integer := 0; v_invited integer := 0; v_skipped jsonb := '[]'::jsonb; v_prev smallint[];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'no rows to import' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'at most 500 rows at a time' using errcode = '22023'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(trim(v_row ->> 'email'));
    select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into v_levels
      from jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'levels') = 'array' then v_row -> 'levels' else '[]'::jsonb end) x
      where x ~ '^[123]$';
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_skipped := v_skipped || jsonb_build_object('email', v_row ->> 'email', 'reason', 'invalid email'); continue;
    end if;
    if cardinality(v_levels) = 0 then
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'no valid levels'); continue;
    end if;
    select id into v_uid from public.profiles where lower(email) = v_email;
    if v_uid is not null then
      foreach v_lvl in array v_levels loop
        if private.grant_level(v_actor, v_uid, v_lvl, null, 'import', 'csv import') then v_granted := v_granted + 1; end if;
      end loop;
    else
      select levels into v_prev from public.level_invites where email = v_email and claimed_at is null;
      insert into public.level_invites (email, levels, created_by) values (v_email, v_levels, v_actor)
      on conflict (email) do update set levels = (select array_agg(distinct l order by l) from unnest(public.level_invites.levels || excluded.levels) l),
                                       created_by = excluded.created_by, created_at = now(), claimed_by = null, claimed_at = null;
      perform private.audit(v_actor, 'import_invite', null, 'level_invite', v_email,
        case when v_prev is null then null else jsonb_build_object('levels', to_jsonb(v_prev)) end, jsonb_build_object('levels', to_jsonb(v_levels)));
      v_invited := v_invited + 1;
    end if;
  end loop;
  return jsonb_build_object('granted', v_granted, 'invited', v_invited, 'skipped', v_skipped);
end $$;

create or replace function public.admin_delete_invite(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_prev smallint[];
begin
  delete from public.level_invites where email = lower(trim(p_email)) and claimed_at is null returning levels into v_prev;
  if v_prev is null then raise exception 'invite not found' using errcode = 'P0002'; end if;
  perform private.audit(v_actor, 'delete_invite', null, 'level_invite', lower(trim(p_email)), jsonb_build_object('levels', to_jsonb(v_prev)), null);
end $$;

-- =========================================================================
-- Users: level requests, invites, onboarding
-- =========================================================================
create or replace function public.request_level(p_level smallint, p_note text default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_level is null or p_level not between 1 and 3 then raise exception 'invalid level' using errcode = '22023'; end if;
  if p_level = any(private.held_levels(v_uid)) then raise exception 'you already have this level' using errcode = '22023'; end if;
  if not private.rate_limit('request:' || v_uid::text, 10, 86400) then
    raise exception 'too many requests today; try again tomorrow' using errcode = '54000';
  end if;
  begin
    insert into public.level_requests (user_id, requested_level, note) values (v_uid, p_level, nullif(left(trim(p_note), 500), '')) returning id into v_id;
  exception when unique_violation then
    raise exception 'you already have a pending request for this level' using errcode = '22023';
  end;
  return v_id;
end $$;

create or replace function public.cancel_level_request(p_request bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.level_requests set status = 'cancelled', decided_at = now()
   where id = p_request and user_id = v_uid and status = 'pending';
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
end $$;

-- Levels waiting for the caller from a CSV import (verified email only).
create or replace function public.my_invite() returns smallint[]
language sql stable security definer set search_path = '' as $$
  select i.levels from public.level_invites i join auth.users u on lower(u.email) = i.email
  where u.id = private.active_uid() and u.email_confirmed_at is not null and i.claimed_at is null
$$;

-- Onboarding (replaces the Milestone 2 version): claims an import invite if there is one,
-- keeps levels an admin already granted, otherwise grants the one level the user picked.
create or replace function public.complete_onboarding(p_level smallint, p_timezone text default 'UTC', p_display_name text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_inv public.level_invites; v_lvl smallint; v_granted smallint[];
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'already onboarded; ask an admin to change levels' using errcode = '42501';
  end if;
  select i.* into v_inv from public.level_invites i join auth.users u on lower(u.email) = i.email
   where u.id = v_uid and u.email_confirmed_at is not null and i.claimed_at is null for update of i;
  if found then
    foreach v_lvl in array v_inv.levels loop
      perform private.grant_level(v_inv.created_by, v_uid, v_lvl, null, 'import', 'claimed invite');
    end loop;
    update public.level_invites set claimed_by = v_uid, claimed_at = now() where email = v_inv.email;
  end if;
  v_granted := private.granted_levels(v_uid);
  if cardinality(v_granted) = 0 then
    if p_level is null or p_level not between 1 and 3 then raise exception 'invalid level' using errcode = '22023'; end if;
    insert into public.level_grants (user_id, level, granted_by, source) values (v_uid, p_level, null, 'onboarding');
    v_granted := array[p_level];
  end if;
  update public.profiles
     set active_level = v_granted[1], timezone = p_timezone, onboarded_at = now(),
         display_name = coalesce(nullif(left(trim(p_display_name), 80), ''), display_name)
   where id = v_uid;
  return public.my_access();
end $$;

-- =========================================================================
-- Function privileges (see the note in 20261105000003_auth_bootstrap.sql)
-- =========================================================================
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
grant execute on function
  public.my_access(), public.my_topic_flags(), public.pareto_topics(smallint), public.level_summary(smallint),
  public.complete_onboarding(smallint, text, text), public.set_active_level(smallint), public.touch_activity(),
  public.set_topic_status(text, smallint), public.set_subtopic_done(text, boolean),
  public.request_level(smallint, text), public.cancel_level_request(bigint), public.my_invite(),
  public.admin_overview(), public.admin_list_users(text, integer, integer), public.admin_user_detail(uuid),
  public.admin_grant_level(uuid, smallint, timestamptz, text), public.admin_revoke_level(uuid, smallint),
  public.admin_bulk_grant(uuid[], smallint, timestamptz), public.admin_set_active_level(uuid, smallint),
  public.admin_set_admin(uuid, boolean), public.admin_set_disabled(uuid, boolean),
  public.admin_decide_request(bigint, boolean, text), public.admin_import_users(jsonb), public.admin_delete_invite(text)
to authenticated;
grant execute on function public.bootstrap_admins(text[]) to service_role;
