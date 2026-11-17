import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { api } from '../lib/api';
import type { Entity } from '../types/database';

export default function Entities() {
  const { data: entities, loading } = useRealtimeQuery<Entity>(
    'entities', () => supabase.from('entities').select('*').order('created_at'),
  );
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createEntity(newName.trim());
      setNewName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startRename = (entity: Entity) => {
    setRenaming(entity.id);
    setRenameValue(entity.name);
  };

  const confirmRename = async (entityId: string) => {
    if (!renameValue.trim()) return;
    setBusy(true);
    try {
      await api.renameEntity(entityId, renameValue.trim());
      setRenaming(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (entity: Entity) => {
    setBusy(true);
    try {
      await api.setEntityActive(entity.id, !entity.is_active);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>الجهات والسرايا</h1>

      <form onSubmit={handleCreate} className="row page-section">
        <input
          type="text"
          placeholder="اسم جهة جديدة (مثال: خدمات المعاونة)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !newName.trim()}>إضافة جهة</button>
      </form>
      {error && <p className="error-text">{error}</p>}

      {loading && <p className="muted">جارٍ التحميل...</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="name-cell">الاسم</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id}>
                <td className="name-cell">
                  {renaming === entity.id ? (
                    <div className="row">
                      <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                      <button className="btn btn-sm btn-primary" onClick={() => confirmRename(entity.id)}>حفظ</button>
                      <button className="btn btn-sm" onClick={() => setRenaming(null)}>إلغاء</button>
                    </div>
                  ) : (
                    <Link to={`/entities/${entity.id}`}>{entity.name}</Link>
                  )}
                </td>
                <td>
                  <span className={`tag ${entity.is_active ? 'tag-paid' : 'tag-closed'}`}>
                    {entity.is_active ? 'نشطة' : 'معطلة'}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-sm" onClick={() => startRename(entity)} disabled={busy}>إعادة تسمية</button>
                    <button className="btn btn-sm" onClick={() => toggleActive(entity)} disabled={busy}>
                      {entity.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {entities.length === 0 && !loading && (
              <tr><td colSpan={3} className="muted">لا توجد جهات بعد.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
