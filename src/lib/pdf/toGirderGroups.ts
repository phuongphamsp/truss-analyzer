/**
 * Build the app's connection model (GirderGroup / CarriedTruss) from the PDFs (prototype).
 *
 * The engineering PDF gives the girders, hanger loads, lumber, plies and reactions; the layout gives
 * which truss hangs at each hanger. Anything the PDFs do not give is left empty or at the default the
 * payload builder already uses, so the result can be compared field by field with the TRE route:
 *   - heel height, slope, skew: not read yet (heel falls back to 3.5", slope 0, skew square)
 *   - king post: no web geometry yet, so none
 *   - DOL: not in the PDF, so the region defaults apply
 */

import type { CarriedTruss, GirderGroup, TreData, TrussInstance } from '../../types';
import { isHungEnd } from './connections';
import type { LayoutLinks } from './layout';
import type { PdfJob, PdfLumberSpec, PdfSupport, PdfTruss } from './types';

/** Actual lumber size (width x depth, inches) of a nominal size such as "2x6". */
const ACTUAL: Record<string, [number, number]> = {
  '2x3': [1.5, 2.5],
  '2x4': [1.5, 3.5],
  '2x6': [1.5, 5.5],
  '2x8': [1.5, 7.25],
  '2x10': [1.5, 9.25],
  '2x12': [1.5, 11.25],
};

const specString = (s: PdfLumberSpec | null) => (s ? `${s.size} ${s.grade} ${s.species}` : '');

/** TRE-shaped data for a truss, reduced to what the payload builder reads. */
function treDataFor(t: PdfTruss, hangers: NonNullable<TreData['hangers']>): TreData {
  const [width, depth] = ACTUAL[t.botChord?.size ?? '2x4'] ?? [1.5, 3.5];
  const members: NonNullable<TreData['members']> = t.botChord
    ? [
        {
          name: 'B1',
          type: 'BottomChord',
          size: t.botChord.size,
          grade: t.botChord.grade,
          species: t.botChord.species,
          width,
          depth,
          // no geometry yet: a short flat segment so the member counts as "the lowest bottom chord"
          coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
          isStructural: true,
        },
      ]
    : [];
  return {
    label: t.label,
    topChord: specString(t.topChord),
    bottomChord: specString(t.botChord),
    webs: specString(t.webs),
    maxReaction: Math.max(0, ...t.supports.map((s) => s.down ?? 0)),
    members,
    ply: t.ply ?? 1,
    hangers,
  };
}

/** The hung-end support of a carried truss whose reaction is closest to the girder load. */
function hungSupport(t: PdfTruss, load: number): PdfSupport | null {
  const ends = t.supports.filter(isHungEnd);
  if (ends.length === 0) return null;
  return ends.reduce((best, s) => (Math.abs((s.down as number) - load) < Math.abs((best.down as number) - load) ? s : best));
}

export function pdfToGirderGroups(job: PdfJob, links: LayoutLinks): GirderGroup[] {
  const byLabel = new Map<string, PdfTruss>();
  for (const t of job.trusses) {
    const key = t.label.toUpperCase();
    const prev = byLabel.get(key);
    if (!prev || (prev.hangerLoads.length === 0 && t.hangerLoads.length > 0)) byLabel.set(key, t);
  }

  const groups: GirderGroup[] = [];
  for (const g of byLabel.values()) {
    if (g.hangerLoads.length === 0) continue;
    const gLabel = g.label.toUpperCase();

    // one hanger line per hanger load; the carried truss comes from the layout
    const rows = g.hangerLoads
      .map((h) => ({ h, link: links.connections.find((c) => c.girder === gLabel && Math.abs(c.position - h.position) <= 0.5) }))
      .filter((r) => r.link)
      .sort((a, b) => a.h.position - b.h.position);
    if (rows.length === 0) continue;

    const hangers: NonNullable<TreData['hangers']> = rows.map(({ h, link }) => ({
      xFeet: h.position / 12,
      xInches: h.position,
      label: link!.carried,
      width: 1.5,
      heelHeight: 0, // not read yet
      bearingLocation: 0,
      angle: 90, // square: skew not read yet
      slope: 0, // not read yet
      chord: h.chord === 'TC' ? 1 : 2,
    }));

    const girder: TrussInstance = {
      id: `PDF_${gLabel}`,
      label: g.label,
      isGirder: true,
      treData: treDataFor(g, hangers),
    };

    const carriedTrusses: CarriedTruss[] = rows.map(({ h, link }, i) => {
      const ct = byLabel.get(link!.carried);
      const support = ct ? hungSupport(ct, h.load) : null;
      return {
        instance: { id: `PDF_${link!.carried}_${i}`, label: link!.carried, isGirder: false },
        localX: h.position,
        spacing: null,
        treData: ct ? treDataFor(ct, []) : undefined,
        hangerAngle: 90,
        hanger: hangers[i],
        downReaction: support?.down ?? h.load,
        upliftReaction: support?.uplift ?? 0,
        bearingSide: 'right',
      };
    });
    groups.push({ girder, carriedTrusses });
  }
  return groups;
}
