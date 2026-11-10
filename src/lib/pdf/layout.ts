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

/** Truss spacings (inches) a roof is framed at. */
const STANDARD_SPACINGS = [12, 16, 19.2, 24, 32, 48];

/** How many gaps between neighbouring parallel bars come to a standard truss spacing at this scale. */
function spacingMatches(bars: Bar[], scale: number): number {
  let hits = 0;
  for (const axis of ['h', 'v'] as const) {
    const same = bars.filter((b) => b.axis === axis).sort((p, q) => p.c - q.c);
    for (let i = 1; i < same.length; i++) {
      const p = same[i - 1];
      const q = same[i];
      const overlap = Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0);
      if (overlap < 0.5 * Math.min(p.a1 - p.a0, q.a1 - q.a0)) continue;
      const inches = (q.c - p.c) * scale;
      if (STANDARD_SPACINGS.some((sp) => Math.abs(inches - sp) <= sp * 0.03)) hits++;
    }
  }
  return hits;
}

/**
 * inches per PDF point, from the dimension strings and the dimension lines beside them.
 * A schedule or legend table beside the plan also has dimension strings next to lines (table rows), and
 * can outvote the plan; the plan's scale is the candidate at which neighbouring trusses are a standard
 * spacing apart.
 */
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
  // votes within 2% of each other are one candidate
  const clusters: Array<{ scale: number; votes: number }> = [];
  for (const [k, n] of [...votes].sort((a, b) => a[0] - b[0])) {
    const last = clusters[clusters.length - 1];
    if (last && k <= last.scale * 1.02) {
      last.scale = (last.scale * last.votes + k * n) / (last.votes + n);
      last.votes += n;
    } else clusters.push({ scale: k, votes: n });
  }
  const candidates = clusters.filter((c) => c.votes >= 2).sort((a, b) => b.votes - a.votes).slice(0, 4); // at least two dimension lines must agree
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return Math.round(candidates[0].scale * 100) / 100;
  const bars = buildBars(layout.segments);
  const scored = candidates.map((c) => ({ ...c, hits: spacingMatches(bars, c.scale) }));
  const best = scored.sort((a, b) => b.hits - a.hits || b.votes - a.votes)[0];
  return Math.round(best.scale * 100) / 100;
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
const DEFAULT_BAR_MERGE = 1.1; // lines closer than this belong to the same bar (a truss is 1 to 4 lines about 0.8 apart)

