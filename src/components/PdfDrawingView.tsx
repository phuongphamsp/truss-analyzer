/**
 * The engineering sheet of a PDF-built girder, drawn with a marker at every hanger (prototype).
 * Replaces the TRE-based diagrams, which have no geometry to draw when the job comes from PDFs.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { GirderGroup } from '../types';
import { getEngineeringPdf } from '../lib/pdf/source';

const RENDER_SCALE = 2;

interface Props {
  group: GirderGroup;
  /** the carried truss to highlight */
  selectedId?: string | null;
}

export function PdfDrawingView({ group, selectedId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drawing = group.pdfDrawing;

  useEffect(() => {
    let cancelled = false;
    setSize(null);
    setError(null);
    (async () => {
      const data = getEngineeringPdf();
      if (!drawing || !data) {
        setError('The engineering PDF is not loaded, or the drawing of this girder could not be placed.');
        return;
      }
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(drawing.page);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        if (!cancelled) setSize({ w: viewport.width, h: viewport.height });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not draw the sheet');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drawing?.page, group.girder.id]);

  if (!drawing) return null;
  const placed = drawing.originX !== undefined && drawing.baseY !== undefined && drawing.inchesPerPoint !== undefined;
  const px = (inches: number) => ((drawing.originX ?? 0) + inches / (drawing.inchesPerPoint ?? 1)) * RENDER_SCALE;

  return (
    <div className="flex-1 overflow-auto bg-[#0C0D14] p-4" data-testid="pdf-drawing">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
        Engineering sheet of {group.girder.label} (page {drawing.page}){placed ? ' · markers = hangers read from the PDFs' : ' · the hanger positions could not be placed on this drawing'}
      </div>
      {error && (
        <div className="flex items-start gap-2 text-[11px] text-red-300 border border-red-500/40 rounded p-3 max-w-xl">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {!size && !error && (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Drawing the sheet…</div>
      )}
      <div className="relative inline-block bg-white" style={{ display: error ? 'none' : 'inline-block' }}>
        <canvas ref={canvasRef} />
        {size && placed && (
          <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h}>
            {group.carriedTrusses.map((c) => {
              const x = px(c.localX ?? 0);
              const yBase = (size.h / RENDER_SCALE - (drawing.baseY ?? 0)) * RENDER_SCALE;
              const on = c.instance.id === selectedId;
              return (
                <g key={c.instance.id} data-testid="hanger-marker">
                  <line x1={x} x2={x} y1={yBase - 160} y2={yBase + 14} stroke={on ? '#e11d48' : '#2563eb'} strokeWidth={on ? 3 : 2} strokeDasharray="6 3" />
                  <circle cx={x} cy={yBase + 14} r={on ? 7 : 5} fill={on ? '#e11d48' : '#2563eb'} />
                  <text x={x + 8} y={yBase - 164} fontSize="16" fontWeight="bold" fill={on ? '#e11d48' : '#2563eb'}>
                    {c.instance.label} @ {c.localX}"
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
