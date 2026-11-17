-- Performance fixes per Supabase performance advisor findings.

-- auth_rls_initplan: auth.uid() was being re-evaluated per row inside the
-- profiles_update_own policy. Wrapping it in a scalar subselect lets Postgres
-- evaluate it once per statement instead of once per row.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Targeted indexes for foreign-key columns the app actually filters by.
-- (Attribution-only FKs such as created_by/paid_by/approved_by/uploaded_by/closed_by
-- are deliberately left unindexed since the app never filters on them.)
create index if not exists personnel_entity_idx on public.personnel (entity_id);
create index if not exists source_documents_entity_idx on public.source_documents (entity_id);
create index if not exists cash_extra_amounts_cycle_idx on public.cash_extra_amounts (cycle_id);
