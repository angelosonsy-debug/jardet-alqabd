/**
 * Cash inventory + final reconciliation — reimplements the logic behind the
 * "جردة" sheet (الفئات النقدية × العدد، + مبالغ إضافية، مقارنة بالمتبقي)
 * WITHOUT carrying over its broken formulas (#NAME? cells, blanks treated as
 * zero inconsistently, float drift). All totals here are integer piastres.
 */

export interface Denomination {
  valueCents: number; // e.g. 20000 for a 200-pound note
  pieceCount: number;
}

export interface ExtraAmount {
  description: string;
  amountCents: number;
}

/**
 * الديون المؤقتة: مبالغ دفعناها نيابة عن جهة تانية وهنستردها لاحقاً ("لينا")،
 * أو مبالغ أخدناها من عندنا مؤقتاً وهنردها ("علينا"). كل سجل يُخزَّن بمبلغ
 * موجب دائماً + نوع (owed_to_us / owed_by_us)؛ صافي الدين = مجموع "لينا" −
 * مجموع "علينا"، ويُضاف هذا الصافي لإجمالي النقدية الموجودة (مثال الطلب:
 * "المرور 2361.27" مبلغ لينا يُحسب كجزء من النقدية الموجودة فعلياً).
 */
export type DebtDirection = 'owed_to_us' | 'owed_by_us';

export interface Debt {
  description: string;
  amountCents: number; // always stored positive; direction decides the sign
  direction: DebtDirection;
}

export function denominationsTotalCents(denoms: Denomination[]): number {
  return denoms.reduce((s, d) => s + d.valueCents * d.pieceCount, 0);
}

export function extrasTotalCents(extras: ExtraAmount[]): number {
  return extras.reduce((s, e) => s + e.amountCents, 0);
}

export function debtsNetCents(debts: Debt[]): number {
  return debts.reduce((s, d) => s + (d.direction === 'owed_to_us' ? d.amountCents : -d.amountCents), 0);
}

export function debtsOwedToUsCents(debts: Debt[]): number {
  return debts.filter((d) => d.direction === 'owed_to_us').reduce((s, d) => s + d.amountCents, 0);
}

export function debtsOwedByUsCents(debts: Debt[]): number {
  return debts.filter((d) => d.direction === 'owed_by_us').reduce((s, d) => s + d.amountCents, 0);
}

export interface ReconciliationResult {
  cashOnHandCents: number;       // denominations + extras + صافي الديون
  remainingDueCents: number;     // sum of amountCents for everyone NOT yet paid, across all entities
  differenceCents: number;       // cashOnHand - remainingDue
  status: 'surplus' | 'deficit' | 'balanced';
}

export function reconcile(
  denoms: Denomination[],
  extras: ExtraAmount[],
  remainingDueCents: number,
  debts: Debt[] = [],
): ReconciliationResult {
  const cashOnHandCents = denominationsTotalCents(denoms) + extrasTotalCents(extras) + debtsNetCents(debts);
  const differenceCents = cashOnHandCents - remainingDueCents;
  const status: ReconciliationResult['status'] =
    differenceCents > 0 ? 'surplus' : differenceCents < 0 ? 'deficit' : 'balanced';
  return { cashOnHandCents, remainingDueCents, differenceCents, status };
}
