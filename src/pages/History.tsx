import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import * as XLSX from 'xlsx';
import { useCycle } from '../lib/cycle';
import { ACTION_TYPE_LABELS } from '../types/database';
import type { AuditLog, Entity, Profile } from '../types/database';

export default function History() {
  const { activeCycle, cycles } = useCycle();
  const [cycleFilter, setCycleFilter] = useState<string>(activeCycle?.id ?? 'all');
  const [userFilter, setUserFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: logs, loading } = useRealtimeQuery<AuditLog>(
    'audit_logs',
    () => supabase.from('audit_logs').select('*').order('at', { ascending: false }).limit(500),
  );
  const { data: entities } = useRealtimeQuery<Entity>('entities', () => supabase.from('entities').select('*'));
  const { data: profiles } = useRealtimeQuery<Profile>('profiles', () => supabase.from('profiles').select('*'));

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (cycleFilter !== 'all' && log.cycle_id !== cycleFilter) return false;
      if (userFilter !== 'all' && log.actor_id !== userFilter) return false;
      if (entityFilter !== 'all' && log.entity_id !== entityFilter) return false;
      if (actionFilter !== 'all' && log.action_type !== actionFilter) return false;
      if (dateFrom && new Date(log.at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(log.at) > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    });
  }, [logs, cycleFilter, userFilter, entityFilter, actionFilter, dateFrom, dateTo]);

  const entityName = (id: string | null) => entities.find((e) => e.id === id)?.name ?? '—';
  const actionTypes = useMemo(() => Array.from(new Set(logs.map((l) => l.action_type))), [logs]);

  const exportExcel = () => {
    const data: (string | number)[][] = [['الوقت', 'المستخدم', 'العملية', 'الجهة', 'الفرد', 'قبل', 'بعد', 'تفاصيل']];
    filtered.forEach((log) => data.push([
      new Date(log.at).toLocaleString('ar-EG'), log.actor_name, ACTION_TYPE_LABELS[log.action_type] ?? log.action_type,
      entityName(log.entity_id), log.person_name ?? '', log.old_value ?? '', log.new_value ?? '', log.details ?? '',
    ]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'سجل الأحداث');
    XLSX.writeFile(wb, 'سجل_الأحداث.xlsx');
  };

  return (
    <div>
      <div className="row-between">
        <h1>سجل الأحداث — History</h1>
        <button className="btn btn-sm" onClick={exportExcel}>تصدير Excel</button>
      </div>
      <p className="muted">سجل كامل، append-only، لا يمكن لأي مستخدم تعديله أو حذفه.</p>

      <div className="row page-section">
        <select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}>
          <option value="all">كل الدورات</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="all">كل المستخدمين</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          <option value="all">كل الجهات</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="all">كل أنواع العمليات</option>
          {actionTypes.map((t) => <option key={t} value={t}>{ACTION_TYPE_LABELS[t] ?? t}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="muted">إلى</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {loading && <p className="muted">جارٍ التحميل...</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الوقت</th>
              <th>المستخدم</th>
              <th>العملية</th>
              <th>الجهة</th>
              <th className="name-cell">الفرد</th>
              <th>القيمة قبل</th>
              <th>القيمة بعد</th>
              <th className="name-cell">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{log.actor_name}</td>
                <td>{ACTION_TYPE_LABELS[log.action_type] ?? log.action_type}</td>
                <td>{entityName(log.entity_id)}</td>
                <td className="name-cell">{log.person_name ?? '—'}</td>
                <td>{log.old_value ?? '—'}</td>
                <td>{log.new_value ?? '—'}</td>
                <td className="name-cell">{log.details ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="muted">لا توجد أحداث مطابقة.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: '0.4rem' }}>عدد النتائج: {filtered.length}</p>
    </div>
  );
}
