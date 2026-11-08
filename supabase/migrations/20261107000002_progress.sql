-- Progress writes. Both functions check the topic is visible to the caller, so a user can't
-- record progress against content their levels don't include. Timestamps are set by the
-- topic_progress trigger, never by the client.

create or replace function public.set_topic_status(p_topic_id text, p_status smallint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_row public.topic_progress;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_status is null or p_status not between 0 and 2 then raise exception 'invalid status' using errcode = '22023'; end if;
  if not private.topic_visible(p_topic_id, v_uid) then raise exception 'topic not available' using errcode = '42501'; end if;
  insert into public.topic_progress (user_id, topic_id, status) values (v_uid, p_topic_id, p_status)
  on conflict (user_id, topic_id) do update set status = excluded.status
  returning * into v_row;
  return jsonb_build_object('topic_id', v_row.topic_id, 'status', v_row.status, 'done_at', v_row.done_at);
end $$;

-- Ticking subtopics drives the topic status (all = done, some = in progress, none = not started)
-- when settings.progress.subtopics_drive_status is true (the default).
create or replace function public.set_subtopic_done(p_subtopic_id text, p_done boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_topic text; v_total integer; v_done integer; v_drive boolean; v_status smallint;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select s.topic_id into v_topic from public.subtopics s where s.id = p_subtopic_id and s.archived_at is null;
  if v_topic is null or not private.topic_visible(v_topic, v_uid) then
    raise exception 'subtopic not available' using errcode = '42501';
  end if;
  if coalesce(p_done, false) then
    insert into public.subtopic_progress (user_id, subtopic_id, done) values (v_uid, p_subtopic_id, true)
    on conflict (user_id, subtopic_id) do update set done = true, updated_at = now();
  else
    delete from public.subtopic_progress where user_id = v_uid and subtopic_id = p_subtopic_id;
  end if;
  select count(*), count(sp.subtopic_id) into v_total, v_done
  from public.subtopics s
  left join public.subtopic_progress sp on sp.subtopic_id = s.id and sp.user_id = v_uid and sp.done
  where s.topic_id = v_topic and s.archived_at is null;
  select coalesce((d.data -> 'progress' ->> 'subtopics_drive_status')::boolean, true) into v_drive
  from public.content_documents d where d.key = 'settings';
  if coalesce(v_drive, true) then
    perform public.set_topic_status(v_topic, (case when v_done = v_total then 2 when v_done > 0 then 1 else 0 end)::smallint);
  end if;
  select tp.status into v_status from public.topic_progress tp where tp.user_id = v_uid and tp.topic_id = v_topic;
  return jsonb_build_object('topic_id', v_topic, 'subtopics_done', v_done, 'subtopics_total', v_total, 'status', coalesce(v_status, 0));
end $$;

revoke all on function public.set_topic_status(text, smallint), public.set_subtopic_done(text, boolean) from public, anon, authenticated;
grant execute on function public.set_topic_status(text, smallint), public.set_subtopic_done(text, boolean) to authenticated;
