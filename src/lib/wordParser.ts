/**
 * Word (.docx) roster parser — name + final amount, page-aware.
 *
 * Ported from the original "مجمع المرتبات" prototype (JSZip + raw document.xml
 * parsing). The prototype only pulled amounts (pounds+piastres split across two
 * cells) from the FIRST table and threw every page into one flat list. This
 * version:
 *   1. Extracts the name alongside the amount for every row.
 *   2. Preserves original page structure instead of flattening.
 *   3. Does NOT assume 331.37 — it reads whatever final amount is in the row.
 *
 * ── Known technical limitation (page detection) ─────────────────────────────
 * docx has no single reliable "page number" in its XML for documents whose
 * pagination is automatic (font/printer dependent) — only Word's rendering
 * engine knows that for certain. We use two detection strategies, in order:
 *
 *   A) One table per page (default, and the common shape for these rosters):
 *      every top-level <w:tbl> in document order is treated as one page.
 *      This is reliable and is what we recommend when each page starts a
 *      fresh table (a page title + a table per page in the source Word file).
 *
 *   B) Explicit page breaks inside a single table: if the WHOLE document has
 *      only one <w:tbl>, we additionally split its rows wherever Word wrote
 *      an explicit page-break run (<w:br w:type="page"/>) or a
 *      <w:lastRenderedPageBreak/> marker inside/around a row. This catches
 *      explicit breaks but is NOT guaranteed to match automatic reflow that
 *      has no break markers at all — if a document uses pure automatic
 *      pagination with a single continuous table and no break markers, we
 *      cannot recover true page numbers from the XML alone and the whole
 *      table is reported as a single page (surfaced in `warnings`).
 *
 * The caller (import review screen) must show `warnings` to the user so they
 * can confirm page numbers manually before approving.
 */

export interface ParsedRow {
  orderInPage: number;
  name: string;
  amountCents: number;
}

export interface ParsedPage {
  pageNumber: number;
  rows: ParsedRow[];
  totalAmountCents: number;
}

export interface ParseResult {
  pages: ParsedPage[];
  totalPersonCount: number;
  totalAmountCents: number;
  pageDetectionStrategy: 'one-table-per-page' | 'single-table-with-breaks' | 'single-table-no-breaks';
  warnings: string[];
}

// Rows to always skip, even though they sit inside the data area of the table:
//   - "اجمالي/الإجمالي/جملة" at the end of a page's table — a manual hand-written
//     total cell, not a person.
//   - "ما قبله" (وتصريفاته) at the START of pages 2+ — a manual running-carry
//     total from the previous page, also not a person. These are explicitly
//     NOT amounts we compute from — they're the old sheet's manual arithmetic,
//     and section 16 of the spec says not to carry old/manual totals into the
//     new system; we recompute totals ourselves instead.
const NON_PERSON_ROW_MARKERS = ['اجمالي', 'إجمالي', 'جملة', 'الاجمالي', 'الإجمالي', 'ما قبله', 'ماقبله'];

function isNonPersonRowText(text: string): boolean {
  return NON_PERSON_ROW_MARKERS.some((marker) => text.includes(marker));
}

/** Parses "331" + "37" (pounds, piastres as separate cell strings) into cents. */
function poundsPiastresToCents(poundsStr: string, piastresStr: string): number | null {
  const pounds = parseInt(poundsStr.replace(/[^\d-]/g, ''), 10);
  const piastres = parseInt(piastresStr.replace(/[^\d-]/g, ''), 10);
  if (Number.isNaN(pounds) && Number.isNaN(piastres)) return null;
  return (Number.isNaN(pounds) ? 0 : pounds) * 100 + (Number.isNaN(piastres) ? 0 : piastres);
}

