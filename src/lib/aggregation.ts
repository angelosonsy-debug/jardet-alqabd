/**
 * Group-by-amount reporting (تجميع حسب قيمة المرتب) — same idea as the
 * SalaryAggregator class in the original HTML prototype, extended with
 * paid/remaining counts as required by section 8 of the spec.
 *
 * Does NOT assume a fixed set of allowed amounts: whatever distinct amounts
 * exist in the imported roster are discovered and grouped automatically.
 */

export interface PersonnelRow {
  id: string;
  fullName: string;
  amountCents: number;
  isPaid: boolean;
}

export interface AmountGroup {
  amountCents: number;
  totalCount: number;
  paidCount: number;
  remainingCount: number;
  totalDueCents: number;
  paidCents: number;
  remainingCents: number;
}

export function groupByAmount(people: PersonnelRow[]): AmountGroup[] {
  const groups = new Map<number, AmountGroup>();

  for (const p of people) {
    let g = groups.get(p.amountCents);
    if (!g) {
      g = {
        amountCents: p.amountCents,
        totalCount: 0,
        paidCount: 0,
        remainingCount: 0,
        totalDueCents: 0,
        paidCents: 0,
        remainingCents: 0,
      };
      groups.set(p.amountCents, g);
    }
    g.totalCount += 1;
    g.totalDueCents += p.amountCents;
    if (p.isPaid) {
      g.paidCount += 1;
      g.paidCents += p.amountCents;
    } else {
      g.remainingCount += 1;
      g.remainingCents += p.amountCents;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.amountCents - a.amountCents);
}

export interface EntitySummary {
  entityId: string;
  entityName: string;
  totalPersonnel: number;
  totalDueCents: number;
  paidCount: number;
  remainingCount: number;
  paidCents: number;
  remainingCents: number;
}

export function summarizeEntity(entityId: string, entityName: string, people: PersonnelRow[]): EntitySummary {
  const totalDueCents = people.reduce((s, p) => s + p.amountCents, 0);
  const paid = people.filter((p) => p.isPaid);
  const remaining = people.filter((p) => !p.isPaid);
  return {
    entityId,
    entityName,
    totalPersonnel: people.length,
    totalDueCents,
    paidCount: paid.length,
    remainingCount: remaining.length,
    paidCents: paid.reduce((s, p) => s + p.amountCents, 0),
    remainingCents: remaining.reduce((s, p) => s + p.amountCents, 0),
  };
}
