-- Additional transactional RPCs so that every mutation that matters for
-- money or accountability is paired with an audit_logs row in the SAME
-- database transaction — never relying on the client to make two separate
-- calls (name/amount edits, cycle/entity management, cash inventory,
-- document approval, add/delete personnel).

create or replace function public._actor_name()
returns text language sql stable as $$
  select coalesce((select display_name from public.profiles where id = auth.uid()), 'unknown');
$$;

-- ---------- Cycles ----------
create or replace function public.create_cycle(p_name text, p_year int, p_month int)
returns public.payroll_cycles
language plpgsql security invoker as $$
declare v_row public.payroll_cycles;
begin
  insert into public.payroll_cycles (name, period_year, period_month, created_by)
    values (p_name, p_year, p_month, auth.uid()) returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, new_value)
    values (auth.uid(), public._actor_name(), 'create_cycle', v_row.id, p_name);
  return v_row;
end; $$;

-- ---------- Entities ----------
create or replace function public.create_entity(p_name text)
returns public.entities
language plpgsql security invoker as $$
declare v_row public.entities;
begin
  insert into public.entities (name, created_by) values (p_name, auth.uid()) returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, entity_id, new_value)
    values (auth.uid(), public._actor_name(), 'create_entity', v_row.id, p_name);
  return v_row;
end; $$;

create or replace function public.rename_entity(p_entity_id uuid, p_new_name text)
returns public.entities
language plpgsql security invoker as $$
declare v_old text; v_row public.entities;
begin
  select name into v_old from public.entities where id = p_entity_id;
  update public.entities set name = p_new_name where id = p_entity_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, entity_id, old_value, new_value)
    values (auth.uid(), public._actor_name(), 'rename_entity', p_entity_id, v_old, p_new_name);
  return v_row;
end; $$;

create or replace function public.set_entity_active(p_entity_id uuid, p_is_active boolean)
returns public.entities
language plpgsql security invoker as $$
declare v_row public.entities;
begin
  update public.entities set is_active = p_is_active where id = p_entity_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, entity_id, old_value, new_value)
    values (auth.uid(), public._actor_name(),
            case when p_is_active then 'reactivate_entity' else 'deactivate_entity' end,
            p_entity_id, (not p_is_active)::text, p_is_active::text);
  return v_row;
end; $$;

-- ---------- Personnel: edits, add, delete ----------
create or replace function public.update_personnel_amount(p_person_id uuid, p_new_amount_cents bigint)
returns public.personnel
language plpgsql security invoker as $$
declare v_old bigint; v_row public.personnel;
begin
  select amount_cents into v_old from public.personnel where id = p_person_id for update;
  if v_old is null then raise exception 'person not found'; end if;
  if p_new_amount_cents < 0 then raise exception 'negative amount not allowed'; end if;
  update public.personnel set amount_cents = p_new_amount_cents where id = p_person_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, old_value, new_value)
    values (auth.uid(), public._actor_name(), 'update_amount', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name,
            (v_old/100.0)::text, (p_new_amount_cents/100.0)::text);
  return v_row;
end; $$;

create or replace function public.update_personnel_name(p_person_id uuid, p_new_name text)
returns public.personnel
language plpgsql security invoker as $$
declare v_old text; v_row public.personnel;
begin
  select full_name into v_old from public.personnel where id = p_person_id for update;
  if v_old is null then raise exception 'person not found'; end if;
  update public.personnel set full_name = p_new_name where id = p_person_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, old_value, new_value)
    values (auth.uid(), public._actor_name(), 'update_name', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name, v_old, p_new_name);
  return v_row;
end; $$;

