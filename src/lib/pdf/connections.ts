/**
 * Suggest which truss hangs at each girder hanger load (prototype).
 *
 * The girder sheet lists loads, positions and (sometimes) chords but not the label of the truss that
 * produces each load. The carried truss's own sheet lists its reaction at the hung end, so a load can
 * be matched to the truss whose hung-end reaction is closest. The match is a suggestion: trusses with
 * the same reaction cannot be told apart, and some girder tables hold net loads (uplift cancels part of
 * a load), so a suggestion is returned with its alternatives for the user to confirm.
 */

import type { PdfJob, PdfSupport, PdfTruss } from './types';

/** Largest relative difference between a girder load and a hung-end reaction to still count as a match. */
export const MATCH_TOLERANCE = 0.06;

export interface CarriedCandidate {
  label: string;
  joint: string;
  /** reaction of that truss at the joint (lb) */
  down: number;
  /** |down − load| / load */
  difference: number;
}

export type MatchConfidence = 'unique' | 'ambiguous' | 'none';

export interface SuggestedConnection {
  girder: string;
  position: number;
  load: number;
  chord: 'TC' | 'BC' | null;
  joint: string | null;
  /** candidates within tolerance, best first, one per truss label */
  candidates: CarriedCandidate[];
  best: CarriedCandidate | null;
  /** unique: one truss fits; ambiguous: several different trusses fit; none: nothing fits */
  confidence: MatchConfidence;
}

/** "1-8" → 1.5 (inches and sixteenths), as printed for a bearing width. */
function bearingInches(bearing: string | null): number | null {
  const m = bearing?.match(/^(\d+)-(\d+)$/);
  return m ? Number(m[1]) + Number(m[2]) / 16 : null;
}

/** A support is a hung end (hanger or girder ply) rather than a wall bearing. */
export function isHungEnd(s: PdfSupport): boolean {
  if (s.down === null || s.down <= 0) return false;
  if (!s.bearing) return false;
  if (/^mechanical$/i.test(s.bearing)) return true;
  const w = bearingInches(s.bearing);
  return w !== null && w <= 3; // a hung truss bears on a girder ply (about 1.5"), a wall on 3.5" or more
}

export function suggestConnections(job: PdfJob): SuggestedConnection[] {
  const seen = new Set<string>();
  const girders: PdfTruss[] = [];
  for (const t of job.trusses) {
    if (t.hangerLoads.length === 0 || seen.has(t.label)) continue;
    seen.add(t.label);
    girders.push(t);
  }

  const result: SuggestedConnection[] = [];
  for (const g of girders) {
    for (const h of g.hangerLoads) {
      const byLabel = new Map<string, CarriedCandidate>();
      for (const t of job.trusses) {
        if (t.label === g.label) continue;
        for (const s of t.supports) {
          if (!isHungEnd(s)) continue;
          const difference = Math.abs((s.down as number) - h.load) / h.load;
          if (difference > MATCH_TOLERANCE) continue;
          const prev = byLabel.get(t.label);
          if (!prev || difference < prev.difference) {
            byLabel.set(t.label, { label: t.label, joint: s.joint, down: s.down as number, difference });
          }
        }
      }
      const candidates = [...byLabel.values()].sort((a, b) => a.difference - b.difference);
      result.push({
        girder: g.label,
        position: h.position,
        load: h.load,
        chord: h.chord,
        joint: h.joint,
        candidates,
        best: candidates[0] ?? null,
        confidence: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'unique' : 'ambiguous',
      });
    }
  }
  return result;
}
