import * as XLSX from 'xlsx';
import { formatEGP } from './money';
import type { Personnel } from '../types/database';

/**
 * Exports preserve original page grouping: one sheet per page when the
 * caller passes page-aware rows, instead of flattening everyone into one
 * long list (per spec section 15: كشف مستقل لكل صفحة).
 */

export function exportEntityRosterExcel(entityName: string, personnel: Personnel[], filenamePrefix = 'كشف') {
  const wb = XLSX.utils.book_new();
  const byPage = groupByPage(personnel);

  const summarySheet: (string | number)[][] = [['الصفحة', 'عدد الأفراد', 'إجمالي المبلغ']];
  for (const [pageNumber, rows] of byPage) {
    summarySheet.push([pageNumber ?? 'بدون ترقيم', rows.length, rows.reduce((s, r) => s + r.amount_cents, 0) / 100]);
  }
  summarySheet.push(['الإجمالي العام', personnel.length, personnel.reduce((s, r) => s + r.amount_cents, 0) / 100]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), 'الملخص');

  for (const [pageNumber, rows] of byPage) {
    const sheetData: (string | number)[][] = [['م', 'الاسم', 'المبلغ', 'تم القبض']];
    rows.forEach((r, i) => sheetData.push([i + 1, r.full_name, r.amount_cents / 100, r.is_paid ? 'نعم' : 'لا']));
    const sheetName = `صفحة ${pageNumber ?? '-'}`.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), sheetName);
  }

  XLSX.writeFile(wb, `${filenamePrefix}_${entityName}.xlsx`);
}

export function exportGroupedByAmountExcel(entityName: string, groups: { amountCents: number; totalCount: number; totalDueCents: number; paidCount: number; remainingCount: number }[]) {
  const data: (string | number)[][] = [['المبلغ', 'العدد', 'إجمالي المستحق', 'قبض', 'متبقي']];
  groups.forEach((g) => data.push([g.amountCents / 100, g.totalCount, g.totalDueCents / 100, g.paidCount, g.remainingCount]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'تجميعي حسب المرتب');
  XLSX.writeFile(wb, `تجميعي_${entityName}.xlsx`);
}

export async function exportElementToPDF(elementId: string, filename: string) {
  const html2pdf = (await import('html2pdf.js')).default;
  const element = document.getElementById(elementId);
  if (!element) throw new Error('العنصر المطلوب تصديره غير موجود');
  await html2pdf()
    .set({
      margin: 0.5,
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    })
    .from(element)
    .save();
}

function groupByPage(personnel: Personnel[]): [number | null, Personnel[]][] {
  const map = new Map<number | null, Personnel[]>();
  for (const p of personnel) {
    const key = p.page_number ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}

export { formatEGP };
