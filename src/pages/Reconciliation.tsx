import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { useCycle } from '../lib/cycle';
import { formatEGP } from '../lib/money';
import { denominationsTotalCents, extrasTotalCents, debtsNetCents, reconcile } from '../lib/reconciliation';
import { summarizeEntity } from '../lib/aggregation';
import { exportElementToPDF } from '../lib/exports';
import type { CashDenomination, CashExtraAmount, CashDebt, Entity, Personnel } from '../types/database';

export default function Reconciliation() {
  const { activeCycle } = useCycle();
  const cycleId = activeCycle?.id ?? '__none__';
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  const { data: entities } = useRealtimeQuery<Entity>('entities', () => supabase.from('entities').select('*').order('name'));
  const { data: personnel } = useRealtimeQuery<Personnel>(
    'personnel', () => supabase.from('personnel').select('*').eq('cycle_id', cycleId), `cycle_id=eq.${cycleId}`, [cycleId],
  );
  const { data: denoms } = useRealtimeQuery<CashDenomination>(
    'cash_denominations', () => supabase.from('cash_denominations').select('*').eq('cycle_id', cycleId), `cycle_id=eq.${cycleId}`, [cycleId],
  );
  const { data: extras } = useRealtimeQuery<CashExtraAmount>(
    'cash_extra_amounts', () => supabase.from('cash_extra_amounts').select('*').eq('cycle_id', cycleId), `cycle_id=eq.${cycleId}`, [cycleId],
  );
  const { data: debts } = useRealtimeQuery<CashDebt>(
    'cash_debts', () => supabase.from('cash_debts').select('*').eq('cycle_id', cycleId), `cycle_id=eq.${cycleId}`, [cycleId],
  );

  if (!activeCycle) return <p className="muted">أنشئ دورة قبض أولاً.</p>;

  const remainingByPerson = personnel.filter((p) => !p.is_paid);
  const remainingTotal = remainingByPerson.reduce((s, p) => s + p.amount_cents, 0);
  const debtRows = debts.map((d) => ({ description: d.description, amountCents: d.amount_cents, direction: d.direction }));
  const debtsNet = debtsNetCents(debtRows);

  const recon = reconcile(
    denoms.map((d) => ({ valueCents: d.value_cents, pieceCount: d.piece_count })),
    extras.map((e) => ({ description: e.description, amountCents: e.amount_cents })),
    remainingTotal,
    debtRows,
  );

  const statusLabel = recon.status === 'surplus' ? 'زيادة' : recon.status === 'deficit' ? 'عجز' : 'الجرد متزن';
  const statusClass = recon.status === 'surplus' ? 'value-success' : recon.status === 'deficit' ? 'value-danger' : '';

  return (
    <div>
      <div className="row-between">
        <h1>التسوية المالية النهائية</h1>
        <button className="btn btn-sm" onClick={() => exportElementToPDF('reconciliation-report', `تسوية_${activeCycle.name}.pdf`)}>تصدير PDF</button>
      </div>

      <div id="reconciliation-report">
      <div className="grid grid-cards page-section">
        <div className="card stat-card"><h3>إجمالي النقدية الموجودة</h3><div className="value">{formatEGP(recon.cashOnHandCents)}</div></div>
        <div className="card stat-card"><h3>إجمالي المستحقات المتبقية</h3><div className="value">{formatEGP(recon.remainingDueCents)}</div></div>
        <div className="card stat-card">
          <h3>الفرق النهائي</h3>
          <div className={`value ${statusClass}`}>
            {recon.status === 'deficit' ? '−' : recon.status === 'surplus' ? '+' : ''}
            {formatEGP(Math.abs(recon.differenceCents))} ({statusLabel})
          </div>
        </div>
      </div>

      <div className="card page-section">
        <h2>تفاصيل تكوين النقدية الموجودة</h2>
        <p className="muted">
          الفئات النقدية: {formatEGP(denominationsTotalCents(denoms.map((d) => ({ valueCents: d.value_cents, pieceCount: d.piece_count }))))} جنيه
          {' '}+ المبالغ الإضافية: {formatEGP(extrasTotalCents(extras.map((e) => ({ description: e.description, amountCents: e.amount_cents }))))} جنيه
          {' '}{debtsNet >= 0 ? '+' : '−'} صافي الديون (لينا/علينا): {formatEGP(Math.abs(debtsNet))} جنيه
          {' '}= {formatEGP(recon.cashOnHandCents)} جنيه
        </p>
        {debts.length > 0 && (
          <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
            <table>
              <thead><tr><th className="name-cell">الوصف</th><th>النوع</th><th>المبلغ</th></tr></thead>
              <tbody>
                {debts.map((d) => (
                  <tr key={d.id}>
                    <td className="name-cell">{d.description}</td>
                    <td><span className={`tag ${d.direction === 'owed_to_us' ? 'tag-paid' : 'tag-unpaid'}`}>{d.direction === 'owed_to_us' ? 'لينا' : 'علينا'}</span></td>
                    <td>{formatEGP(d.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card page-section">
        <h2>تفاصيل المستحقات المتبقية حسب الجهة</h2>
        {entities.map((entity) => {
          const entityRemaining = remainingByPerson.filter((p) => p.entity_id === entity.id);
          if (entityRemaining.length === 0) return null;
          const summary = summarizeEntity(entity.id, entity.name, personnel.filter((p) => p.entity_id === entity.id).map((p) => ({
            id: p.id, fullName: p.full_name, amountCents: p.amount_cents, isPaid: p.is_paid,
          })));
          const isOpen = expandedEntity === entity.id;
          return (
            <div key={entity.id} style={{ marginBottom: '0.75rem' }}>
              <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setExpandedEntity(isOpen ? null : entity.id)}>
                <strong>{entity.name}</strong>
                <span className="muted">{summary.remainingCount} فرد — {formatEGP(summary.remainingCents)} جنيه {isOpen ? '▲' : '▼'}</span>
              </div>
              {isOpen && (
                <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                  <table>
                    <thead><tr><th className="name-cell">الاسم</th><th>المبلغ</th></tr></thead>
                    <tbody>
                      {entityRemaining.map((p) => (
                        <tr key={p.id}><td className="name-cell">{p.full_name}</td><td>{formatEGP(p.amount_cents)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {remainingByPerson.length === 0 && <p className="muted">لا توجد مستحقات متبقية — الجميع قبضوا.</p>}
      </div>
      </div>
    </div>
  );
}
