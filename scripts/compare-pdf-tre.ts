/**
 * Prototype check: does the engineering PDF carry what the TRE pipeline produces?
 *
 * Reads a job's TRE files with the current pipeline (the reference) and the same job's engineering
 * PDF with the new reader, then compares girders, hanger positions, chords, loads, plies and species.
 *
 * Run (from the repo root, node 20):
 *   npx esbuild scripts/compare-pdf-tre.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=node_modules/.cache/compare-pdf-tre.mjs
 *   node node_modules/.cache/compare-pdf-tre.mjs "<folder with the .tre files>" "<engineering .pdf>"
 */

import fs from 'node:fs';
import path from 'node:path';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { analyzeFiles } from '../src/lib/parser';
import { attachGeometry, extractPdfPages, parsePdfJob, pdfToGirderGroups, readLayoutPage, linkLayout, suggestConnections } from '../src/lib/pdf';
import { buildSSTPayload } from '../src/lib/sst-mapper';
import type { PdfJob, PdfTruss } from '../src/lib/pdf';
import { getCarriedSpecies, getGirderSpecies } from '../src/lib/sst-mapper';

const [treDir, pdfFile, layoutFile] = process.argv.slice(2);
if (!treDir || !pdfFile) {
  console.error('usage: compare-pdf-tre <tre folder> <engineering pdf>');
  process.exit(1);
}

