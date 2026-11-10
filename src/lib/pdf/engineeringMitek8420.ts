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
 * The LUMBER table names chords by joints ("F - D  2x8  DRY  1950F 1.7E  SPF"). The chord-force table
 * lists the chord pieces with the load on each: top chord pieces carry the roof load, bottom chord pieces
 * the (smaller) ceiling load, heels and verticals none. The pieces with the smallest non-zero load are
 * the bottom chord; a lumber row whose two joints both lie on them is a bottom chord row, one whose joints
 * both lie on the top pieces is a top chord row.
 */

import type { PdfPageText } from './pdfText';
import { fisToInches } from './pdfText';
import type { PdfHangerLoad, PdfJob, PdfLumberSpec, PdfSupport, PdfTruss } from './types';

/** Any page: a set can start with a seal letter and MiTek's general reference sheet before the first truss. */
export function isMitek8420(pages: PdfPageText[]): boolean {
  return pages.some((p) => /JOB NAME\s+TRUSS NAME\s+QUANTITY/.test(p.text));
}

// a joint is a letter ("F") or, in older versions, a number ("12")
const J = '(?:[A-Z]{1,2}|\\d{1,3})';

const BEARING_ROW = new RegExp(
  `(?:^|\\s)(${J}(?:\\([A-Z]\\))?)\\s+(-?\\d+)\\s+(-?\\d+)\\s+(-?\\d+)\\s+(-?\\d+)\\s+(-?\\d+)\\s+(MECHANICAL|[\\d-]+)(?:\\s+[\\d-]+)?`
);
// the location is feet-inches-sixteenths ("4-8-12") or, under a foot, inches-sixteenths ("8-12")
const CONCENTRATED_ROW = new RegExp(`(?:^|\\s)(${J})\\s+(\\d+-\\d+(?:-\\d+)?)\\s+(-?\\d+)\\s+(-?\\d+)`);
const LUMBER_ROW = new RegExp(`(?:^|\\s)(${J})\\s*-\\s*(${J})\\s+(\\d)x(\\d+)\\s+DRY\\s+(.+?)\\s+(SPF|SP|DF|HF|[A-Z]{2,4})(?:\\s|$)`);
const CHORD_PIECE = new RegExp(`(?:^|\\s)(${J})-\\s*(${J})\\s+-?\\d+\\s*\\/\\s*-?\\d+\\s+(-?[\\d.]+)\\s+-?[\\d.]+\\s+[\\d.]+\\s+\\(\\d+\\)\\s+[\\d.]+`, 'g');

function locationInches(loc: string): number | null {
  const parts = loc.split('-').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return fisToInches(loc);
  return parts.length === 2 ? parts[0] + parts[1] / 16 : null;
}

interface LumberRow {
  from: string;
  to: string;
  spec: PdfLumberSpec;
}

/** Top and bottom chord lumber of a sheet, told apart by the load carried by the chord pieces. */
function readChords(lines: string[]): { top: LumberRow[]; bottom: LumberRow[] } {
  const rows: LumberRow[] = [];
  for (const l of lines) {
    const m = l.match(LUMBER_ROW);
    if (m) rows.push({ from: m[1], to: m[2], spec: { size: `${m[3]}x${m[4]}`, grade: m[5].trim(), species: m[6] } });
  }
  const pieces: Array<{ a: string; b: string; load: number }> = [];
  for (const l of lines) for (const m of l.matchAll(CHORD_PIECE)) pieces.push({ a: m[1], b: m[2], load: Math.abs(Number(m[3])) });
  const loads = [...new Set(pieces.map((p) => p.load).filter((v) => v > 0))].sort((x, y) => x - y);
  if (rows.length === 0 || loads.length < 2) return { top: [], bottom: [] };
  const near = (v: number, ref: number) => Math.abs(v - ref) <= ref * 0.2;
  const nodes = (ref: number) => new Set(pieces.filter((p) => near(p.load, ref)).flatMap((p) => [p.a, p.b]));
  const bottomNodes = nodes(loads[0]);
  const topNodes = nodes(loads[loads.length - 1]);
  const on = (set: Set<string>) => (r: LumberRow) => set.has(r.from) && set.has(r.to);
  return { top: rows.filter(on(topNodes)), bottom: rows.filter(on(bottomNodes)) };
}

/** The deepest row stands for the chord (the payload reads width and depth from the largest chord). */
function chordSpec(rows: LumberRow[]): PdfLumberSpec | null {
  const depth = (r: LumberRow) => Number(r.spec.size.split('x')[1]);
  return rows.length === 0 ? null : rows.reduce((best, r) => (depth(r) > depth(best) ? r : best)).spec;
}

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

  const chords = readChords(lines);
  t.topChord = chordSpec(chords.top);
  t.botChord = chordSpec(chords.bottom);
  // the left bearing is where the bottom chord starts: a joint that no bottom row ends on
  t.leftJoint = chords.bottom.find((r) => !chords.bottom.some((o) => o !== r && o.to === r.from))?.from ?? null;

  // --- factored concentrated loads (girder) ---
  const loadsAt = lines.findIndex((l) => /FACTORED CONCENTRATED LOADS/.test(l));
  if (loadsAt >= 0) {
    const loads: PdfHangerLoad[] = [];
    for (let i = loadsAt + 1; i < lines.length; i++) {
      if (/CONNECTION REQUIREMENTS/.test(lines[i])) break;
      const m = lines[i].match(CONCENTRATED_ROW);
      if (!m) continue;
      const position = locationInches(m[2]);
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
