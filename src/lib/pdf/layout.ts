/**
 * Roof truss layout reader (prototype).
 *
 * The layout is a plan view: every truss is a bar (two or more parallel lines whose spacing is the
 * truss thickness), girders carry bars that end on them, and dimension strings ("52-00-00") sit next
 * to a dimension line of that length. From this the reader finds
 *   - the drawing scale,
 *   - which truss bars end on a girder bar (who hangs from whom) and where along the girder,
 *   - the connector callouts (JUS210-2, HUS26) next to each junction.
 *
 * Positions along a girder are matched to the hanger positions printed on the engineering sheet, so the
 * layout only has to be right about the ORDER and SPACING of the trusses, not about the origin.
 * Limits: bars at right angles only (no skewed trusses yet), one layout page.
 */

import { extractSegments } from './pdfVectors';
import type { PdfPageLike, Segment } from './pdfVectors';
import type { PdfJob } from './types';

export interface LayoutWord {
  text: string;
  x: number;
  y: number;
  /** advance length along the text direction */
  w: number;
  /** font size */
  h: number;
  rotated: boolean;
}

export interface LayoutPage {
  words: LayoutWord[];
  segments: Segment[];
}

/** The part of a pdf.js page this module uses. */
export interface LayoutPageSource extends PdfPageLike {
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number }> }>;
}

export async function readLayoutPage(page: LayoutPageSource, OPS: Record<string, number>): Promise<LayoutPage> {
  const content = await page.getTextContent();
  const words: LayoutWord[] = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || it.str.trim() === '' || !it.transform) continue;
    const [a, b] = it.transform;
    words.push({
      text: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
      h: Math.hypot(a, b),
      rotated: Math.abs(b) > Math.abs(a),
    });
  }
  return { words, segments: await extractSegments(page, OPS) };
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

const DIM = /^(\d+)-(\d+)-(\d+)$/;

function dimInches(text: string): number | null {
  const m = text.match(DIM);
  if (!m || Number(m[2]) > 11 || Number(m[3]) > 15) return null; // rejects phone numbers
  return Number(m[1]) * 12 + Number(m[2]) + Number(m[3]) / 16;
}

const isH = (s: Segment) => Math.abs(s.y1 - s.y2) < 0.05;
const isV = (s: Segment) => Math.abs(s.x1 - s.x2) < 0.05;
const segLen = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** inches per PDF point, from the dimension strings and the dimension lines beside them. */
export function inferScale(layout: LayoutPage): number | null {
  const votes = new Map<number, number>();
  for (const w of layout.words) {
    const inches = dimInches(w.text);
    if (inches === null || inches < 24) continue;
    const along = w.rotated ? w.y + w.w / 2 : w.x + w.w / 2;
    let best: { off: number; len: number } | null = null;
    for (const s of layout.segments) {
      if (w.rotated ? !isV(s) : !isH(s)) continue;
      const lo = w.rotated ? Math.min(s.y1, s.y2) : Math.min(s.x1, s.x2);
      const hi = w.rotated ? Math.max(s.y1, s.y2) : Math.max(s.x1, s.x2);
      if (along < lo - 1 || along > hi + 1 || segLen(s) < 20) continue;
      const off = w.rotated ? Math.abs(s.x1 - w.x) : Math.abs(s.y1 - w.y);
      if (off < 14 && (!best || off < best.off)) best = { off, len: segLen(s) };
    }
    if (best) {
      const key = Math.round((inches / best.len) * 100) / 100;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }
  let scale: number | null = null;
  let top = 1; // at least two dimension lines must agree
  for (const [k, n] of votes) if (n > top) { top = n; scale = k; }
  return scale;
}

// ---------------------------------------------------------------------------
// Bars (trusses in plan)
// ---------------------------------------------------------------------------

export interface Bar {
  axis: 'h' | 'v';
  /** centre across the bar (y for a horizontal bar, x for a vertical one) */
  c: number;
  /** extent along the bar */
  a0: number;
  a1: number;
  /** distance between the outer lines */
  thick: number;
}

const BAR_MIN_LENGTH = 6;
const BAR_MERGE = 1.1; // lines closer than this belong to the same bar (a truss is 1 to 4 lines about 0.8 apart)

export function buildBars(segments: Segment[]): Bar[] {
  const bars: Array<Bar & { lo: number; hi: number }> = [];
  for (const s of segments) {
    if (segLen(s) < BAR_MIN_LENGTH) continue;
    const axis = isH(s) ? 'h' : isV(s) ? 'v' : null;
    if (!axis) continue;
    const c = axis === 'h' ? s.y1 : s.x1;
    const a0 = axis === 'h' ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2);
    const a1 = axis === 'h' ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2);
    const bar = bars.find((b) => b.axis === axis && c >= b.lo - BAR_MERGE && c <= b.hi + BAR_MERGE && a0 <= b.a1 + 1 && a1 >= b.a0 - 1);
    if (bar) {
      bar.lo = Math.min(bar.lo, c);
      bar.hi = Math.max(bar.hi, c);
      bar.a0 = Math.min(bar.a0, a0);
      bar.a1 = Math.max(bar.a1, a1);
    } else bars.push({ axis, c, a0, a1, thick: 0, lo: c, hi: c });
  }
  // lines can reach a bar through another bar: merge bars until none touch any more
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < bars.length && !merged; i++) {
      for (let j = i + 1; j < bars.length && !merged; j++) {
        const p = bars[i];
        const q = bars[j];
        if (p.axis !== q.axis) continue;
        const gap = Math.max(p.lo - q.hi, q.lo - p.hi);
        if (gap > BAR_MERGE || p.a0 > q.a1 + 1 || q.a0 > p.a1 + 1) continue;
        p.lo = Math.min(p.lo, q.lo);
        p.hi = Math.max(p.hi, q.hi);
        p.a0 = Math.min(p.a0, q.a0);
        p.a1 = Math.max(p.a1, q.a1);
        bars.splice(j, 1);
        merged = true;
      }
    }
  }
  return bars.map((b) => ({ axis: b.axis, c: (b.lo + b.hi) / 2, a0: b.a0, a1: b.a1, thick: b.hi - b.lo }));
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

