export interface TreData {
  label: string;
  isGirder?: boolean;
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
  span?: number;
  pitch?: number;
  spacing?: number;
  dol?: number | null;
  csi?: number;
  leftHeel?: number;
  rightHeel?: number;
  hangers?: Array<{
    xFeet: number;
    xInches: number;
    label: string;
    width: number;
    heelHeight: number;
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
