/**
 * PDF input (prototype): read a truss engineering PDF into `PdfJob`.
 *
 *   const pages = await extractPdfPages(pdfjsDocument);
 *   const job = parsePdfJob(pages);   // throws on an unknown format
 */

import { isMitek8420, parseMitek8420 } from './engineeringMitek8420';
import { isMitek8810, parseMitek8810 } from './engineeringMitek8810';
import type { PdfPageText } from './pdfText';
import type { PdfJob } from './types';

export { extractPdfPages, fisToInches, groupItemsIntoLines } from './pdfText';
export type { PdfDocumentLike, PdfPageText } from './pdfText';
export type * from './types';

export function parsePdfJob(pages: PdfPageText[]): PdfJob {
  if (isMitek8810(pages)) return parseMitek8810(pages);
  if (isMitek8420(pages)) return parseMitek8420(pages);
  throw new Error('Unrecognised engineering PDF format (expected a MiTek 8.810 or 8.420 sheet set).');
}
