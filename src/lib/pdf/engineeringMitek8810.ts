/**
 * Reader for the MiTek "8.810" engineering sheets (ASCE / IRC style).
 *
 * One sheet per truss, headed
 *   Job   Truss   Truss Type   Qty   Ply   <job>
 *   <job> <label> <type> <qty> <ply>
 * and containing a LUMBER block, a REACTIONS line and, for a girder, the note
 *   "Hanger(s) or other connection device(s) shall be provided sufficient to support
 *    concentrated load(s) 1652 lb down at 15-10-8, and 1652 lb down at 36-1-8 on bottom chord."
 * which gives each hanger load, its position along the girder and the chord it is on.
 */

import type { PdfPageText } from './pdfText';
import { fisToInches } from './pdfText';
import type {
  PdfHangerLoad,
  PdfJob,
  PdfLumberException,
  PdfLumberSpec,
  PdfSupport,
  PdfTruss,
} from './types';

/** Any page: a set can start with a seal letter and MiTek's general reference sheet before the first truss. */
export function isMitek8810(pages: PdfPageText[]): boolean {
  return pages.some((p) => /Job\s+Truss\s+Truss Type/.test(p.text) && /MiTek Industries/.test(p.text));
}

function emptyTruss(label: string, type: string, page: number): PdfTruss {
  return {
    label,
    page,
    type,
    qty: null,
    ply: null,
    topChord: null,
    botChord: null,
    webs: null,
    exceptions: { topChord: [], botChord: [], webs: [] },
    supports: [],
    hangerLoads: [],
    notes: [],
  };
}

interface Header {
  job: string;
  label: string;
  type: string;
  qty: number | null;
  ply: number | null;
}

/** Reads the two header lines of a sheet page (qty / ply may wrap onto the next line). */
function parseHeader(lines: string[]): Header | null {
  const h = lines.findIndex((l) => /^Job\s+Truss\s+Truss Type/.test(l));
  if (h < 0 || !lines[h + 1]) return null;
  const tokens = lines[h + 1].trim().split(/\s+/);
  if (tokens.length < 3) return null;
  const [job, label, ...rest] = tokens;

  // trailing numeric tokens are qty and ply
  const nums: number[] = [];
  while (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1]) && nums.length < 2) {
    nums.unshift(Number(rest.pop()));
  }
  let qty: number | null = nums.length ? nums[0] : null;
  let ply: number | null = nums.length > 1 ? nums[1] : null;
  if (ply === null) {
    const next = lines[h + 2]?.trim().match(/^(\d+)\s+Job Reference/);
    if (next) ply = Number(next[1]);
  }
  return { job, label, type: rest.join(' '), qty, ply };
}

function spec(size: string, species: string, grade: string): PdfLumberSpec {
  return { size, species, grade: grade.trim() };
}

function parseLumber(lines: string[], t: PdfTruss): void {
  let exceptTarget: 'topChord' | 'botChord' | 'webs' | null = null;

  for (const line of lines) {
    if (/^REACTIONS\./.test(line)) exceptTarget = null;

    const chord = line.match(/^(TOP CHORD|BOT CHORD|WEBS)\s+(\d+x\d+)\s+(\S+)\s+(.*)$/);
    if (chord) {
      const key = chord[1] === 'TOP CHORD' ? 'topChord' : chord[1] === 'BOT CHORD' ? 'botChord' : 'webs';
      // the grade ends at "*Except*" or at the next column
      const grade = chord[4].split(/\*Except\*|\s{3,}/)[0];
      t[key] = spec(chord[2], chord[3], grade);
      exceptTarget = /\*Except\*/.test(line) ? key : null;
      continue;
    }

    if (exceptTarget) {
      const ex = line.match(/^([A-Z]+\d+(?:,[A-Z]+\d+)*):\s+(\d+x\d+)\s+(\S+)\s+(.*)$/);
      if (ex) {
        const item: PdfLumberException = {
          members: ex[1].split(','),
          spec: spec(ex[2], ex[3], ex[4].split(/\s{3,}/)[0]),
        };
        t.exceptions[exceptTarget].push(item);
      }
    }
  }
}

function parseReactions(lines: string[], t: PdfTruss): void {
  const text = lines.join('\n');
  const supports = new Map<string, PdfSupport>();
  const get = (joint: string): PdfSupport => {
    let s = supports.get(joint);
    if (!s) {
      s = { joint, down: null, uplift: null, bearing: null, upliftLoadCase: null };
      supports.set(joint, s);
    }
    return s;
  };

  const rLine = text.match(/^REACTIONS\.\s*\(lb\/size\)\s*(.*)$/m);
  if (rLine) {
    for (const m of rLine[1].matchAll(/(\d+)=(\d+)\/([^\s,(]+)/g)) {
      const s = get(m[1]);
      s.down = Number(m[2]);
      s.bearing = m[3];
    }
  }
  for (const m of text.matchAll(/Max Uplift(\d+)=(-?\d+)\(LC (\d+)\)/g)) {
    const s = get(m[1]);
    s.uplift = Number(m[2]);
    s.upliftLoadCase = Number(m[3]);
  }
  t.supports = [...supports.values()];
}

function parseHangerLoads(lines: string[], t: PdfTruss): void {
  const flat = lines.join(' ').replace(/\s+/g, ' ');
  const m = flat.match(/support concentrated load\(s\)\s+(.+?)\s+on\s+(top|bottom)\s+chord/i);
  if (!m) return;
  const chord: 'TC' | 'BC' = m[2].toLowerCase() === 'top' ? 'TC' : 'BC';
  const loads: PdfHangerLoad[] = [];
  for (const g of m[1].matchAll(/(\d+)\s*lb down at\s*(\d+-\d+-\d+)/g)) {
    const position = fisToInches(g[2]);
    if (position !== null) loads.push({ position, load: Number(g[1]), chord, joint: null });
  }
  t.hangerLoads = loads;
}

export function parseMitek8810(pages: PdfPageText[]): PdfJob {
  const trusses: PdfTruss[] = [];
  let jobName = '';
  let current: { truss: PdfTruss; lines: string[] } | null = null;
  const sheets: Array<{ truss: PdfTruss; lines: string[] }> = [];

  for (const page of pages) {
    const lines = page.lines.map((l) => l.text);
    const header = parseHeader(lines);
    if (!header) {
      if (current) current.lines.push(...lines);
      continue;
    }
    jobName = jobName || header.job;
    // a page with the same label and type as the previous one continues that sheet
    if (current && current.truss.label === header.label && current.truss.type === header.type) {
      current.lines.push(...lines);
      continue;
    }
    const truss = emptyTruss(header.label, header.type, page.page);
    truss.qty = header.qty;
    truss.ply = header.ply;
    current = { truss, lines: [...lines] };
    sheets.push(current);
  }

  for (const sheet of sheets) {
    parseLumber(sheet.lines, sheet.truss);
    parseReactions(sheet.lines, sheet.truss);
    parseHangerLoads(sheet.lines, sheet.truss);
    trusses.push(sheet.truss);
  }
  return { format: 'mitek-us', jobName, trusses };
}
