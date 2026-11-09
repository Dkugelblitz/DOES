-- Control who can join: "open" (anyone signing in with Google) or "invite_only".
-- In invite-only mode a new person can finish onboarding only if (1) they have a CSV invite,
-- (2) their verified email's domain is on the allowed list, or (3) an admin already granted
-- them a level (for example by approving their access request). Everyone else stays at the
-- waiting screen with no levels, so row-level security shows them nothing.
-- Existing members are never affected by a policy change.

create table public.join_policy (
  id              boolean primary key default true check (id),   -- single row
  mode            text not null default 'open' check (mode in ('open', 'invite_only')),
  allowed_domains text[] not null default '{}',
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);
insert into public.join_policy (id) values (true);
alter table public.join_policy enable row level security;  -- no grants: read and written only via functions below

create or replace function private.email_domain(p_email text) returns text
language sql immutable as $$ select lower(split_part(coalesce(p_email, ''), '@', 2)) $$;

-- Why the caller may or may not join. Used by onboarding (database) and the waiting screen (app).
create or replace function private.join_status(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with u as (select au.email, au.email_confirmed_at from auth.users au where au.id = p_uid),
  p as (select * from public.join_policy where id)
  select jsonb_build_object(
    'mode', p.mode,
    'allowed', case
      when p.mode = 'open' then true
      when exists (select 1 from public.level_grants g where g.user_id = p_uid and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) then true
      when (select email_confirmed_at from u) is null then false
      when exists (select 1 from public.level_invites i, u where i.email = lower(u.email) and i.claimed_at is null) then true
      when private.email_domain((select email from u)) = any(p.allowed_domains) then true
      else false end,
    'reason', case
      when p.mode = 'open' then 'open'
      when exists (select 1 from public.level_grants g where g.user_id = p_uid and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) then 'approved'
      when (select email_confirmed_at from u) is null then 'unverified'
      when exists (select 1 from public.level_invites i, u where i.email = lower(u.email) and i.claimed_at is null) then 'invited'
      when private.email_domain((select email from u)) = any(p.allowed_domains) then 'domain'
      else 'not_invited' end,
    'pending_requests', (select coalesce(jsonb_agg(requested_level order by requested_level), '[]'::jsonb) from public.level_requests where user_id = p_uid and status = 'pending'))
  from p
$$;

create or replace function public.my_join_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return private.join_status(v_uid);
end $$;

-- Onboarding (replaces the Milestone 3 version) with the join policy check.
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
  if not (private.join_status(v_uid) ->> 'allowed')::boolean then
    raise exception 'invite only: ask an admin for access' using errcode = '42501';
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

-- Admin: read and change the policy (audited).
create or replace function public.admin_join_policy() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('mode', mode, 'allowed_domains', to_jsonb(allowed_domains), 'updated_at', updated_at,
            'waiting', (select count(*) from public.profiles p where p.onboarded_at is null and p.disabled_at is null
                          and not exists (select 1 from public.level_grants g where g.user_id = p.id and g.revoked_at is null)))
          from public.join_policy where id);
end $$;

create or replace function public.admin_set_join_policy(p_mode text, p_domains text[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before jsonb; v_domains text[];
begin
  if p_mode not in ('open', 'invite_only') then raise exception 'mode must be open or invite_only' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_domains
  from (select lower(btrim(regexp_replace(x, '^@', ''))) as d from unnest(coalesce(p_domains, '{}')) x) y where d <> '';
  if exists (select 1 from unnest(v_domains) d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
    raise exception 'domains look like example.com (no @, no spaces)' using errcode = '22023';
  end if;
  if cardinality(v_domains) > 50 then raise exception 'at most 50 domains' using errcode = '22023'; end if;
  if v_domains && array['gmail.com', 'googlemail.com'] then
    raise exception 'allowing gmail.com would let anyone in; use Open mode instead' using errcode = '22023';
  end if;
  select jsonb_build_object('mode', mode, 'allowed_domains', to_jsonb(allowed_domains)) into v_before from public.join_policy where id;
  update public.join_policy set mode = p_mode, allowed_domains = v_domains, updated_by = v_actor, updated_at = now() where id;
  perform private.audit(v_actor, 'set_join_policy', null, 'join_policy', 'join_policy', v_before,
    jsonb_build_object('mode', p_mode, 'allowed_domains', to_jsonb(v_domains)));
  return public.admin_join_policy();
end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
revoke all on function public.my_join_status(), public.complete_onboarding(smallint, text, text), public.admin_join_policy(),
  public.admin_set_join_policy(text, text[]) from public, anon, authenticated;
grant execute on function public.my_join_status(), public.complete_onboarding(smallint, text, text), public.admin_join_policy(),
  public.admin_set_join_policy(text, text[]) to authenticated;
