import { describe, it, expect } from 'vitest';
import { groupByAmount, summarizeEntity, type PersonnelRow } from '../aggregation';
import { poundsToCents, formatEGP } from '../money';
import { reconcile, debtsNetCents, type Debt } from '../reconciliation';

// These mirror the acceptance tests in section 17 of the spec exactly.

function makePeople(count: number, amount: number, paidCount: number): PersonnelRow[] {
  const cents = poundsToCents(amount);
  return Array.from({ length: count }, (_, i) => ({
    id: `${amount}-${i}`,
    fullName: `فرد ${i + 1}`,
    amountCents: cents,
    isPaid: i < paidCount,
  }));
}

describe('Acceptance test 2 — personnel review', () => {
  it('60 × 331.37 + 1 × 195 + 1 × 238 → count 62, total 20,315.20', () => {
    const people = [
      ...makePeople(60, 331.37, 0),
      ...makePeople(1, 195, 0),
      ...makePeople(1, 238, 0),
    ];
    expect(people.length).toBe(62);
    const total = people.reduce((s, p) => s + p.amountCents, 0);
    expect(formatEGP(total)).toBe('20,315.20');
  });
});

describe('Acceptance test 3 — payment registration', () => {
  it('20 paid of 331.37, 1 paid of 195 → correct paid/remaining splits', () => {
    const people = [
      ...makePeople(60, 331.37, 20),
      ...makePeople(1, 195, 1),
      ...makePeople(1, 238, 0),
    ];

    const groups = groupByAmount(people);
    const g33137 = groups.find((g) => g.amountCents === poundsToCents(331.37))!;
    const g195 = groups.find((g) => g.amountCents === poundsToCents(195))!;
    const g238 = groups.find((g) => g.amountCents === poundsToCents(238))!;

    expect(g33137.remainingCount).toBe(40);
    expect(g195.remainingCount).toBe(0);
    expect(g238.remainingCount).toBe(1);

    const paidTotal = people.filter((p) => p.isPaid).reduce((s, p) => s + p.amountCents, 0);
    expect(formatEGP(paidTotal)).toBe('6,822.40');

    const remainingTotal = people.filter((p) => !p.isPaid).reduce((s, p) => s + p.amountCents, 0);
    expect(formatEGP(remainingTotal)).toBe('13,492.80');
  });
});

describe('Acceptance test 6 — reconciliation', () => {
  it('25,000 cash vs 24,500 due → surplus of 500', () => {
    const result = reconcile(
      [{ valueCents: poundsToCents(200), pieceCount: 125 }], // 25,000
      [],
      poundsToCents(24500),
    );
    expect(result.status).toBe('surplus');
    expect(formatEGP(result.differenceCents)).toBe('500.00');
  });

  it('balanced when cash equals remaining due exactly', () => {
    const result = reconcile([{ valueCents: poundsToCents(100), pieceCount: 245 }], [], poundsToCents(24500));
    expect(result.status).toBe('balanced');
    expect(result.differenceCents).toBe(0);
  });
});

describe('الديون المؤقتة (لينا / علينا)', () => {
  it('المرور 2361.27 جنيه "لينا" يُضاف كاملاً لصافي الديون', () => {
    const debts: Debt[] = [{ description: 'المرور', amountCents: poundsToCents(2361.27), direction: 'owed_to_us' }];
    expect(formatEGP(debtsNetCents(debts))).toBe('2,361.27');
  });

  it('صافي الديون = مجموع لينا − مجموع علينا', () => {
    const debts: Debt[] = [
      { description: 'المرور', amountCents: poundsToCents(2361.27), direction: 'owed_to_us' },
      { description: 'الشيبسي', amountCents: poundsToCents(5000), direction: 'owed_by_us' },
    ];
    expect(formatEGP(debtsNetCents(debts))).toBe('-2,638.73');
  });

  it('صافي الديون "لينا" يرفع النقدية الموجودة في التسوية', () => {
    const debts: Debt[] = [{ description: 'المرور', amountCents: poundsToCents(2361.27), direction: 'owed_to_us' }];
    const result = reconcile([{ valueCents: poundsToCents(100), pieceCount: 100 }], [], poundsToCents(10000), debts);
    // cash = 10,000 + 2,361.27 = 12,361.27 ; due = 10,000 → surplus 2,361.27
    expect(result.status).toBe('surplus');
    expect(formatEGP(result.differenceCents)).toBe('2,361.27');
  });
});

describe('summarizeEntity', () => {
  it('splits paid/remaining correctly for a mixed entity', () => {
    const people = makePeople(3, 100, 1);
    const summary = summarizeEntity('e1', 'خدمات المعاونة', people);
    expect(summary.totalPersonnel).toBe(3);
    expect(summary.paidCount).toBe(1);
    expect(summary.remainingCount).toBe(2);
  });
});
