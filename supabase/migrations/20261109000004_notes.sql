-- Milestone 7: notes, saved links, file attachments and sharing.

-- Save (or clear) the caller's Markdown note for a topic they can see.
create or replace function public.save_note(p_topic_id text, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.active_uid(); v_body text := coalesce(p_body, '');
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not private.topic_visible(p_topic_id, v_uid) then raise exception 'topic not available' using errcode = '42501'; end if;
  if char_length(v_body) > 100000 then raise exception 'note is too long (100,000 characters max)' using errcode = '22023'; end if;
  if not private.rate_limit('note:' || v_uid::text, 600, 3600) then
    raise exception 'saving too often; wait a moment' using errcode = '54000';
  end if;
  if btrim(v_body) = '' then
    delete from public.notes where user_id = v_uid and topic_id = p_topic_id;
    return jsonb_build_object('saved_at', now(), 'empty', true);
  end if;
  insert into public.notes (user_id, topic_id, body_md) values (v_uid, p_topic_id, v_body)
  on conflict (user_id, topic_id) do update set body_md = excluded.body_md;
  return jsonb_build_object('saved_at', now(), 'empty', false);
end $$;

-- Private storage bucket for photos and handwritten PDFs. No storage policies are granted to
-- users: uploads go through one-time signed upload URLs issued by the server after it checks
-- type, size and quota, and files are read through short-lived signed URLs. The bucket's own
-- size and type limits are a second line of defence.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

revoke all on function public.save_note(text, text) from public, anon, authenticated;
grant execute on function public.save_note(text, text) to authenticated;
