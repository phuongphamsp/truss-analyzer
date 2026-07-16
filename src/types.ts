/**
 * Lumber species determination for one member group (top chord, bottom chord,
 * or webs), including detection of chord segments with mixed lumber types.
 */
export interface LumberSpeciesResult {
  /**
   * Reported lumber species: the single species when all segments match, or —
   * when segments are mixed — the MOST CONSERVATIVE (lowest specific gravity)
   * species among the distinct species present.
   */
  species: string;
  /** True when the group's segments differ in size, grade, or species. */
  mixed: boolean;
  /** Specific gravity of the reported species; null if the token is unrecognized. */
  specificGravity: number | null;
  /** Per-segment breakdown used for the determination. */
  segments: Array<{ name: string; spec: string; species: string }>;
}

/**
 * A selected hanger parsed from the TRE [Hanger Conn Info V4.2000] section.
 *
 * PROTOTYPE / UNVERIFIED: the MiTek TRE hanger flag layout is undocumented, so
 * `offsetDirection` and `flushPosition` are best-guess candidate mappings tied
 * to specific comma-separated field indices (see parseHangerConnInfo). They are
 * NOT sent to the SST API and must be validated against known cases before use.
 */
export interface HangerConnInfo {
  model: string;         // field[1], e.g. "JUS26"
  type: string;          // field[2], e.g. "Face Mount Hanger"
  isTopFlange: boolean;  // type text contains "Top Flange"/"Top Mount"
  xInches: number;       // field[3], position along the girder
  carriedLabel: string;  // field[12], carried truss label
  angle: number;         // field[13], connection angle (270 = perpendicular)
  rawFields: string[];   // all fields, for inspection/validation
  /** UNVERIFIED candidate from field[14] (top-flange only; else 'N/A'). */
  offsetDirection: 'N/A' | 'Left' | 'Right' | 'Center';
  /** UNVERIFIED candidate from field[5]. */
  flushPosition: 'High' | 'Low' | 'Center';
  unverified: true;
}

export interface TreData {
  label: string;
  isGirder?: boolean;
  rawText?: string;  // raw TRE file content, used for TRE-based bearing detection
  topChord: string;
  bottomChord: string;
  webs: string;
  maxReaction: number;
  reactions?: {
    leftDown: number;
    rightDown: number;
    leftUp: number;
    rightUp: number;
    leftHorz?: number;
  };
  members?: Array<{
    name: string;
    type: 'TopChord' | 'BottomChord' | 'Web' | 'Peak' | 'Dummy' | 'Other';
    size: string;
    grade: string;
    species: string;
    width: number;
    depth: number;
    coords: Array<{ x: number, y: number }>;
    isStructural: boolean;
  }>;
  /** Members parsed from [ADDITIONAL CUTTING INFO] — authoritative source for grade/size */
  cuttingMembers?: Array<{
    name: string;
    type: 'TopChord' | 'BottomChord' | 'Web' | 'Other';
    size: string;
    grade: string;
    species: string;
  }>;
  span?: number;
  pitch?: number;
  spacing?: number;
  dol?: number | null;
  ply?: number;         // Ply= field from [ADDITIONAL TRUSS INFO]
  csi?: number;
  leftHeel?: number;
  rightHeel?: number;
  leftStub?: number;   // Left Stub= field from TRE (inches from left end to left bearing)
  rightStub?: number;  // Right Stub= field from TRE (inches from right end to right bearing)
  /** Lumber species per member group, with mixed-segment detection (see resolveLumberSpecies). */
  lumberSpecies?: {
    topChord: LumberSpeciesResult;
    bottomChord: LumberSpeciesResult;
    webs: LumberSpeciesResult;
  };
  /** Selected hangers from [Hanger Conn Info] (prototype; see HangerConnInfo). */
  hangerConnInfo?: HangerConnInfo[];
  hangers?: Array<{
    xFeet: number;
    xInches: number;
    label: string;
    width: number;
    heelHeight: number;
    bearingLocation: number;  // bearing location of carried truss at this hanger (inches), from LG*T field[16]
    angle: number;            // carried truss angle relative to girder (degrees), from LG*T field[14]; 90/270 = perpendicular
  }>;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface TrussInstance {
  id: string;
  label: string;
  isGirder: boolean;
  boundingBox?: BoundingBox;
  centroid?: Point3D;
  leftEnd?: Point3D;
  treData?: TreData;
  ifcTopChord?: string;
  ifcBottomChord?: string;
  ifcWebs?: string;
  /**
   * Orientation derived from IFC geometry (placements in this export are
   * identity, so orientation comes from the point cloud). slopeDeg is the tilt
   * of the assembly's principal axis from horizontal, in degrees [0, 90].
   */
  orientation?: {
    slopeDeg: number;
    principalAxis: Point3D;
  };
}

export interface CarriedTruss {
  instance: TrussInstance;
  localX: number;
  spacing: number | null;
  distFromGE?: number;
  angle?: number;
  rotation?: number;
  side?: 'above' | 'below';
  member?: string;
  memberSize?: string;
  treData?: TreData;
  bearingSide?: 'left' | 'right';
  downReaction?: number;
  upliftReaction?: number;
  downDolFactor?: number;   // DOL factor of the LC that produced downReaction (e.g. 1.15, 1.25)
  upliftDolFactor?: number; // DOL factor of the LC that produced upliftReaction (e.g. 1.6)
  hangerAngle?: number;     // LG*T field[14]: angle of carried truss relative to girder (degrees)
}

export interface GirderGroup {
  girder: TrussInstance;
  carriedTrusses: CarriedTruss[];
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}