export function buildBars(segments: Segment[], BAR_MERGE = DEFAULT_BAR_MERGE): Bar[] {
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
const SPACING_TOLERANCE = 2.5; // inches: a bar may be this far from where the printed hanger spacing puts it
const REFERENCE_SCALE = 1.86; // inches per point of the layout the label distances were tuned on
const SNAP = 1.5; // inches: a layout position this close to a printed hanger position is that hanger

export function linkLayout(layout: LayoutPage, job: PdfJob): LayoutLinks {
  const notes: string[] = [];
  const scale = inferScale(layout);
  if (!scale) return { scale, connections: [], notes: ['Could not infer the drawing scale from the dimension lines.'] };

  // a truss is 1.5" thick on the drawing: lines up to that far apart (plus slack) are one bar
  const bars = buildBars(layout.segments, Math.max(DEFAULT_BAR_MERGE, (1.5 / scale) * 1.3));
  // distances between a label and its bar are about the same on the paper, i.e. fewer points on a small drawing
  const reach = (points: number) => points * Math.min(1, REFERENCE_SCALE / scale);
  const labels = new Set(job.trusses.map((t) => t.label.toUpperCase()));
  const labelWords = layout.words.filter((w) => labels.has(baseLabel(w.text).toUpperCase()));
  const connectors = layout.words.filter((w) => CONNECTOR.test(w.text) && !labels.has(w.text.toUpperCase()));

  /** the bars a truss label may annotate, best first: near the label, thickness close to the truss's plies */
  const barsOf = (w: LayoutWord, ply: number): Bar[] => {
    const want = (ply * 1.5) / scale;
    const found: Array<{ bar: Bar; score: number }> = [];
    for (const b of bars) {
      if (b.thick < 0.3) continue; // dimension lines and brackets are single lines
      const d = distBoxToBar(w, b);
      if (d > reach(8)) continue;
      // text runs along the bar it names: rotated text names a vertical bar
      const alongText = b.axis === (w.rotated ? 'v' : 'h') ? 0 : 4;
      found.push({ bar: b, score: d + Math.abs(b.thick - want) * 2 + alongText });
    }
    return found.sort((p, q) => p.score - q.score).map((x) => x.bar);
  };
  const barOf = (w: LayoutWord, ply: number): Bar | null => barsOf(w, ply)[0] ?? null;

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
      const reach = 1.5 + gBar.thick / 2; // a bar ends on the face of the girder, not on its centre line
      const reaches = b.a0 - reach <= gBar.c && b.a1 + reach >= gBar.c; // it crosses or ends on the girder
      return onGirder && reaches;
    });

    // label of each attached bar. A bar that ends on the girder is labelled anywhere along it (the label
    // often sits at the far end); a bar that runs on past the girder is labelled only next to the girder.
    const sides = attached.map((b) => {
      const crosses = b.a0 < gBar.c - 3 && b.a1 > gBar.c + 3;
      let best: { label: string; d: number } | null = null;
      for (const l of labelled) {
        if (l.label === g.label) continue;
        if (crosses && distBoxToBar(l.w, gBar) > reach(14)) continue;
        const d = distBoxToBar(l.w, b);
        if (d <= reach(crosses ? 8 : 12) && (!best || d < best.d)) best = { label: l.label, d };
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
          .filter((o) => o.d <= reach(14))
          .sort((p1, p2) => p1.d - p2.d)[0];
        connections.push({ girder: g.label, carried, position: p, connector: near?.c.text ?? null });
      }
    }
  }
  // Girders whose hanger loads were not all linked (a run of identical trusses is labelled once, the
  // trusses are labelled at their far end, ...) are read again by spacing and order.
  const tried = new Set<string>();
  for (const g of labelled.filter((l) => girders.has(l.label) && l.bar)) {
    if (tried.has(g.label)) continue;
    const mine = connections.filter((c) => c.girder === g.label);
    if (girders.get(g.label)!.every((p) => mine.some((c) => Math.abs(c.position - p) <= 0.5))) continue;
    for (const bar of barsOf(g.w, plyOf(g.label))) {
      const found = linkBySeries(layout, job, g.label, bar, bars, labelWords, girders.get(g.label)!, scale);
      if (found.length === 0) continue;
      tried.add(g.label);
      for (let i = connections.length - 1; i >= 0; i--) if (connections[i].girder === g.label) connections.splice(i, 1);
      connections.push(...found);
      break;
    }
  }
  return { scale, connections, notes };
}

/** The run of consecutive bars (sorted along the girder) spaced like the hanger positions, or null. */
function hangerRun(bars: Bar[], positions: number[], ascending: boolean, scale: number): Bar[] | null {
  const n = positions.length;
  const gaps = positions.slice(1).map((p, i) => (p - positions[i]) / scale); // points, left end first
  const want = ascending ? gaps : [...gaps].reverse(); // bars are sorted by coordinate
  for (let i = 0; i + n <= bars.length; i++) {
    const run = bars.slice(i, i + n);
    const tolerance = SPACING_TOLERANCE / scale;
    if (run.every((b, k) => k === 0 || Math.abs(b.c - run[k - 1].c - want[k - 1]) <= tolerance)) return run;
  }
  return null;
}

/** "T-5(4)" → 4, "T-4" → 1 */
const seriesSize = (text: string) => Number(text.match(/\((\d+)\)$/)?.[1] ?? 1);

/**
 * Trusses hung on a girder when runs of identical trusses are labelled once.
 *   - the girder's bearing reactions are printed at its ends ("R=3961#"); the one of the left bearing
 *     says where position 0 is, and the two together delimit the trusses that belong to this girder
 *   - the bars ending on the girder inside that stretch are the hangers: the run of consecutive bars whose
 *     spacing equals the spacing of the hanger loads on the engineering sheet (lines of the drawing that
 *     run on past the girder also look like bars)
 *   - the labels beside those bars, in order, hand their quantities out to the bars one after the other
 */
