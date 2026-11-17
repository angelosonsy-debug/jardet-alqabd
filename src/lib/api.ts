import { supabase } from './supabaseClient';
import type { Personnel, PayrollCycle, Entity, SourceDocument, CashDenomination, CashExtraAmount, CashDebt, DebtDirection } from '../types/database';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const api = {
  registerPayment: (personId: string) => call<Personnel>('register_payment', { p_person_id: personId }),
  revertPayment: (personId: string) => call<Personnel>('revert_payment', { p_person_id: personId }),
  registerPaymentsBulk: (personIds: string[]) =>
    call<{ person_id: string; outcome: string }[]>('register_payments_bulk', { p_person_ids: personIds }),

  closeCycle: (cycleId: string) => call<PayrollCycle>('close_cycle', { p_cycle_id: cycleId }),
  reopenCycle: (cycleId: string) => call<PayrollCycle>('reopen_cycle', { p_cycle_id: cycleId }),
  createCycle: (name: string, year: number, month: number) =>
    call<PayrollCycle>('create_cycle', { p_name: name, p_year: year, p_month: month }),

  createEntity: (name: string) => call<Entity>('create_entity', { p_name: name }),
  renameEntity: (entityId: string, newName: string) =>
    call<Entity>('rename_entity', { p_entity_id: entityId, p_new_name: newName }),
  setEntityActive: (entityId: string, isActive: boolean) =>
    call<Entity>('set_entity_active', { p_entity_id: entityId, p_is_active: isActive }),

  updatePersonnelAmount: (personId: string, newAmountCents: number) =>
    call<Personnel>('update_personnel_amount', { p_person_id: personId, p_new_amount_cents: newAmountCents }),
  updatePersonnelName: (personId: string, newName: string) =>
    call<Personnel>('update_personnel_name', { p_person_id: personId, p_new_name: newName }),
  addPersonnel: (args: {
    cycleId: string; entityId: string; fullName: string; amountCents: number;
    documentId?: string; pageNumber?: number; orderInPage?: number;
  }) =>
    call<Personnel>('add_personnel', {
      p_cycle_id: args.cycleId, p_entity_id: args.entityId, p_full_name: args.fullName,
      p_amount_cents: args.amountCents, p_document_id: args.documentId ?? null,
      p_page_number: args.pageNumber ?? null, p_order_in_page: args.orderInPage ?? null,
    }),
  deletePersonnel: (personId: string) => call<void>('delete_personnel', { p_person_id: personId }),

  approveDocument: (documentId: string) => call<SourceDocument>('approve_document', { p_document_id: documentId }),
  replaceDocument: (oldDocumentId: string, newDocumentId: string) =>
    call<SourceDocument>('replace_document', { p_old_document_id: oldDocumentId, p_new_document_id: newDocumentId }),

  upsertCashDenomination: (cycleId: string, valueCents: number, pieceCount: number) =>
    call<CashDenomination>('upsert_cash_denomination', { p_cycle_id: cycleId, p_value_cents: valueCents, p_piece_count: pieceCount }),
  addCashExtra: (cycleId: string, description: string, amountCents: number) =>
    call<CashExtraAmount>('add_cash_extra', { p_cycle_id: cycleId, p_description: description, p_amount_cents: amountCents }),
  deleteCashExtra: (id: string) => call<void>('delete_cash_extra', { p_id: id }),

  addCashDebt: (cycleId: string, description: string, amountCents: number, direction: DebtDirection) =>
    call<CashDebt>('add_cash_debt', { p_cycle_id: cycleId, p_description: description, p_amount_cents: amountCents, p_direction: direction }),
  deleteCashDebt: (id: string) => call<void>('delete_cash_debt', { p_id: id }),
};
