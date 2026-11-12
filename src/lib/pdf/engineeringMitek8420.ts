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

// the job name may hold spaces ("THORNBURN H"): the truss name is the token before quantity and ply
const HEADER_ROW = /^(.+?)\s+(\S+)\s+(\d+)\s+(\d+)(?:\s|$)/;

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
function readChords(lines: string[]): {
  top: LumberRow[];
  bottom: LumberRow[];
  chordOf: (joint: string) => 'TC' | 'BC' | null;
  /** lumber of the chord piece a joint lies on (the deepest when it is where two pieces meet) */
  specAt: (joint: string) => PdfLumberSpec | null;
} {
  const rows: LumberRow[] = [];
  for (const l of lines) {
    const m = l.match(LUMBER_ROW);
    if (m) rows.push({ from: m[1], to: m[2], spec: { size: `${m[3]}x${m[4]}`, grade: m[5].trim(), species: m[6] } });
  }
  const pieces: Array<{ a: string; b: string; load: number }> = [];
  for (const l of lines) for (const m of l.matchAll(CHORD_PIECE)) pieces.push({ a: m[1], b: m[2], load: Math.abs(Number(m[3])) });
  const loads = [...new Set(pieces.map((p) => p.load).filter((v) => v > 0))].sort((x, y) => x - y);
  const none = () => null;
  if (rows.length === 0 || loads.length < 2) return { top: [], bottom: [], chordOf: none, specAt: none };
  const near = (v: number, ref: number) => Math.abs(v - ref) <= ref * 0.2;
  const nodes = (ref: number) => new Set(pieces.filter((p) => near(p.load, ref)).flatMap((p) => [p.a, p.b]));
  const bottomNodes = nodes(loads[0]);
  const topNodes = nodes(loads[loads.length - 1]);
  // every piece carrying more than the bottom chord does lies on the top chord (its load changes along the roof)
  const aboveBottom = new Set(pieces.filter((p) => p.load > loads[0] * 1.2).flatMap((p) => [p.a, p.b]));
  const on = (set: Set<string>) => (r: LumberRow) => set.has(r.from) && set.has(r.to);
  // a lumber row names the two ends of a run of chord pieces ("A - C" is A-B and B-C): the joints between lie on the path
  const adjacent = new Map<string, Set<string>>();
  for (const p of pieces.filter((q) => q.load > 0)) {
    adjacent.set(p.a, (adjacent.get(p.a) ?? new Set()).add(p.b));
    adjacent.set(p.b, (adjacent.get(p.b) ?? new Set()).add(p.a));
  }
  const pathNodes = (from: string, to: string): Set<string> => {
    const previous = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    for (let i = 0; i < queue.length && !previous.has(to); i++) {
      for (const n of adjacent.get(queue[i]) ?? []) if (!previous.has(n)) { previous.set(n, queue[i]); queue.push(n); }
    }
    const out = new Set<string>();
    for (let n: string | null | undefined = previous.has(to) ? to : null; n; n = previous.get(n)) out.add(n);
    return out.size > 0 ? out : new Set([from, to]);
  };
  const depthOf = (r: LumberRow) => Number(r.spec.size.split('x')[1]);
  return {
    top: rows.filter(on(topNodes)),
    bottom: rows.filter(on(bottomNodes)),
    chordOf: (joint) => (bottomNodes.has(joint) ? 'BC' : aboveBottom.has(joint) ? 'TC' : null),
    specAt: (joint) => {
      const chordSet = bottomNodes.has(joint) ? bottomNodes : aboveBottom.has(joint) ? aboveBottom : null;
      if (!chordSet) return null;
      const covering = rows.filter((r) => chordSet.has(r.from) && chordSet.has(r.to) && pathNodes(r.from, r.to).has(joint));
      return covering.length === 0 ? null : covering.reduce((a, b) => (depthOf(b) > depthOf(a) ? b : a)).spec;
    },
  };
}

/** The deepest row stands for the chord (the payload reads width and depth from the largest chord). */
function chordSpec(rows: LumberRow[]): PdfLumberSpec | null {
  const depth = (r: LumberRow) => Number(r.spec.size.split('x')[1]);
  return rows.length === 0 ? null : rows.reduce((best, r) => (depth(r) > depth(best) ? r : best)).spec;
}

function parsePage(lines: string[], pageNumber: number): PdfTruss | null {
  const h = lines.findIndex((l) => /JOB NAME\s+TRUSS NAME\s+QUANTITY/.test(l));
  if (h < 0) return null;
  const row = lines.slice(h + 1, h + 4).map((l) => l.match(HEADER_ROW)).find(Boolean);
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
  for (const s of t.supports) s.chord = chords.chordOf(s.joint);
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
      if (position !== null) loads.push({ position, load: Math.abs(Number(m[3])), chord: chords.chordOf(m[1]), joint: m[1], spec: chords.specAt(m[1]) });
    }
    t.hangerLoads = loads;
  }
  return t;
}

/** The truss name printed in the header of a page, or null for a page that is not a truss sheet. */
function sheetLabel(lines: string[]): { label: string; job: string } | null {
  const h = lines.findIndex((l) => /JOB NAME\s+TRUSS NAME\s+QUANTITY/.test(l));
  if (h < 0) return null;
  const row = lines.slice(h + 1, h + 4).map((l) => l.match(HEADER_ROW)).find(Boolean);
  return row ? { label: row[2], job: row[1] } : null;
}

export function parseMitek8420(pages: PdfPageText[]): PdfJob {
  let jobName = '';
  // a sheet can run over several pages ("CONTINUED ON PAGE 2"): consecutive pages of one truss are read as one
  const sheets: Array<{ label: string; page: number; lines: string[] }> = [];
  for (const page of pages) {
    const lines = page.lines.map((l) => l.text);
    const head = sheetLabel(lines);
    if (!head) continue;
    jobName = jobName || head.job;
    const last = sheets[sheets.length - 1];
    if (last && last.label === head.label) last.lines.push(...lines);
    else sheets.push({ label: head.label, page: page.page, lines: [...lines] });
  }
  const trusses = sheets.map((sh) => parsePage(sh.lines, sh.page)).filter((t): t is PdfTruss => t !== null);
  return { format: 'mitek-canada', jobName, trusses };
}
