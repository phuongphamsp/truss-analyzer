/**
 * Data read from a truss engineering PDF (prototype).
 * Kept independent of the TRE model so a PDF can feed the app without a TRE file.
 */

/** The layout of the sheets: MiTek US sheets (software 8.810) or MiTek Canadian sheets (8.420, 8.030, 25.2 ... share one layout). */
export type PdfFormat = 'mitek-us' | 'mitek-canada';

export interface PdfLumberSpec {
  size: string;    // "2x8"
  species: string; // "SP", "SPF", "DF", "HF"
  grade: string;   // "2400F 2.0E", "No.2"
}

export interface PdfLumberException {
  members: string[]; // ["B3", "B4"]
  spec: PdfLumberSpec;
}

export interface PdfSupport {
  /** joint id as printed ("6", "8", or a letter in the Canadian format) */
  joint: string;
  /** reaction pushing down on the support (lb); factored (LSD) in the Canadian format */
  down: number | null;
  /** uplift (lb, negative); factored (LSD) in the Canadian format */
  uplift: number | null;
  /** bearing size or "Mechanical" (a truss hung from a girder) */
  bearing: string | null;
  /** load case of the maximum uplift, when printed ("LC 12") */
  upliftLoadCase: number | null;
  /** chord the joint lies on, when the sheet names chords by joints (Canadian format) */
  chord?: 'TC' | 'BC' | null;
  /** which load produces the largest uplift at this joint, from the unfactored component reactions (wind, or snow / live / dead) */
  upliftSource?: 'wind' | 'other' | null;
}

export interface PdfHangerLoad {
  /** position along the girder from its left end (inches) */
  position: number;
  /** load (lb), absolute value */
  load: number;
  /** chord the load is applied to, when the sheet says so */
  chord: 'TC' | 'BC' | null;
  /** joint of the load, when the sheet gives one (Canadian format) */
  joint: string | null;
  /** lumber of the chord piece the load sits on, when the sheet names chords by joints */
  spec?: PdfLumberSpec | null;
}

/** A vertical web read from the drawing: two faces one lumber depth apart, standing on the bottom chord. */
export interface VerticalWeb {
  /** left / right face, inches from the left bearing */
  left: number;
  right: number;
  /** face-to-face distance snapped to the lumber depth (3.5, 5.5 ...) */
  depth: number;
  /** top edge of each face, inches above the underside of the bottom chord */
  topLeft: number;
  topRight: number;
}

/** What the drawing of one truss gives (see drawing.ts). */
export interface TrussGeometry {
  inchesPerPoint: number;
  /** heel height (inches) of the hung end at a joint */
  heelByJoint: Record<string, number>;
  /** pitch (degrees) of the top chord at a hung joint that lies on the top chord */
  slopeByJoint?: Record<string, number>;
  /** page position of the left bearing (x) and the underside of the bottom chord (y), in points */
  originX?: number;
  baseY?: number;
  /** distance between the two outer bearings (inches), when both could be placed */
  span?: number;
  webs: VerticalWeb[];
}

export interface PdfTruss {
  label: string;
  /** page of the sheet whose drawing belongs to this truss */
  page: number | null;
  /** joint of the left bearing (first joint of the bottom chord), when the sheet names chords by joints */
  leftJoint?: string | null;
  /** read from the drawing page, when it has been (attachGeometry) */
  geometry?: TrussGeometry;
  type: string;
  qty: number | null;
  ply: number | null;
  topChord: PdfLumberSpec | null;
  botChord: PdfLumberSpec | null;
  webs: PdfLumberSpec | null;
  /** *Except* lists printed under a chord: members that differ from the chord default */
  exceptions: { topChord: PdfLumberException[]; botChord: PdfLumberException[]; webs: PdfLumberException[] };
  supports: PdfSupport[];
  /** loads this truss delivers to a connection device (it is a girder when this is not empty) */
  hangerLoads: PdfHangerLoad[];
  /** lines of the sheet kept for debugging */
  notes: string[];
}

export interface PdfJob {
  format: PdfFormat;
  /** country the sheets were made for, guessed from the design code printed on them (null when unclear) */
  regionHint?: { region: 'us' | 'can'; evidence: string[] } | null;
  jobName: string;
  trusses: PdfTruss[];
}
