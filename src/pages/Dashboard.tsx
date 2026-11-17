import { Link } from 'react-router-dom';
import { useCycle } from '../lib/cycle';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { supabase } from '../lib/supabaseClient';
import { formatEGP } from '../lib/money';
import type { Personnel, Entity, CashDenomination, CashExtraAmount, CashDebt } from '../types/database';
import { summarizeEntity } from '../lib/aggregation';
import { denominationsTotalCents, extrasTotalCents, debtsNetCents, reconcile } from '../lib/reconciliation';

export default function Dashboard() {
  const { activeCycle, loading: cycleLoading } = useCycle();
  const cycleId = activeCycle?.id ?? '__none__';

  const { data: entities } = useRealtimeQuery<Entity>(
    'entities', () => supabase.from('entities').select('*').eq('is_active', true).order('name'),
  );

  const { data: personnel, loading: peopleLoading } = useRealtimeQuery<Personnel>(
    'personnel',
    () => supabase.from('personnel').select('*').eq('cycle_id', cycleId),
    `cycle_id=eq.${cycleId}`,
    [cycleId],
  );

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

  if (cycleLoading) return <div className="muted">جارٍ التحميل...</div>;
  if (!activeCycle) {
    return (
      <div className="card">
        <h1>لا توجد دورة قبض بعد</h1>
        <p className="muted">ابدأ بإنشاء دورة جديدة من صفحة أرشيف الدورات.</p>
        <Link to="/archive" className="btn btn-primary">إنشاء دورة جديدة</Link>
      </div>
    );
  }

  const totalDue = personnel.reduce((s, p) => s + p.amount_cents, 0);
  const paid = personnel.filter((p) => p.is_paid);
  const unpaid = personnel.filter((p) => !p.is_paid);
  const paidTotal = paid.reduce((s, p) => s + p.amount_cents, 0);
  const remainingTotal = unpaid.reduce((s, p) => s + p.amount_cents, 0);

  const debtRows = debts.map((d) => ({ description: d.description, amountCents: d.amount_cents, direction: d.direction }));

  const cashOnHand = denominationsTotalCents(
    denoms.map((d) => ({ valueCents: d.value_cents, pieceCount: d.piece_count })),
  ) + extrasTotalCents(extras.map((e) => ({ description: e.description, amountCents: e.amount_cents })))
    + debtsNetCents(debtRows);

  const recon = reconcile(
    denoms.map((d) => ({ valueCents: d.value_cents, pieceCount: d.piece_count })),
    extras.map((e) => ({ description: e.description, amountCents: e.amount_cents })),
    remainingTotal,
    debtRows,
  );

  return (
    <div>
      <h1>{activeCycle.name} {activeCycle.status === 'closed' && <span className="tag tag-closed">مغلقة</span>}</h1>

      <div className="grid grid-cards page-section">
        <div className="card stat-card"><h3>عدد الجهات</h3><div className="value">{entities.length}</div></div>
        <div className="card stat-card"><h3>إجمالي الأفراد</h3><div className="value">{personnel.length}</div></div>
        <div className="card stat-card"><h3>إجمالي المستحقات</h3><div className="value">{formatEGP(totalDue)}</div></div>
        <div className="card stat-card"><h3>عدد الذين قبضوا</h3><div className="value value-success">{paid.length}</div></div>
        <div className="card stat-card"><h3>عدد الذين لم يقبضوا</h3><div className="value value-danger">{unpaid.length}</div></div>
        <div className="card stat-card"><h3>إجمالي المقبوض</h3><div className="value value-success">{formatEGP(paidTotal)}</div></div>
        <div className="card stat-card"><h3>إجمالي المتبقي</h3><div className="value value-danger">{formatEGP(remainingTotal)}</div></div>
        <div className="card stat-card"><h3>إجمالي النقدية الموجودة</h3><div className="value">{formatEGP(cashOnHand)}</div></div>
        <div className="card stat-card">
          <h3>الفرق النهائي</h3>
          <div className={`value ${recon.status === 'surplus' ? 'value-success' : recon.status === 'deficit' ? 'value-danger' : ''}`}>
            {recon.status === 'deficit' ? '−' : recon.status === 'surplus' ? '+' : ''}
            {formatEGP(Math.abs(recon.differenceCents))}
            {' '}
            {recon.status === 'surplus' ? '(زيادة)' : recon.status === 'deficit' ? '(عجز)' : '(متزن)'}
          </div>
        </div>
      </div>

      <h2>الجهات</h2>
      <div className="grid grid-cards">
        {entities.map((entity) => {
          const entityPeople = personnel.filter((p) => p.entity_id === entity.id);
          const s = summarizeEntity(entity.id, entity.name, entityPeople.map((p) => ({
            id: p.id, fullName: p.full_name, amountCents: p.amount_cents, isPaid: p.is_paid,
          })));
          return (
            <Link to={`/entities/${entity.id}`} key={entity.id} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>{entity.name}</h3>
              <div className="muted">{s.totalPersonnel} فرد — {formatEGP(s.totalDueCents)} جنيه</div>
              <div className="row" style={{ marginTop: '0.4rem' }}>
                <span className="tag tag-paid">قبضوا: {s.paidCount}</span>
                <span className="tag tag-unpaid">لم يقبضوا: {s.remainingCount}</span>
              </div>
            </Link>
          );
        })}
        {entities.length === 0 && <p className="muted">لا توجد جهات بعد — أضف جهة من صفحة "الجهات".</p>}
      </div>

      {peopleLoading && <p className="muted">جارٍ تحديث الأرقام...</p>}
    </div>
  );
}
