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
