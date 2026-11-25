/**
 * Build the app's connection model (GirderGroup / CarriedTruss) from the PDFs (prototype).
 *
 * The engineering PDF gives the girders, hanger loads, lumber, plies and reactions; the layout gives
 * which truss hangs at each hanger. Anything the PDFs do not give is left empty or at the default the
 * payload builder already uses, so the result can be compared field by field with the TRE route:
 *   - heel height: the end vertical at the hung joint of the carried truss's drawing (3.5" when not read)
 *   - king post: vertical webs of the girder's drawing, judged by the same rule as the TRE route
 *   - slope, skew: not read yet (slope 0, skew square)
 *   - DOL: not in the PDF, so the region defaults apply
 */

import type { CarriedTruss, GirderGroup, TreData, TrussInstance } from '../../types';
import { isHungEnd, isUpliftHungEnd } from './connections';
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

/** inches: faces read from a drawing are good to about a tenth of an inch */
const FACE_SLACK = 0.05;

/** inches: top chord loads of trusses this close together are added into one load on the sheet */
const MERGE_REACH = 3;

const specString = (s: PdfLumberSpec | null) => (s ? `${s.size} ${s.grade} ${s.species}` : '');

/** TRE-shaped data for a truss, reduced to what the payload builder reads. */
function treDataFor(t: PdfTruss, hangers: NonNullable<TreData['hangers']>): TreData {
  const [width, depth] = ACTUAL[t.botChord?.size ?? '2x4'] ?? [1.5, 3.5];
  const members: NonNullable<TreData['members']> = t.botChord
    ? [
        ...(t.geometry?.webs ?? []).map((w, i) => ({
          name: `W${i + 1}`,
          type: 'Web' as const,
          size: '',
          grade: '',
          species: '',
          width: 1.5,
          depth: w.depth,
          // faces widened by the drawing's resolution so a truss that exactly fills the web still fits
          coords: [{ x: w.left - FACE_SLACK, y: 0 }, { x: w.left - FACE_SLACK, y: w.topLeft }, { x: w.right + FACE_SLACK, y: w.topRight }, { x: w.right + FACE_SLACK, y: 0 }],
          isStructural: true,
        })),
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
  if (t.topChord) {
    const [tw, td] = ACTUAL[t.topChord.size] ?? [1.5, 3.5];
    members.push({
      name: 'T1',
      type: 'TopChord',
      size: t.topChord.size,
      grade: t.topChord.grade,
      species: t.topChord.species,
      width: tw,
      depth: td,
      coords: [{ x: 0, y: 10 }, { x: 1, y: 10 }],
      isStructural: true,
    });
  }
  return {
    label: t.label,
    topChord: specString(t.topChord),
    bottomChord: specString(t.botChord),
    webs: specString(t.webs),
    maxReaction: Math.max(0, ...t.supports.map((s) => s.down ?? 0)),
    members,
    ply: t.ply ?? 1,
    // positions on the drawing run from the left bearing, so the stubs are 0 and the span is bearing to bearing
    span: t.geometry?.span,
    leftStub: 0,
    rightStub: 0,
    hangers,
  };
}

/**
 * The hung-end support of a carried truss for a girder load: on the same chord as the load when the sheets
 * say which chord each is on (a truss can hang from both chords of a girder), the reaction closest to the load.
 */
function hungSupport(t: PdfTruss, load: number, chord: 'TC' | 'BC' | null): PdfSupport | null {
  const ends = t.supports.filter(isHungEnd);
  const sameChord = chord ? ends.filter((s) => s.chord === chord) : [];
  // no end on that chord pushes down: a hung end on it that only pulls (a hip jack) is the one the load comes from
  const pulling = sameChord.length === 0 && chord ? t.supports.filter((s) => isUpliftHungEnd(s) && s.chord === chord) : [];
  const pool = sameChord.length > 0 ? sameChord : pulling.length > 0 ? pulling : ends;
  if (pool.length === 0) return null;
  return pool.reduce((best, s) => (Math.abs((s.down as number) - load) < Math.abs((best.down as number) - load) ? s : best));
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

    // heel and slope of the hung end of the carried truss, read from its drawing (0 = not read).
    // On a top chord the end is cut square: its height is the chord depth over the cosine of the pitch.
    const endOf = (carried: string, load: number, chord: 'TC' | 'BC' | null) => {
      const ct = byLabel.get(carried);
      const support = ct ? hungSupport(ct, load, chord) : null;
      const slope = (support && ct?.geometry?.slopeByJoint?.[support.joint]) || 0;
      if (support && ct && support.chord === 'TC' && slope > 0) {
        const depth = ACTUAL[ct.topChord?.size ?? '2x4']?.[1] ?? 3.5;
        return { heel: Math.round((depth / Math.cos((slope * Math.PI) / 180)) * 1000) / 1000, slope };
      }
      const drawn = (support && ct?.geometry?.heelByJoint[support.joint]) || 0;
      // a truss hung from both chords at one end: its bottom chord ends square, as high as the chord
      if (!drawn && support && ct && support.chord === 'BC' && ct.supports.some((x) => isHungEnd(x) && x.chord === 'TC')) {
        return { heel: ACTUAL[ct.botChord?.size ?? '2x4']?.[1] ?? 3.5, slope: 0 };
      }
      return { heel: drawn, slope: 0 };
    };

    // one hanger line per hanger load; the carried truss comes from the layout
    const rows = g.hangerLoads
      // the top chord load and the bottom chord load of one truss can sit up to an inch apart on the sheet
      .map((h) => ({ h, link: links.connections.find((c) => c.girder === gLabel && Math.abs(c.position - h.position) <= 0.5) ?? links.connections.find((c) => c.girder === gLabel && Math.abs(c.position - h.position) <= 1) }))
      .filter((r) => r.link);
    // A truss hung from both chords at a bottom chord load also loads the top chord there. When the girder sheet has no
    // top chord load at that position but one close by, the program added the two top chord loads and put the sum at
    // one of the positions (tester): the truss still has its top chord connection at its own position.
    for (const { h, link } of [...rows]) {
      if (h.chord !== 'BC') continue;
      const ct = byLabel.get(link!.carried);
      const topEnd = ct?.supports.find((x) => x.chord === 'TC' && (isHungEnd(x) || isUpliftHungEnd(x)));
      if (!ct || !topEnd) continue;
      if (g.hangerLoads.some((x) => x.chord === 'TC' && Math.abs(x.position - h.position) <= 0.5)) continue;
      const merged = g.hangerLoads.filter((x) => x.chord === 'TC' && Math.abs(x.position - h.position) <= MERGE_REACH).sort((p, q) => Math.abs(p.position - h.position) - Math.abs(q.position - h.position))[0];
      if (!merged) continue;
      // the load kept for the sum is that of another truss, and it is larger than that truss's own top chord reaction
      const owner = links.connections.find((c) => c.girder === gLabel && Math.abs(c.position - merged.position) <= 0.5);
      const ownerEnd = owner ? byLabel.get(owner.carried)?.supports.filter((x) => x.chord === 'TC' && (isHungEnd(x) || isUpliftHungEnd(x))) : undefined;
      if (!owner || owner.carried === link!.carried) continue;
      if (ownerEnd && ownerEnd.length > 0 && merged.load <= Math.max(...ownerEnd.map((x) => x.down ?? 0))) continue;
      rows.push({ h: { ...merged, position: h.position, load: topEnd.down ?? 0 }, link });
    }
    rows.sort((a, b) => a.h.position - b.h.position);
    if (rows.length === 0) continue;

    const hangers: NonNullable<TreData['hangers']> = rows.map(({ h, link }) => ({
      xFeet: h.position / 12,
      xInches: h.position,
      label: link!.carried,
      width: 1.5,
      heelHeight: endOf(link!.carried, h.load, h.chord).heel,
      bearingLocation: 0,
      angle: 90, // square: skew not read yet
      slope: endOf(link!.carried, h.load, h.chord).slope,
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
      const support = ct ? hungSupport(ct, h.load, h.chord) : null;
      return {
        instance: { id: `PDF_${link!.carried}_${i}`, label: link!.carried, isGirder: false },
        localX: h.position,
        spacing: null,
        treData: ct ? treDataFor(ct, []) : undefined,
        hangerAngle: 90,
        hanger: hangers[i],
        // a load on the top chord hangs from the top chord piece it sits on (its size and species)
        carryingChord:
          h.chord === 'TC' && h.spec
            ? { width: (ACTUAL[h.spec.size] ?? [1.5, 3.5])[0], depth: (ACTUAL[h.spec.size] ?? [1.5, 3.5])[1], species: h.spec.species }
            : undefined,
        downReaction: support?.down ?? h.load,
        upliftReaction: support?.uplift ?? 0,
        // Canadian sheets (tester rule): with no factored uplift the default stays (short term, 1.15); with uplift, a snow or
        // dead load pulling up in the unfactored reactions is standard term (1.00), any other uplift short term (1.15)
        upliftDolFactor: !support?.uplift ? undefined : support.upliftSource === 'standard' ? 1.0 : support.upliftSource === 'short' ? 1.15 : undefined,
        bearingSide: 'right',
      };
    });
    const geo = g.geometry;
    // the sheet is shown even when the drawing could not be placed; markers need all three
    const pdfDrawing = g.page !== null ? { page: g.page, originX: geo?.originX, baseY: geo?.baseY, inchesPerPoint: geo?.inchesPerPoint } : undefined;
    groups.push({ source: 'pdf', pdfDrawing, girder, carriedTrusses });
  }
  return groups;
}
