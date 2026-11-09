-- Milestone 9: XP, levels, streaks and badges.
-- Rules live in data: points and limits in content_documents('gamification'), badge rules in
-- public.badges. XP is only ever written by database triggers on real actions, never by the
-- client, and every award has an idempotency key (unique per user), so repeating an action
-- (un-done/re-done, re-saving a note, re-uploading) can't earn XP twice.
-- XP, streaks and badges are global per user, not per level.

-- Reminder emails become opt-in: nobody is emailed unless they switch it on themselves.
alter table public.profiles alter column email_reminders set default false;
update public.profiles set email_reminders = false;

-- ---------------------------------------------------------------- helpers
create or replace function private.game_cfg() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select data from public.content_documents where key = 'gamification'), '{}'::jsonb)
$$;

-- Record activity on the user's local calendar day (drives streaks).
create or replace function private.touch_day(p_uid uuid, p_at timestamptz default now()) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.activity_days (user_id, day, events)
  select p_uid, (p_at at time zone coalesce(p.timezone, 'UTC'))::date, 1 from public.profiles p where p.id = p_uid
  on conflict (user_id, day) do update set events = public.activity_days.events + 1
$$;

-- Current streak = the run of consecutive active days ending today or yesterday (so today is
-- optional until it ends). Longest = the longest run ever.
create or replace function private.streak_info(p_uid uuid, out current_streak integer, out longest_streak integer)
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone coalesce(p.timezone, 'UTC'))::date as d from public.profiles p where p.id = p_uid),
  days as (select day from public.activity_days where user_id = p_uid and (minutes > 0 or events > 0)),
  grp as (select day, day - (row_number() over (order by day))::integer as g from days),
  runs as (select max(day) as e, count(*)::integer as n from grp group by g)
  select coalesce((select r.n from runs r, today t where r.e >= t.d - 1 order by r.e desc limit 1), 0),
         coalesce((select max(n) from runs), 0)
$$;

