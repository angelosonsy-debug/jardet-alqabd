-- Harden RLS: mutations that must always produce an audit_logs row (payments,
-- amount/name edits, cash inventory, entity/cycle management, document
-- approval) can ONLY happen through the SECURITY DEFINER RPCs below — direct
-- client UPDATE/DELETE on those tables is revoked. Bulk INSERT during import
-- (personnel/source_pages/source_documents rows coming straight from the
-- parsed Word file, before anything financial has happened to them) is still
-- allowed directly, since that step has nothing to audit yet — accountability
-- starts at "اعتماد الكشف" (approve_document), which IS an RPC.

-- 1) Flip all the RPCs from SECURITY INVOKER to SECURITY DEFINER so they keep
--    working once direct client table access is narrowed below. Each one
--    already does `auth.uid()` + row-level checks internally, and a
--    SECURITY DEFINER function still correctly fails if no cycle/person
--    matches, so this doesn't bypass any real business rule.
alter function public.register_payment(uuid) security definer set search_path = public;
alter function public.revert_payment(uuid) security definer set search_path = public;
alter function public.register_payments_bulk(uuid[]) security definer set search_path = public;
alter function public.close_cycle(uuid) security definer set search_path = public;
alter function public.reopen_cycle(uuid) security definer set search_path = public;
alter function public.create_cycle(text, int, int) security definer set search_path = public;
alter function public.create_entity(text) security definer set search_path = public;
alter function public.rename_entity(uuid, text) security definer set search_path = public;
alter function public.set_entity_active(uuid, boolean) security definer set search_path = public;
alter function public.update_personnel_amount(uuid, bigint) security definer set search_path = public;
alter function public.update_personnel_name(uuid, text) security definer set search_path = public;
alter function public.add_personnel(uuid, uuid, text, bigint, uuid, int, int) security definer set search_path = public;
alter function public.delete_personnel(uuid) security definer set search_path = public;
alter function public.approve_document(uuid) security definer set search_path = public;
alter function public.upsert_cash_denomination(uuid, bigint, int) security definer set search_path = public;
alter function public.add_cash_extra(uuid, text, bigint) security definer set search_path = public;
alter function public.delete_cash_extra(uuid) security definer set search_path = public;

-- All of these still require an authenticated auth.uid() internally
-- (profiles lookups, foreign keys to auth.users) so an anonymous/public
-- caller gets a clean failure, not a silent bypass.
revoke all on function
  public.register_payment(uuid), public.revert_payment(uuid), public.register_payments_bulk(uuid[]),
  public.close_cycle(uuid), public.reopen_cycle(uuid), public.create_cycle(text,int,int),
  public.create_entity(text), public.rename_entity(uuid,text), public.set_entity_active(uuid,boolean),
  public.update_personnel_amount(uuid,bigint), public.update_personnel_name(uuid,text),
  public.add_personnel(uuid,uuid,text,bigint,uuid,int,int), public.delete_personnel(uuid),
  public.approve_document(uuid), public.upsert_cash_denomination(uuid,bigint,int),
  public.add_cash_extra(uuid,text,bigint), public.delete_cash_extra(uuid)
from public, anon;

grant execute on function
  public.register_payment(uuid), public.revert_payment(uuid), public.register_payments_bulk(uuid[]),
  public.close_cycle(uuid), public.reopen_cycle(uuid), public.create_cycle(text,int,int),
  public.create_entity(text), public.rename_entity(uuid,text), public.set_entity_active(uuid,boolean),
  public.update_personnel_amount(uuid,bigint), public.update_personnel_name(uuid,text),
  public.add_personnel(uuid,uuid,text,bigint,uuid,int,int), public.delete_personnel(uuid),
  public.approve_document(uuid), public.upsert_cash_denomination(uuid,bigint,int),
  public.add_cash_extra(uuid,text,bigint), public.delete_cash_extra(uuid)
to authenticated;

-- 2) Narrow direct-table policies.

drop policy "cycles_insert_all" on public.payroll_cycles;
drop policy "cycles_update_all" on public.payroll_cycles;
-- select-only remains (cycles_select_all); creation/close/reopen are RPC-only now.

drop policy "entities_write_all" on public.entities;
-- (entities_select_all from 0001 already covers select; write is now RPC-only.)

drop policy "documents_write_all" on public.source_documents;
create policy "documents_insert_import" on public.source_documents for insert to authenticated with check (true);
-- Clients may still update a document's own row counts/totals while it's
-- still pending review (that's just import bookkeeping, nothing to audit
-- yet) but can never flip the status to 'approved' or 'replaced' themselves
-- — that only happens inside the SECURITY DEFINER approve_document()/
-- replace_document() RPCs, which bypass RLS as the table owner.
create policy "documents_update_while_pending" on public.source_documents
  for update to authenticated
  using (status = 'pending_review')
  with check (status = 'pending_review');

drop policy "pages_write_all" on public.source_pages;
create policy "pages_insert_import" on public.source_pages for insert to authenticated with check (true);

drop policy "personnel_write_all" on public.personnel;
create policy "personnel_insert_import" on public.personnel for insert to authenticated with check (true);
-- amount/name/is_paid changes and deletes are RPC-only from here on.

drop policy "denoms_write_all" on public.cash_denominations;
-- select-only remains; all writes go through upsert_cash_denomination().

drop policy "extras_write_all" on public.cash_extra_amounts;
-- select-only remains; all writes go through add_cash_extra()/delete_cash_extra().