create or replace function public.add_personnel(
  p_cycle_id uuid, p_entity_id uuid, p_full_name text, p_amount_cents bigint,
  p_document_id uuid default null, p_page_number int default null, p_order_in_page int default null
) returns public.personnel
language plpgsql security invoker as $$
declare v_row public.personnel;
begin
  if p_amount_cents < 0 then raise exception 'negative amount not allowed'; end if;
  insert into public.personnel (cycle_id, entity_id, document_id, page_number, order_in_page, full_name, amount_cents)
    values (p_cycle_id, p_entity_id, p_document_id, p_page_number, p_order_in_page, p_full_name, p_amount_cents)
    returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, new_value)
    values (auth.uid(), public._actor_name(), 'add_person', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name,
            format('%s جنيه', (v_row.amount_cents/100.0)::text));
  return v_row;
end; $$;

create or replace function public.delete_personnel(p_person_id uuid)
returns void
language plpgsql security invoker as $$
declare v_row public.personnel;
begin
  select * into v_row from public.personnel where id = p_person_id for update;
  if v_row.id is null then raise exception 'person not found'; end if;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, person_id, person_name, old_value, details)
    values (auth.uid(), public._actor_name(), 'delete_person', v_row.cycle_id, v_row.entity_id, v_row.id, v_row.full_name,
            format('%s جنيه', (v_row.amount_cents/100.0)::text),
            case when v_row.is_paid then 'تم حذف فرد كان مسجلاً كمقبوض' else null end);
  delete from public.personnel where id = p_person_id;
end; $$;

-- ---------- Document approval ----------
create or replace function public.approve_document(p_document_id uuid)
returns public.source_documents
language plpgsql security invoker as $$
declare v_row public.source_documents;
begin
  update public.source_documents set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_document_id returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, entity_id, details)
    values (auth.uid(), public._actor_name(), 'approve_document', v_row.cycle_id, v_row.entity_id,
            format('اعتماد كشف "%s" — %s فرد، إجمالي %s جنيه', v_row.original_filename, v_row.person_count, (v_row.total_amount_cents/100.0)::text));
  return v_row;
end; $$;

-- ---------- Cash inventory ----------
create or replace function public.upsert_cash_denomination(p_cycle_id uuid, p_value_cents bigint, p_piece_count int)
returns public.cash_denominations
language plpgsql security invoker as $$
declare v_old int; v_row public.cash_denominations;
begin
  if p_piece_count < 0 then raise exception 'negative count not allowed'; end if;
  select piece_count into v_old from public.cash_denominations where cycle_id = p_cycle_id and value_cents = p_value_cents;
  insert into public.cash_denominations (cycle_id, value_cents, piece_count)
    values (p_cycle_id, p_value_cents, p_piece_count)
    on conflict (cycle_id, value_cents) do update set piece_count = excluded.piece_count
    returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, old_value, new_value, details)
    values (auth.uid(), public._actor_name(), 'update_cash', p_cycle_id, coalesce(v_old::text, '0'), p_piece_count::text,
            format('فئة %s جنيه', (p_value_cents/100.0)::text));
  return v_row;
end; $$;

create or replace function public.add_cash_extra(p_cycle_id uuid, p_description text, p_amount_cents bigint)
returns public.cash_extra_amounts
language plpgsql security invoker as $$
declare v_row public.cash_extra_amounts;
begin
  insert into public.cash_extra_amounts (cycle_id, description, amount_cents, created_by)
    values (p_cycle_id, p_description, p_amount_cents, auth.uid()) returning * into v_row;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, new_value, details)
    values (auth.uid(), public._actor_name(), 'add_cash_extra', p_cycle_id, (p_amount_cents/100.0)::text, p_description);
  return v_row;
end; $$;

create or replace function public.delete_cash_extra(p_id uuid)
returns void
language plpgsql security invoker as $$
declare v_row public.cash_extra_amounts;
begin
  select * into v_row from public.cash_extra_amounts where id = p_id;
  if v_row.id is null then raise exception 'not found'; end if;
  insert into public.audit_logs (actor_id, actor_name, action_type, cycle_id, old_value, details)
    values (auth.uid(), public._actor_name(), 'delete_cash_extra', v_row.cycle_id, (v_row.amount_cents/100.0)::text, v_row.description);
  delete from public.cash_extra_amounts where id = p_id;
end; $$;