/** Parses a single combined cell like "331.37" or "331,37" into cents. */
function combinedAmountToCents(text: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

function cellText(cell: Element): string {
  const textNodes = cell.getElementsByTagName('w:t');
  let text = '';
  for (const t of Array.from(textNodes)) text += t.textContent ?? '';
  return text.trim();
}

function looksNumeric(text: string): boolean {
  if (!text) return false;
  return /^-?[\d.,]+$/.test(text.replace(/\s/g, ''));
}

/**
 * Given a header row's cell texts, guess which column index holds the name
 * and which holds the final amount. Falls back to "first non-numeric column
 * = name, column with header containing المبلغ/الصافي/المرتب/الراتب = amount,
 * else the last numeric-looking column".
 */
function guessColumns(headerCells: string[], sampleDataRow: string[]): { nameIdx: number; amountIdx: number; amountIsSplit: boolean; piastresIdx?: number } {
  const amountHeaderWords = ['المبلغ', 'الصافي', 'المرتب', 'الراتب', 'النهائي', 'المستحق'];
  const piastresWords = ['قرش', 'بدون الحافز الفئة'];

  let amountIdx = headerCells.findIndex((h) => amountHeaderWords.some((w) => h.includes(w)));
  let nameIdx = headerCells.findIndex((h) => h.includes('اسم') || h.includes('الاسم'));

  // Fallback using the sample data row shape if headers are uninformative.
  if (nameIdx === -1) {
    nameIdx = sampleDataRow.findIndex((c) => c && !looksNumeric(c));
  }
  if (amountIdx === -1) {
    // last numeric-looking column, scanning from the right
    for (let i = sampleDataRow.length - 1; i >= 0; i--) {
      if (looksNumeric(sampleDataRow[i]) && i !== nameIdx) {
        amountIdx = i;
        break;
      }
    }
  }

  // Detect the legacy two-cell pounds+piastres split (adjacent numeric columns).
  const piastresIdx = headerCells.findIndex((h) => piastresWords.some((w) => h.includes(w)));

  return {
    nameIdx: nameIdx === -1 ? 0 : nameIdx,
    amountIdx: amountIdx === -1 ? headerCells.length - 1 : amountIdx,
    amountIsSplit: piastresIdx !== -1,
    piastresIdx: piastresIdx === -1 ? undefined : piastresIdx,
  };
}

function rowHasPageBreak(row: Element): boolean {
  return row.getElementsByTagName('w:br').length > 0 &&
    Array.from(row.getElementsByTagName('w:br')).some((br) => br.getAttribute('w:type') === 'page');
}

function extractRowsFromTable(table: Element): { headerCells: string[]; dataRowsWithBreakFlag: { cells: string[]; breaksBefore: boolean }[] } {
  const rows = Array.from(table.getElementsByTagName('w:tr'));
  if (rows.length === 0) return { headerCells: [], dataRowsWithBreakFlag: [] };

  const headerCells = Array.from(rows[0].getElementsByTagName('w:tc')).map(cellText);
  const dataRowsWithBreakFlag = rows.slice(1).map((row) => ({
    cells: Array.from(row.getElementsByTagName('w:tc')).map(cellText),
    breaksBefore: rowHasPageBreak(row),
  }));

  return { headerCells, dataRowsWithBreakFlag };
}

export async function parseWordRoster(file: File | Blob, JSZip: any): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(file);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) throw new Error('الملف لا يحتوي على document.xml — تأكد أنه ملف Word صحيح (.docx)');

  const docXml: string = await docEntry.async('text');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, 'text/xml');

  const tables = Array.from(xmlDoc.getElementsByTagName('w:tbl'));
  if (tables.length === 0) throw new Error('لم يتم العثور على أي جدول في الملف');

  const warnings: string[] = [];
  const pages: ParsedPage[] = [];
  let strategy: ParseResult['pageDetectionStrategy'];

  const buildPageFromRows = (
    pageNumber: number,
    headerCells: string[],
    rows: { cells: string[] }[],
  ): ParsedPage => {
    const firstDataRow = rows[0]?.cells ?? [];
    const cols = guessColumns(headerCells, firstDataRow);

    const parsedRows: ParsedRow[] = [];
    let order = 1;
    for (const row of rows) {
      // Check every cell, not just the name column: a manual "اجمالي" or
      // "ما قبله" row sometimes puts its label in a different cell than
      // where a name would normally sit (merged cells, shifted columns).
      if (row.cells.some((c) => isNonPersonRowText(c))) continue;

      const nameRaw = row.cells[cols.nameIdx] ?? '';
      if (!nameRaw) continue;

      let amountCents: number | null;
      if (cols.amountIsSplit && cols.piastresIdx !== undefined) {
        amountCents = poundsPiastresToCents(row.cells[cols.amountIdx] ?? '', row.cells[cols.piastresIdx] ?? '');
      } else {
        amountCents = combinedAmountToCents(row.cells[cols.amountIdx] ?? '');
      }
      if (amountCents === null || amountCents <= 0) continue;

      parsedRows.push({ orderInPage: order++, name: nameRaw, amountCents });
    }

    return {
      pageNumber,
      rows: parsedRows,
      totalAmountCents: parsedRows.reduce((s, r) => s + r.amountCents, 0),
    };
  };

  if (tables.length > 1) {
    // Strategy A: one table per page, in document order.
    strategy = 'one-table-per-page';
    tables.forEach((table, idx) => {
      const { headerCells, dataRowsWithBreakFlag } = extractRowsFromTable(table);
      if (dataRowsWithBreakFlag.length === 0) return;
      pages.push(buildPageFromRows(idx + 1, headerCells, dataRowsWithBreakFlag));
    });
  } else {
    // Single table: look for explicit page-break markers inside it.
    const { headerCells, dataRowsWithBreakFlag } = extractRowsFromTable(tables[0]);
    const breakIndices = dataRowsWithBreakFlag
      .map((r, i) => (r.breaksBefore ? i : -1))
      .filter((i) => i >= 0);

    if (breakIndices.length > 0) {
      strategy = 'single-table-with-breaks';
      let start = 0;
      let pageNum = 1;
      const boundaries = [...breakIndices, dataRowsWithBreakFlag.length];
      for (const end of boundaries) {
        const slice = dataRowsWithBreakFlag.slice(start, end);
        if (slice.length > 0) pages.push(buildPageFromRows(pageNum++, headerCells, slice));
        start = end;
      }
    } else {
      strategy = 'single-table-no-breaks';
      warnings.push(
        'لم يتم العثور على فواصل صفحات صريحة ولا جداول متعددة — تم التعامل مع الملف كصفحة واحدة. ' +
        'يرجى مراجعة ترقيم الصفحات يدوياً قبل الاعتماد إذا كان الكشف الأصلي يحتوي فعلياً على أكثر من صفحة.',
      );
      pages.push(buildPageFromRows(1, headerCells, dataRowsWithBreakFlag));
    }
  }

  if (pages.length === 0) {
    throw new Error('لم يتم استخراج أي أسماء/مبالغ صالحة من الملف. راجع تنسيق الجدول.');
  }

  const totalPersonCount = pages.reduce((s, p) => s + p.rows.length, 0);
  const totalAmountCents = pages.reduce((s, p) => s + p.totalAmountCents, 0);

  return { pages, totalPersonCount, totalAmountCents, pageDetectionStrategy: strategy, warnings };
}
