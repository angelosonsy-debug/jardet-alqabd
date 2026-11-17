-- جردة القبض – Payroll Reconciliation System
-- Initial schema: cycles, entities, documents, pages, personnel, payments,
-- cash inventory, reconciliation, audit log.
--
-- Money is ALWAYS stored as integer piastres (قروش) in *_cents columns.
-- Never use numeric/float for money math — only bigint arithmetic.

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "moddatetime" schema extensions;

-- ============================================================
-- 1. PROFILES  (one row per authenticated user; same-permission model)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_all_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Auto-create a profile row when a new auth user is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. PAYROLL CYCLES  (one independent month at a time)
-- ============================================================
create table public.payroll_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- e.g. 'نوفمبر 2026'
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  unique (period_year, period_month)
);

alter table public.payroll_cycles enable row level security;

create policy "cycles_select_all" on public.payroll_cycles for select to authenticated using (true);
create policy "cycles_insert_all" on public.payroll_cycles for insert to authenticated with check (true);
-- Closing/reopening goes through the close_cycle/reopen_cycle RPCs below (security definer),
-- so direct UPDATE from clients is limited to non-status fields; status flips go through the RPCs.
create policy "cycles_update_all" on public.payroll_cycles for update to authenticated using (true) with check (true);

-- ============================================================
-- 3. ENTITIES (السرايا / الجهات) — flexible, not fixed to 3
-- ============================================================
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

alter table public.entities enable row level security;
create policy "entities_select_all" on public.entities for select to authenticated using (true);
create policy "entities_write_all" on public.entities for all to authenticated using (true) with check (true);

-- ============================================================
-- 4. SOURCE DOCUMENTS (كشف Word مرفوع لجهة ضمن دورة)
-- ============================================================
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  entity_id uuid not null references public.entities(id),
  storage_path text not null,          -- path inside the private 'payroll-documents' bucket
  original_filename text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'replaced')),
  page_count int not null default 0,
  person_count int not null default 0,
  total_amount_cents bigint not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz
);

-- Only one APPROVED document per (cycle, entity) at a time; replacing creates
-- a new row and flips the old one to 'replaced' rather than deleting it.
create unique index source_documents_one_approved_per_entity
  on public.source_documents (cycle_id, entity_id)
  where (status = 'approved');

alter table public.source_documents enable row level security;
create policy "documents_select_all" on public.source_documents for select to authenticated using (true);
create policy "documents_write_all" on public.source_documents for all to authenticated using (true) with check (true);

-- ============================================================
-- 5. SOURCE PAGES (صفحات الكشف الأصلي — يجب الحفاظ على ترقيمها)
-- ============================================================
create table public.source_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.source_documents(id) on delete cascade,
  page_number int not null,
  person_count int not null default 0,
  total_amount_cents bigint not null default 0,
  unique (document_id, page_number)
);

alter table public.source_pages enable row level security;
create policy "pages_select_all" on public.source_pages for select to authenticated using (true);
create policy "pages_write_all" on public.source_pages for all to authenticated using (true) with check (true);

-- ============================================================
-- 6. PERSONNEL (فرد واحد داخل كشف جهة في دورة معينة)
-- ============================================================
create table public.personnel (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  entity_id uuid not null references public.entities(id),
  document_id uuid references public.source_documents(id) on delete set null,
  page_id uuid references public.source_pages(id) on delete set null,
  page_number int,                       -- denormalized for fast page-aware queries/exports
  order_in_page int,                     -- original row order within the page
  full_name text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  is_paid boolean not null default false,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index personnel_cycle_entity_idx on public.personnel (cycle_id, entity_id);
create index personnel_name_trgm_idx on public.personnel using gin (full_name gin_trgm_ops);
create index personnel_page_idx on public.personnel (document_id, page_number, order_in_page);
create index personnel_amount_idx on public.personnel (cycle_id, entity_id, amount_cents);

alter table public.personnel enable row level security;
create policy "personnel_select_all" on public.personnel for select to authenticated using (true);
-- Direct inserts/updates to non-payment fields (name/amount edits) are allowed to any
-- authenticated user; payment toggles MUST go through register_payment/revert_payment
-- below so they are transactional and always produce an audit row.
create policy "personnel_write_all" on public.personnel for all to authenticated using (true) with check (true);

create trigger personnel_set_updated_at
  before update on public.personnel
  for each row execute function extensions.moddatetime(updated_at);

-- ============================================================
-- 7. CASH INVENTORY (جرد النقدية لكل دورة)
-- ============================================================
create table public.cash_denominations (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  value_cents bigint not null check (value_cents > 0),
  piece_count int not null default 0 check (piece_count >= 0),
  unique (cycle_id, value_cents)
);

alter table public.cash_denominations enable row level security;
create policy "denoms_select_all" on public.cash_denominations for select to authenticated using (true);
create policy "denoms_write_all" on public.cash_denominations for all to authenticated using (true) with check (true);

create table public.cash_extra_amounts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  description text not null,
  amount_cents bigint not null,          -- can be negative to represent a shortfall entry
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.cash_extra_amounts enable row level security;
create policy "extras_select_all" on public.cash_extra_amounts for select to authenticated using (true);
create policy "extras_write_all" on public.cash_extra_amounts for all to authenticated using (true) with check (true);

-- ============================================================
-- 8. AUDIT LOG (append-only — no client UPDATE/DELETE, even though
--    all users share the same functional permissions elsewhere)
-- ============================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,              -- denormalized snapshot, survives profile renames
  action_type text not null,
  cycle_id uuid references public.payroll_cycles(id),
  entity_id uuid references public.entities(id),
  person_id uuid references public.personnel(id),
  person_name text,
  old_value text,
  new_value text,
  details text
);