create or replace function private.current_streak(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (private.streak_info(p_uid)).current_streak
$$;

-- Recompute denormalised totals from the source tables.
create or replace function private.refresh_stats(p_uid uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_min integer := coalesce((private.game_cfg() -> 'xp' -> 'note' ->> 'min_chars')::integer, 20); s record;
begin
  s := private.streak_info(p_uid);
  insert into public.user_stats (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_stats set
    xp = (select coalesce(sum(points), 0) from public.xp_events where user_id = p_uid),
    topics_done = (select count(*) from public.topic_progress where user_id = p_uid and status = 2),
    notes = (select count(*) from public.notes where user_id = p_uid and char_length(btrim(body_md)) >= v_min),
    revisions = (select count(*) from public.revisions where user_id = p_uid and was_due),
    study_minutes = (select coalesce(sum(minutes), 0) from public.study_sessions where user_id = p_uid and status = 'closed'),
    current_streak = s.current_streak,
    longest_streak = greatest(s.longest_streak, longest_streak),
    updated_at = now()
  where user_id = p_uid;
end $$;

-- Evaluate every badge rule; award the ones newly met. Returns the newly awarded badge ids.
create or replace function private.evaluate_badges(p_uid uuid) returns text[]
language plpgsql volatile security definer set search_path = '' as $$
declare b public.badges; st public.user_stats; tz text; ok boolean; v_new text[] := '{}';
begin
  select * into st from public.user_stats where user_id = p_uid;
  select coalesce(timezone, 'UTC') into tz from public.profiles where id = p_uid;
  for b in select * from public.badges order by sort_order loop
    continue when exists (select 1 from public.user_badges where user_id = p_uid and badge_id = b.id);
    ok := case b.rule ->> 'type'
      when 'topics_done' then st.topics_done >= (b.rule ->> 'gte')::integer
      when 'streak_days' then greatest(st.longest_streak, st.current_streak) >= (b.rule ->> 'gte')::integer
      when 'study_minutes' then st.study_minutes >= (b.rule ->> 'gte')::integer
      when 'notes_count' then st.notes >= (b.rule ->> 'gte')::integer
      when 'revisions_count' then st.revisions >= (b.rule ->> 'gte')::integer
      when 'pareto_complete' then exists (
        select 1 from unnest(private.held_levels(p_uid)) l
        where exists (select 1 from public.topics t where t.owner_id is null and t.archived_at is null and t.min_level <= l and l = any(t.pareto_levels))
          and not exists (select 1 from public.topics t where t.owner_id is null and t.archived_at is null and t.min_level <= l and l = any(t.pareto_levels)
                          and not exists (select 1 from public.topic_progress tp where tp.user_id = p_uid and tp.topic_id = t.id and tp.status = 2)))
      when 'session_start_local_hour' then exists (
        select 1 from public.study_sessions s where s.user_id = p_uid and s.status = 'closed' and s.minutes >= 1
          and (case when (b.rule ->> 'from')::integer < (b.rule ->> 'to')::integer
                    then extract(hour from s.started_at at time zone tz) >= (b.rule ->> 'from')::integer and extract(hour from s.started_at at time zone tz) < (b.rule ->> 'to')::integer
                    else extract(hour from s.started_at at time zone tz) >= (b.rule ->> 'from')::integer or extract(hour from s.started_at at time zone tz) < (b.rule ->> 'to')::integer end))
      else false end;
    if coalesce(ok, false) then
      insert into public.user_badges (user_id, badge_id) values (p_uid, b.id) on conflict do nothing;
      v_new := v_new || b.id;
    end if;
  end loop;
  return v_new;
end $$;

-- Award XP once per idempotency key. Points come from the gamification document.
create or replace function private.award_xp(p_uid uuid, p_kind text, p_key text, p_units integer default 1, p_ref jsonb default '{}'::jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_pts integer := coalesce((private.game_cfg() -> 'xp' -> p_kind ->> 'points')::integer, 0) * greatest(coalesce(p_units, 1), 0); v_id bigint;
begin
  if v_pts <= 0 then return 0; end if;
  insert into public.xp_events (user_id, kind, points, idempotency_key, ref) values (p_uid, p_kind, v_pts, p_key, coalesce(p_ref, '{}'::jsonb))
  on conflict (user_id, idempotency_key) do nothing returning id into v_id;
  return case when v_id is null then 0 else v_pts end;
end $$;

-- After any gamified action: refresh totals and badges.
create or replace function private.after_activity(p_uid uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.refresh_stats(p_uid);
  perform private.evaluate_badges(p_uid);
end $$;

-- ---------------------------------------------------------------- triggers on real actions
create or replace function private.on_topic_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 2 and (tg_op = 'INSERT' or old.status is distinct from 2) then
    perform private.award_xp(new.user_id, 'topic_done', 'topic_done:' || new.topic_id, 1, jsonb_build_object('topic_id', new.topic_id));
    perform private.touch_day(new.user_id);
  end if;
  if tg_op = 'INSERT' or old.status is distinct from new.status then perform private.after_activity(new.user_id); end if;
  return null;
end $$;
create trigger game_topic_progress after insert or update of status on public.topic_progress for each row execute function private.on_topic_progress();

create or replace function private.on_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_min integer := coalesce((private.game_cfg() -> 'xp' -> 'note' ->> 'min_chars')::integer, 20);
begin
  if char_length(btrim(new.body_md)) >= v_min then
    perform private.award_xp(new.user_id, 'note', 'note:' || new.topic_id, 1, jsonb_build_object('topic_id', new.topic_id));
  end if;
  perform private.touch_day(new.user_id);
  perform private.after_activity(new.user_id);
  return null;
end $$;
create trigger game_note after insert or update of body_md on public.notes for each row execute function private.on_note();

create or replace function private.on_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.award_xp(new.user_id, 'attachment', 'attachment:' || new.topic_id, 1, jsonb_build_object('topic_id', new.topic_id));
  perform private.touch_day(new.user_id);
  perform private.after_activity(new.user_id);
  return null;
end $$;
create trigger game_attachment after insert on public.attachments for each row execute function private.on_attachment();

create or replace function private.on_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only a revision that was actually due earns XP (configurable), once per revision cycle.
  if new.was_due or not coalesce((private.game_cfg() -> 'xp' -> 'revision' ->> 'only_when_due')::boolean, true) then
    perform private.award_xp(new.user_id, 'revision', 'revision:' || new.topic_id || ':' || new.cycle, 1, jsonb_build_object('topic_id', new.topic_id, 'cycle', new.cycle));
  end if;
  perform private.touch_day(new.user_id, new.revised_at);
  perform private.after_activity(new.user_id);
  return null;
end $$;
create trigger game_revision after insert on public.revisions for each row execute function private.on_revision();

create or replace function private.on_session_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'running' and new.status = 'closed' and coalesce(new.minutes, 0) > 0 then
    perform private.award_xp(new.user_id, 'study_minute', 'session:' || new.id, new.minutes, jsonb_build_object('minutes', new.minutes));
    perform private.after_activity(new.user_id);
  end if;
  return null;
end $$;
create trigger game_session after update of status on public.study_sessions for each row execute function private.on_session_closed();

-- close_session (Milestone 6) used to add minutes to user_stats itself; refresh_stats now owns
-- every total, so that would double count. The activity day is also recorded before the status
-- change, so the session trigger's streak refresh already sees today.
create or replace function private.close_session(p_id uuid, p_end timestamptz) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.study_sessions; v_min integer; v_tz text;
begin
  select * into v_s from public.study_sessions where id = p_id and status = 'running' for update;
  if not found then return 0; end if;
  v_min := least(240, greatest(0, floor(extract(epoch from (p_end - v_s.started_at)) / 60)))::integer;
  if v_min < 1 then
    delete from public.study_sessions where id = p_id;
    return 0;
  end if;
  select coalesce(timezone, 'UTC') into v_tz from public.profiles where id = v_s.user_id;
  insert into public.activity_days (user_id, day, minutes, events)
  values (v_s.user_id, (v_s.started_at at time zone v_tz)::date, v_min, 1)
  on conflict (user_id, day) do update set minutes = public.activity_days.minutes + excluded.minutes,
                                           events = public.activity_days.events + 1;
  update public.study_sessions
     set status = 'closed', ended_at = greatest(p_end, v_s.started_at), minutes = v_min, last_seen_at = greatest(p_end, v_s.started_at)
   where id = p_id;
  return v_min;
end $$;

-- mark_revised used to bump user_stats.revisions itself; refresh_stats now owns that number.
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
  return jsonb_build_object('topic_id', p_topic_id, 'was_due', v_due, 'days', v_days, 'cycle', v_tp.revision_cycle + 1);
end $$;

-- ---------------------------------------------------------------- reads
-- Everything the UI needs: level, XP to next level, streak, badges and recent XP.
create or replace function public.my_game() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); c jsonb := private.game_cfg(); st public.user_stats; s record;
        v_div numeric; v_max integer; v_lvl integer; v_today date;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform private.refresh_stats(v_uid);
  perform private.evaluate_badges(v_uid);
  select * into st from public.user_stats where user_id = v_uid;
  s := private.streak_info(v_uid);
  v_div := coalesce((c -> 'levels' ->> 'divisor')::numeric, 40);
  v_max := coalesce((c -> 'levels' ->> 'max_level')::integer, 7);
  v_lvl := least(v_max, floor(sqrt(st.xp / v_div))::integer + 1);
  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today from public.profiles where id = v_uid;
  return jsonb_build_object(
    'xp', st.xp, 'level', v_lvl, 'max_level', v_max,
    'title', (select t ->> 'title' from jsonb_array_elements(c -> 'levels' -> 'titles') t where (t ->> 'level')::integer = v_lvl),
    'level_floor_xp', (v_div * (v_lvl - 1) * (v_lvl - 1))::integer,
    'next_level_xp', case when v_lvl >= v_max then null else (v_div * v_lvl * v_lvl)::integer end,
    'next_title', (select t ->> 'title' from jsonb_array_elements(c -> 'levels' -> 'titles') t where (t ->> 'level')::integer = v_lvl + 1),
    'streak', s.current_streak, 'longest_streak', greatest(s.longest_streak, st.longest_streak),
    'active_today', exists (select 1 from public.activity_days where user_id = v_uid and day = v_today and (minutes > 0 or events > 0)),
    'stats', jsonb_build_object('topics_done', st.topics_done, 'notes', st.notes, 'revisions', st.revisions, 'study_minutes', st.study_minutes),
    'badges', (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'icon', b.icon, 'rule', b.rule, 'earned_at', ub.awarded_at) order by b.sort_order)
               from public.badges b left join public.user_badges ub on ub.badge_id = b.id and ub.user_id = v_uid),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'points', x.points, 'ref', x.ref, 'at', x.created_at) order by x.created_at desc)
               from (select * from public.xp_events where user_id = v_uid order by created_at desc limit 10) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- backfill existing users
-- Award XP for everything done before this migration, using the same idempotency keys.
do $$
declare u record; r record;
begin
  for u in select id from public.profiles loop
    for r in select topic_id, coalesce(first_done_at, done_at, updated_at) as at from public.topic_progress where user_id = u.id and status = 2 loop
      perform private.award_xp(u.id, 'topic_done', 'topic_done:' || r.topic_id, 1, jsonb_build_object('topic_id', r.topic_id, 'backfill', true));
      perform private.touch_day(u.id, r.at);
    end loop;
    for r in select topic_id, updated_at from public.notes where user_id = u.id
             and char_length(btrim(body_md)) >= coalesce((private.game_cfg() -> 'xp' -> 'note' ->> 'min_chars')::integer, 20) loop
      perform private.award_xp(u.id, 'note', 'note:' || r.topic_id, 1, jsonb_build_object('topic_id', r.topic_id, 'backfill', true));
      perform private.touch_day(u.id, r.updated_at);
    end loop;
    for r in select distinct on (topic_id) topic_id, created_at from public.attachments where user_id = u.id order by topic_id, created_at loop
      perform private.award_xp(u.id, 'attachment', 'attachment:' || r.topic_id, 1, jsonb_build_object('topic_id', r.topic_id, 'backfill', true));
      perform private.touch_day(u.id, r.created_at);
    end loop;
    for r in select topic_id, cycle, revised_at from public.revisions where user_id = u.id and was_due loop
      perform private.award_xp(u.id, 'revision', 'revision:' || r.topic_id || ':' || r.cycle, 1, jsonb_build_object('topic_id', r.topic_id, 'backfill', true));
    end loop;
    for r in select id, minutes from public.study_sessions where user_id = u.id and status = 'closed' and minutes > 0 loop
      perform private.award_xp(u.id, 'study_minute', 'session:' || r.id, r.minutes, jsonb_build_object('minutes', r.minutes, 'backfill', true));
    end loop;
    perform private.after_activity(u.id);
  end loop;
end $$;

-- Admin list shows the live streak (it decays when a day is missed, even without new activity).
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.admin_list_users(text, integer, integer)'::regprocedure) into v_src;
  v_src := replace(v_src, $r$'streak', coalesce(s.current_streak, 0)$r$, $r$'streak', private.current_streak(pg.id)$r$);
  execute v_src;
end $$;

-- ---------------------------------------------------------------- privileges
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
revoke all on function public.my_game(), public.mark_revised(text) from public, anon, authenticated;
grant execute on function public.my_game(), public.mark_revised(text) to authenticated;
