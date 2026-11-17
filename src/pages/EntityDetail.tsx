import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { useCycle } from '../lib/cycle';
import { useConnectionStatus } from '../lib/useConnectionStatus';
import { api } from '../lib/api';
import { formatEGP, poundsToCents } from '../lib/money';
import { groupByAmount } from '../lib/aggregation';
import { exportEntityRosterExcel, exportGroupedByAmountExcel } from '../lib/exports';
import type { Entity, Personnel } from '../types/database';

type ViewMode = 'list' | 'grouped' | 'pages';
type FilterMode = 'all' | 'paid' | 'unpaid';
type SortMode = 'name' | 'amount';

export default function EntityDetail() {
  const { entityId } = useParams<{ entityId: string }>();
  const { activeCycle } = useCycle();
  const connection = useConnectionStatus();
  const canMutate = connection === 'online' && activeCycle?.status === 'open';

  const { data: entities } = useRealtimeQuery<Entity>('entities', () => supabase.from('entities').select('*'));
  const entity = entities.find((e) => e.id === entityId);

  const cycleId = activeCycle?.id ?? '__none__';
  const { data: personnel, loading, error } = useRealtimeQuery<Personnel>(
    'personnel',
    () => supabase.from('personnel').select('*').eq('cycle_id', cycleId).eq('entity_id', entityId ?? '__none__'),
    `cycle_id=eq.${cycleId}`,
    [cycleId, entityId],
  );

  const [view, setView] = useState<ViewMode>('list');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'amount'; value: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [activePage, setActivePage] = useState<number | 'all'>('all');

  const filtered = useMemo(() => {
    let rows = personnel;
    if (filter === 'paid') rows = rows.filter((p) => p.is_paid);
    if (filter === 'unpaid') rows = rows.filter((p) => !p.is_paid);
    if (search.trim()) rows = rows.filter((p) => p.full_name.includes(search.trim()));
    if (view === 'pages' && activePage !== 'all') rows = rows.filter((p) => p.page_number === activePage);

    rows = [...rows].sort((a, b) => {
      if (sort === 'amount') return b.amount_cents - a.amount_cents;
      return a.full_name.localeCompare(b.full_name, 'ar');
    });
    return rows;
  }, [personnel, filter, search, sort, view, activePage]);

  const pageNumbers = useMemo(
    () => Array.from(new Set(personnel.map((p) => p.page_number).filter((n): n is number => n != null))).sort((a, b) => a - b),
    [personnel],
  );

  const selectedPeople = filtered.filter((p) => selected.has(p.id) && !p.is_paid);
  const selectedTotal = selectedPeople.reduce((s, p) => s + p.amount_cents, 0);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleToggle = async (person: Personnel) => {
    setActionError(null);
    setBusyId(person.id);
    try {
      if (person.is_paid) await api.revertPayment(person.id);
      else await api.registerPayment(person.id);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkRegister = async () => {
    if (selectedPeople.length === 0) return;
    if (!confirm(`سيتم تسجيل قبض ${selectedPeople.length} فرد بإجمالي ${formatEGP(selectedTotal)} جنيه. متابعة؟`)) return;
    setActionError(null);
    try {
      await api.registerPaymentsBulk(selectedPeople.map((p) => p.id));
      setSelected(new Set());
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setActionError(null);
    try {
      if (editing.field === 'name') {
        if (!editing.value.trim()) return;
        await api.updatePersonnelName(editing.id, editing.value.trim());
      } else {
        const pounds = parseFloat(editing.value);
        if (Number.isNaN(pounds) || pounds < 0) {
          setActionError('مبلغ غير صالح');
          return;
        }
        await api.updatePersonnelAmount(editing.id, poundsToCents(pounds));
      }
      setEditing(null);
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCycle || !entityId || !newName.trim()) return;
    const pounds = parseFloat(newAmount);
    if (Number.isNaN(pounds) || pounds < 0) {
      setActionError('مبلغ غير صالح');
      return;
    }
    try {
      await api.addPersonnel({
        cycleId: activeCycle.id, entityId, fullName: newName.trim(), amountCents: poundsToCents(pounds),
      });
      setNewName('');
      setNewAmount('');
      setAddOpen(false);
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handleDelete = async (person: Personnel) => {
    if (!confirm(`حذف "${person.full_name}" نهائياً؟`)) return;
    try {
      await api.deletePersonnel(person.id);
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  if (!entity) return <p className="muted">جارٍ التحميل...</p>;

  const totalDue = personnel.reduce((s, p) => s + p.amount_cents, 0);
  const paidCount = personnel.filter((p) => p.is_paid).length;

  return (
    <div>
      <div className="row-between page-section">
        <h1>{entity.name}</h1>
        <Link to="/entities" className="muted">&larr; كل الجهات</Link>
      </div>

      {!activeCycle?.status || activeCycle.status === 'closed' ? (
        <p className="muted">هذه الدورة مغلقة — القراءة والمراجعة فقط.</p>
      ) : null}
      {connection !== 'online' && <p className="error-text">غير متصل — عمليات القبض معطلة حتى تعود المزامنة.</p>}

      <div className="grid grid-cards page-section">
        <div className="card stat-card"><h3>عدد الأفراد</h3><div className="value">{personnel.length}</div></div>
        <div className="card stat-card"><h3>إجمالي المستحق</h3><div className="value">{formatEGP(totalDue)}</div></div>
        <div className="card stat-card"><h3>قبضوا</h3><div className="value value-success">{paidCount}</div></div>
        <div className="card stat-card"><h3>لم يقبضوا</h3><div className="value value-danger">{personnel.length - paidCount}</div></div>
      </div>

      <div className="row-between page-section">
        <div className="row">
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`} onClick={() => setView('list')}>بالأسماء</button>
          <button className={`btn btn-sm ${view === 'grouped' ? 'btn-primary' : ''}`} onClick={() => setView('grouped')}>تجميعي حسب المرتب</button>
          <button className={`btn btn-sm ${view === 'pages' ? 'btn-primary' : ''}`} onClick={() => setView('pages')}>حسب صفحات الكشف</button>
        </div>
        {view !== 'grouped' && (
          <button className="btn btn-sm btn-primary" onClick={() => setAddOpen((v) => !v)} disabled={!canMutate}>
            + إضافة فرد
          </button>
        )}
      </div>

      {addOpen && (
        <form onSubmit={handleAdd} className="card row page-section">
          <input placeholder="الاسم" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <input placeholder="المبلغ (جنيه)" type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} required />
          <button className="btn btn-primary" type="submit">إضافة</button>
        </form>
      )}

      {actionError && <p className="error-text">{actionError}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="row page-section">
        <button className="btn btn-sm" onClick={() => exportEntityRosterExcel(entity.name, personnel)}>تصدير كشف كامل (Excel)</button>
        <button className="btn btn-sm" onClick={() => exportEntityRosterExcel(entity.name, personnel.filter((p) => p.is_paid), 'كشف_المقبوضين')}>تصدير المقبوضين</button>
        <button className="btn btn-sm" onClick={() => exportEntityRosterExcel(entity.name, personnel.filter((p) => !p.is_paid), 'كشف_غير_المقبوضين')}>تصدير غير المقبوضين</button>
        <button className="btn btn-sm" onClick={() => exportGroupedByAmountExcel(entity.name, groupByAmount(personnel.map((p) => ({ id: p.id, fullName: p.full_name, amountCents: p.amount_cents, isPaid: p.is_paid }))))}>تصدير التجميعي</button>
      </div>

      {view === 'grouped' ? (
        <GroupedView personnel={personnel} />
      ) : (
        <>
          <div className="row page-section">
            <input type="search" placeholder="البحث بالاسم..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
              <option value="all">الجميع</option>
              <option value="unpaid">لم يقبضوا فقط</option>
              <option value="paid">قبضوا فقط</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="name">ترتيب بالاسم</option>
              <option value="amount">ترتيب بالمبلغ</option>
            </select>
            {view === 'pages' && (
              <select value={activePage} onChange={(e) => setActivePage(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">كل الصفحات</option>
                {pageNumbers.map((n) => <option key={n} value={n}>صفحة {n}</option>)}
              </select>
            )}
          </div>

          {selectedPeople.length > 0 && (
            <div className="card row-between page-section">
              <span>تم تحديد {selectedPeople.length} فرد — إجمالي {formatEGP(selectedTotal)} جنيه</span>
              <button className="btn btn-success" onClick={handleBulkRegister} disabled={!canMutate}>تسجيل قبض المحددين</button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="checkbox-cell"></th>
                  <th>تم القبض</th>
                  <th>م</th>
                  <th className="name-cell">الاسم</th>
                  <th>المبلغ</th>
                  {view === 'pages' && <th>الصفحة</th>}
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((person, idx) => (
                  <tr key={person.id}>
                    <td className="checkbox-cell">
                      {!person.is_paid && (
                        <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggleSelect(person.id)} disabled={!canMutate} />
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={person.is_paid}
                        onChange={() => handleToggle(person)}
                        disabled={!canMutate || busyId === person.id}
                      />
                    </td>
                    <td>{idx + 1}</td>
                    <td className="name-cell">
                      {editing?.id === person.id && editing.field === 'name' ? (
                        <div className="row">
                          <input value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                          <button className="btn btn-sm btn-primary" onClick={saveEdit}>حفظ</button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>إلغاء</button>
                        </div>
                      ) : (
                        <span onDoubleClick={() => canMutate && setEditing({ id: person.id, field: 'name', value: person.full_name })}>
                          {person.full_name}
                        </span>
                      )}
                    </td>
                    <td>
                      {editing?.id === person.id && editing.field === 'amount' ? (
                        <div className="row" style={{ justifyContent: 'center' }}>
                          <input
                            type="number" step="0.01" style={{ width: '90px' }}
                            value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          />
                          <button className="btn btn-sm btn-primary" onClick={saveEdit}>حفظ</button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>إلغاء</button>
                        </div>
                      ) : (
                        <span onDoubleClick={() => canMutate && setEditing({ id: person.id, field: 'amount', value: (person.amount_cents / 100).toFixed(2) })}>
                          {formatEGP(person.amount_cents)}
                        </span>
                      )}
                    </td>
                    {view === 'pages' && <td>{person.page_number ?? '—'}</td>}
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(person)} disabled={!canMutate}>حذف</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={7} className="muted">لا توجد نتائج.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function GroupedView({ personnel }: { personnel: Personnel[] }) {
  const groups = groupByAmount(personnel.map((p) => ({
    id: p.id, fullName: p.full_name, amountCents: p.amount_cents, isPaid: p.is_paid,
  })));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>المبلغ</th>
            <th>العدد</th>
            <th>إجمالي المستحق</th>
            <th>قبض</th>
            <th>متبقي</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.amountCents}>
              <td>{formatEGP(g.amountCents)}</td>
              <td>{g.totalCount}</td>
              <td>{formatEGP(g.totalDueCents)}</td>
              <td>{g.paidCount}</td>
              <td>{g.remainingCount}</td>
            </tr>
          ))}
          {groups.length === 0 && <tr><td colSpan={5} className="muted">لا توجد بيانات.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
