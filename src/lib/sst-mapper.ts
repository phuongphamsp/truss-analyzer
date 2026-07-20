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
  MATERIAL_TRUSS_DF,
  MATERIAL_TRUSS_HF,
  MATERIAL_TRUSS_SP,
  MATERIAL_TRUSS_SPF,
  ANSITPI_END,
  ANSITPI_INTERIOR,
  BUILDING_CODE_IRC2018,
  STYLE_ALL,
  FASTENER_ALL,
  FLUSH_BOTTOM,
  SKEW_TYPE_NONE,
  SKEW_TYPE_LEFT,
  SKEW_TYPE_RIGHT,
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
 * Map a lumber species string (from TRE file) to the SST API material code.
 *
 * TRE species strings → SST material codes:
 *   "DF"  (Douglas Fir)     → 5
 *   "HF"  (Hem Fir)         → 6
 *   "SP"  (Southern Pine)   → 7
 *   "SPF" (Spruce Pine Fir) → 8
 *
 * Matching is case-insensitive and checks if the species token appears
 * anywhere in the spec string (e.g. "2x4 No.2 SP" → 7).
 * Falls back to MATERIAL_TRUSS (5 = DF) if species is unknown.
 */
function speciesStringToMaterial(speciesOrSpec: string | undefined): number {
  if (!speciesOrSpec) return MATERIAL_TRUSS;
  const s = speciesOrSpec.trim().toUpperCase();
  // Check longest token first to avoid "SP" matching inside "SPF"
  if (s === 'SPF' || s.endsWith(' SPF')) return MATERIAL_TRUSS_SPF;
  if (s === 'SP'  || s.endsWith(' SP'))  return MATERIAL_TRUSS_SP;
  if (s === 'HF'  || s.endsWith(' HF'))  return MATERIAL_TRUSS_HF;
  if (s === 'DF'  || s.endsWith(' DF'))  return MATERIAL_TRUSS_DF;
  // Fallback: scan for token anywhere in the string
  const tokens = s.split(/[\s,]+/);
  if (tokens.includes('SPF')) return MATERIAL_TRUSS_SPF;
  if (tokens.includes('SP'))  return MATERIAL_TRUSS_SP;
  if (tokens.includes('HF'))  return MATERIAL_TRUSS_HF;
  if (tokens.includes('DF'))  return MATERIAL_TRUSS_DF;
  return MATERIAL_TRUSS; // default: DF (5)
}

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
 * Strategy (per tester spec):
 * 1. For each Web member, compute midpoint X = (x_min + x_max) / 2 of all coords.
 * 2. Check if midpoint X is within TOLERANCE of connectionX.
 * 3. Verify the web is vertical: all coords share the same two distinct x values
 *    (i.e. x1=x4 and x2=x3 in the 4-point rectangle layout).
 * 4. Extract:
 *    - kingWidth  = lumber depth (face width toward hanger, e.g. 3.5" for 2x4)
 *    - kingHeight = max(y) across all coords of the web member
 *                  (absolute height from bottom of girder to top of king post)
 */
function findKingPost(
  members: TreData['members'],
  connectionX: number
): KingPostResult {
  const TOLERANCE = 2.0; // inches — snap tolerance for midpoint match

  if (!members || members.length === 0) {
    return { hasKingPost: false, kingWidth: 0, kingHeight: 0 };
  }

  const webMembers = members.filter(m => m.type === 'Web' && m.isStructural);

  for (const web of webMembers) {
    const coords = web.coords;
    if (coords.length < 2) continue;

    const xs = coords.map(c => c.x);
    const ys = coords.map(c => c.y);

    // Midpoint X of the web member (tester: (x_left + x_right) / 2)
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const midX = (xMin + xMax) / 2;

    // Check if this web is at the connection point
    if (Math.abs(midX - connectionX) > TOLERANCE) continue;

    // Check if the web is vertical:
    // A vertical king post has exactly 2 distinct x values (left face & right face)
    // and the y range must be meaningful (not a degenerate point)
    const uniqueXs = [...new Set(xs.map(x => Math.round(x * 1000) / 1000))];
    const yRange = Math.max(...ys) - Math.min(...ys);
    const isVertical = uniqueXs.length === 2 && yRange > 0.5;

    if (isVertical) {
      return {
        hasKingPost: true,
        // Face width toward hanger = lumber depth (e.g. 3.5" for 2x4)
        // web.width = thickness (1.5"), web.depth = face depth (3.5")
        kingWidth: web.depth,
        // Total Height = max(y) of the web member = absolute height from girder bottom
        // to top of king post (tester: "lấy cặp y lớn hơn")
        kingHeight: Math.max(...ys),
      };
    }
  }

  return { hasKingPost: false, kingWidth: 0, kingHeight: 0 };
}

/**
 * Compute ANSI/TPI 1 connection type for a hanger on a girder.
 *
 * Rule (ANSI/TPI 1):
 *   End Connection     (3) — hanger is within 5d from the NEAREST bearing end
 *   Interior Connection(6) — hanger is >= 5d from BOTH bearing ends
 *
 * where d = actual depth of the girder bottom chord (inches).
 *
 * Hanger position (xInches) is measured from the LEFT physical end of the girder.
 * Left bearing  = leftStub  (inches from left end to left bearing point)
 * Right bearing = span - rightStub
 *
 * Returns an object so the UI can display the computed distances.
 */
export interface AnsitpiResult {
  ansitpi: number;           // ANSITPI_END (3) or ANSITPI_INTERIOR (6)
  distFromNearestBearing: number;  // inches — distance from nearest bearing
  threshold: number;         // 5d in inches
  isEndConnection: boolean;
  girderBCDepth: number;     // d used in calculation
}

export function computeAnsitpi(
  group: GirderGroup,
  carried: CarriedTruss
): AnsitpiResult {
  const tre = group.girder.treData;

  // Girder bottom chord depth (d)
  const girderBC = findBottomChord(tre?.members);
  const d = girderBC?.depth ?? 5.5; // default 2x6
  const threshold = 5 * d;

  // Hanger x position on girder (inches from left physical end)
  const xInches = carried.localX ?? 0;

  // Bearing positions (inches from left physical end)
  const leftBearing  = tre?.leftStub  ?? 0;
  const rightBearing = (tre?.span ?? 0) - (tre?.rightStub ?? 0);

  const distFromLeft  = xInches - leftBearing;
  const distFromRight = rightBearing - xInches;
  const distFromNearestBearing = Math.min(distFromLeft, distFromRight);

  const isEndConnection = distFromNearestBearing < threshold;

  return {
    ansitpi: isEndConnection ? ANSITPI_END : ANSITPI_INTERIOR,
    distFromNearestBearing,
    threshold,
    isEndConnection,
    girderBCDepth: d,
  };
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
  // otherwise fall back to girder bottom chord depth.
  const kingHeight = kingPost.hasKingPost
    ? kingPost.kingHeight
    : girderDepth;

  // Ply from [ADDITIONAL TRUSS INFO] Ply= field; default 1 if not found
  const girderPly = group.girder.treData?.ply ?? 1;

  // Species → material code for girder (carrying member).
  // Use the bottom chord species from cuttingMembers (authoritative) or
  // fall back to the majority bottomChord spec string (e.g. "2x6 No.2 SP").
  const girderSpecies =
    group.girder.treData?.cuttingMembers?.find(m => m.type === 'BottomChord')?.species
    ?? group.girder.treData?.bottomChord
    ?? group.girder.ifcBottomChord;
  const girderMaterial = speciesStringToMaterial(girderSpecies);

  const carryingMember: SSTCarryingMember = {
    material: girderMaterial,
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

  // Species → material code for carried truss.
  // Use the bottom chord species from cuttingMembers (authoritative) or
  // fall back to the majority bottomChord spec string (e.g. "2x4 No.2 SP").
  const carriedSpecies =
    carried.treData?.cuttingMembers?.find(m => m.type === 'BottomChord')?.species
    ?? carried.treData?.bottomChord;
  const carriedMaterial = speciesStringToMaterial(carriedSpecies);

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
    material: carriedMaterial,
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

  // ANSI/TPI 1 connection type — computed from hanger distance vs 5d rule
  const ansitpiResult = computeAnsitpi(group, carried);

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
    ansitpi: ansitpiResult.ansitpi,
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
