-- استبدال كشف: flips the currently-approved document for an entity/cycle to
-- 'replaced' (never deleted — stays in history) and approves the new one in
-- the same transaction, with both halves captured in a single audit row.
create or replace function public.replace_document(p_old_document_id uuid, p_new_document_id uuid)
returns public.source_documents
language plpgsql security definer set search_path = public as $$
declare v_old public.source_documents; v_new public.source_documents;
begin
  select * into v_old from public.source_documents where id = p_old_document_id for update;
  if v_old.id is null then raise exception 'old document not found'; end if;

  update public.source_documents set status = 'replaced' where id = p_old_document_id;
  update public.source_documents set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_new_document_id returning * into v_new;

  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, details)
  values (
    auth.uid(), public._actor_name(), 'replace_document', v_new.cycle_id, v_new.entity_id,
    format('تم استبدال "%s" بالكشف الجديد "%s" (%s فرد، %s جنيه)',
      v_old.original_filename, v_new.original_filename, v_new.person_count, (v_new.total_amount_cents/100.0)::text)
  );

  return v_new;
end; $$;

revoke all on function public.replace_document(uuid, uuid) from public, anon;
grant execute on function public.replace_document(uuid, uuid) to authenticated;
