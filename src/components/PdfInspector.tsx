/**
 * PdfInspector — prototype screen to check what the PDF reader extracts.
 *
 * Choose a truss engineering PDF (MiTek 8.810 or 8.420) and see, per truss sheet: label, type,
 * qty / ply, lumber, supports (reactions) and, for a girder, the hanger loads with their position
 * and chord. Everything runs in the browser; the PDF is not uploaded anywhere.
 */

import { useMemo, useState } from 'react';
import type { GirderGroup } from '../types';
import { setEngineeringPdf } from '../lib/pdf/source';
import { FileText, AlertCircle, Loader2 } from 'lucide-react';
import { attachGeometry, extractPdfPages, linkLayout, pdfToGirderGroups, parsePdfJob, readLayoutPage, suggestConnections } from '../lib/pdf';
import type { LayoutPage, PdfDocumentLike, PdfJob, PdfLumberSpec, PdfTruss, SuggestedConnection } from '../lib/pdf';

async function readPdf(file: File): Promise<PdfJob> {
  // loaded on demand: pdf.js is large and only this screen needs it
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  setEngineeringPdf(data);
  const doc = await pdfjs.getDocument({ data }).promise;
  const job = parsePdfJob(await extractPdfPages(doc as unknown as PdfDocumentLike));
  await attachGeometry(job, (n) => doc.getPage(n) as any, pdfjs.OPS as unknown as Record<string, number>);
  return job;
}

/** What to show for the truss suggested at a hanger load. */
function suggestionText(s: SuggestedConnection | undefined): string {
  if (!s || s.confidence === 'none') return '–';
  if (s.confidence === 'unique') return `${s.best!.label} (${s.best!.down} lb)`;
  return `? ${s.candidates.map((c) => c.label).join(' / ')}`;
}

async function readLayout(file: File): Promise<LayoutPage> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  return readLayoutPage(page as any, pdfjs.OPS as unknown as Record<string, number>);
}

const spec = (s: PdfLumberSpec | null) => (s ? `${s.size} ${s.species} ${s.grade}` : '–');