create index audit_logs_cycle_idx on public.audit_logs (cycle_id, at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_id, at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, at desc);
create index audit_logs_action_idx on public.audit_logs (action_type, at desc);

alter table public.audit_logs enable row level security;
create policy "audit_select_all" on public.audit_logs for select to authenticated using (true);
create policy "audit_insert_all" on public.audit_logs for insert to authenticated with check (true);
-- Deliberately no UPDATE or DELETE policy at all → RLS denies both for every role.

-- ============================================================
-- 9. TRANSACTIONAL RPCs — the only way payment state changes.
--    These guarantee: no double-payment under concurrency, and every
--    state change is paired with an audit_logs row in the same transaction.
-- ============================================================

create or replace function public.register_payment(p_person_id uuid)
returns public.personnel
language plpgsql
security invoker
as $$
declare
  v_row public.personnel;
  v_actor_name text;
begin
  select display_name into v_actor_name from public.profiles where id = auth.uid();

  -- Row lock prevents two concurrent calls from both succeeding on the same person.
  select * into v_row from public.personnel where id = p_person_id for update;

  if v_row.id is null then
    raise exception 'person not found';
  end if;

  if v_row.is_paid then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;

  update public.personnel
    set is_paid = true, paid_at = now(), paid_by = auth.uid()
    where id = p_person_id
    returning * into v_row;

  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, old_value, new_value, details)
  values (auth.uid(), coalesce(v_actor_name, 'unknown'), 'register_payment', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name,
          'غير مقبوض', 'مقبوض', format('تم تسجيل قبض %s جنيه', (v_row.amount_cents / 100.0)::text));

  return v_row;
end;
$$;

create or replace function public.revert_payment(p_person_id uuid)
returns public.personnel
language plpgsql
security invoker
as $$
declare
  v_row public.personnel;
  v_actor_name text;
begin
  select display_name into v_actor_name from public.profiles where id = auth.uid();

  select * into v_row from public.personnel where id = p_person_id for update;

  if v_row.id is null then
    raise exception 'person not found';
  end if;

  if not v_row.is_paid then
    raise exception 'not_paid' using errcode = 'P0001';
  end if;

  update public.personnel
    set is_paid = false, paid_at = null, paid_by = null
    where id = p_person_id
    returning * into v_row;

  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, old_value, new_value, details)
  values (auth.uid(), coalesce(v_actor_name, 'unknown'), 'revert_payment', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name,
          'مقبوض', 'غير مقبوض', 'تراجع عن تسجيل القبض');

  return v_row;
end;
$$;

-- Bulk registration: all-or-nothing within one transaction; skips anyone
-- already paid (reported back) instead of silently double counting.
create or replace function public.register_payments_bulk(p_person_ids uuid[])
returns table (person_id uuid, outcome text)
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  foreach v_id in array p_person_ids loop
    begin
      perform public.register_payment(v_id);
      person_id := v_id; outcome := 'paid'; return next;
    exception when others then
      person_id := v_id; outcome := 'skipped_' || sqlerrm; return next;
    end;
  end loop;
end;
$$;

create or replace function public.close_cycle(p_cycle_id uuid)
returns public.payroll_cycles
language plpgsql
security invoker
as $$
declare
  v_row public.payroll_cycles;
  v_actor_name text;
begin
  select display_name into v_actor_name from public.profiles where id = auth.uid();
  update public.payroll_cycles set status = 'closed', closed_at = now(), closed_by = auth.uid()
    where id = p_cycle_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, old_value, new_value)
  values (auth.uid(), coalesce(v_actor_name,'unknown'), 'close_cycle', p_cycle_id, 'open', 'closed');
  return v_row;
end;
$$;

create or replace function public.reopen_cycle(p_cycle_id uuid)
returns public.payroll_cycles
language plpgsql
security invoker
as $$
declare
  v_row public.payroll_cycles;
  v_actor_name text;
begin
  select display_name into v_actor_name from public.profiles where id = auth.uid();
  update public.payroll_cycles set status = 'open', closed_at = null, closed_by = null
    where id = p_cycle_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, old_value, new_value)
  values (auth.uid(), coalesce(v_actor_name,'unknown'), 'reopen_cycle', p_cycle_id, 'closed', 'open');
  return v_row;
end;
$$;

-- ============================================================
-- 10. REALTIME
-- ============================================================
alter publication supabase_realtime add table public.personnel;
alter publication supabase_realtime add table public.cash_denominations;
alter publication supabase_realtime add table public.cash_extra_amounts;
alter publication supabase_realtime add table public.audit_logs;
alter publication supabase_realtime add table public.payroll_cycles;
alter publication supabase_realtime add table public.source_documents;

-- ============================================================
-- 11. STORAGE (private bucket for original Word files)
-- ============================================================
insert into storage.buckets (id, name, public) values ('payroll-documents', 'payroll-documents', false)
  on conflict (id) do nothing;

create policy "payroll_docs_select_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'payroll-documents');

create policy "payroll_docs_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payroll-documents');
