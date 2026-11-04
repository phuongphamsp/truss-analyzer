/**
 * The engineering PDF in use (prototype): kept so the Analyzer can draw the sheet of a girder.
 * pdf.js takes ownership of the bytes it is given, so every reader gets its own copy.
 */

let current: Uint8Array | null = null;

export function setEngineeringPdf(data: Uint8Array): void {
  current = data.slice();
}

export function getEngineeringPdf(): Uint8Array | null {
  return current ? current.slice() : null;
}
