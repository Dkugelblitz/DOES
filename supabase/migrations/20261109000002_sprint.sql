-- Milestone 5: sprint checklist and flip-card mastery writes, level-checked like topic progress.

create or replace function public.set_sprint_item(p_item_id text, p_done boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not private.sprint_item_visible(p_item_id) then raise exception 'item not available' using errcode = '42501'; end if;
  if coalesce(p_done, false) then
    insert into public.sprint_progress (user_id, item_id, done) values (v_uid, p_item_id, true)
    on conflict (user_id, item_id) do update set done = true, updated_at = now();
  else
    delete from public.sprint_progress where user_id = v_uid and item_id = p_item_id;
  end if;
  return coalesce(p_done, false);
end $$;

create or replace function public.set_card_mastered(p_card_id text, p_mastered boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.cards c where c.id = p_card_id and c.archived_at is null)
     or private.card_level(p_card_id) > private.max_level() then
    raise exception 'card not available' using errcode = '42501';
  end if;
  if coalesce(p_mastered, false) then
    insert into public.card_mastery (user_id, card_id, mastered) values (v_uid, p_card_id, true)
    on conflict (user_id, card_id) do update set mastered = true, updated_at = now();
  else
    delete from public.card_mastery where user_id = v_uid and card_id = p_card_id;
  end if;
  return coalesce(p_mastered, false);
end $$;

revoke all on function public.set_sprint_item(text, boolean), public.set_card_mastered(text, boolean) from public, anon, authenticated;
grant execute on function public.set_sprint_item(text, boolean), public.set_card_mastered(text, boolean) to authenticated;
