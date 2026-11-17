import { useState } from 'react';
import JSZip from 'jszip';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/auth';
import { useCycle } from '../lib/cycle';
import { useRealtimeQuery } from '../lib/useRealtimeQuery';
import { api } from '../lib/api';
import { parseWordRoster, type ParseResult } from '../lib/wordParser';
import { formatEGP } from '../lib/money';
import type { Entity, SourceDocument } from '../types/database';

export default function ImportRoster() {
  const { activeCycle } = useCycle();
  const { session } = useAuth();
  const { data: entities } = useRealtimeQuery<Entity>(
    'entities', () => supabase.from('entities').select('*').eq('is_active', true).order('name'),
  );

  const [entityId, setEntityId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const cycleId = activeCycle?.id ?? '__none__';
  const { data: existingDocs } = useRealtimeQuery<SourceDocument>(
    'source_documents',
    () => supabase.from('source_documents').select('*').eq('cycle_id', cycleId).eq('status', 'approved'),
    `cycle_id=eq.${cycleId}`,
    [cycleId],
  );
  const existingApproved = existingDocs.find((d) => d.entity_id === entityId);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
    setDone(null);
    if (!f) return;
    setParsing(true);
    try {
      const parsed = await parseWordRoster(f, JSZip);
      setResult(parsed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const updateRowField = (pageNumber: number, orderInPage: number, field: 'name' | 'amountCents', value: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((page) => {
        if (page.pageNumber !== pageNumber) return page;
        const rows = page.rows.map((row) => {
          if (row.orderInPage !== orderInPage) return row;
          if (field === 'name') return { ...row, name: value };
          const cents = Math.round(parseFloat(value || '0') * 100);
          return { ...row, amountCents: Number.isNaN(cents) ? row.amountCents : cents };
        });
        return { ...page, rows, totalAmountCents: rows.reduce((s, r) => s + r.amountCents, 0) };
      });
      const totalAmountCents = pages.reduce((s, p) => s + p.totalAmountCents, 0);
      const totalPersonCount = pages.reduce((s, p) => s + p.rows.length, 0);
      return { ...prev, pages, totalAmountCents, totalPersonCount };
    });
  };

  const removeRow = (pageNumber: number, orderInPage: number) => {
    setResult((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((page) => {
        if (page.pageNumber !== pageNumber) return page;
        const rows = page.rows.filter((r) => r.orderInPage !== orderInPage);
        return { ...page, rows, totalAmountCents: rows.reduce((s, r) => s + r.amountCents, 0) };
      });
      return {
        ...prev,
        pages,
        totalAmountCents: pages.reduce((s, p) => s + p.totalAmountCents, 0),
        totalPersonCount: pages.reduce((s, p) => s + p.rows.length, 0),
      };
    });
  };

  const handleApprove = async () => {
    if (!result || !file || !activeCycle || !entityId || !session) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1) Upload the original file to private storage.
      const storagePath = `${activeCycle.id}/${entityId}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('payroll-documents').upload(storagePath, file);
      if (uploadErr) throw new Error(`فشل رفع الملف: ${uploadErr.message}`);

      // 2) Create the source_documents row (pending_review).
      const { data: docRow, error: docErr } = await supabase
        .from('source_documents')
        .insert({
          cycle_id: activeCycle.id,
          entity_id: entityId,
          storage_path: storagePath,
          original_filename: file.name,
          status: 'pending_review',
          page_count: result.pages.length,
          person_count: result.totalPersonCount,
          total_amount_cents: result.totalAmountCents,
          uploaded_by: session.user.id,
        })
        .select()
        .single();
      if (docErr || !docRow) throw new Error(docErr?.message ?? 'فشل إنشاء سجل الكشف');

      // 3) Insert source_pages, keeping original page numbers/order.
      const pageInserts = result.pages.map((p) => ({
        document_id: docRow.id,
        page_number: p.pageNumber,
        person_count: p.rows.length,
        total_amount_cents: p.totalAmountCents,
      }));
      const { data: pageRows, error: pagesErr } = await supabase.from('source_pages').insert(pageInserts).select();
      if (pagesErr || !pageRows) throw new Error(pagesErr?.message ?? 'فشل حفظ صفحات الكشف');

      const pageIdByNumber = new Map(pageRows.map((p) => [p.page_number, p.id]));

      // 4) Insert personnel rows, one per person, preserving page + order.
      const personnelInserts = result.pages.flatMap((page) =>
        page.rows.map((row) => ({
          cycle_id: activeCycle.id,
          entity_id: entityId,
          document_id: docRow.id,
          page_id: pageIdByNumber.get(page.pageNumber),
          page_number: page.pageNumber,
          order_in_page: row.orderInPage,
          full_name: row.name,
          amount_cents: row.amountCents,
        })),
      );
      const { error: peopleErr } = await supabase.from('personnel').insert(personnelInserts);
      if (peopleErr) throw new Error(`فشل حفظ الأفراد: ${peopleErr.message}`);

      // 5) Approve — either first-time approval or a replacement of an existing approved doc.
      if (existingApproved) {
        await api.replaceDocument(existingApproved.id, docRow.id);
      } else {
        await api.approveDocument(docRow.id);
      }

      setDone(`تم اعتماد الكشف: ${result.totalPersonCount} فرد، إجمالي ${formatEGP(result.totalAmountCents)} جنيه.`);
      setResult(null);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeCycle) return <p className="muted">أنشئ دورة قبض أولاً من صفحة الأرشيف.</p>;
  if (activeCycle.status === 'closed') return <p className="muted">هذه الدورة مغلقة — لا يمكن استيراد كشوف جديدة فيها.</p>;

  return (
    <div>
      <h1>استيراد الكشوف</h1>

      <div className="card page-section">
        <div className="row">
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">اختر الجهة...</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {existingApproved && entityId && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            يوجد كشف معتمد بالفعل لهذه الجهة في هذه الدورة ("{existingApproved.original_filename}") —
            اعتماد كشف جديد هنا سيستبدله (يبقى محفوظاً في الأرشيف ولا يُحذف).
          </p>
        )}
      </div>

      {entityId && (
        <div className="dropzone page-section" onClick={() => document.getElementById('file-input')?.click()}>
          <input
            id="file-input" type="file" accept=".docx" hidden
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <p>{file ? `📄 ${file.name}` : 'اضغط لاختيار ملف Word (.docx)'}</p>
        </div>
      )}

      {parsing && <p className="muted">جارٍ تحليل الملف...</p>}
      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-text">{done}</p>}

      {result && (
        <div className="page-section">
          {result.warnings.map((w, i) => <p key={i} className="error-text">⚠ {w}</p>)}
          <p className="muted">
            استراتيجية اكتشاف الصفحات: {
              result.pageDetectionStrategy === 'one-table-per-page' ? 'جدول منفصل لكل صفحة'
              : result.pageDetectionStrategy === 'single-table-with-breaks' ? 'فواصل صفحات صريحة داخل جدول واحد'
              : 'جدول واحد بلا فواصل (راجع الترقيم يدوياً)'
            }
          </p>

          <div className="row-between">
            <h2>معاينة الاستخراج — {entities.find((e) => e.id === entityId)?.name}</h2>
            <div className="muted">
              {result.totalPersonCount} فرد — إجمالي {formatEGP(result.totalAmountCents)} جنيه — {result.pages.length} صفحة
            </div>
          </div>

          {result.pages.map((page) => (
            <div key={page.pageNumber} className="card page-section">
              <div className="row-between">
                <h2>صفحة {page.pageNumber}</h2>
                <span className="muted">{page.rows.length} فرد — {formatEGP(page.totalAmountCents)} جنيه</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>م</th><th className="name-cell">الاسم</th><th>المبلغ</th><th></th></tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <tr key={row.orderInPage}>
                        <td>{row.orderInPage}</td>
                        <td className="name-cell">
                          <input
                            value={row.name}
                            onChange={(e) => updateRowField(page.pageNumber, row.orderInPage, 'name', e.target.value)}
                            style={{ width: '100%' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" step="0.01" style={{ width: '90px' }}
                            value={(row.amountCents / 100).toFixed(2)}
                            onChange={(e) => updateRowField(page.pageNumber, row.orderInPage, 'amountCents', e.target.value)}
                          />
                        </td>
                        <td>
                          <button className="btn btn-sm btn-danger" onClick={() => removeRow(page.pageNumber, row.orderInPage)}>حذف</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <button className="btn btn-success" onClick={handleApprove} disabled={submitting || result.totalPersonCount === 0}>
            {submitting ? 'جارٍ الاعتماد...' : existingApproved ? 'اعتماد كبديل للكشف الحالي' : 'اعتماد الكشف'}
          </button>
        </div>
      )}
    </div>
  );
}
