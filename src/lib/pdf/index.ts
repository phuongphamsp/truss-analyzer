/**
 * PDF input (prototype): read a truss engineering PDF into `PdfJob`.
 *
 *   const pages = await extractPdfPages(pdfjsDocument);
 *   const job = parsePdfJob(pages);   // throws on an unknown format
 */

import { isMitek8420, parseMitek8420 } from './engineeringMitek8420';
import { isMitek8810, parseMitek8810 } from './engineeringMitek8810';
import type { PdfPageText } from './pdfText';
import { detectRegion } from './regionHint';
import type { PdfJob } from './types';

export { extractPdfPages, fisToInches, groupItemsIntoLines } from './pdfText';
export type { PdfDocumentLike, PdfPageText } from './pdfText';
export type * from './types';
export { suggestConnections, isHungEnd, MATCH_TOLERANCE } from './connections';
export type { SuggestedConnection, CarriedCandidate, MatchConfidence } from './connections';
export { readLayoutPage, linkLayout, inferScale, buildBars } from './layout';
export type { LayoutPage, LayoutLinks, LayoutConnection, Bar } from './layout';
export { attachGeometry, readDrawingPage, readTrussGeometry, drawingScale } from './drawing';
export type { DrawingPage } from './drawing';
export { detectRegion } from './regionHint';
export type { RegionHint } from './regionHint';
export { pdfToGirderGroups } from './toGirderGroups';
export { extractSegments } from './pdfVectors';
export type { Segment } from './pdfVectors';

export function parsePdfJob(pages: PdfPageText[]): PdfJob {
  const hint = detectRegion(pages);
  if (isMitek8810(pages)) return { ...parseMitek8810(pages), regionHint: hint };
  if (isMitek8420(pages)) return { ...parseMitek8420(pages), regionHint: hint };
  throw new Error('Unrecognised engineering PDF format (expected a MiTek 8.810 or 8.420 sheet set).');
}