export interface LayoutConnection {
  girder: string;
  carried: string;
  /** position along the girder (inches), snapped to the engineering hanger position it matched */
  position: number;
  /** connector printed next to the junction (e.g. "JUS210-2"), when found */
  connector: string | null;
}

export interface LayoutLinks {
  scale: number | null;
  connections: LayoutConnection[];
  /** why something could not be linked, for display */
  notes: string[];
}

const wordBox = (w: LayoutWord) =>
  w.rotated
    ? { x0: w.x - w.h, x1: w.x, y0: w.y, y1: w.y + w.w }
    : { x0: w.x, x1: w.x + w.w, y0: w.y, y1: w.y + w.h };

function distBoxToBar(w: LayoutWord, b: Bar): number {
  const box = wordBox(w);
  const bx0 = b.axis === 'h' ? b.a0 : b.c - b.thick / 2;
  const bx1 = b.axis === 'h' ? b.a1 : b.c + b.thick / 2;
  const by0 = b.axis === 'h' ? b.c - b.thick / 2 : b.a0;
  const by1 = b.axis === 'h' ? b.c + b.thick / 2 : b.a1;
  const dx = Math.max(bx0 - box.x1, box.x0 - bx1, 0);
  const dy = Math.max(by0 - box.y1, box.y0 - by1, 0);
  return Math.hypot(dx, dy);
}

const baseLabel = (text: string) => text.replace(/\(\d+\)$/, '');
const CONNECTOR = /^[A-Z]{2,4}\d+[A-Z0-9-]*$/;
const SNAP = 1.5; // inches: a layout position this close to a printed hanger position is that hanger

