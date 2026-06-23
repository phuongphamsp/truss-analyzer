/**
 * SST Hanger Selector — API Types & Constants
 *
 * Reverse-engineered from DevTools capture of:
 *   POST https://api.strongtie.com/gws/hanger-selector/hangers
 *
 * Reference: D:\DataBridge-PoC\poc\src\integration\sst_api.py
 */

// ---------------------------------------------------------------------------
// API endpoint
// ---------------------------------------------------------------------------

export const SST_API_URL =
  'https://api.strongtie.com/gws/hanger-selector/hangers';

// ---------------------------------------------------------------------------
// Material types
// ---------------------------------------------------------------------------

export const MATERIAL_SOLID_SAWN = 1;
export const MATERIAL_GLULAM = 2;
export const MATERIAL_LSL = 3;
export const MATERIAL_LVL = 4;
export const MATERIAL_TRUSS = 5;
export const MATERIAL_I_JOIST = 6;
export const MATERIAL_FLOOR_TRUSS = 7;
export const MATERIAL_CONCRETE = 10;
export const MATERIAL_STEEL = 11;

// ---------------------------------------------------------------------------
// ANSI/TPI connection type (root-level field)
// ---------------------------------------------------------------------------

export const ANSITPI_OFF = 0;
export const ANSITPI_END = 3;
export const ANSITPI_INTERIOR = 6;

// ---------------------------------------------------------------------------
// Hanger style
// ---------------------------------------------------------------------------

export const STYLE_ALL = 0;
export const STYLE_FACE_MOUNT = 1;
export const STYLE_TOP_FLANGE = 2;
export const STYLE_CONCEALED = 3;

// ---------------------------------------------------------------------------
// Fastener type
// ---------------------------------------------------------------------------

export const FASTENER_ALL = 0;
export const FASTENER_NAILS = 1;
export const FASTENER_BOLTS = 2;
export const FASTENER_SCREWS = 3;

// ---------------------------------------------------------------------------
// Building code
// ---------------------------------------------------------------------------

export const BUILDING_CODE_NONE = 0;
export const BUILDING_CODE_IBC2018 = 10;
export const BUILDING_CODE_IRC2018 = 20;
export const BUILDING_CODE_IBC2021 = 30;
export const BUILDING_CODE_IRC2021 = 40;

// ---------------------------------------------------------------------------
// Load duration types (factor x 10)
// ---------------------------------------------------------------------------

export const DL_DURATION_DEAD = 90;
export const DL_DURATION_FLOOR = 100;
export const DL_DURATION_SNOW = 115;
export const DL_DURATION_ROOF = 125;
export const DL_DURATION_WIND_QUAKE = 160;

export const UL_DURATION_NORMAL = 100;
export const UL_DURATION_WIND_QUAKE = 160;

// ---------------------------------------------------------------------------
// Flush option
// ---------------------------------------------------------------------------

export const FLUSH_TOP = 'TOP'; // Joist
export const FLUSH_BOTTOM = 'BOTTOM'; // Truss

// ---------------------------------------------------------------------------
// Skew / slope types
// ---------------------------------------------------------------------------

export const SKEW_TYPE_NONE = 0;
export const SKEW_TYPE_LEFT = 1;
export const SKEW_TYPE_RIGHT = 2;

export const SLOPE_TYPE_NONE = 0;
export const SLOPE_TYPE_UP = 1;
export const SLOPE_TYPE_DOWN = 2;

// ---------------------------------------------------------------------------
// API payload interfaces
// ---------------------------------------------------------------------------

export interface SSTAngle {
  skewAngle: number;
  skewType: number;
  slopeAngle: number;
  slopeType: number;
}

export interface SSTLoads {
  load: number;
  uplift: number;
}

export interface SSTCarriedMember {
  material: number;
  width: number;
  depth: number;
  ply: number;
  loads: SSTLoads;
  angle: SSTAngle;
}

export interface SSTCarryingMember {
  material: number;
  width: number;
  depth: number;
  ply: number;
  topChord: number;
  topChordPly: number;
  kingWidth: number;
  kingHeight: number;
}

export interface SSTDesignInformations {
  downloadDurationType: number;
  upliftLoadDurationType: number;
}

export interface SSTFilters {
  depth: number;
  model: string;
  series: string;
  webStiffeners: number;
  width: number;
}

export interface SSTPayload {
  style: number;
  buildingCode: number;
  concealed: number;
  fastenerType: number;
  sort: number;
  ledger: number;
  designInformations: SSTDesignInformations;
  filters: SSTFilters;
  carriedMembers: SSTCarriedMember[];
  flushOption: string;
  carryingMember: SSTCarryingMember;
  ansitpi: number;
}

// ---------------------------------------------------------------------------
// API response interfaces
// ---------------------------------------------------------------------------

/** Single hanger from lstHangerOutput[] */
export interface SSTHangerResult {
  model: string;
  downloadLoad: number;
  upliftLoad: number;
  width: number;
  height: number;
  bearing: number;
  cost: number;
  series: string;
  sku: string;
}

export interface SSTAPIResponse {
  success: boolean;
  hangers: SSTHangerResult[];
  error?: string;
  raw?: unknown;
}
