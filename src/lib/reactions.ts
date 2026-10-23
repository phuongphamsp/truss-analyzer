/**
 * Reaction selection from the REACTION INFO load cases of a carried truss.
 *
 * The parser collects every governing ("total") reaction at the connection bearing
 * together with the DOL factor of its load case. Which of those load cases are
 * eligible depends on the region: Canadian jobs only use DOL 0.65 / 1.00 / 1.15,
 * so load cases with any other DOL are ignored there. USA uses every load case.
 */

import type { GirderGroup, CarriedTruss, ReactionEntry } from '../types';
import type { SSTRegion } from './sst-types';
import { REGION_CONFIG } from './sst-types';

export interface PickedReactions {
  downReaction: number;
  upliftReaction: number;
  downDolFactor: number;
  upliftDolFactor: number | undefined;
}

/**
 * downReaction  = largest value (and the DOL of that load case)
 * upliftReaction = smallest value, only if it is negative (and the DOL of that load case);
 *                  otherwise 0 with no DOL.
 */
export function pickReactions(entries: ReactionEntry[]): PickedReactions | null {
  if (entries.length === 0) return null;
  const down = entries.reduce((a, b) => (b.value > a.value ? b : a));
  const up = entries.reduce((a, b) => (b.value < a.value ? b : a));
  const hasUplift = up.value < 0;
  return {
    downReaction: down.value,
    upliftReaction: hasUplift ? up.value : 0,
    downDolFactor: down.dolFactor,
    upliftDolFactor: hasUplift ? up.dolFactor : undefined,
  };
}

/**
 * An end of a truss can bear on both its top chord (TC) and its bottom chord (BC): REACTION INFO
 * then has rows at the same X but two different heights Y. A hanger carries only one of them:
 * hanger block #10 = 1 (TC, the larger Y) or 2 (BC, the smaller Y).
 * With a single Y, or an unknown chord, every row is kept.
 */
export function separateByChord(entries: ReactionEntry[], chord: number | undefined): ReactionEntry[] {
  if (chord !== 1 && chord !== 2) return entries;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const ys = [...new Set(entries.map((e) => e.y).filter((y): y is number => y !== undefined && !isNaN(y)).map(round3))];
  if (ys.length < 2) return entries;
  const target = chord === 1 ? Math.max(...ys) : Math.min(...ys);
  return entries.filter((e) => e.y !== undefined && round3(e.y) === target);
}

const DOL_EPS = 0.0005;

/** Keep only the load cases whose DOL is one of `validDols` (null = keep all). */
export function filterEntriesByDol(entries: ReactionEntry[], validDols: number[] | null): ReactionEntry[] {
  if (!validDols) return entries;
  return entries.filter((e) => validDols.some((d) => Math.abs(d - e.dolFactor) < DOL_EPS));
}

/**
 * Recompute each carried truss's reactions for the selected region.
 * Returns the same array when the region uses every load case (USA), so memoised
 * consumers do not re-render. If a connection has no eligible load case at all,
 * its values are left as parsed rather than showing a made-up zero.
 */
export function applyRegionReactions(groups: GirderGroup[], region: SSTRegion): GirderGroup[] {
  const validDols = REGION_CONFIG[region].validDols;
  if (!validDols) return groups;

  return groups.map((g) => ({
    ...g,
    carriedTrusses: g.carriedTrusses.map((c): CarriedTruss => {
      if (!c.reactionEntries) return c;
      const picked = pickReactions(filterEntriesByDol(separateByChord(c.reactionEntries, c.hanger?.chord), validDols));
      return picked ? { ...c, ...picked } : c;
    }),
  }));
}
