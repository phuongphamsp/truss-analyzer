/**
 * Vector extraction from a PDF page (prototype).
 *
 * Walks the pdf.js operator list, applies the current transformation matrix (cm / q / Q) and returns
 * the straight segments and rectangles of every path in page coordinates, the same space as the
 * positions of the text items. Curves are reduced to their end points.
 *
 * `OPS` is passed in (pdfjs.OPS) so this module does not import pdf.js itself.
 */

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The part of a pdf.js page this module uses. */
export interface PdfPageLike {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: any[] }>;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 applied first, then m2 (PDF "cm": new CTM = m × CTM). */
function multiply(m: Matrix, ctm: Matrix): Matrix {
  return [
    m[0] * ctm[0] + m[1] * ctm[2],
    m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2],
    m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
    m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export async function extractSegments(
  page: PdfPageLike,
  OPS: Record<string, number>
): Promise<Segment[]> {
  const list = await page.getOperatorList();
  const out: Segment[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;

  const push = (ax: number, ay: number, bx: number, by: number) => {
    const [x1, y1] = apply(ctm, ax, ay);
    const [x2, y2] = apply(ctm, bx, by);
    out.push({ x1, y1, x2, y2 });
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.constructPath) {
      const subOps: number[] = args[0];
      const c: number[] = args[1];
      let a = 0;
      let cx = 0, cy = 0, sx = 0, sy = 0;
      for (const op of subOps) {
        if (op === OPS.moveTo) { cx = sx = c[a++]; cy = sy = c[a++]; }
        else if (op === OPS.lineTo) { const x = c[a++], y = c[a++]; push(cx, cy, x, y); cx = x; cy = y; }
        else if (op === OPS.curveTo) { a += 4; const x = c[a++], y = c[a++]; push(cx, cy, x, y); cx = x; cy = y; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { a += 2; const x = c[a++], y = c[a++]; push(cx, cy, x, y); cx = x; cy = y; }
        else if (op === OPS.rectangle) {
          const x = c[a++], y = c[a++], w = c[a++], h = c[a++];
          push(x, y, x + w, y); push(x + w, y, x + w, y + h); push(x + w, y + h, x, y + h); push(x, y + h, x, y);
          cx = sx = x; cy = sy = y;
        } else if (op === OPS.closePath) { push(cx, cy, sx, sy); cx = sx; cy = sy; }
      }
    }
  }
  return out;
}

export const segmentLength = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
