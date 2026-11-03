/**
 * PDF text extraction (prototype).
 *
 * Rebuilds readable lines from the positioned text items of a PDF (pdf.js `getTextContent`).
 * It works on any object shaped like a pdf.js document, so the same code runs in the browser
 * and in node scripts; the caller loads the PDF.
 *
 * Lines are rebuilt by clustering items on their baseline (y). Items on the same line are joined
 * left to right: a small gap becomes one space, a big gap (a different column of the drawing
 * sheet) becomes three spaces, so parsers can split columns with /\s{3,}/.
 */

/** The part of a pdf.js text item this module uses. */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, e, f]; e = x, f = y (PDF points, origin bottom-left) */
  transform: number[];
  width: number;
}

/** The part of a pdf.js document this module uses. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: Array<PdfTextItem | { str?: undefined }> }>;
  }>;
}

export interface PdfLine {
  /** baseline y of the line (PDF points) */
  y: number;
  /** x of the first item */
  x: number;
  text: string;
}

export interface PdfPageText {
  page: number;
  lines: PdfLine[];
  /** all lines joined with \n */
  text: string;
}

const LINE_TOLERANCE = 2.0; // points: items whose baselines are this close share a line
const COLUMN_GAP = 12;      // points: a gap wider than this separates columns
const WORD_GAP = 1.5;       // points: a gap wider than this separates words

export function groupItemsIntoLines(items: PdfTextItem[]): PdfLine[] {
  const sorted = items
    .filter((i) => i.str !== undefined && i.str.trim() !== '')
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Array<{ y: number; items: typeof sorted }> = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= LINE_TOLERANCE);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const items = row.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd = items[0].x;
      items.forEach((it, i) => {
        if (i > 0) {
          const gap = it.x - prevEnd;
          text += gap > COLUMN_GAP ? '   ' : gap > WORD_GAP ? ' ' : '';
        }
        text += it.str;
        prevEnd = it.x + it.w;
      });
      return { y: row.y, x: items[0].x, text: text.replace(/\s+$/g, '') };
    });
}

export async function extractPdfPages(doc: PdfDocumentLike): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter((i): i is PdfTextItem => typeof i.str === 'string');
    const lines = groupItemsIntoLines(items);
    pages.push({ page: p, lines, text: lines.map((l) => l.text).join('\n') });
  }
  return pages;
}

/** Feet-inches-sixteenths ("15-10-8") to inches (15 ft 10 in 8/16 = 190.5). */
export function fisToInches(fis: string): number | null {
  const m = fis.trim().match(/^(\d+)-(\d+)-(\d+)$/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]) + Number(m[3]) / 16;
}
