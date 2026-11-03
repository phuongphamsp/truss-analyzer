/**
 * Reader for the MiTek "8.420" engineering sheets (Canadian, NBCC / CSA O86, factored loads).
 *
 * One page per truss, headed
 *   JOB NAME   TRUSS NAME   QUANTITY   PLY
 *   <job>      <label>      <qty>      <ply>
 * A BEARINGS table gives the factored reactions per joint:
 *   JT  VERT HORZ DOWN HORZ UPLIFT  BRG IN-SX  BRG IN-SX
 *   C   34   0    34   0    -68     1-8       1-8
 * and a girder has a FACTORED CONCENTRATED LOADS table (joint, position, load).
 *
 * Gap: the CHORDS table names chords by joints ("E- B", "A- C"), so top / bottom chord and
 * their species cannot be told apart without the drawing geometry; they are left empty.
 */

import type { PdfPageText } from './pdfText';
import { fisToInches } from './pdfText';
import type { PdfHangerLoad, PdfJob, PdfSupport, PdfTruss } from './types';

export function isMitek8420(pages: PdfPageText[]): boolean {
  const first = pages[0]?.text ?? '';
  return /JOB NAME\s+TRUSS NAME\s+QUANTITY/.test(first);
}

const BEARING_ROW =
  /(?:^|\s)([A-Z]{1,2}(?:\([A-Z]\))?)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(MECHANICAL|[\d-]+)(?:\s+[\d-]+)?/;
const CONCENTRATED_ROW = /(?:^|\s)([A-Z]{1,2})\s+(\d+-\d+-\d+)\s+(-?\d+)\s+(-?\d+)/;

function parsePage(lines: string[], pageNumber: number): PdfTruss | null {
  const h = lines.findIndex((l) => /JOB NAME\s+TRUSS NAME\s+QUANTITY/.test(l));
  if (h < 0) return null;
  const row = lines.slice(h + 1, h + 4).map((l) => l.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\b/)).find(Boolean);
  if (!row) return null;

  const t: PdfTruss = {
    label: row[2],
    page: pageNumber,
    type: '',
    qty: Number(row[3]),
    ply: Number(row[4]),
    topChord: null,
    botChord: null,
    webs: null,
    exceptions: { topChord: [], botChord: [], webs: [] },
    supports: [],
    hangerLoads: [],
    notes: [],
  };

  // --- bearings table ---
  const supports: PdfSupport[] = [];
  const tableAt = lines.findIndex((l) => /JT\s+VERT\s+HORZ\s+DOWN\s+HORZ\s+UPLIFT/.test(l));
  if (tableAt >= 0) {
    for (let i = tableAt + 1; i < lines.length; i++) {
      if (/UNFACTORED|SEE MITEK|PROVIDE ANCHORAGE|BEARING MATERIAL/.test(lines[i])) break;
      const m = lines[i].match(BEARING_ROW);
      if (m) {
        supports.push({
          joint: m[1],
          down: Number(m[4]),
          uplift: Number(m[6]),
          bearing: m[7],
          upliftLoadCase: null,
        });
      }
    }
  }
  t.supports = supports;

  // --- factored concentrated loads (girder) ---
  const loadsAt = lines.findIndex((l) => /FACTORED CONCENTRATED LOADS/.test(l));
  if (loadsAt >= 0) {
    const loads: PdfHangerLoad[] = [];
    for (let i = loadsAt + 1; i < lines.length; i++) {
      if (/CONNECTION REQUIREMENTS/.test(lines[i])) break;
      const m = lines[i].match(CONCENTRATED_ROW);
      if (!m) continue;
      const position = fisToInches(m[2]);
      if (position !== null) loads.push({ position, load: Math.abs(Number(m[3])), chord: null, joint: m[1] });
    }
    t.hangerLoads = loads;
  }
  return t;
}

export function parseMitek8420(pages: PdfPageText[]): PdfJob {
  const trusses: PdfTruss[] = [];
  let jobName = '';
  for (const page of pages) {
    const t = parsePage(page.lines.map((l) => l.text), page.page);
    if (!t) continue;
    const header = page.lines.map((l) => l.text).find((l) => /^\S+\s+\S+\s+\d+\s+\d+\b/.test(l));
    jobName = jobName || (header ? header.split(/\s+/)[0] : '');
    trusses.push(t);
  }
  return { format: 'mitek-8.420', jobName, trusses };
}
