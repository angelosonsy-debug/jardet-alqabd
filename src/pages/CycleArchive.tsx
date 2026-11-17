import { useState } from 'react';
import { useCycle, ARABIC_MONTHS } from '../lib/cycle';
import { api } from '../lib/api';
import { monthLabel } from '../components/Layout';

const now = new Date();

export default function CycleArchive() {
  const { cycles, setActiveCycleId, refresh } = useCycle();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyExists = cycles.some((c) => c.period_year === year && c.period_month === month);

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const name = monthLabel(year, month);
      const cycle = await api.createCycle(name, year, month);
      await refresh();
      setActiveCycleId(cycle.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (id: string) => {
    if (!confirm('إغلاق هذه الدورة؟ ستصبح للقراءة فقط ويمكن إعادة فتحها لاحقاً.')) return;
    setError(null);
    try {
      await api.closeCycle(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleReopen = async (id: string) => {
    if (!confirm('إعادة فتح هذه الدورة؟ سيُسجَّل ذلك في History.')) return;
    setError(null);
    try {
      await api.reopenCycle(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <h1>أرشيف الدورات الشهرية</h1>

      <div className="card page-section">
        <h2>إنشاء دورة جديدة</h2>
        <div className="row">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {ARABIC_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: '100px' }} />
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy || alreadyExists}>
            {alreadyExists ? 'الدورة موجودة بالفعل' : 'إنشاء الدورة'}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <p className="muted" style={{ marginTop: '0.4rem' }}>
          الدورة الجديدة تبدأ فارغة تماماً — لا يتم ترحيل أي حالات قبض أو مستحقات من الشهر السابق.
        </p>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>الدورة</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead>
          <tbody>
            {cycles.map((cycle) => (
              <tr key={cycle.id}>
                <td>{cycle.name}</td>
                <td><span className={`tag ${cycle.status === 'open' ? 'tag-open' : 'tag-closed'}`}>{cycle.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span></td>
                <td>{new Date(cycle.created_at).toLocaleDateString('ar-EG')}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-sm" onClick={() => setActiveCycleId(cycle.id)}>عرض</button>
                    {cycle.status === 'open'
                      ? <button className="btn btn-sm btn-danger" onClick={() => handleClose(cycle.id)}>إغلاق</button>
                      : <button className="btn btn-sm btn-success" onClick={() => handleReopen(cycle.id)}>إعادة فتح</button>}
                  </div>
                </td>
              </tr>
            ))}
            {cycles.length === 0 && <tr><td colSpan={4} className="muted">لا توجد دورات بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
