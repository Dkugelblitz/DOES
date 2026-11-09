-- Milestone 10: encouragement data, admin analytics, admin content editing with version
-- history, and private custom topics.

-- =========================================================================
-- Game deltas, so the UI can cheer: XP gained, level change and new badges.
-- =========================================================================
create or replace function private.game_snapshot(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'xp', coalesce((select xp from public.user_stats where user_id = p_uid), 0),
    'badges', coalesce((select jsonb_agg(badge_id) from public.user_badges where user_id = p_uid), '[]'::jsonb))
$$;

create or replace function private.game_delta(p_uid uuid, p_before jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  with a as (select private.game_snapshot(p_uid) as s)
  select jsonb_build_object(
    'xp_before', (p_before ->> 'xp')::integer, 'xp_after', (a.s ->> 'xp')::integer,
    'new_badges', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'icon', b.icon) order by b.sort_order)
                            from public.badges b
                            where (a.s -> 'badges') ? b.id and not ((p_before -> 'badges') ? b.id)), '[]'::jsonb))
  from a
$$;

create or replace function public.set_topic_status(p_topic_id text, p_status smallint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_row public.topic_progress; v_before jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_status is null or p_status not between 0 and 2 then raise exception 'invalid status' using errcode = '22023'; end if;
  if not private.topic_visible(p_topic_id, v_uid) then raise exception 'topic not available' using errcode = '42501'; end if;
  v_before := private.game_snapshot(v_uid);
  insert into public.topic_progress (user_id, topic_id, status) values (v_uid, p_topic_id, p_status)
  on conflict (user_id, topic_id) do update set status = excluded.status
  returning * into v_row;
  return jsonb_build_object('topic_id', v_row.topic_id, 'status', v_row.status, 'done_at', v_row.done_at,
                            'game', private.game_delta(v_uid, v_before));
end $$;

create or replace function public.set_subtopic_done(p_subtopic_id text, p_done boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_topic text; v_total integer; v_done integer; v_drive boolean; v_status smallint; v_before jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select s.topic_id into v_topic from public.subtopics s where s.id = p_subtopic_id and s.archived_at is null;
  if v_topic is null or not private.topic_visible(v_topic, v_uid) then
    raise exception 'subtopic not available' using errcode = '42501';
  end if;
  v_before := private.game_snapshot(v_uid);
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
    insert into public.topic_progress (user_id, topic_id, status)
    values (v_uid, v_topic, (case when v_done = v_total then 2 when v_done > 0 then 1 else 0 end)::smallint)
    on conflict (user_id, topic_id) do update set status = excluded.status;
  end if;
  select tp.status into v_status from public.topic_progress tp where tp.user_id = v_uid and tp.topic_id = v_topic;
  return jsonb_build_object('topic_id', v_topic, 'subtopics_done', v_done, 'subtopics_total', v_total, 'status', coalesce(v_status, 0),
                            'game', private.game_delta(v_uid, v_before));
end $$;

-- The next topic to suggest: first not-started Pareto core topic for the level, else the first
-- not-started roadmap topic, in roadmap order.
create or replace function public.my_next_topic(p_level smallint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); r record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_level is null or not (p_level = any(private.held_levels(v_uid))) then raise exception 'level % not granted', p_level using errcode = '42501'; end if;
  select t.id, t.name, (p_level = any(t.pareto_levels)) as core into r
  from public.topics t join public.domains d on d.slug = t.domain_slug
  left join public.topic_progress tp on tp.user_id = v_uid and tp.topic_id = t.id
  where t.owner_id is null and t.archived_at is null and t.min_level <= p_level and coalesce(tp.status, 0) = 0
  order by (p_level = any(t.pareto_levels)) desc, d.sort_order, t.sort_order
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object('topic_id', r.id, 'name', r.name, 'core', r.core);
end $$;

-- =========================================================================
-- Admin analytics (aggregates only; never note text, links or files)
-- =========================================================================
create or replace function public.admin_analytics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_week date := date_trunc('week', now())::date; v_rev30 integer; v_due integer;
begin
  perform private.require_admin();
  select count(*) into v_rev30 from public.revisions where was_due and revised_at > now() - interval '30 days';
  select coalesce(sum((select count(*) from private.due_topics(p.id))), 0) into v_due from public.profiles p where p.disabled_at is null;
  return jsonb_build_object(
    'weeks', (select jsonb_agg(jsonb_build_object('week', w.d::date,
                'active_users', (select count(distinct a.user_id) from public.activity_days a where a.day >= w.d::date and a.day < w.d::date + 7 and (a.minutes > 0 or a.events > 0)),
                'study_minutes', (select coalesce(sum(a.minutes), 0) from public.activity_days a where a.day >= w.d::date and a.day < w.d::date + 7)) order by w.d)
              from generate_series((v_week - 49)::timestamp, v_week::timestamp, interval '7 days') w(d)),
    'avg_session_minutes', (select coalesce(round(avg(minutes)), 0) from public.study_sessions where status = 'closed'),
    'avg_weekly_minutes_per_active_user', (select coalesce(round(avg(m)), 0) from (
        select sum(a.minutes) as m from public.activity_days a where a.day >= current_date - 28 group by a.user_id, date_trunc('week', a.day) having sum(a.minutes) > 0) x),
    'level_distribution', (select jsonb_agg(jsonb_build_object('level', l.level, 'name', l.name,
        'granted', (select count(distinct g.user_id) from public.level_grants g where g.level = l.level and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())),
        'active', (select count(*) from public.profiles p where p.active_level = l.level and p.disabled_at is null)) order by l.level) from public.levels l),
    'most_bookmarked', coalesce((select jsonb_agg(x) from (
        select t.id as topic_id, t.name, count(*) as n from public.bookmarks b join public.topics t on t.id = b.topic_id
        where t.owner_id is null group by t.id, t.name order by count(*) desc, t.name limit 10) x), '[]'::jsonb),
    'least_completed', coalesce((select jsonb_agg(x) from (
        select t.id as topic_id, t.name, t.min_level,
               (select count(*) from public.topic_progress tp where tp.topic_id = t.id and tp.status = 2) as done
        from public.topics t where t.owner_id is null and t.archived_at is null
        order by 4, t.min_level, t.name limit 10) x), '[]'::jsonb),
    'revision', jsonb_build_object('done_on_time_30d', v_rev30, 'currently_due', v_due,
        'rate', case when v_rev30 + v_due = 0 then null else round(v_rev30::numeric / (v_rev30 + v_due), 2) end)
  );
end $$;

-- =========================================================================
-- Admin content editing. Every save bumps the version, stores a full snapshot in
-- content_versions (append-only) and writes an audit entry with before/after.
-- =========================================================================
create or replace function private.slugify(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(replace(coalesce(p, ''), '&', ' and ')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function private.topic_snapshot(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(t) - 'updated_at' || jsonb_build_object('subtopics', coalesce((
    select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name) order by s.sort_order)
    from public.subtopics s where s.topic_id = t.id and s.archived_at is null), '[]'::jsonb))
  from public.topics t where t.id = p_id
$$;

create or replace function private.record_version(p_actor uuid, p_type text, p_id text, p_version integer, p_before jsonb, p_after jsonb, p_action text default 'content_edit')
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.content_versions (entity_type, entity_id, version, data, edited_by) values (p_type, p_id, p_version, p_after, p_actor);
  perform private.audit(p_actor, p_action, null, p_type, p_id, p_before, p_after);
end $$;

-- p: {id?, domain_slug?, module_slug?, name?, min_level?, pareto_levels?, sort_order?, archived?, subtopics?: [name | {name}]}
create or replace function public.admin_save_topic(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_id text := nullif(p ->> 'id', ''); v_before jsonb; v_t public.topics;
        v_name text; v_dom text; v_mod text; v_slug text; v_n integer := 0; v_sub jsonb; v_sname text; v_sslug text; v_keep text[] := '{}';
begin
  if v_id is null then
    v_dom := p ->> 'domain_slug'; v_mod := p ->> 'module_slug'; v_name := btrim(p ->> 'name');
    if v_name is null or v_name = '' then raise exception 'a topic needs a name' using errcode = '22023'; end if;
    if not exists (select 1 from public.modules where domain_slug = v_dom and slug = v_mod) then raise exception 'choose an existing domain and module' using errcode = '22023'; end if;
    v_slug := private.slugify(v_name); if v_slug = '' then v_slug := 'topic'; end if;
    v_id := v_dom || '/' || v_slug;
    while exists (select 1 from public.topics where id = v_id) loop v_n := v_n + 1; v_id := v_dom || '/' || v_slug || '-' || v_n; end loop;
    insert into public.topics (id, domain_slug, module_slug, slug, name, sort_order, min_level, pareto_levels, provenance, version)
    values (v_id, v_dom, v_mod, split_part(v_id, '/', 2), v_name,
            coalesce((p ->> 'sort_order')::integer, (select coalesce(max(sort_order), 0) + 1 from public.topics where domain_slug = v_dom)),
            coalesce((p ->> 'min_level')::smallint, 1), '{}', jsonb_build_object('basis', 'admin'), 0);
  else
    v_before := private.topic_snapshot(v_id);
    if v_before is null or (v_before ->> 'owner_id') is not null then raise exception 'topic not found' using errcode = 'P0002'; end if;
  end if;

  update public.topics set
    name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
    module_slug = coalesce(p ->> 'module_slug', module_slug),
    min_level = coalesce((p ->> 'min_level')::smallint, min_level),
    pareto_levels = case when p ? 'pareto_levels' then array(select distinct x::smallint from jsonb_array_elements_text(p -> 'pareto_levels') x order by 1) else pareto_levels end,
    sort_order = coalesce((p ->> 'sort_order')::integer, sort_order),
    archived_at = case when p ? 'archived' then (case when (p ->> 'archived')::boolean then coalesce(archived_at, now()) end) else archived_at end,
    version = version + 1, updated_at = now()
  where id = v_id returning * into v_t;

  if p ? 'subtopics' then
    v_n := 0;
    for v_sub in select * from jsonb_array_elements(p -> 'subtopics') loop
      v_sname := btrim(case jsonb_typeof(v_sub) when 'string' then v_sub #>> '{}' else v_sub ->> 'name' end);
      continue when v_sname is null or v_sname = '';
      v_sslug := coalesce(nullif(private.slugify(v_sname), ''), 'sub');
      while v_sslug = any(v_keep) loop v_sslug := v_sslug || '-x'; end loop;
      v_n := v_n + 1; v_keep := v_keep || v_sslug;
      insert into public.subtopics (id, topic_id, slug, name, sort_order) values (v_id || '#' || v_sslug, v_id, v_sslug, v_sname, v_n)
      on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order, archived_at = null;
    end loop;
    -- Removed subtopics are archived, not deleted, so people's ticks come back if one is restored.
    update public.subtopics set archived_at = now() where topic_id = v_id and archived_at is null and not (slug = any(v_keep));
  end if;

  perform private.record_version(v_actor, 'topic', v_id, v_t.version, v_before, private.topic_snapshot(v_id));
  return private.topic_snapshot(v_id);
end $$;

-- p: {id?, deck, question, answer, topic_id, min_level_override?, sort_order?, archived?}
create or replace function public.admin_save_card(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_id text := nullif(p ->> 'id', ''); v_before jsonb; v_c public.cards; v_base text; v_n integer := 0;
begin
  if coalesce(btrim(p ->> 'question'), '') = '' or coalesce(btrim(p ->> 'answer'), '') = '' or coalesce(btrim(p ->> 'deck'), '') = '' then
    raise exception 'a card needs a deck, a question and an answer' using errcode = '22023'; end if;
  if not exists (select 1 from public.topics where id = p ->> 'topic_id' and owner_id is null) then
    raise exception 'link the card to an existing topic' using errcode = '22023'; end if;
  if v_id is null then
    v_base := left(private.slugify((p ->> 'deck') || ' ' || (p ->> 'question')), 60); v_id := v_base;
    while exists (select 1 from public.cards where id = v_id) loop v_n := v_n + 1; v_id := v_base || '-' || v_n; end loop;
    insert into public.cards (id, deck, question, answer, topic_id, sort_order, version)
    values (v_id, btrim(p ->> 'deck'), btrim(p ->> 'question'), btrim(p ->> 'answer'), p ->> 'topic_id', (select coalesce(max(sort_order), 0) + 1 from public.cards), 0);
  else
    select to_jsonb(c) - 'updated_at' into v_before from public.cards c where id = v_id;
    if v_before is null then raise exception 'card not found' using errcode = 'P0002'; end if;
  end if;
  update public.cards set deck = btrim(p ->> 'deck'), question = btrim(p ->> 'question'), answer = btrim(p ->> 'answer'), topic_id = p ->> 'topic_id',
    min_level_override = nullif(p ->> 'min_level_override', '')::smallint,
    sort_order = coalesce((p ->> 'sort_order')::integer, sort_order),
    archived_at = case when p ? 'archived' then (case when (p ->> 'archived')::boolean then coalesce(archived_at, now()) end) else archived_at end,
    version = version + 1, updated_at = now()
  where id = v_id returning * into v_c;
  perform private.record_version(v_actor, 'card', v_id, v_c.version, v_before, to_jsonb(v_c) - 'updated_at');
  return to_jsonb(v_c);
end $$;

-- p: {id?, title, min_level, points: [text], topic_ids?: [text], sort_order?, archived?}
create or replace function public.admin_save_design(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_id text := nullif(p ->> 'id', ''); v_before jsonb; v_d public.designs;
        v_points text[]; v_topics text[]; v_base text; v_n integer := 0;
begin
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_points from jsonb_array_elements_text(coalesce(p -> 'points', '[]')) x;
  select coalesce(array_agg(x), '{}') into v_topics from jsonb_array_elements_text(coalesce(p -> 'topic_ids', '[]')) x;
  if coalesce(btrim(p ->> 'title'), '') = '' or cardinality(v_points) = 0 then raise exception 'a design needs a title and at least one point' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_topics) t where not exists (select 1 from public.topics where id = t and owner_id is null)) then
    raise exception 'related topics must exist' using errcode = '22023'; end if;
  if v_id is null then
    v_base := left(private.slugify(p ->> 'title'), 60); v_id := v_base;
    while exists (select 1 from public.designs where id = v_id) loop v_n := v_n + 1; v_id := v_base || '-' || v_n; end loop;
    insert into public.designs (id, title, min_level, points, topic_ids, sort_order, version)
    values (v_id, btrim(p ->> 'title'), coalesce((p ->> 'min_level')::smallint, 3), v_points, v_topics, (select coalesce(max(sort_order), 0) + 1 from public.designs), 0);
  else
    select to_jsonb(d) - 'updated_at' into v_before from public.designs d where id = v_id;
    if v_before is null then raise exception 'design not found' using errcode = 'P0002'; end if;
  end if;
  update public.designs set title = btrim(p ->> 'title'), min_level = coalesce((p ->> 'min_level')::smallint, min_level), points = v_points, topic_ids = v_topics,
    sort_order = coalesce((p ->> 'sort_order')::integer, sort_order),
    archived_at = case when p ? 'archived' then (case when (p ->> 'archived')::boolean then coalesce(archived_at, now()) end) else archived_at end,
    version = version + 1, updated_at = now()
  where id = v_id returning * into v_d;
  perform private.record_version(v_actor, 'design', v_id, v_d.version, v_before, to_jsonb(v_d) - 'updated_at');
  return to_jsonb(v_d);
end $$;

-- Documents: HackerRank guide, messages, gamification rules, settings, design framework, sprint intro.
-- Each key has a minimal shape check so a typo can't break the app.
create or replace function private.check_document(p_key text, d jsonb) returns void
language plpgsql immutable as $$
declare k text;
begin
  if jsonb_typeof(d) <> 'object' then raise exception 'the document must be a JSON object' using errcode = '22023'; end if;
  case p_key
    when 'hackerrank' then
      if jsonb_typeof(d -> 'sections') <> 'array' or jsonb_array_length(d -> 'sections') = 0
         or exists (select 1 from jsonb_array_elements(d -> 'sections') s where coalesce(s ->> 'title', '') = '' or coalesce(s ->> 'body', '') = '')
      then raise exception 'hackerrank needs "sections": [{"title", "body"}, ...]' using errcode = '22023'; end if;
    when 'messages' then
      if jsonb_typeof(d -> 'greeting') <> 'object' or jsonb_typeof(d -> 'topic_done_cheers') <> 'array' or jsonb_array_length(d -> 'topic_done_cheers') = 0
         or jsonb_typeof(d -> 'closing' -> 'farewells') <> 'array'
      then raise exception 'messages needs "greeting", "topic_done_cheers" and "closing.farewells"' using errcode = '22023'; end if;
    when 'gamification' then
      foreach k in array array['topic_done', 'revision', 'note', 'attachment', 'study_minute'] loop
        if coalesce((d -> 'xp' -> k ->> 'points')::numeric, -1) < 0 then raise exception 'gamification.xp.%.points must be 0 or more', k using errcode = '22023'; end if;
      end loop;
      if coalesce((d -> 'levels' ->> 'divisor')::numeric, 0) <= 0 or coalesce((d -> 'levels' ->> 'max_level')::integer, 0) not between 1 and 20
         or jsonb_array_length(coalesce(d -> 'levels' -> 'titles', '[]')) <> (d -> 'levels' ->> 'max_level')::integer
      then raise exception 'gamification.levels needs a positive divisor, max_level 1-20 and one title per level' using errcode = '22023'; end if;
      if coalesce((d -> 'revision' ->> 'due_after_days')::integer, 0) < 1 or coalesce((d -> 'revision' ->> 'overdue_after_days')::integer, 0) <= (d -> 'revision' ->> 'due_after_days')::integer
      then raise exception 'gamification.revision needs due_after_days >= 1 and overdue_after_days greater than it' using errcode = '22023'; end if;
      if exists (select 1 from jsonb_array_elements(coalesce(d -> 'badges', '[]')) b
                 where coalesce(b ->> 'id', '') = '' or coalesce(b ->> 'name', '') = '' or not (b -> 'rule' ->> 'type' = any(array['topics_done', 'streak_days', 'study_minutes', 'notes_count', 'revisions_count', 'pareto_complete', 'session_start_local_hour'])))
      then raise exception 'each badge needs an id, a name and a known rule type' using errcode = '22023'; end if;
    when 'settings' then
      if jsonb_typeof(d -> 'progress') <> 'object' or jsonb_typeof(d -> 'uploads') <> 'object' or jsonb_typeof(d -> 'summary') <> 'object'
      then raise exception 'settings needs "progress", "uploads" and "summary"' using errcode = '22023'; end if;
    when 'design_framework' then
      if jsonb_typeof(d -> 'steps') <> 'array' or jsonb_array_length(d -> 'steps') = 0 then raise exception 'design_framework needs "steps"' using errcode = '22023'; end if;
    when 'sprint_intro' then
      if coalesce(d ->> 'intro', '') = '' then raise exception 'sprint_intro needs "intro"' using errcode = '22023'; end if;
    else raise exception 'unknown document %', p_key using errcode = '22023';
  end case;
end $$;

create or replace function public.admin_save_document(p_key text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_before jsonb; v_doc public.content_documents; b jsonb; v_i integer := 0;
begin
  perform private.check_document(p_key, p_data);
  select jsonb_build_object('data', data, 'min_level', min_level) into v_before from public.content_documents where key = p_key;
  if v_before is null then raise exception 'document not found' using errcode = 'P0002'; end if;
  update public.content_documents set data = p_data, version = version + 1, updated_at = now() where key = p_key returning * into v_doc;
  -- Badge rules are evaluated from the badges table: keep it in sync (badges can be added or changed, not removed).
  if p_key = 'gamification' then
    for b in select * from jsonb_array_elements(coalesce(p_data -> 'badges', '[]')) loop
      v_i := v_i + 1;
      insert into public.badges (id, name, icon, rule, sort_order) values (b ->> 'id', b ->> 'name', coalesce(b ->> 'icon', '🏅'), b -> 'rule', coalesce((b ->> 'order')::integer, v_i))
      on conflict (id) do update set name = excluded.name, icon = excluded.icon, rule = excluded.rule, sort_order = excluded.sort_order;
    end loop;
  end if;
  perform private.record_version(v_actor, 'document', p_key, v_doc.version, v_before, jsonb_build_object('data', v_doc.data, 'min_level', v_doc.min_level));
  return to_jsonb(v_doc);
end $$;

-- Restore any earlier version (it becomes a new version; history is never rewritten).
create or replace function public.admin_restore_version(p_type text, p_id text, p_version integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.admin_guard(); v_data jsonb; v_res jsonb;
begin
  select data into v_data from public.content_versions where entity_type = p_type and entity_id = p_id and version = p_version;
  if v_data is null then raise exception 'version not found' using errcode = 'P0002'; end if;
  v_res := case p_type
    when 'topic' then public.admin_save_topic(v_data || jsonb_build_object('archived', (v_data ->> 'archived_at') is not null))
    when 'card' then public.admin_save_card(v_data || jsonb_build_object('archived', (v_data ->> 'archived_at') is not null))
    when 'design' then public.admin_save_design(v_data || jsonb_build_object('archived', (v_data ->> 'archived_at') is not null))
    when 'document' then public.admin_save_document(p_id, v_data -> 'data')
    else null end;
  if v_res is null then raise exception 'versions of % can''t be restored here', p_type using errcode = '22023'; end if;
  perform private.audit(v_actor, 'content_restore', null, p_type, p_id, null, jsonb_build_object('restored_version', p_version));
  return v_res;
end $$;

-- Read side of the content editor: full rows including archived items and Pareto flags,
-- which learners can't read directly. Admins only.
create or replace function public.admin_content(p_kind text, p_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return case p_kind
    when 'topics' then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'domain_slug', t.domain_slug, 'module_slug', t.module_slug,
        'min_level', t.min_level, 'pareto_levels', t.pareto_levels, 'sort_order', t.sort_order, 'archived', t.archived_at is not null, 'version', t.version,
        'subtopics', (select count(*) from public.subtopics s where s.topic_id = t.id and s.archived_at is null)) order by d.sort_order, t.sort_order)
      from public.topics t join public.domains d on d.slug = t.domain_slug where t.owner_id is null and (p_id is null or t.domain_slug = p_id)), '[]'::jsonb)
    when 'topic' then (select private.topic_snapshot(t.id) || jsonb_build_object('modules',
        (select jsonb_agg(jsonb_build_object('slug', m.slug, 'name', m.name) order by m.sort_order) from public.modules m where m.domain_slug = t.domain_slug and m.slug <> 'my-topics'))
      from public.topics t where t.id = p_id and t.owner_id is null)
    when 'cards' then coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('topic_name', t.name) order by c.sort_order) from public.cards c join public.topics t on t.id = c.topic_id), '[]'::jsonb)
    when 'card' then (select to_jsonb(c) from public.cards c where c.id = p_id)
    when 'designs' then coalesce((select jsonb_agg(to_jsonb(d) order by d.sort_order) from public.designs d), '[]'::jsonb)
    when 'design' then (select to_jsonb(d) from public.designs d where d.id = p_id)
    when 'documents' then coalesce((select jsonb_agg(jsonb_build_object('key', key, 'version', version, 'updated_at', updated_at) order by key) from public.content_documents), '[]'::jsonb)
    when 'document' then (select to_jsonb(d) from public.content_documents d where d.key = p_id)
    else null end;
