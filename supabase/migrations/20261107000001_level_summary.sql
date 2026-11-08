-- Per-level content summary for the "View as" level. Refuses levels the caller doesn't hold.
-- Counts what that level's view contains (min_level <= level), not everything the caller may see.
create or replace function public.level_summary(p_level smallint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.active_uid() is null or p_level is null or not (p_level = any(private.held_levels())) then
    raise exception 'level % not granted', p_level using errcode = '42501';
  end if;
  return jsonb_build_object(
    'level', p_level,
    'topics', (select count(*) from public.topics t where t.archived_at is null and t.owner_id is null and t.min_level <= p_level),
    'pareto', (select count(*) from public.topics t where t.archived_at is null and t.owner_id is null and t.min_level <= p_level and p_level = any(t.pareto_levels)),
    'subtopics', (select count(*) from public.subtopics s join public.topics t on t.id = s.topic_id
                  where s.archived_at is null and t.archived_at is null and t.owner_id is null and t.min_level <= p_level),
    'cards', (select count(*) from public.cards c join public.topics t on t.id = c.topic_id
              where c.archived_at is null and coalesce(c.min_level_override, t.min_level) <= p_level),
    'designs', (select count(*) from public.designs d where d.archived_at is null and d.min_level <= p_level),
    'sprint_items', (select count(*) from public.sprint_items i join public.sprint_blocks b on b.id = i.block_id
                     where b.archived_at is null and b.min_level <= p_level and i.min_level <= p_level),
    'domains', coalesce((select jsonb_agg(x order by x.sort_order) from (
        select d.slug, d.name, d.icon, d.sort_order,
               (select count(*) from public.topics t where t.domain_slug = d.slug and t.archived_at is null
                  and t.owner_id is null and t.min_level <= p_level) as topics
        from public.domains d where d.archived_at is null) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.level_summary(smallint) from public, anon, authenticated;
grant execute on function public.level_summary(smallint) to authenticated;