function linkBySeries(
  layout: LayoutPage,
  job: PdfJob,
  girder: string,
  gBar: Bar,
  bars: Bar[],
  labelWords: LayoutWord[],
  expected: number[],
  scale: number
): LayoutConnection[] {
  const truss = job.trusses.find((t) => t.label.toUpperCase() === girder && t.hangerLoads.length > 0);
  if (!truss) return [];
  const alongOf = (w: LayoutWord) => (gBar.axis === 'v' ? (w.rotated ? w.y + w.w / 2 : w.y + w.h / 2) : w.rotated ? w.x - w.h / 2 : w.x + w.w / 2);
  const acrossOf = (w: LayoutWord) => (gBar.axis === 'v' ? w.x : w.y);

  // reaction labels at the ends of the girder; a printed value may carry a stray digit ("41364" for 4164)
  const isValue = (text: string, value: number) => {
    const d = text.replace(/\D/g, '');
    const v = String(value);
    if (d === v) return true;
    if (d.length !== v.length + 1) return false;
    let k = 0;
    for (const ch of d) if (ch === v[k]) k++;
    return k === v.length;
  };
  const reactions = layout.words.filter((w) => /^R=\d+#$/.test(w.text) && Math.abs(acrossOf(w) - gBar.c) < 40);
  const endOf = (joint: string | undefined | null): number | null => {
    const s = truss.supports.find((x) => x.joint === joint);
    if (!s || s.down === null) return null;
    const w = reactions.find((r) => isValue(r.text, s.down as number) && alongOf(r) >= gBar.a0 - 20 && alongOf(r) <= gBar.a1 + 20);
    return w ? alongOf(w) : null;
  };
  const otherJoint = truss.supports.find((s) => s.joint !== truss.leftJoint)?.joint;
  const left = endOf(truss.leftJoint);
  const right = endOf(otherJoint);
  // without the printed reactions the whole girder is searched and the run of bars tells the direction
  const haveEnds = left !== null && right !== null;
  const lo = haveEnds ? Math.min(left, right) : gBar.a0;
  const hi = haveEnds ? Math.max(left, right) : gBar.a1;
  const margin = 12 / scale; // about half a truss spacing

  const attached = bars
    .filter((b) => {
      if (b.axis === gBar.axis || b.thick < 0.3) return false;
      const reach = 1.5 + gBar.thick / 2;
      return b.c >= lo - margin && b.c <= hi + margin && b.a0 - reach <= gBar.c && b.a1 + reach >= gBar.c;
    })
    .sort((p, q) => p.c - q.c);
  // trusses hang from one side of the girder: the side whose bars and labels both add up to the hanger loads.
  // A line that runs on past the girder (a wall line merged into a bar) counts for both sides.
  const positions = [...expected].sort((a, b) => a - b);
  for (const sideName of ['before', 'after'] as const) {
    const onSide = attached.filter((b) => (sideName === 'before' ? b.a0 < gBar.c - 3 : b.a1 > gBar.c + 3));
    const directions = haveEnds ? [left! <= right!] : [true, false];
    const found = directions.map((d) => ({ ascending: d, run: hangerRun(onSide, positions, d, scale) })).find((x) => x.run);
    if (!found) continue;
    const ascending = found.ascending;
    const ordered = found.run!;
    const beside = labelWords
      .filter((w) => baseLabel(w.text).toUpperCase() !== girder)
      .filter((w) => (sideName === 'before' ? acrossOf(w) < gBar.c : acrossOf(w) > gBar.c))
      .filter((w) => alongOf(w) >= ordered[0].c - margin && alongOf(w) <= ordered[ordered.length - 1].c + margin)
      .sort((p, q) => alongOf(p) - alongOf(q));
    // labels of other trusses sit among them: the stretch of labels whose quantities add up to the bars, nearest the bars
    const middle = (ordered[0].c + ordered[ordered.length - 1].c) / 2;
    let chosen: LayoutWord[] | null = null;
    let chosenOff = Infinity;
    for (let a = 0; a < beside.length; a++) {
      for (let b = a; b < beside.length; b++) {
        const window = beside.slice(a, b + 1);
        if (window.reduce((n, w) => n + seriesSize(w.text), 0) !== ordered.length) continue;
        const off = Math.abs((alongOf(window[0]) + alongOf(window[window.length - 1])) / 2 - middle);
        if (off < chosenOff) {
          chosen = window;
          chosenOff = off;
        }
      }
    }
    if (!chosen) continue;
    const sequence = ascending ? chosen : [...chosen].reverse();

    const out: LayoutConnection[] = [];
    let i = 0;
    for (const w of sequence) {
      const carried = baseLabel(w.text).toUpperCase();
      for (let k = 0; k < seriesSize(w.text); k++, i++) out.push({ girder, carried, position: positions[i], connector: null });
    }
    return out;
  }
  return [];
}
