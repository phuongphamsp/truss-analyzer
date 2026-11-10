/**
 * Guess whether an engineering PDF was made for the US or for Canada (prototype).
 *
 * The design code printed on the sheets says it: Canadian sheets cite NBCC / CSA O86 / TPIC and print
 * factored reactions, US sheets cite the IRC / IBC and ANSI/TPI. A hint, not a verdict: it only warns when
 * the country selected in the app disagrees, and returns null when the sheets do not say clearly.
 */

import type { PdfPageText } from './pdfText';

export type RegionHintValue = 'us' | 'can';

export interface RegionHint {
  region: RegionHintValue;
  /** the printed phrases that decided it, for display */
  evidence: string[];
}

const CAN_SIGNS: Array<[RegExp, string]> = [
  [/\bNBCC\b/, 'NBCC'],
  [/\bCSA\s*O\s*-?86\b/i, 'CSA O86'],
  [/\bTPIC\b/, 'TPIC'],
  [/\bBCBC\b|\bOBC\b|\bABC\b/, 'BCBC / OBC / ABC'],
  [/\bPART 9\b/, 'Part 9'],
  [/\bFACTORED\b/, 'factored reactions'],
  [/MiTek Canada/i, 'MiTek Canada'],
  [/\bG\.S\.L\./, 'ground snow load (G.S.L.)'],
];

const US_SIGNS: Array<[RegExp, string]> = [
  [/\bIRC\s?20\d\d\b/, 'IRC'],
  [/\bIBC\s?20\d\d\b/, 'IBC'],
  [/\bANSI\/?TPI\b|\bTPI\s?20\d\d\b/, 'ANSI/TPI'],
  [/\bASCE\b/, 'ASCE 7'],
  [/Plate Grip DOL/i, 'Plate Grip DOL'],
];

/** Needs at least two signs and a clear lead: one stray word (a customer called "Canada Lumber") is not enough. */
const MIN_SIGNS = 2;

export function detectRegion(pages: PdfPageText[]): RegionHint | null {
  const text = pages.map((p) => p.text).join('\n');
  const found = (signs: Array<[RegExp, string]>) => signs.filter(([re]) => re.test(text)).map(([, label]) => label);
  const can = found(CAN_SIGNS);
  const us = found(US_SIGNS);
  if (can.length >= MIN_SIGNS && can.length >= us.length + MIN_SIGNS) return { region: 'can', evidence: can };
  if (us.length >= MIN_SIGNS && us.length >= can.length + MIN_SIGNS) return { region: 'us', evidence: us };
  return null;
}