const speciesToken = (s?: string | null): string => {
  const t = (s ?? '').toUpperCase().split(/[\s,]+/);
  return ['SPF', 'SP', 'HF', 'DF'].find((x) => t.includes(x)) ?? '?';
};
const r2 = (v: number) => Math.round(v * 100) / 100;
let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  MISMATCH ${label}${detail ? ': ' + detail : ''}`);
  }
};

async function main() {
  // --- reference: the TRE pipeline ---
  const treFiles = fs
    .readdirSync(treDir)
    .filter((f) => /\.tre$/i.test(f))
    .map((f) => new File([fs.readFileSync(path.join(treDir, f), 'utf8')], f));
  const groups = await analyzeFiles([], treFiles, () => {});

  // --- the PDF ---
  const doc = await (pdfjs as any).getDocument({
    data: new Uint8Array(fs.readFileSync(pdfFile)),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const job: PdfJob = parsePdfJob(await extractPdfPages(doc));
  await attachGeometry(job, (n) => doc.getPage(n), (pdfjs as any).OPS);

  console.log(`PDF: ${job.format}, job ${job.jobName}, ${job.trusses.length} truss sheets`);
  console.log(`TRE: ${treFiles.length} files, ${groups.length} girders\n`);

  // a label can have several sheets (mirrored / continued): keep the first with data
  const byLabel = new Map<string, PdfTruss>();
  for (const t of job.trusses) {
    const prev = byLabel.get(t.label.toUpperCase());
    if (!prev || (prev.hangerLoads.length === 0 && t.hangerLoads.length > 0)) byLabel.set(t.label.toUpperCase(), t);
  }

  // 1) girders
  const pdfGirders = [...byLabel.values()].filter((t) => t.hangerLoads.length > 0).map((t) => t.label.toUpperCase()).sort();
  const treGirders = groups.map((g) => g.girder.label.toUpperCase()).sort();
  console.log('Girders  TRE:', treGirders.join(' '));
  console.log('Girders  PDF:', pdfGirders.join(' '));
  check(JSON.stringify(pdfGirders) === JSON.stringify(treGirders), 'girder list');

  for (const g of groups) {
    const label = g.girder.label.toUpperCase();
    const pg = byLabel.get(label);
    console.log(`\nGirder ${label}: ${g.carriedTrusses.length} connections in TRE`);
    if (!pg) {
      check(false, `${label} has a PDF sheet`);
      continue;
    }

    // 2) hanger positions
    const trePos = [...new Set(g.carriedTrusses.map((c) => r2(c.localX)))].sort((a, b) => a - b);
    const pdfPos = [...new Set(pg.hangerLoads.map((h) => r2(h.position)))].sort((a, b) => a - b);
    check(JSON.stringify(trePos) === JSON.stringify(pdfPos), `${label} hanger positions`, `TRE ${trePos.join(',')} | PDF ${pdfPos.join(',')}`);

    // 3) chord (only the sheets that print it)
    for (const c of g.carriedTrusses) {
      const treChord = c.hanger?.chord === 1 ? 'TC' : c.hanger?.chord === 2 ? 'BC' : null;
      const here = pg.hangerLoads.filter((h) => r2(h.position) === r2(c.localX));
      if (here.length === 1 && here[0].chord && treChord) {
        check(here[0].chord === treChord, `${label} chord @${c.localX}`, `TRE ${treChord} | PDF ${here[0].chord}`);
      }
    }

    // 4) each connection's reaction is in the PDF sheet of its carried truss
    for (const c of g.carriedTrusses) {
      const pc = byLabel.get(c.instance.label.toUpperCase());
      const down = Math.round(c.downReaction ?? 0);
      const up = Math.round(Math.abs(c.upliftReaction ?? 0));
      if (!pc) {
        check(false, `${label} <- ${c.instance.label} has a PDF sheet`);
        continue;
      }
      const hit = pc.supports.find(
        (s) => s.down !== null && Math.abs(s.down - down) <= 1 && (job.format === 'mitek-8.810' || Math.abs(Math.abs(s.uplift ?? 0) - up) <= 1)
      );
      check(!!hit, `${label} <- ${c.instance.label}@${c.localX} down ${down} up ${up}`, `PDF supports: ${pc.supports.map((s) => `${s.joint}:${s.down}/${s.uplift ?? '-'}`).join(' ')}`);
    }

    // 5) plies and species
    check(pg.ply === (g.girder.treData?.ply ?? 1), `${label} plies`, `TRE ${g.girder.treData?.ply} | PDF ${pg.ply}`);
    if (pg.botChord) {
      const treSp = speciesToken(getGirderSpecies(g));
      check(speciesToken(pg.botChord.species) === treSp, `${label} bottom chord species`, `TRE ${treSp} | PDF ${pg.botChord.species}`);
    }
    for (const c of g.carriedTrusses) {
      const pc = byLabel.get(c.instance.label.toUpperCase());
      if (pc && pc.ply !== null && c.treData?.ply !== undefined) check(pc.ply === c.treData.ply, `${c.instance.label} plies`, `TRE ${c.treData.ply} | PDF ${pc.ply}`);
      if (pc?.botChord) {
        const treSp = speciesToken(getCarriedSpecies(c));
        check(speciesToken(pc.botChord.species) === treSp, `${c.instance.label} bottom chord species`, `TRE ${treSp} | PDF ${pc.botChord.species}`);
      }
    }
  }

  // 6) which truss hangs at each hanger load: suggestion from load matching vs the TRE truth
  const suggestions = suggestConnections(job);
  let uniqueRight = 0, uniqueWrong = 0, ambiguousWith = 0, ambiguousWithout = 0, none = 0, total = 0;
  const notes: string[] = [];
  for (const g of groups) {
    const gl = g.girder.label.toUpperCase();
    for (const c of g.carriedTrusses) {
      total++;
      // several hangers can share a position (TC and BC): take the one whose load is closest to this connection
      const spot = suggestions
        .filter((x) => x.girder.toUpperCase() === gl && r2(x.position) === r2(c.localX))
        .sort((a, b) => Math.abs(a.load - (c.downReaction ?? 0)) - Math.abs(b.load - (c.downReaction ?? 0)))[0];
      const truth = c.instance.label.toUpperCase();
      if (!spot || spot.confidence === 'none') {
        none++;
        notes.push(`none:      ${gl}@${c.localX} true ${truth}, PDF load ${spot?.load ?? '-'}, TRE down ${Math.round(c.downReaction ?? 0)}`);
      } else if (spot.confidence === 'unique') {
        if (spot.best!.label.toUpperCase() === truth) uniqueRight++;
        else {
          uniqueWrong++;
          notes.push(`wrong:     ${gl}@${c.localX} true ${truth}, suggested ${spot.best!.label}`);
        }
      } else if (spot.candidates.some((x) => x.label.toUpperCase() === truth)) {
        ambiguousWith++;
        notes.push(`ambiguous: ${gl}@${c.localX} true ${truth}, candidates ${spot.candidates.map((x) => x.label).join('/')}`);
      } else ambiguousWithout++;
    }
  }
  console.log(`\nCarried truss suggestion from load matching (${total} connections):`);
  console.log(`  unique and right: ${uniqueRight}, unique but wrong: ${uniqueWrong}`);
  console.log(`  ambiguous, true truss among candidates: ${ambiguousWith}, ambiguous without it: ${ambiguousWithout}`);
  console.log(`  no candidate: ${none}`);
  [...new Set(notes)].slice(0, 12).forEach((n) => console.log('   ' + n));

  // 7) the layout: who hangs where
  if (layoutFile) {
    const ldoc = await (pdfjs as any).getDocument({ data: new Uint8Array(fs.readFileSync(layoutFile)), useSystemFonts: true, verbosity: 0 }).promise;
    const layoutPage = await readLayoutPage(await ldoc.getPage(1), (pdfjs as any).OPS);
    const links = linkLayout(layoutPage, job);
    console.log(`\nLayout: scale ${links.scale} in/pt, ${links.connections.length} connections found`);
    links.connections.forEach((c) => console.log(`  ${c.girder} @${c.position}" <- ${c.carried}  connector ${c.connector ?? '-'}`));
    links.notes.forEach((n) => console.log('  note: ' + n));
    for (const g of groups) {
      for (const c of g.carriedTrusses) {
        const hit = links.connections.find((x) => x.girder === g.girder.label.toUpperCase() && Math.abs(x.position - c.localX) <= 0.5);
        check(!!hit && hit.carried === c.instance.label.toUpperCase(), `layout: ${g.girder.label}@${c.localX} carries ${c.instance.label}`, hit ? `layout says ${hit.carried}` : 'not found in the layout');
      }
    }

    // 8) the payload sent to Strong-Tie: built from the PDFs vs built from the TRE
    const pdfGroups = pdfToGirderGroups(job, links);
    const flat = (o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as object)) flat(v, prefix ? `${prefix}.${k}` : k, out);
      else out[prefix] = o;
      return out;
    };
    // geometry read from a drawing is as exact as the printed scale: a tenth of an inch
    const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.15 : a === b);
    const region = process.env.REGION === 'us' ? 'us' : 'can';
    const stats = new Map<string, { ok: number; total: number; samples: string[] }>();
    let compared = 0;
    for (const g of groups) {
      const pg = pdfGroups.find((x) => x.girder.label.toUpperCase() === g.girder.label.toUpperCase());
      for (const c of g.carriedTrusses) {
        const pc = pg?.carriedTrusses.find((x) => Math.abs(x.localX - c.localX) <= 0.5);
        if (!pg || !pc) continue;
        compared++;
        const a = flat(buildSSTPayload(g, c, region));
        const b = flat(buildSSTPayload(pg, pc, region));
        for (const key of Object.keys(a)) {
          const s = stats.get(key) ?? { ok: 0, total: 0, samples: [] };
          s.total++;
          if (same(a[key], b[key])) s.ok++;
          else if (s.samples.length < 2) s.samples.push(`${g.girder.label}@${c.localX}: TRE ${String(a[key])} | PDF ${String(b[key])}`);
          stats.set(key, s);
        }
      }
    }
    console.log(`\nPayload built from the PDFs vs from the TRE (${region.toUpperCase()}), ${compared} connections:`);
    const wrong = [...stats].filter(([, s]) => s.ok < s.total);
    console.log(`  ${stats.size - wrong.length} of ${stats.size} payload fields identical on every connection`);
    for (const [key, s] of wrong) console.log(`  DIFFERENT ${key}: ${s.ok}/${s.total} equal   e.g. ${s.samples.join('  ||  ')}`);
  }

  console.log(`\nResult: ${pass} checks matched, ${fail} mismatched`);
}

main();