/** 190.5 → "15'-10 1/2\"" */
function feetInches(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const rest = totalInches - ft * 12;
  const whole = Math.floor(rest);
  const sixteenths = Math.round((rest - whole) * 16);
  const frac = sixteenths === 0 ? '' : ` ${sixteenths / gcd(sixteenths, 16)}/${16 / gcd(sixteenths, 16)}`;
  return `${ft}'-${whole}${frac}"`;
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function PdfInspector({ onUseJob }: { onUseJob?: (groups: GirderGroup[], tab: 'analyzer' | 'summary') => void }) {
  const [job, setJob] = useState<PdfJob | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutPage, setLayoutPage] = useState<LayoutPage | null>(null);
  const [layoutName, setLayoutName] = useState('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setJob(null);
    setFileName(file.name);
    try {
      setJob(await readPdf(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this PDF');
    } finally {
      setBusy(false);
    }
  };

  const onLayoutFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setLayoutName(file.name);
    try {
      setLayoutPage(await readLayout(file));
    } catch (e) {
      setLayoutPage(null);
      setError(e instanceof Error ? e.message : 'Could not read the layout PDF');
    } finally {
      setBusy(false);
    }
  };

  const suggestions = job ? suggestConnections(job) : [];
  const links = useMemo(() => (job && layoutPage ? linkLayout(layoutPage, job) : null), [job, layoutPage]);
  const pdfGroups = useMemo(() => (job && links ? pdfToGirderGroups(job, links) : []), [job, links]);
  // a sheet can be printed more than once (same label): list each girder once
  const girders = job
    ? job.trusses.filter((t, i, all) => t.hangerLoads.length > 0 && all.findIndex((o) => o.label === t.label && o.hangerLoads.length > 0) === i)
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-5 text-[#141414]" data-testid="pdf-inspector">
      <div className="flex items-center gap-3 mb-4">
        <FileText className="w-4 h-4" />
        <h2 className="text-xs uppercase font-bold tracking-widest">PDF input (beta)</h2>
        <label className="ml-auto cursor-pointer px-3 py-1.5 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-wider rounded hover:bg-black">
          Choose engineering PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="pdf-file-input"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label
          className={`cursor-pointer px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border border-[#141414] ${job ? 'hover:bg-[#141414]/10' : 'opacity-40 pointer-events-none'}`}
          title={job ? 'Add the roof truss layout PDF of the same job' : 'Choose the engineering PDF first'}
        >
          Add layout PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="layout-file-input"
            onChange={(e) => {
              void onLayoutFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {!job && !busy && !error && (
        <p className="text-[11px] opacity-70 max-w-xl">
          Choose the truss engineering PDF of a job (MiTek sheets). The app reads the text of the PDF in
          your browser and lists the trusses, their lumber and reactions, and the hanger loads of each girder.
          Nothing is uploaded.
        </p>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-[11px]"><Loader2 className="w-4 h-4 animate-spin" /> Reading {fileName}…</div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-[11px] text-red-700 bg-red-50 border border-red-300 rounded p-3 max-w-xl">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {job && (
        <div className="space-y-6">
          <div className="text-[11px] font-mono" data-testid="pdf-summary">
            {fileName} · format <b>{job.format}</b> · job <b>{job.jobName || '–'}</b> · {job.trusses.length} truss sheets ·{' '}
            <b>{girders.length}</b> girder{girders.length === 1 ? '' : 's'}
            {girders.length > 0 && <> ({girders.map((g) => g.label).join(', ')})</>}
          </div>
          {layoutName && links && (
            <div className="text-[11px] font-mono" data-testid="layout-summary">
              layout {layoutName} · scale {links.scale ?? '–'} in/pt · {links.connections.length} connections found
              {links.notes.map((n, i) => <div key={i} className="text-amber-800">note: {n}</div>)}
            </div>
          )}

          {onUseJob && (
            <div className="flex items-center gap-3 text-[11px]">
              <button
                className="px-3 py-1.5 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-wider rounded disabled:opacity-40"
                disabled={pdfGroups.length === 0}
                onClick={() => onUseJob(pdfGroups, 'analyzer')}
                data-testid="use-pdf-input"
                title={links ? 'Open the Analyzer: the INPUT column shows the parameters read from the PDFs' : 'Add the layout PDF first'}
              >
                View INPUT
              </button>
              <button
                className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase tracking-wider rounded disabled:opacity-40"
                disabled={pdfGroups.length === 0}
                onClick={() => onUseJob(pdfGroups, 'summary')}
                data-testid="use-pdf-job"
                title={links ? 'Open the Job Summary built from these PDFs and query the Hanger Selector' : 'Add the layout PDF first'}
              >
                Query Hanger Selector
              </button>
              <span className="opacity-70" data-testid="pdf-connections">
                {links ? `${pdfGroups.reduce((n, g) => n + g.carriedTrusses.length, 0)} connections ready` : 'add the layout PDF to build the connections'}
              </span>
            </div>
          )}

          <section>
            <h3 className="text-[10px] uppercase font-bold tracking-widest mb-2">Girders and hanger loads</h3>
            {girders.length === 0 && <p className="text-[11px] opacity-70">No girder found (no hanger load table in this PDF).</p>}
            {girders.map((g, gi) => (
              <div key={g.label + gi} className="mb-4 bg-white/60 border border-[#141414]/30 rounded" data-testid={`girder-${g.label}`}>
                <div className="px-3 py-1.5 border-b border-[#141414]/20 text-[11px] font-bold">
                  {g.label} <span className="font-normal opacity-60">{g.type} · qty {g.qty ?? '–'} · ply {g.ply ?? '–'}</span>
                </div>
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-wider opacity-60">
                      <th className="px-3 py-1">Position</th>
                      <th className="px-3 py-1">Inches</th>
                      <th className="px-3 py-1">Load (lb)</th>
                      <th className="px-3 py-1">Chord</th>
                      <th className="px-3 py-1">Joint</th>
                      <th className="px-3 py-1">Carried truss (suggested from load)</th>
                      {links && <th className="px-3 py-1">Carried truss and hanger (from layout)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const mine = suggestions.filter((x) => x.girder === g.label);
                      return g.hangerLoads.map((h, idx) => ({ h, sug: mine[idx] })).sort((a, b) => a.h.position - b.h.position);
                    })().map(({ h, sug }, i) => (
                      <tr key={i} className="border-t border-[#141414]/10">
                        <td className="px-3 py-1">{feetInches(h.position)}</td>
                        <td className="px-3 py-1">{h.position}</td>
                        <td className="px-3 py-1">{h.load.toLocaleString()}</td>
                        <td className="px-3 py-1">{h.chord ?? '–'}</td>
                        <td className="px-3 py-1">{h.joint ?? '–'}</td>
                        <td className="px-3 py-1" data-testid="suggestion">{suggestionText(sug)}</td>
                        {links && (
                          <td className="px-3 py-1" data-testid="layout-link">
                            {(() => {
                              const hit = links.connections.find((c) => c.girder === g.label.toUpperCase() && Math.abs(c.position - h.position) <= 0.5);
                              return hit ? `${hit.carried}${hit.connector ? ' · ' + hit.connector : ''}` : '–';
                            })()}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          <section>
            <h3 className="text-[10px] uppercase font-bold tracking-widest mb-2">All truss sheets</h3>
            <div className="overflow-x-auto bg-white/60 border border-[#141414]/30 rounded">
              <table className="w-full text-[11px] font-mono" data-testid="truss-table">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider opacity-60">
                    <th className="px-3 py-1">Truss</th>
                    <th className="px-3 py-1">Type</th>
                    <th className="px-3 py-1">Qty</th>
                    <th className="px-3 py-1">Ply</th>
                    <th className="px-3 py-1">Top chord</th>
                    <th className="px-3 py-1">Bottom chord</th>
                    <th className="px-3 py-1">Supports (joint: down / uplift @ bearing)</th>
                  </tr>
                </thead>
                <tbody>
                  {job.trusses.map((t: PdfTruss, i) => (
                    <tr key={t.label + i} className="border-t border-[#141414]/10 align-top">
                      <td className="px-3 py-1 font-bold">{t.label}</td>
                      <td className="px-3 py-1">{t.type || '–'}</td>
                      <td className="px-3 py-1">{t.qty ?? '–'}</td>
                      <td className="px-3 py-1">{t.ply ?? '–'}</td>
                      <td className="px-3 py-1">{spec(t.topChord)}</td>
                      <td className="px-3 py-1">
                        {spec(t.botChord)}
                        {t.exceptions.botChord.map((e, k) => (
                          <div key={k} className="opacity-60">except {e.members.join(', ')}: {spec(e.spec)}</div>
                        ))}
                      </td>
                      <td className="px-3 py-1">
                        {t.supports.length === 0 && '–'}
                        {t.supports.map((s, k) => (
                          <div key={k}>
                            {s.joint}: {s.down ?? '–'} / {s.uplift ?? '–'}
                            {s.bearing ? ` @ ${s.bearing}` : ''}
                            {s.upliftLoadCase ? ` (LC ${s.upliftLoadCase})` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
