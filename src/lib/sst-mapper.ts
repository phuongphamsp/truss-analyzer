/**
 * SST Hanger Selector — Payload Builder
 *
 * Maps truss-analyzer data (GirderGroup + CarriedTruss) to SST API payload.
 * Designed specifically for truss-analyzer's data model — NOT a port of PoC Python.
 *
 * Key mapping decisions:
 * - Both carrying (girder) and carried (truss) use material=5 (Truss)
 * - Girder bottom chord dimensions → carryingMember width/depth
 * - Carried truss heel height at bearing side → carriedMember depth
 * - Carried truss bottom chord width → carriedMember width
 * - downReaction/upliftReaction → loads (already computed by enrichCarriedTrusses)
 * - ply defaults to 1 (not parsed from TRE files)
 * - skewAngle defaults to 0 (bearing orientation not in TRE/IFC data)
 */

import type { GirderGroup, CarriedTruss, TreData } from '../types';
import type { SSTPayload, SSTCarriedMember, SSTCarryingMember } from './sst-types';
import {
  MATERIAL_TRUSS,
  ANSITPI_INTERIOR,
  BUILDING_CODE_IRC2018,
  STYLE_ALL,
  FASTENER_ALL,
  FLUSH_BOTTOM,
  SKEW_TYPE_NONE,
  SLOPE_TYPE_NONE,
  DL_DURATION_ROOF,
  UL_DURATION_WIND_QUAKE,
} from './sst-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MemberDims {
  width: number;
  depth: number;
}

/**
 * Find the bottom chord member with the largest cross-section from treData.members.
 * Returns actual lumber dimensions (inches), e.g. width=1.5, depth=3.5 for a 2x4.
 */
function findBottomChord(members: TreData['members']): MemberDims | null {
  if (!members || members.length === 0) return null;

  const bcs = members.filter(
    (m) => m.type === 'BottomChord' && m.width > 0 && m.depth > 0
  );
  if (bcs.length === 0) return null;

  // Pick largest cross-section area
  const best = bcs.reduce((a, b) =>
    a.width * a.depth >= b.width * b.depth ? a : b
  );
  return { width: best.width, depth: best.depth };
}

/**
 * Get heel height at the bearing side of a carried truss.
 * Falls back to the other side, then to 3.5" (2x4 depth).
 */
function getCarriedDepth(carried: CarriedTruss): number {
  const tre = carried.treData;
  if (!tre) return 3.5;

  if (carried.bearingSide === 'right') {
    return tre.rightHeel ?? tre.leftHeel ?? 3.5;
  }
  return tre.leftHeel ?? tre.rightHeel ?? 3.5;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build SST API payload for a single carried truss on a girder.
 *
 * @param group   The girder group containing the girder instance
 * @param carried The specific carried truss to query hangers for
 * @returns       Complete SSTPayload ready to POST to the API
 */
export function buildSSTPayload(
  group: GirderGroup,
  carried: CarriedTruss
): SSTPayload {
  // --- Carrying member (girder) ---
  const girderBC = findBottomChord(group.girder.treData?.members);
  const girderWidth = girderBC?.width ?? 1.5;
  const girderDepth = girderBC?.depth ?? 5.5;

  // kingHeight = overall girder height at the connection point.
  // Best approximation: girder heel height (left side, since girders are
  // typically symmetric). Must be >= carrying depth. SST UI defaults to 24.0.
  const girderHeel = group.girder.treData?.leftHeel ?? 0;
  const kingHeight = Math.max(girderHeel, girderDepth, 24.0);

  const carryingMember: SSTCarryingMember = {
    material: MATERIAL_TRUSS,
    width: girderWidth,
    depth: girderDepth,
    ply: 1,
    topChord: 0,
    topChordPly: 0,
    kingWidth: 0,
    kingHeight,
  };

  // --- Carried member (truss) ---
  const carriedBC = findBottomChord(carried.treData?.members);
  const carriedWidth = carriedBC?.width ?? 1.5;
  const carriedDepth = getCarriedDepth(carried);

  // Loads — already computed by enrichCarriedTrusses() in parser.ts
  const load = Math.round(Math.abs(carried.downReaction ?? 0));
  const uplift = Math.round(Math.abs(carried.upliftReaction ?? 0));

  const carriedMember: SSTCarriedMember = {
    material: MATERIAL_TRUSS,
    width: carriedWidth,
    depth: carriedDepth > 0 ? carriedDepth : 3.5,
    ply: 1,
    loads: { load, uplift },
    angle: {
      skewAngle: 0,
      skewType: SKEW_TYPE_NONE,
      slopeAngle: 0,
      slopeType: SLOPE_TYPE_NONE,
    },
  };

  // --- Full payload ---
  return {
    style: STYLE_ALL,
    buildingCode: BUILDING_CODE_IRC2018,
    concealed: 0,
    fastenerType: FASTENER_ALL,
    sort: 0,
    ledger: 0,
    designInformations: {
      downloadDurationType: DL_DURATION_ROOF,
      upliftLoadDurationType: UL_DURATION_WIND_QUAKE,
    },
    filters: {
      depth: 0,
      model: '',
      series: '',
      webStiffeners: 0,
      width: 0,
    },
    carriedMembers: [carriedMember],
    flushOption: FLUSH_BOTTOM,
    carryingMember: carryingMember,
    ansitpi: ANSITPI_INTERIOR,
  };
}

/**
 * Build payloads for ALL carried trusses in a girder group.
 * Returns array of [CarriedTruss, SSTPayload] pairs.
 */
export function buildBatchPayloads(
  group: GirderGroup
): Array<{ carried: CarriedTruss; payload: SSTPayload }> {
  return group.carriedTrusses
    .filter((ct) => ct.downReaction != null && ct.downReaction > 0)
    .map((ct) => ({
      carried: ct,
      payload: buildSSTPayload(group, ct),
    }));
}
