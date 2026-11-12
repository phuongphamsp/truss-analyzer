/**
 * Geometry read from the drawing of an engineering sheet (prototype).
 *
 * A MiTek sheet draws the truss to scale next to its dimension strings. From the vector lines and the
 * text positions of that page this module recovers:
 *   - the scale (inches per point): "Scale = 1:N" refined with the dimension strings and their ticks
 *   - the heel height of a hung end: the length of the end vertical at the hung joint
 *   - the vertical webs (a king post is a vertical web the carried truss fits inside)
 *
 * Positions on a girder are measured from the left end of the first dimension that follows the
 * negative overhang dimension ("-1-10-8"), i.e. from the left bearing.
 */

import { fisToInches } from './pdfText';
import { segmentLength, type PdfPageLike, type Segment } from './pdfVectors';
import type { PdfJob, PdfTruss, TrussGeometry, VerticalWeb } from './types';
import { isHungEnd } from './connections';

export interface DrawingWord {
  str: string;
  x: number;
  y: number;
  w: number;
  rot: boolean;
}

/** Vector lines and words of one page. */
export interface DrawingPage {
  width: number;
  words: DrawingWord[];
  segments: Segment[];
}

const OPEN = 0.05; // points: a segment this close to axis-aligned counts as vertical / horizontal
const GAP = 0.6; // points: collinear pieces closer than this are one line
const DEPTHS = [2.5, 3.5, 5.5, 7.25, 9.25, 11.25]; // actual lumber depths (inches)
const DEPTH_TOLERANCE = 0.3; // inches: the drawn face spacing vs the lumber depth

const nearestDepth = (inches: number): number | null => {
  const d = DEPTHS.find((x) => Math.abs(x - inches) <= DEPTH_TOLERANCE);
  return d ?? null;
};

export async function readDrawingPage(page: PdfPageLike & { getTextContent(): Promise<any>; getViewport(o: { scale: number }): { width: number } }, OPS: Record<string, number>): Promise<DrawingPage> {
  const { extractSegments } = await import('./pdfVectors');
  const segments = await extractSegments(page, OPS);
  const content = await page.getTextContent();
  const words: DrawingWord[] = content.items
    .filter((i: any) => typeof i.str === 'string' && i.str.trim() !== '')
    .map((i: any) => ({
      str: i.str.trim(),
      x: i.transform[4],
      y: i.transform[5],
      w: i.width,
      rot: Math.abs(i.transform[1]) > Math.abs(i.transform[0]),
    }));
  return { width: page.getViewport({ scale: 1 }).width, words, segments };
}

interface VLine {
  x: number;
  /** contiguous runs [lo, hi] of the line */
  runs: Array<[number, number]>;
}

function verticalLines(segments: Segment[]): VLine[] {
  const byX = new Map<number, Array<[number, number]>>();
  for (const s of segments) {
    if (Math.abs(s.x1 - s.x2) > OPEN || segmentLength(s) < 1) continue;
    const key = Math.round(s.x1 * 20) / 20;
    const list = byX.get(key) ?? [];
    list.push([Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)]);
    byX.set(key, list);
  }
  return [...byX].map(([x, list]) => ({ x, runs: mergeRuns(list) }));
}

function mergeRuns(list: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + GAP) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

interface HLine {
  y: number;
  runs: Array<[number, number]>;
}

function horizontalLines(segments: Segment[], maxLength: number): HLine[] {
  const byY = new Map<number, Array<[number, number]>>();
  for (const s of segments) {
    if (Math.abs(s.y1 - s.y2) > OPEN || segmentLength(s) < 1 || segmentLength(s) > maxLength) continue;
    const key = Math.round(s.y1 * 20) / 20;
    const list = byY.get(key) ?? [];
    list.push([Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]);
    byY.set(key, list);
  }
  return [...byY].map(([y, list]) => ({ y, runs: mergeRuns(list) }));
}

