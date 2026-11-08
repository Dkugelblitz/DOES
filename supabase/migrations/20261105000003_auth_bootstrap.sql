-- Sign-up hooks, ADMIN_EMAILS bootstrap, onboarding and level switching.

-- Every audited admin/system mutation goes through this helper (same transaction as the change).
create or replace function private.audit(p_actor uuid, p_action text, p_target uuid, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.admin_audit_log (actor_id, action, target_user_id, entity_type, entity_id, before, after)
  values (p_actor, p_action, p_target, p_entity_type, p_entity_id, p_before, p_after)
$$;

-- New auth user -> profile, role row (never admin) and stats row.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''),
          nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 80), ''));
  insert into public.roles (user_id, is_admin) values (new.id, false);
  insert into public.user_stats (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users for each row
  when (old.email is distinct from new.email) execute function private.handle_user_email_change();

-- ADMIN_EMAILS bootstrap. Called by the Next.js server with the service-role key after
-- every sign-in, passing the comma-separated ADMIN_EMAILS env var. Not callable by
-- anon/authenticated users. Only verified emails qualify, so nobody can claim an admin
-- address by signing up with it before verifying. Idempotent; each promotion is audited.
create or replace function public.bootstrap_admins(p_emails text[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_count integer := 0; v_list text[];
begin
  -- Primary guard is EXECUTE privilege (service_role only). Defence in depth: refuse any
  -- request carrying an end-user JWT.
  if auth.jwt() ->> 'role' in ('anon', 'authenticated') then
    raise exception 'service role only' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct lower(trim(e))), '{}') into v_list from unnest(p_emails) e where trim(e) <> '';
  for r in
    select u.id, ro.is_admin from auth.users u
    join public.profiles p on p.id = u.id join public.roles ro on ro.user_id = u.id
    where u.email_confirmed_at is not null and lower(u.email) = any(v_list) and not ro.is_admin
  loop
    update public.roles set is_admin = true, updated_at = now() where user_id = r.id;
    perform private.audit(null, 'bootstrap_admin', r.id, 'role', r.id::text, jsonb_build_object('is_admin', false), jsonb_build_object('is_admin', true, 'source', 'ADMIN_EMAILS'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.bootstrap_admins(text[]) from public, anon, authenticated;
grant execute on function public.bootstrap_admins(text[]) to service_role;

-- Onboarding: the user picks ONE level once. After that only admins change levels.
create or replace function public.complete_onboarding(p_level smallint, p_timezone text default 'UTC', p_display_name text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_level is null or p_level not between 1 and 3 then raise exception 'invalid level' using errcode = '22023'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  -- Serialise concurrent onboarding calls for the same user.
  perform 1 from public.profiles where id = v_uid for update;
  if exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null)
     or exists (select 1 from public.level_grants where user_id = v_uid) then
    raise exception 'already onboarded; ask an admin to change levels' using errcode = '42501';
  end if;
  insert into public.level_grants (user_id, level, granted_by, source) values (v_uid, p_level, null, 'onboarding');
  update public.profiles
     set active_level = p_level, timezone = p_timezone, onboarded_at = now(),
         display_name = coalesce(nullif(left(trim(p_display_name), 80), ''), display_name)
   where id = v_uid;
  return public.my_access();
end $$;

-- Switching level only changes the view among levels the user holds.
create or replace function public.set_active_level(p_level smallint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not (p_level = any(private.held_levels(v_uid))) then
    raise exception 'level % not granted', p_level using errcode = '42501';
  end if;
  update public.profiles set active_level = p_level where id = v_uid;
  return public.my_access();
end $$;

-- Lightweight "last active" stamp (at most one write per 5 minutes).
create or replace function public.touch_activity() returns void
language sql volatile security definer set search_path = '' as $$
  update public.profiles set last_active_at = now()
  where id = private.active_uid() and (last_active_at is null or last_active_at < now() - interval '5 minutes')
$$;

-- Lock down every function, then grant back only what each role may call.
-- (Repeat this block at the end of every future migration that adds functions.)
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
grant execute on function public.my_access(), public.my_topic_flags(), public.pareto_topics(smallint),
  public.complete_onboarding(smallint, text, text), public.set_active_level(smallint), public.touch_activity() to authenticated;
grant execute on function public.bootstrap_admins(text[]) to service_role;
