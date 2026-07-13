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
  DL_DURATION_DEAD,
  DL_DURATION_FLOOR,
  DL_DURATION_SNOW,
  DL_DURATION_ROOF,
  DL_DURATION_WIND_QUAKE,
  UL_DURATION_NORMAL,
  UL_DURATION_WIND_QUAKE,
} from './sst-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map TRE load-case DOL factor → SST download duration type constant.
 *
 * TRE DOL factors (from LoadCase definitions):
 *   0.90 → Dead only
 *   1.00 → Floor
 *   1.15 → Snow / Roof Live
 *   1.25 → Roof Live (uninhabitable attic)
 *   1.60 → Wind / Seismic
 *
 * SST duration constants are factor × 100 (e.g. Roof 125 = 125).
 */
function dolFactorToDownloadDuration(dolFactor: number | undefined): number {
  if (dolFactor === undefined || dolFactor === null) return DL_DURATION_ROOF; // default
  const f = Math.round(dolFactor * 100); // e.g. 1.15 → 115, 1.60 → 160
  if (f <= 90)  return DL_DURATION_DEAD;
  if (f <= 100) return DL_DURATION_FLOOR;
  if (f <= 115) return DL_DURATION_SNOW;
  if (f <= 125) return DL_DURATION_ROOF;
  return DL_DURATION_WIND_QUAKE; // 160
}

function dolFactorToUpliftDuration(dolFactor: number | undefined): number {
  if (dolFactor === undefined || dolFactor === null) return UL_DURATION_WIND_QUAKE; // default
  const f = Math.round(dolFactor * 100);
  if (f <= 100) return UL_DURATION_NORMAL;
  return UL_DURATION_WIND_QUAKE; // 160
}


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

interface KingPostResult {
  hasKingPost: boolean;
  kingWidth: number;   // face width of the vertical web toward the hanger = lumber depth (e.g. 3.5" for 2x4)
  kingHeight: number;  // vertical height of the king post segment (yMax - yMin)
}

/**
 * Detect whether a vertical web (king post) exists at the connection point
 * of a carried truss on the girder.
 *
 * Strategy:
 * - connectionX = localX of the carried truss on the girder
 * - For each Web member in the girder's MEMBER INFO, scan consecutive coord pairs
 *   looking for a segment where |x1 - x2| < TOLERANCE (nearly vertical)
 *   AND the segment's x is within TOLERANCE of connectionX
 * - If found, kingWidth = member.width, kingHeight = |y2 - y1| of that segment
 */
function findKingPost(
  members: TreData['members'],
  connectionX: number
): KingPostResult {
  const TOLERANCE = 2.0; // inches — snap tolerance for "same x"

  if (!members || members.length === 0) {
    return { hasKingPost: false, kingWidth: 0, kingHeight: 0 };
  }

  const webMembers = members.filter(m => m.type === 'Web' && m.isStructural);

  for (const web of webMembers) {
    const coords = web.coords;
    if (coords.length < 2) continue;

    for (let i = 0; i < coords.length - 1; i++) {
      const x1 = coords[i].x;
      const y1 = coords[i].y;
      const x2 = coords[i + 1].x;
      const y2 = coords[i + 1].y;

      const isVertical = Math.abs(x1 - x2) < TOLERANCE;
      const atConnection = Math.abs(x1 - connectionX) < TOLERANCE;
      const hasHeight = Math.abs(y2 - y1) > 0.5; // meaningful vertical extent

      if (isVertical && atConnection && hasHeight) {
        return {
          hasKingPost: true,
          // King post stands vertically → face width toward hanger = lumber depth (e.g. 3.5" for 2x4)
          // web.width = lumber thickness (1.5"), web.depth = lumber depth (3.5")
          kingWidth: web.depth,
          kingHeight: Math.abs(y2 - y1),
        };
      }
    }
  }

  return { hasKingPost: false, kingWidth: 0, kingHeight: 0 };
}

/**
 * Get heel height at the bearing side of a carried truss.
 * Falls back to the other side, then to 3.5" (2x4 depth).
 */
function getCarriedDepth(carried: CarriedTruss): number {
  const tre = carried.treData;
  if (!tre) return 3.5;
  // Use heel height matching the bearing side (left/right)
  if (carried.bearingSide === 'left') return tre.leftHeel ?? tre.rightHeel ?? 3.5;
  return tre.rightHeel ?? tre.leftHeel ?? 3.5;
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

  // Detect king post (vertical web) at the connection point of this carried truss.
  // connectionX = localX of the carried truss along the girder span.
  const kingPost = findKingPost(
    group.girder.treData?.members,
    carried.localX
  );

  // kingHeight: use actual vertical segment height if king post found,
  // otherwise fall back to girder heel height (floor 24.0" per SST default).
  const girderHeel = group.girder.treData?.leftHeel ?? 0;
  const kingHeight = kingPost.hasKingPost
    ? kingPost.kingHeight
    : Math.max(girderHeel, girderDepth, 24.0);

  // Ply from [ADDITIONAL TRUSS INFO] Ply= field; default 1 if not found
  const girderPly = group.girder.treData?.ply ?? 1;

  const carryingMember: SSTCarryingMember = {
    material: MATERIAL_TRUSS,
    width: girderWidth,
    depth: girderDepth,
    ply: girderPly,
    topChord: 0,
    topChordPly: 0,
    kingWidth: kingPost.hasKingPost ? kingPost.kingWidth : 0,
    kingHeight,
  };

  // --- Carried member (truss) ---
  const carriedBC = findBottomChord(carried.treData?.members);
  const carriedWidth = carriedBC?.width ?? 1.5;
  const carriedDepth = getCarriedDepth(carried);

  // Loads — already computed by enrichCarriedTrusses() in parser.ts
  const load = Math.round(Math.abs(carried.downReaction ?? 0));
  const uplift = Math.round(Math.abs(carried.upliftReaction ?? 0));

  // Ply from [ADDITIONAL TRUSS INFO] Ply= field of carried truss; default 1 if not found
  const carriedPly = carried.treData?.ply ?? 1;

  // Skew angle — derived from LG*T field[14] (angle of carried truss relative to girder).
  // 90° or 270° = perpendicular (no skew) → skewAngle=0, skewType=NONE.
  // Other angles: skewAngle = |angle - 90| normalised to [0, 90].
  // skewType: LEFT (1) when angle < 90 or angle > 270, RIGHT (2) otherwise.
  const hangerAngle = group.girder.treData?.hangers?.find(
    h => Math.abs(h.xInches - (carried.localX ?? 0)) < 1.0
  )?.angle ?? 90;
  const normalised  = ((hangerAngle % 180) + 180) % 180; // fold 270→90, 315→135, etc.
  const skewAngle   = Math.round(Math.abs(normalised - 90));
  const skewType    = skewAngle === 0
    ? SKEW_TYPE_NONE
    : (normalised < 90 ? SKEW_TYPE_LEFT : SKEW_TYPE_RIGHT);

  const carriedMember: SSTCarriedMember = {
    material: MATERIAL_TRUSS,
    width: carriedWidth,
    depth: carriedDepth > 0 ? carriedDepth : 3.5,
    ply: carriedPly,
    loads: { load, uplift },
    angle: {
      skewAngle,
      skewType,
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
      downloadDurationType:   dolFactorToDownloadDuration(carried.downDolFactor),
      upliftLoadDurationType: dolFactorToUpliftDuration(carried.upliftDolFactor),
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
