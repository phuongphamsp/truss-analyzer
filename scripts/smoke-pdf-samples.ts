/**
 * Smoke test of the PDF reader over many jobs: no expected values needed.
 *
 * For every sub-folder holding an engineering PDF and a layout PDF it reads the job and reports what is
 * suspicious: girders whose hanger loads are not all linked to a carried truss, carried trusses without
 * a hung end, missing bottom chord lumber, heel or span not read. Each finding is a lead for the next
 * comparison with the tester's value sheet; an empty report is NOT a proof that the values are right.
 *
 * Run (from the repo root, node 20):
 *   npx esbuild scripts/smoke-pdf-samples.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=node_modules/.cache/smoke-pdf-samples.mjs
 *   node node_modules/.cache/smoke-pdf-samples.mjs "<folder with Sample XX sub-folders>" [can|us]
 */

import fs from 'node:fs';
import path from 'node:path';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { attachGeometry, extractPdfPages, isHungEnd, linkLayout, parsePdfJob, pdfToGirderGroups, readLayoutPage } from '../src/lib/pdf';
import { buildSSTPayload } from '../src/lib/sst-mapper';
import type { SSTRegion } from '../src/lib/sst-types';

const [root, regionArg] = process.argv.slice(2);
if (!root) {
  console.error('usage: smoke-pdf-samples <folder with Sample sub-folders> [can|us]');
  process.exit(1);
}
const region: SSTRegion = regionArg === 'us' ? 'us' : 'can';

const open = (file: string) =>
  (pdfjs as any).getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
const isLayout = (name: string) => /layout|[-_ ]R\.pdf$|mmdl/i.test(name);

async function smoke(dir: string) {
  const pdfs = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f));
  const layoutFile = pdfs.find(isLayout);
  const engFile = pdfs.find((f) => !isLayout(f));
  console.log(`\n=== ${path.basename(dir)}  (${engFile ?? 'no engineering PDF'} | ${layoutFile ?? 'no layout PDF'})`);
  if (!engFile || !layoutFile) return;

  const flags: string[] = [];
  try {
    const doc = await open(path.join(dir, engFile));
    const job = parsePdfJob(await extractPdfPages(doc));
    await attachGeometry(job, (n) => doc.getPage(n), (pdfjs as any).OPS);
    const girders = job.trusses.filter((t, i, all) => t.hangerLoads.length > 0 && all.findIndex((o) => o.label === t.label && o.hangerLoads.length > 0) === i);
    console.log(`${job.format}, region hint ${job.regionHint ? job.regionHint.region : 'none'}, ${job.trusses.length} sheets, ${girders.length} girders`);

    const ldoc = await open(path.join(dir, layoutFile));
    const links = linkLayout(await readLayoutPage(await ldoc.getPage(1), (pdfjs as any).OPS), job);
    console.log(`layout scale ${links.scale ?? 'not found'}, ${links.connections.length} connections linked`);
    links.notes.forEach((n) => flags.push(`layout note: ${n}`));
    if (links.scale === null) flags.push('layout: drawing scale not found');

    const groups = pdfToGirderGroups(job, links);
    for (const g of girders) {
      const label = g.label.toUpperCase();
      const linked = links.connections.filter((c) => c.girder === label);
      const positions = [...new Set(g.hangerLoads.map((h) => h.position))];
      const missing = positions.filter((p) => !linked.some((c) => Math.abs(c.position - p) <= 0.5));
      if (missing.length > 0) flags.push(`${label}: ${missing.length} of ${positions.length} hanger loads not linked to a truss (at ${missing.join(', ')}")`);
      if (!g.botChord) flags.push(`${label}: bottom chord lumber not read`);
    }
    for (const gr of groups) {
      for (const c of gr.carriedTrusses) {
        const tag = `${gr.girder.label} @${c.localX} ${c.instance.label}`;
        const carried = job.trusses.find((t) => t.label.toUpperCase() === c.instance.label.toUpperCase());
        if (!carried) flags.push(`${tag}: carried truss has no sheet in the engineering PDF`);
        else if (!carried.supports.some(isHungEnd)) flags.push(`${tag}: carried truss has no hung end (no mechanical / girder-ply bearing)`);
        else if (!(c.hanger?.heelHeight && c.hanger.heelHeight > 0)) flags.push(`${tag}: heel not read from the drawing`);
        const p = buildSSTPayload(gr, c, region) as any;
        if (p.carryingMember.material === 5 && !/DF/i.test(String(gr.girder.treData?.bottomChord ?? ''))) flags.push(`${tag}: girder species not read (default sent)`);
      }
    }
  } catch (e) {
    flags.push(`failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const unique = [...new Set(flags)];
  if (unique.length === 0) console.log('no findings');
  unique.slice(0, 25).forEach((f) => console.log('  - ' + f));
  if (unique.length > 25) console.log(`  ... and ${unique.length - 25} more`);
}

async function main() {
  const dirs = fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.statSync(d).isDirectory()).sort();
  for (const d of dirs) await smoke(d);
}

main();
