-- الديون المؤقتة: مبالغ دفعناها نيابة عن جهة تانية وهنستردها لاحقاً ("لينا")،
-- أو مبالغ أخدناها من عندنا مؤقتاً وهنردها ("علينا"). صافي الدين يُضاف إلى
-- إجمالي النقدية الموجودة في حساب التسوية (مثال: "المرور 2,361.27 جنيه لينا").

create table public.cash_debts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0), -- دائماً موجب؛ الاتجاه يحدد الإشارة
  direction text not null check (direction in ('owed_to_us', 'owed_by_us')), -- لينا / علينا
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index cash_debts_cycle_idx on public.cash_debts (cycle_id);

alter table public.cash_debts enable row level security;
create policy "cash_debts_select_all" on public.cash_debts for select to authenticated using (true);
-- كل الكتابة عبر RPC فقط (زي باقي الجداول المالية) — يضمن تسجيل الحدث في audit_logs دايماً.

alter publication supabase_realtime add table public.cash_debts;

create or replace function public.add_cash_debt(
  p_cycle_id uuid, p_description text, p_amount_cents bigint, p_direction text
) returns public.cash_debts
language plpgsql security definer set search_path = public as $$
declare v_row public.cash_debts;
begin
  if p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;
  if p_direction not in ('owed_to_us', 'owed_by_us') then raise exception 'invalid direction'; end if;

  insert into public.cash_debts (cycle_id, description, amount_cents, direction, created_by)
    values (p_cycle_id, p_description, p_amount_cents, p_direction, auth.uid())
    returning * into v_row;

  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, new_value, details)
    values (auth.uid(), public._actor_name(), 'add_cash_debt', p_cycle_id, (p_amount_cents/100.0)::text,
            format('%s — %s: %s جنيه', p_description, case when p_direction='owed_to_us' then 'لينا' else 'علينا' end, (p_amount_cents/100.0)::text));

  return v_row;
end; $$;

create or replace function public.delete_cash_debt(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row public.cash_debts;
begin
  select * into v_row from public.cash_debts where id = p_id;
  if v_row.id is null then raise exception 'not found'; end if;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, old_value, details)
    values (auth.uid(), public._actor_name(), 'delete_cash_debt', v_row.cycle_id, (v_row.amount_cents/100.0)::text,
            format('%s — %s', v_row.description, case when v_row.direction='owed_to_us' then 'لينا' else 'علينا' end));
  delete from public.cash_debts where id = p_id;
end; $$;

revoke all on function public.add_cash_debt(uuid, text, bigint, text) from public, anon;
revoke all on function public.delete_cash_debt(uuid) from public, anon;
grant execute on function public.add_cash_debt(uuid, text, bigint, text) to authenticated;
grant execute on function public.delete_cash_debt(uuid) to authenticated;