end $$;

-- =========================================================================
-- Private custom topics (each user's own; never visible to anyone else)
-- =========================================================================
insert into public.modules (domain_slug, slug, name, sort_order)
select slug, 'my-topics', 'My topics', 999 from public.domains on conflict do nothing;

create or replace function public.create_custom_topic(p_domain text, p_name text, p_subtopics text[] default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_id text; v_name text := btrim(coalesce(p_name, '')); v_s text; v_n integer := 0; v_slug text; v_keep text[] := '{}';
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_name = '' or char_length(v_name) > 160 then raise exception 'give your topic a name (up to 160 characters)' using errcode = '22023'; end if;
  if not exists (select 1 from public.domains where slug = p_domain and archived_at is null) then raise exception 'choose a domain' using errcode = '22023'; end if;
  if (select count(*) from public.topics where owner_id = v_uid) >= 50 then raise exception 'you can add up to 50 of your own topics' using errcode = '22023'; end if;
  if not private.rate_limit('custom:' || v_uid::text, 30, 3600) then raise exception 'too many new topics at once; wait a little' using errcode = '54000'; end if;
  insert into public.modules (domain_slug, slug, name, sort_order) values (p_domain, 'my-topics', 'My topics', 999) on conflict do nothing;
  v_id := p_domain || '/my-' || substr(md5(gen_random_uuid()::text), 1, 10);
  insert into public.topics (id, domain_slug, module_slug, slug, name, sort_order, min_level, pareto_levels, owner_id, provenance)
  values (v_id, p_domain, 'my-topics', split_part(v_id, '/', 2), v_name, 1000, 1, '{}', v_uid, jsonb_build_object('basis', 'custom'));
  foreach v_s in array coalesce(p_subtopics, '{}') loop
    v_s := btrim(v_s); continue when v_s = '' or v_n >= 30;
    v_slug := coalesce(nullif(private.slugify(v_s), ''), 'sub');
    while v_slug = any(v_keep) loop v_slug := v_slug || '-x'; end loop;
    v_n := v_n + 1; v_keep := v_keep || v_slug;
    insert into public.subtopics (id, topic_id, slug, name, sort_order) values (v_id || '#' || v_slug, v_id, v_slug, left(v_s, 200), v_n);
  end loop;
  return jsonb_build_object('topic_id', v_id);
end $$;

create or replace function public.delete_custom_topic(p_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.topics where id = p_id and owner_id = v_uid) then raise exception 'topic not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.attachments where topic_id = p_id) then raise exception 'remove this topic''s files first' using errcode = '22023'; end if;
  delete from public.xp_events where user_id = v_uid and ref ->> 'topic_id' = p_id;  -- no XP farming by create/finish/delete
  delete from public.topics where id = p_id and owner_id = v_uid;
  perform private.after_activity(v_uid);
end $$;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.active_uid(), private.is_admin(uuid), private.held_levels(uuid), private.max_level(uuid),
  private.topic_visible(text, uuid), private.subtopic_visible(text), private.card_level(text), private.sprint_item_visible(text),
  private.topic_shared(uuid, text) to authenticated;
revoke all on function public.set_topic_status(text, smallint), public.set_subtopic_done(text, boolean), public.my_next_topic(smallint),
  public.admin_analytics(), public.admin_content(text, text), public.admin_save_topic(jsonb), public.admin_save_card(jsonb), public.admin_save_design(jsonb),
  public.admin_save_document(text, jsonb), public.admin_restore_version(text, text, integer),
  public.create_custom_topic(text, text, text[]), public.delete_custom_topic(text) from public, anon, authenticated;
grant execute on function public.set_topic_status(text, smallint), public.set_subtopic_done(text, boolean), public.my_next_topic(smallint),
  public.admin_analytics(), public.admin_content(text, text), public.admin_save_topic(jsonb), public.admin_save_card(jsonb), public.admin_save_design(jsonb),
  public.admin_save_document(text, jsonb), public.admin_restore_version(text, text, integer),
  public.create_custom_topic(text, text, text[]), public.delete_custom_topic(text) to authenticated;
