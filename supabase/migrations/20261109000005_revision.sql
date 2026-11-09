-- Milestone 8: spaced revision and reminder emails.
-- A done topic's clock starts at max(done_at, last_revised_at). It's "due" from 5 days and
-- "overdue" from 7 (both read from the gamification document, so admins can change them).
-- "Revised" resets the clock and records whether it was actually due (used for XP later).

alter table public.profiles add column last_reminder_at timestamptz;

create or replace function private.revision_cfg() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'due', coalesce((d.data -> 'revision' ->> 'due_after_days')::integer, 5),
    'overdue', coalesce((d.data -> 'revision' ->> 'overdue_after_days')::integer, 7))
  from (select 1) x left join public.content_documents d on d.key = 'gamification'
$$;

-- Topics due for revision for one user (visible topics only, so a revoked level's topics drop out).
create or replace function private.due_topics(p_uid uuid)
returns table (topic_id text, name text, domain_slug text, days integer, state text)
language sql stable security definer set search_path = '' as $$
  with cfg as (select (private.revision_cfg() ->> 'due')::integer as due, (private.revision_cfg() ->> 'overdue')::integer as overdue),
  t as (
    select tp.topic_id, tk.name, tk.domain_slug,
           floor(extract(epoch from now() - greatest(tp.done_at, coalesce(tp.last_revised_at, tp.done_at))) / 86400)::integer as days
    from public.topic_progress tp join public.topics tk on tk.id = tp.topic_id
    where tp.user_id = p_uid and tp.status = 2 and tp.done_at is not null and tk.archived_at is null
      and ((tk.owner_id is null and tk.min_level <= private.max_level(p_uid)) or tk.owner_id = p_uid)
  )
  select t.topic_id, t.name, t.domain_slug, t.days, case when t.days >= cfg.overdue then 'overdue' else 'due' end
  from t, cfg where t.days >= cfg.due
  order by t.days desc, t.name
$$;

create or replace function public.revision_due() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return jsonb_build_object('config', private.revision_cfg(),
    'topics', coalesce((select jsonb_agg(to_jsonb(d)) from private.due_topics(v_uid) d), '[]'::jsonb));
end $$;

create or replace function public.mark_revised(p_topic_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_tp public.topic_progress; v_days integer; v_due boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not private.topic_visible(p_topic_id, v_uid) then raise exception 'topic not available' using errcode = '42501'; end if;
  select * into v_tp from public.topic_progress where user_id = v_uid and topic_id = p_topic_id for update;
  if not found or v_tp.status <> 2 then raise exception 'mark the topic done before revising it' using errcode = '22023'; end if;
  if not private.rate_limit('revise:' || v_uid::text, 200, 3600) then raise exception 'too many revisions at once; wait a little' using errcode = '54000'; end if;
  v_days := floor(extract(epoch from now() - greatest(v_tp.done_at, coalesce(v_tp.last_revised_at, v_tp.done_at))) / 86400)::integer;
  v_due := v_days >= (private.revision_cfg() ->> 'due')::integer;
  update public.topic_progress set last_revised_at = now(), revision_cycle = revision_cycle + 1, updated_at = now()
   where user_id = v_uid and topic_id = p_topic_id;
  insert into public.revisions (user_id, topic_id, cycle, was_due) values (v_uid, p_topic_id, v_tp.revision_cycle + 1, v_due);
  if v_due then update public.user_stats set revisions = revisions + 1, updated_at = now() where user_id = v_uid; end if;
  return jsonb_build_object('topic_id', p_topic_id, 'was_due', v_due, 'days', v_days, 'cycle', v_tp.revision_cycle + 1);
end $$;

-- ---------------------------------------------------------------- reminder emails (service role only)
-- People to email this run: opted in, enabled, onboarded, verified email, at least one topic due,
-- not emailed in the last 20 hours, and it's between p_from_hour and p_to_hour in their timezone.
create or replace function public.reminder_batch(p_limit integer default 10, p_from_hour integer default 8, p_to_hour integer default 11)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.jwt() ->> 'role' in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by x.max_days desc) from (
      select p.id as user_id, u.email, p.display_name, p.timezone,
             count(*) as due_count, count(*) filter (where d.state = 'overdue') as overdue_count, max(d.days) as max_days,
             (select jsonb_agg(jsonb_build_object('topic_id', z.topic_id, 'name', z.name, 'days', z.days, 'state', z.state))
              from (select * from private.due_topics(p.id) limit 5) z) as topics
      from public.profiles p
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
      cross join lateral private.due_topics(p.id) d
      where p.email_reminders and p.disabled_at is null and p.onboarded_at is not null
        and (p.last_reminder_at is null or p.last_reminder_at < now() - interval '20 hours')
        and extract(hour from now() at time zone p.timezone) between p_from_hour and p_to_hour - 1
      group by p.id, u.email, p.display_name, p.timezone
      order by max(d.days) desc
      limit least(greatest(coalesce(p_limit, 10), 1), 100)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.mark_reminder_sent(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.jwt() ->> 'role' in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  update public.profiles set last_reminder_at = now() where id = p_user;
end $$;

-- One-click unsubscribe from a signed email link (the server verifies the HMAC first).
create or replace function public.set_email_reminders_for(p_user uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.jwt() ->> 'role' in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  update public.profiles set email_reminders = coalesce(p_on, false) where id = p_user;
end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
revoke all on function public.revision_due(), public.mark_revised(text), public.reminder_batch(integer, integer, integer),
  public.mark_reminder_sent(uuid), public.set_email_reminders_for(uuid, boolean) from public, anon, authenticated;
grant execute on function public.revision_due(), public.mark_revised(text) to authenticated;
grant execute on function public.reminder_batch(integer, integer, integer), public.mark_reminder_sent(uuid),
  public.set_email_reminders_for(uuid, boolean) to service_role;
