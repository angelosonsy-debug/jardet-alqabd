export type CycleStatus = 'open' | 'closed';
export type DocumentStatus = 'pending_review' | 'approved' | 'replaced';

export interface Profile {
  id: string;
  display_name: string;
  email: string;
  created_at: string;
}

export interface PayrollCycle {
  id: string;
  name: string;
  period_year: number;
  period_month: number;
  status: CycleStatus;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

export interface Entity {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

export interface SourceDocument {
  id: string;
  cycle_id: string;
  entity_id: string;
  storage_path: string;
  original_filename: string;
  status: DocumentStatus;
  page_count: number;
  person_count: number;
  total_amount_cents: number;
  uploaded_by: string;
  uploaded_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface SourcePage {
  id: string;
  document_id: string;
  page_number: number;
  person_count: number;
  total_amount_cents: number;
}

export interface Personnel {
  id: string;
  cycle_id: string;
  entity_id: string;
  document_id: string | null;
  page_id: string | null;
  page_number: number | null;
  order_in_page: number | null;
  full_name: string;
  amount_cents: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashDenomination {
  id: string;
  cycle_id: string;
  value_cents: number;
  piece_count: number;
}

export interface CashExtraAmount {
  id: string;
  cycle_id: string;
  description: string;
  amount_cents: number;
  created_by: string;
  created_at: string;
}

export type DebtDirection = 'owed_to_us' | 'owed_by_us';

export interface CashDebt {
  id: string;
  cycle_id: string;
  description: string;
  amount_cents: number;
  direction: DebtDirection;
  created_by: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor_id: string;
  actor_name: string;
  action_type: string;
  cycle_id: string | null;
  entity_id: string | null;
  person_id: string | null;
  person_name: string | null;
  old_value: string | null;
  new_value: string | null;
  details: string | null;
}

export const STANDARD_DENOMINATIONS_EGP = [200, 100, 50, 20, 10, 5, 1];

export const ACTION_TYPE_LABELS: Record<string, string> = {
  register_payment: 'تسجيل قبض',
  revert_payment: 'التراجع عن قبض',
  register_payments_bulk: 'تسجيل قبض جماعي',
  update_amount: 'تعديل مبلغ',
  update_name: 'تعديل اسم',
  add_person: 'إضافة فرد',
  delete_person: 'حذف فرد',
  import_document: 'استيراد كشف جديد',
  approve_document: 'اعتماد كشف',
  replace_document: 'استبدال كشف',
  update_cash: 'تعديل جرد نقدية',
  add_cash_extra: 'إضافة مبلغ نقدي',
  add_cash_debt: 'إضافة دين مؤقت',
  delete_cash_debt: 'حذف دين مؤقت',
  delete_cash_extra: 'حذف مبلغ نقدي',
  create_cycle: 'إنشاء دورة',
  close_cycle: 'إغلاق دورة',
  reopen_cycle: 'إعادة فتح دورة',
  create_entity: 'إضافة جهة',
  rename_entity: 'إعادة تسمية جهة',
};