export function linkLayout(layout: LayoutPage, job: PdfJob): LayoutLinks {
  const notes: string[] = [];
  const scale = inferScale(layout);
  if (!scale) return { scale, connections: [], notes: ['Could not infer the drawing scale from the dimension lines.'] };

  const bars = buildBars(layout.segments);
  const labels = new Set(job.trusses.map((t) => t.label.toUpperCase()));
  const labelWords = layout.words.filter((w) => labels.has(baseLabel(w.text).toUpperCase()));
  const connectors = layout.words.filter((w) => CONNECTOR.test(w.text) && !labels.has(w.text.toUpperCase()));

  /** the bar a truss label annotates: the nearest bar whose thickness fits the truss's plies best */
  const barOf = (w: LayoutWord, ply: number): Bar | null => {
    const want = (ply * 1.5) / scale;
    let best: { bar: Bar; score: number } | null = null;
    for (const b of bars) {
      if (b.thick < 0.3) continue; // dimension lines and brackets are single lines
      const d = distBoxToBar(w, b);
      if (d > 8) continue;
      const score = d + Math.abs(b.thick - want) * 2;
      if (!best || score < best.score) best = { bar: b, score };
    }
    return best?.bar ?? null;
  };

  const plyOf = (label: string) => job.trusses.find((t) => t.label.toUpperCase() === label)?.ply ?? 1;
  const girders = new Map<string, number[]>();
  for (const t of job.trusses) if (t.hangerLoads.length) girders.set(t.label.toUpperCase(), [...new Set(t.hangerLoads.map((h) => h.position))].sort((a, b) => a - b));

  // bars carrying a label
  const labelled = labelWords.map((w) => ({ w, label: baseLabel(w.text).toUpperCase(), bar: barOf(w, plyOf(baseLabel(w.text).toUpperCase())) }));
  const seen = new Set<string>();
  const connections: LayoutConnection[] = [];

  for (const g of labelled.filter((l) => girders.has(l.label) && l.bar)) {
    const gBar = g.bar!;
    const expected = girders.get(g.label)!;
    // bars at right angles that cross or end on this girder bar
    const attached = bars.filter((b) => {
      if (b.axis === gBar.axis || b.thick < 0.3) return false;
      const onGirder = b.c >= gBar.a0 - 1 && b.c <= gBar.a1 + 1; // its centre line lies along the girder
      const reaches = b.a0 - 1.5 <= gBar.c && b.a1 + 1.5 >= gBar.c; // it crosses or ends on the girder
      return onGirder && reaches;
    });

    // label of each attached bar. A bar that ends on the girder is labelled anywhere along it (the label
    // often sits at the far end); a bar that runs on past the girder is labelled only next to the girder.
    const sides = attached.map((b) => {
      const crosses = b.a0 < gBar.c - 3 && b.a1 > gBar.c + 3;
      let best: { label: string; d: number } | null = null;
      for (const l of labelled) {
        if (l.label === g.label) continue;
        if (crosses && distBoxToBar(l.w, gBar) > 14) continue;
        const d = distBoxToBar(l.w, b);
        if (d <= (crosses ? 8 : 12) && (!best || d < best.d)) best = { label: l.label, d };
      }
      return { b, label: best?.label ?? null };
    });

    const byLabel = new Map<string, number[]>();
    for (const s of sides) if (s.label) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s.b.c]);

    for (const [carried, coords] of byLabel) {
      const along = [...new Set(coords.map((c) => Math.round(c * 100) / 100))].sort((a, b) => a - b);
      // try both directions along the girder; the offset is fixed by pairing the first coordinate with each printed position
      let best: { hits: Array<[number, number]>; offset: number; sign: number } | null = null;
      for (const sign of [1, -1]) {
        for (const p0 of expected) {
          const offset = p0 - sign * along[sign === 1 ? 0 : along.length - 1] * scale;
          const hits: Array<[number, number]> = [];
          for (const a of along) {
            const est = sign * a * scale + offset;
            const p = expected.find((e) => Math.abs(e - est) <= SNAP);
            if (p !== undefined) hits.push([a, p]);
          }
          if (!best || hits.length > best.hits.length) best = { hits, offset, sign };
        }
      }
      if (!best || best.hits.length === 0) {
        notes.push(`${g.label}: ${carried} ends on the girder but its spacing does not match the printed hanger positions.`);
        continue;
      }
      for (const [a, p] of best.hits) {
        const key = `${g.label}|${carried}|${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // connector next to the junction (centre of the carried bar on the girder edge)
        const jx = gBar.axis === 'h' ? a : gBar.c;
        const jy = gBar.axis === 'h' ? gBar.c : a;
        const near = connectors
          .map((c) => ({ c, d: Math.hypot(c.x + (c.rotated ? 0 : c.w / 2) - jx, c.y + (c.rotated ? c.w / 2 : c.h / 2) - jy) }))
          .filter((o) => o.d <= 14)
          .sort((p1, p2) => p1.d - p2.d)[0];
        connections.push({ girder: g.label, carried, position: p, connector: near?.c.text ?? null });
      }
    }
  }
  return { scale, connections, notes };
}
