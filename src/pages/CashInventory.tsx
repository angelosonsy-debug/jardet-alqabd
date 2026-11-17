import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { useCycle } from '../lib/cycle';
import { useConnectionStatus } from '../lib/useConnectionStatus';
import { api } from '../lib/api';
import { formatEGP, poundsToCents } from '../lib/money';
import { denominationsTotalCents, extrasTotalCents, debtsNetCents, debtsOwedToUsCents, debtsOwedByUsCents } from '../lib/reconciliation';
import { STANDARD_DENOMINATIONS_EGP } from '../types/database';
import type { CashDenomination, CashExtraAmount, CashDebt, DebtDirection } from '../types/database';

export default function CashInventory() {
  const { activeCycle } = useCycle();
  const connection = useConnectionStatus();
  const canMutate = connection === 'online' && activeCycle?.status === 'open';
  const cycleId = activeCycle?.id ?? '__none__';

  const { data: denoms } = useRealtimeQuery<CashDenomination>(
    'cash_denominations',
    () => supabase.from('cash_denominations').select('*').eq('cycle_id', cycleId),
    `cycle_id=eq.${cycleId}`,
    [cycleId],
  );
  const { data: extras } = useRealtimeQuery<CashExtraAmount>(
    'cash_extra_amounts',
    () => supabase.from('cash_extra_amounts').select('*').eq('cycle_id', cycleId),
    `cycle_id=eq.${cycleId}`,
    [cycleId],
  );
  const { data: debts } = useRealtimeQuery<CashDebt>(
    'cash_debts',
    () => supabase.from('cash_debts').select('*').eq('cycle_id', cycleId),
    `cycle_id=eq.${cycleId}`,
    [cycleId],
  );

  const [error, setError] = useState<string | null>(null);
  const [extraDesc, setExtraDesc] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [debtDesc, setDebtDesc] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDirection, setDebtDirection] = useState<DebtDirection>('owed_to_us');

  const denomMap = new Map(denoms.map((d) => [d.value_cents, d]));
  const rows = STANDARD_DENOMINATIONS_EGP.map((egp) => {
    const valueCents = poundsToCents(egp);
    const existing = denomMap.get(valueCents);
    return { valueCents, pieceCount: existing?.piece_count ?? 0 };
  });
  // Include any extra (non-standard) denominations someone added.
  const extraDenomRows = denoms.filter((d) => !STANDARD_DENOMINATIONS_EGP.some((egp) => poundsToCents(egp) === d.value_cents));

  const updateCount = async (valueCents: number, count: number) => {
    if (!activeCycle) return;
    setError(null);
    try {
      await api.upsertCashDenomination(activeCycle.id, valueCents, count);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const [customValue, setCustomValue] = useState('');
  const [customCount, setCustomCount] = useState('');
  const addCustomDenomination = async () => {
    const value = parseFloat(customValue);
    const count = parseInt(customCount, 10);
    if (!activeCycle || Number.isNaN(value) || value <= 0 || Number.isNaN(count) || count < 0) return;
    try {
      await api.upsertCashDenomination(activeCycle.id, poundsToCents(value), count);
      setCustomValue('');
      setCustomCount('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCycle || !extraDesc.trim()) return;
    const pounds = parseFloat(extraAmount);
    if (Number.isNaN(pounds)) return;
    try {
      await api.addCashExtra(activeCycle.id, extraDesc.trim(), poundsToCents(pounds));
      setExtraDesc('');
      setExtraAmount('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeExtra = async (id: string) => {
    try {
      await api.deleteCashExtra(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCycle || !debtDesc.trim()) return;
    const pounds = parseFloat(debtAmount);
    if (Number.isNaN(pounds) || pounds <= 0) return;
    try {
      await api.addCashDebt(activeCycle.id, debtDesc.trim(), poundsToCents(pounds), debtDirection);
      setDebtDesc('');
      setDebtAmount('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeDebt = async (id: string) => {
    try {
      await api.deleteCashDebt(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const denomsTotal = denominationsTotalCents(denoms.map((d) => ({ valueCents: d.value_cents, pieceCount: d.piece_count })));
  const extrasTotal = extrasTotalCents(extras.map((e) => ({ description: e.description, amountCents: e.amount_cents })));
  const debtRows = debts.map((d) => ({ description: d.description, amountCents: d.amount_cents, direction: d.direction }));
  const owedToUsTotal = debtsOwedToUsCents(debtRows);
  const owedByUsTotal = debtsOwedByUsCents(debtRows);
  const debtsNet = debtsNetCents(debtRows);

  if (!activeCycle) return <p className="muted">أنشئ دورة قبض أولاً.</p>;

  return (
    <div>
      <h1>جرد النقدية</h1>
      {error && <p className="error-text">{error}</p>}

      <div className="card page-section">
        <h2>الفئات النقدية</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>الفئة</th><th>العدد</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.valueCents}>
                  <td>{formatEGP(r.valueCents)}</td>
                  <td>
                    <input
                      type="number" min="0" style={{ width: '90px' }}
                      value={r.pieceCount}
                      disabled={!canMutate}
                      onChange={(e) => updateCount(r.valueCents, Math.max(0, parseInt(e.target.value || '0', 10)))}
                    />
                  </td>
                  <td>{formatEGP(r.valueCents * r.pieceCount)}</td>
                </tr>
              ))}
              {extraDenomRows.map((d) => (
                <tr key={d.value_cents}>
                  <td>{formatEGP(d.value_cents)}</td>
                  <td>
                    <input
                      type="number" min="0" style={{ width: '90px' }}
                      value={d.piece_count}
                      disabled={!canMutate}
                      onChange={(e) => updateCount(d.value_cents, Math.max(0, parseInt(e.target.value || '0', 10)))}
                    />
                  </td>
                  <td>{formatEGP(d.value_cents * d.piece_count)}</td>
                </tr>
              ))}
              <tr><td colSpan={2} style={{ fontWeight: 700 }}>إجمالي الفئات</td><td style={{ fontWeight: 700 }}>{formatEGP(denomsTotal)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <input placeholder="فئة جديدة (جنيه)" type="number" value={customValue} onChange={(e) => setCustomValue(e.target.value)} style={{ width: '120px' }} disabled={!canMutate} />
          <input placeholder="العدد" type="number" value={customCount} onChange={(e) => setCustomCount(e.target.value)} style={{ width: '90px' }} disabled={!canMutate} />
          <button className="btn btn-sm" onClick={addCustomDenomination} disabled={!canMutate}>إضافة فئة أخرى</button>
        </div>
      </div>

      <div className="card page-section">
        <h2>المبالغ الإضافية</h2>
        <form onSubmit={addExtra} className="row">
          <input placeholder="الوصف" value={extraDesc} onChange={(e) => setExtraDesc(e.target.value)} disabled={!canMutate} />
          <input placeholder="المبلغ (جنيه)" type="number" step="0.01" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} disabled={!canMutate} style={{ width: '130px' }} />
          <button className="btn btn-sm btn-primary" disabled={!canMutate}>إضافة</button>
        </form>
        <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
          <table>
            <thead><tr><th className="name-cell">الوصف</th><th>المبلغ</th><th></th></tr></thead>
            <tbody>
              {extras.map((ex) => (
                <tr key={ex.id}>
                  <td className="name-cell">{ex.description}</td>
                  <td>{formatEGP(ex.amount_cents)}</td>
                  <td><button className="btn btn-sm btn-danger" onClick={() => removeExtra(ex.id)} disabled={!canMutate}>حذف</button></td>
                </tr>
              ))}
              <tr><td style={{ fontWeight: 700 }}>إجمالي المبالغ الإضافية</td><td style={{ fontWeight: 700 }}>{formatEGP(extrasTotal)}</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card page-section">
        <h2>الديون المؤقتة (لينا / علينا)</h2>
        <p className="muted" style={{ marginTop: '-0.3rem', marginBottom: '0.6rem' }}>
          مبالغ دفعناها نيابة عن جهة تانية وهنستردها لاحقاً ("لينا") — أو مبالغ أخدناها من عندنا مؤقتاً
          وهنردها ("علينا"). مثال: المرور 2,361.27 جنيه لينا. صافي الديون يُضاف لإجمالي النقدية الموجودة تلقائياً.
        </p>
        <form onSubmit={addDebt} className="row">
          <input placeholder="الوصف (مثال: المرور)" value={debtDesc} onChange={(e) => setDebtDesc(e.target.value)} disabled={!canMutate} />
          <input placeholder="المبلغ (جنيه)" type="number" step="0.01" min="0" value={debtAmount} onChange={(e) => setDebtAmount(e.target.value)} disabled={!canMutate} style={{ width: '130px' }} />
          <select value={debtDirection} onChange={(e) => setDebtDirection(e.target.value as DebtDirection)} disabled={!canMutate}>
            <option value="owed_to_us">لينا (يُضاف للنقدية)</option>
            <option value="owed_by_us">علينا (يُخصم من النقدية)</option>
          </select>
          <button className="btn btn-sm btn-primary" disabled={!canMutate}>إضافة</button>
        </form>
        <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
          <table>
            <thead><tr><th className="name-cell">الوصف</th><th>النوع</th><th>المبلغ</th><th></th></tr></thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td className="name-cell">{d.description}</td>
                  <td>
                    <span className={`tag ${d.direction === 'owed_to_us' ? 'tag-paid' : 'tag-unpaid'}`}>
                      {d.direction === 'owed_to_us' ? 'لينا' : 'علينا'}
                    </span>
                  </td>
                  <td>{formatEGP(d.amount_cents)}</td>
                  <td><button className="btn btn-sm btn-danger" onClick={() => removeDebt(d.id)} disabled={!canMutate}>حذف</button></td>
                </tr>
              ))}
              {debts.length === 0 && <tr><td colSpan={4} className="muted">لا توجد ديون مؤقتة مسجّلة.</td></tr>}
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>إجمالي لينا / إجمالي علينا</td>
                <td colSpan={2} style={{ fontWeight: 700 }}>
                  +{formatEGP(owedToUsTotal)} / -{formatEGP(owedByUsTotal)}
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>صافي الديون</td>
                <td colSpan={2} style={{ fontWeight: 700 }}>
                  {debtsNet >= 0 ? '+' : '-'}{formatEGP(Math.abs(debtsNet))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card stat-card">
        <h3>إجمالي النقدية النهائي</h3>
        <div className="value">{formatEGP(denomsTotal + extrasTotal + debtsNet)}</div>
        <p className="muted" style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>
          الفئات {formatEGP(denomsTotal)} + المبالغ الإضافية {formatEGP(extrasTotal)}
          {' '}{debtsNet >= 0 ? '+' : '−'} صافي الديون {formatEGP(Math.abs(debtsNet))}
        </p>
      </div>
    </div>
  );
}