/** Inches per point: "Scale = 1:N" gives N/72, the dimension strings between their ticks refine it. */
/** The printed scale as inches per point: "Scale = 1:40.3" or "Scale: 1/4"=1'" (1/4 inch on paper = 1 foot). */
function printedScale(page: DrawingPage): number | null {
  for (const w of page.words) {
    const ratio = w.str.match(/^Scale\s*[:=]\s*1:([\d.]+)/);
    if (ratio) return Number(ratio[1]) / 72;
    // 1/4"=1' or 1"=1': a paper fraction (or whole number) of an inch stands for one foot
    const architect = w.str.match(/^Scale\s*[:=]\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*"\s*=\s*1'/);
    if (architect) return 12 / (Number(architect[1]) / Number(architect[2] ?? 1)) / 72;
  }
  return null;
}

export function drawingScale(page: DrawingPage): number | null {
  const nominal = printedScale(page);
  if (nominal === null || !Number.isFinite(nominal)) return null;

  const ticks = page.segments.filter((s) => Math.abs(s.x1 - s.x2) < OPEN && segmentLength(s) > 3 && segmentLength(s) < 12);
  const ratios: number[] = [];
  for (const w of page.words) {
    if (w.rot) continue;
    const inches = fisToInches(w.str);
    if (inches === null || inches <= 0) continue;
    const center = w.x + w.w / 2;
    const xs = ticks
      .filter((t) => Math.abs((t.y1 + t.y2) / 2 - w.y) < 10)
      .map((t) => t.x1)
      .sort((a, b) => a - b);
    const right = xs.find((x) => x > center);
    const left = [...xs].reverse().find((x) => x < center);
    if (left === undefined || right === undefined) continue;
    const ratio = inches / (right - left);
    if (Math.abs(ratio / nominal - 1) < 0.03) ratios.push(ratio);
  }
  if (ratios.length === 0) return nominal;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

/** x (points) of the left bearing: the tick at the end of the first negative dimension. */
function originX(page: DrawingPage): number | null {
  const neg = page.words.find((w) => !w.rot && /^-\d+-\d+-\d+$/.test(w.str));
  if (!neg) return firstDimensionStart(page);
  const center = neg.x + neg.w / 2;
  const ticks = page.segments
    .filter((s) => Math.abs(s.x1 - s.x2) < OPEN && segmentLength(s) > 3 && segmentLength(s) < 12 && Math.abs((s.y1 + s.y2) / 2 - neg.y) < 10 && s.x1 > center)
    .map((s) => s.x1)
    .sort((a, b) => a - b);
  return ticks[0] ?? null;
}

/** No overhang: the left bearing is the left end of the first dimension of the top dimension row. */
function firstDimensionStart(page: DrawingPage): number | null {
  const dims = page.words.filter((w) => !w.rot && fisToInches(w.str) !== null);
  if (dims.length === 0) return null;
  const top = Math.max(...dims.map((w) => w.y));
  const first = dims.filter((w) => Math.abs(w.y - top) < 3).sort((a, b) => a.x - b.x)[0];
  const center = first.x + first.w / 2;
  const ticks = page.segments
    .filter((x) => Math.abs(x.x1 - x.x2) < OPEN && segmentLength(x) > 3 && segmentLength(x) < 12 && Math.abs((x.y1 + x.y2) / 2 - first.y) < 10 && x.x1 < center)
    .map((x) => x.x1)
    .sort((p, q) => q - p);
  return ticks[0] ?? null;
}

/** y (points) of the underside of the bottom chord and the chord depth: the lowest pair of horizontal lines a lumber depth apart. */
function bottomChord(page: DrawingPage, scale: number): { baseY: number; depthPts: number; leftX: number } | null {
  const lines = horizontalLines(page.segments, page.width * 0.9).sort((a, b) => a.y - b.y);
  for (const lo of lines) {
    for (const hi of lines) {
      if (hi.y <= lo.y) continue;
      const depth = nearestDepth((hi.y - lo.y) * scale);
      if (depth === null) continue;
      const run = lo.runs.find(([a, b]) => hi.runs.some(([c, d]) => Math.min(b, d) - Math.max(a, c) > 20));
      if (run) return { baseY: lo.y, depthPts: hi.y - lo.y, leftX: run[0] };
    }
  }
  return null;
}

/** The measured length, or the vertical dimension printed for it when one is within a few tenths of an inch. */
function snapToDimension(page: DrawingPage, measured: number, vertical = true): number {
  const printed = page.words
    .filter((w) => w.rot === vertical)
    .map((w) => fisToInches(w.str))
    .filter((v): v is number => v !== null && Math.abs(v - measured) <= 0.3)
    .sort((a, b) => Math.abs(a - measured) - Math.abs(b - measured));
  return printed[0] ?? Math.round(measured * 16) / 16;
}

/** Bearing to bearing: the outer wall / girder bearings sit on dimension ticks, the right one is measured from the origin tick. */
function bearingSpan(page: DrawingPage, truss: PdfTruss, scale: number, origin: number, baseY: number): number | undefined {
  const ticks = page.segments
    .filter((s) => Math.abs(s.x1 - s.x2) < OPEN && segmentLength(s) > 3 && segmentLength(s) < 12 && s.x1 > origin + 20)
    .map((s) => s.x1);
  const xs: number[] = [];
  for (const s of truss.supports.filter((x) => !isHungEnd(x))) {
    const w = page.words.find((x) => !x.rot && x.str === s.joint && Math.abs(x.y - baseY) < 40);
    if (w) xs.push(w.x + w.w / 2);
  }
  if (xs.length < 2) return undefined;
  const right = Math.max(...xs);
  const tick = ticks.reduce<number | null>((best, t) => (Math.abs(t - right) < Math.abs((best ?? Infinity) - right) ? t : best), null);
  if (tick === null || Math.abs(tick - right) > 8) return undefined;
  return snapToDimension(page, (tick - origin) * scale, false);
}

export function readTrussGeometry(page: DrawingPage, truss: PdfTruss): TrussGeometry | null {
  const scale = drawingScale(page);
  if (scale === null) return null;
  const vlines = verticalLines(page.segments);

  // --- heel of each hung end: the end vertical above the joint number ---
  const heelByJoint: Record<string, number> = {};
  for (const s of truss.supports.filter(isHungEnd)) {
    let best = 0;
    for (const w of page.words.filter((x) => !x.rot && x.str === s.joint)) {
      const jx = w.x + w.w / 2;
      for (const v of vlines) {
        if (Math.abs(v.x - jx) > 12) continue;
        for (const [lo, hi] of v.runs) {
          if (lo >= w.y && lo - w.y <= 30) best = Math.max(best, (hi - lo) * scale);
        }
      }
    }
    if (best > 0) heelByJoint[s.joint] = snapToDimension(page, best);
  }

  // --- top chord pitch at a hung joint on the top chord: the nearest "4.00 12" label of the drawing ---
  const slopeByJoint: Record<string, number> = {};
  const pitches = page.words
    .map((w) => ({ w, rise: Number(w.str.match(/^(\d+(?:\.\d+)?)\s+12$/)?.[1]) }))
    .filter((p) => Number.isFinite(p.rise) && !p.w.rot);
  for (const s of truss.supports.filter((x) => isHungEnd(x) && x.chord === 'TC')) {
    const joints = page.words.filter((x) => !x.rot && x.str === s.joint && x.y > 400 && x.y < 735);
    let best: { rise: number; d: number } | null = null;
    for (const j of joints) for (const p of pitches) {
      const d = Math.hypot(j.x - p.w.x, j.y - p.w.y);
      if (!best || d < best.d) best = { rise: p.rise, d };
    }
    if (best) slopeByJoint[s.joint] = (Math.atan(best.rise / 12) * 180) / Math.PI;
  }

  // --- vertical webs: two vertical faces one lumber depth apart, standing on the bottom chord ---
  const webs: VerticalWeb[] = [];
  const chord = bottomChord(page, scale);
  // no dimension ticks to read the left bearing from (Canadian sheets): the left end of the bottom chord
  const origin = originX(page) ?? chord?.leftX ?? null;
  if (origin !== null && chord) {
    const standing = vlines.flatMap((v) =>
      v.runs
        .filter(([lo, hi]) => lo >= chord.baseY + chord.depthPts - 1 && lo <= chord.baseY + chord.depthPts + 1 && hi - lo > 8)
        .map(([lo, hi]) => ({ x: v.x, top: hi, lo }))
    );
    for (const a of standing) {
      for (const b of standing) {
        if (b.x <= a.x) continue;
        const depth = nearestDepth((b.x - a.x) * scale);
        if (depth === null) continue;
        webs.push({
          left: (a.x - origin) * scale,
          right: (b.x - origin) * scale,
          depth,
          topLeft: (a.top - chord.baseY) * scale,
          topRight: (b.top - chord.baseY) * scale,
        });
      }
    }
  }
  return { inchesPerPoint: scale, heelByJoint, slopeByJoint, webs, originX: origin ?? undefined, baseY: chord?.baseY, span: origin !== null && chord ? bearingSpan(page, truss, scale, origin, chord.baseY) : undefined };
}

/** Reads the drawing of every truss sheet of a job into `truss.geometry`. */
export async function attachGeometry(
  job: PdfJob,
  getPage: (pageNumber: number) => Promise<Parameters<typeof readDrawingPage>[0]>,
  OPS: Record<string, number>
): Promise<void> {
  for (const t of job.trusses) {
    if (t.page === null) continue;
    const geometry = readTrussGeometry(await readDrawingPage(await getPage(t.page), OPS), t);
    if (geometry) t.geometry = geometry;
  }
}
