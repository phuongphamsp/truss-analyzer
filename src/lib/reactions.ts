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
      const picked = pickReactions(filterEntriesByDol(c.reactionEntries, validDols));
      return picked ? { ...c, ...picked } : c;
    }),
  }));
}
