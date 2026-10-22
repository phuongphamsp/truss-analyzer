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
// Lumber Species → Material code mapping (Truss material type)
//
// When material = Truss, the species determines the exact material code:
//   DF  (Douglas Fir)      → 5
//   HF  (Hem Fir)          → 6
//   SP  (Southern Pine)    → 7
//   SPF (Spruce Pine Fir)  → 8
// ---------------------------------------------------------------------------

export const MATERIAL_TRUSS_DF  = 5;  // Douglas Fir
export const MATERIAL_TRUSS_HF  = 6;  // Hem Fir
export const MATERIAL_TRUSS_SP  = 7;  // Southern Pine
export const MATERIAL_TRUSS_SPF = 8;  // Spruce Pine Fir

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
// Canada-specific constants
//
// Observed from the official Hanger Selector (app.strongtie.com/hs/can,
// Truss Flush Bottom): buildingCode 41, ansitpi 0, download 100, uplift 115.
// ---------------------------------------------------------------------------

export const BUILDING_CODE_CAN_DEFAULT = 41;

export const DL_DURATION_STANDARD_TERM = 100; // CAN: "Standard Term 1.00"
export const UL_DURATION_STANDARD_TERM = 100; // CAN: "Standard Term 1.00"
export const UL_DURATION_SHORT_TERM = 115;    // CAN: "Short Term 1.15"

// ---------------------------------------------------------------------------
// Region configuration (US vs CAN)
// ---------------------------------------------------------------------------

export type SSTRegion = 'us' | 'can';
export const DEFAULT_REGION: SSTRegion = 'us';

export interface SSTRegionConfig {
  label: string;
  /** Default building code sent to the API */
  buildingCode: number;
  buildingCodeNote: string;
  /** Whether the ANSI/TPI 1 evaluation applies (CAN: hidden, always 0) */
  usesAnsitpi: boolean;
  /** SST material codes (Truss species) accepted by the region's selector */
  supportedTrussMaterials: number[];
  /** "ASD" (US) or "LSD" (CAN) — labels only */
  loadLabelSuffix: 'ASD' | 'LSD';
  codeLabels: Record<number, string>;
  downloadDurationLabels: Record<number, string>;
  upliftDurationLabels: Record<number, string>;
  /** Default uplift duration when no DOL factor is available */
  defaultUplift: number;
  /** Default download duration when no DOL factor is available */
  defaultDownload: number;
  /**
   * DOL factors that exist in this region's REACTION INFO. Load cases with any other DOL
   * are ignored when picking the Download / Uplift reaction. null = use every load case.
   */
  validDols: number[] | null;
}

export const REGION_CONFIG: Record<SSTRegion, SSTRegionConfig> = {
  us: {
    label: 'USA',
    buildingCode: BUILDING_CODE_IRC2018,
    buildingCodeNote: 'IRC 2018',
    usesAnsitpi: true,
    supportedTrussMaterials: [MATERIAL_TRUSS_DF, MATERIAL_TRUSS_HF, MATERIAL_TRUSS_SP, MATERIAL_TRUSS_SPF],
    loadLabelSuffix: 'ASD',
    codeLabels: {
      0: 'None', 10: 'IBC 2018', 20: 'IRC 2018', 30: 'IBC 2021', 40: 'IRC 2021',
    },
    downloadDurationLabels: {
      90: 'Dead (90)', 100: 'Floor (100)', 115: 'Snow (115)', 125: 'Roof (125)', 160: 'Quake/Wind (160)',
    },
    upliftDurationLabels: { 100: 'Normal (100)', 160: 'Quake/Wind (160)' },
    defaultUplift: UL_DURATION_WIND_QUAKE,
    defaultDownload: DL_DURATION_ROOF,
    validDols: null,
  },
  can: {
    label: 'CAN',
    buildingCode: BUILDING_CODE_CAN_DEFAULT,
    buildingCodeNote: 'Canada (code 41)',
    usesAnsitpi: false,
    supportedTrussMaterials: [MATERIAL_TRUSS_DF, MATERIAL_TRUSS_SPF],
    loadLabelSuffix: 'LSD',
    codeLabels: { 40: 'Canada (40)', 41: 'Canada (41)', 42: 'Canada (42)' },
    downloadDurationLabels: { 100: 'Standard Term 1.00' },
    upliftDurationLabels: { 100: 'Standard Term 1.00', 115: 'Short Term 1.15' },
    defaultUplift: UL_DURATION_SHORT_TERM,
    defaultDownload: DL_DURATION_STANDARD_TERM,
    validDols: [0.65, 1.0, 1.15],
  },
};

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
  skewAngle: number;   // magnitude (always >= 0), sent to SST API
  skewRaw: number;     // signed value (-90 to +90), used for UI display
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
  installedCost: number;  // h.ici: Installed Cost Index (lower = cheaper); 0 = unknown
  series: string;
  sku: string;
}

export interface SSTAPIResponse {
  success: boolean;
  hangers: SSTHangerResult[];
  error?: string;
  raw?: unknown;
}
