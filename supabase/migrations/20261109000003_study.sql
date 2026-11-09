-- Milestone 6: study timer and insights.
-- The server owns all timing: start time, heartbeats and duration. The client only says
-- start / heartbeat / stop. A session left running without heartbeats for 5 minutes (tab
-- closed, laptop asleep) is closed at its last heartbeat, so idle time never counts.
-- Sessions are capped at 240 minutes; longer study rolls over into a new session.

alter table public.study_sessions add column last_seen_at timestamptz;
update public.study_sessions set last_seen_at = coalesce(ended_at, started_at);
alter table public.study_sessions alter column last_seen_at set not null, alter column last_seen_at set default now();

-- Close one running session at p_end. Credits minutes to the user's local day and totals.
-- Sessions under a minute are discarded. Returns the minutes credited.
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
  update public.study_sessions
     set status = 'closed', ended_at = greatest(p_end, v_s.started_at), minutes = v_min, last_seen_at = greatest(p_end, v_s.started_at)
   where id = p_id;
  select coalesce(timezone, 'UTC') into v_tz from public.profiles where id = v_s.user_id;
  insert into public.activity_days (user_id, day, minutes, events)
  values (v_s.user_id, (v_s.started_at at time zone v_tz)::date, v_min, 1)
  on conflict (user_id, day) do update set minutes = public.activity_days.minutes + excluded.minutes,
                                           events = public.activity_days.events + 1;
  update public.user_stats set study_minutes = study_minutes + v_min, updated_at = now() where user_id = v_s.user_id;
  return v_min;
end $$;

-- Close the user's running session if it has gone quiet. Returns minutes credited (0 if none).
create or replace function private.close_stale(p_uid uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.study_sessions;
begin
  select * into v_s from public.study_sessions where user_id = p_uid and status = 'running';
  if found and v_s.last_seen_at < now() - interval '5 minutes' then
    return private.close_session(v_s.id, v_s.last_seen_at);
  end if;
  return 0;
end $$;

create or replace function private.session_state(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'server_now', now(),
    'running', (select jsonb_build_object('id', s.id, 'started_at', s.started_at, 'topic_id', s.topic_id, 'topic_name', t.name)
                from public.study_sessions s left join public.topics t on t.id = s.topic_id
                where s.user_id = p_uid and s.status = 'running'),
    'today_minutes', coalesce((select a.minutes from public.activity_days a join public.profiles p on p.id = a.user_id
                               where a.user_id = p_uid and a.day = (now() at time zone coalesce(p.timezone, 'UTC'))::date), 0)
  )
$$;

create or replace function public.study_state() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform private.close_stale(v_uid);
  return private.session_state(v_uid);
end $$;

-- Start a session (idempotent: returns the running one if there is one).
create or replace function public.start_study_session(p_topic_id text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_topic_id is not null and not private.topic_visible(p_topic_id, v_uid) then
    raise exception 'topic not available' using errcode = '42501';
  end if;
  perform private.close_stale(v_uid);
  if not private.rate_limit('study:' || v_uid::text, 120, 3600) then
    raise exception 'too many timer actions; wait a little' using errcode = '54000';
  end if;
  insert into public.study_sessions (user_id, topic_id, started_at, last_seen_at, status)
  values (v_uid, p_topic_id, now(), now(), 'running')
  on conflict (user_id) where status = 'running' do nothing;
  return private.session_state(v_uid);
end $$;

-- Keep-alive, sent about once a minute and when the tab is hidden or closed.
create or replace function public.heartbeat_study_session() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_s public.study_sessions; v_saved integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_saved := private.close_stale(v_uid);
  select * into v_s from public.study_sessions where user_id = v_uid and status = 'running' for update;
  if found then
    if now() >= v_s.started_at + interval '240 minutes' then
      -- Roll over: bank 240 minutes and continue in a fresh session from that point.
      perform private.close_session(v_s.id, v_s.started_at + interval '240 minutes');
      insert into public.study_sessions (user_id, topic_id, started_at, last_seen_at, status)
      values (v_uid, v_s.topic_id, v_s.started_at + interval '240 minutes', now(), 'running');
    else
      update public.study_sessions set last_seen_at = now() where id = v_s.id;
    end if;
  end if;
  return private.session_state(v_uid) || jsonb_build_object('auto_saved_minutes', v_saved);
end $$;

-- Pause or finish: close the running session now.
create or replace function public.stop_study_session() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_id uuid; v_min integer := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_min := private.close_stale(v_uid);
  select id into v_id from public.study_sessions where user_id = v_uid and status = 'running';
  if v_id is not null then v_min := v_min + private.close_session(v_id, now()); end if;
  return private.session_state(v_uid) || jsonb_build_object('saved_minutes', v_min,
    'topics_done', (select count(*) from public.topic_progress where user_id = v_uid and status = 2));
end $$;

-- Everything the Insights page needs, computed in the user's own timezone.
create or replace function public.my_insights() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_tz text; v_today date;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform private.close_stale(v_uid);
  select coalesce(timezone, 'UTC') into v_tz from public.profiles where id = v_uid;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'timezone', v_tz,
    'days', (select jsonb_agg(jsonb_build_object('day', g.d::date, 'minutes', coalesce(a.minutes, 0)) order by g.d)
             from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') g(d)
             left join public.activity_days a on a.user_id = v_uid and a.day = g.d::date),
    'buckets', (select jsonb_object_agg(v.b, coalesce(y.m, 0))
                from (values ('morning'), ('afternoon'), ('evening'), ('night')) v(b)
                left join (select case when h between 5 and 11 then 'morning' when h between 12 and 16 then 'afternoon'
                                       when h between 17 and 21 then 'evening' else 'night' end as bk, sum(minutes) as m
                           from (select extract(hour from started_at at time zone v_tz)::integer as h, minutes
                                 from public.study_sessions where user_id = v_uid and status = 'closed') x group by 1) y on y.bk = v.b),
    'sessions', (select count(*) from public.study_sessions where user_id = v_uid and status = 'closed'),
    'total_minutes', (select coalesce(sum(minutes), 0) from public.study_sessions where user_id = v_uid and status = 'closed'),
    'avg_minutes', (select coalesce(round(avg(minutes)), 0) from public.study_sessions where user_id = v_uid and status = 'closed'),
    'longest_minutes', (select coalesce(max(minutes), 0) from public.study_sessions where user_id = v_uid and status = 'closed'),
    'topics_done', (select count(*) from public.topic_progress where user_id = v_uid and status = 2),
    'topics_studied', (select count(distinct topic_id) from public.study_sessions where user_id = v_uid and status = 'closed' and topic_id is not null),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('started_at', s.started_at, 'minutes', s.minutes, 'topic_id', s.topic_id, 'topic_name', t.name) order by s.started_at desc)
               from (select * from public.study_sessions where user_id = v_uid and status = 'closed' order by started_at desc limit 10) s
               left join public.topics t on t.id = s.topic_id), '[]'::jsonb)
  );
end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
revoke all on function public.study_state(), public.start_study_session(text), public.heartbeat_study_session(),
  public.stop_study_session(), public.my_insights() from public, anon, authenticated;
grant execute on function public.study_state(), public.start_study_session(text), public.heartbeat_study_session(),
  public.stop_study_session(), public.my_insights() to authenticated;
