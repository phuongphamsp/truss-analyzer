/**
 * Prototype check: do the values the tester read from a job's PDFs match what the PDF reader produces?
 *
 * The tester fills docs/Tester-Value-Sheet-Template.xlsx (sheet "Connections", one row per connection).
 * The engineering PDF and the layout PDF of the same job are read with the PDF reader, the connections are
 * built and run through buildSSTPayload; every filled column is compared field by field.
 *
 * Run (from the repo root, node 20):
 *   npx esbuild scripts/check-tester-sheet.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=node_modules/.cache/check-tester-sheet.mjs
 *   node node_modules/.cache/check-tester-sheet.mjs "<engineering .pdf>" "<layout .pdf>" "<tester .xlsx>" [can|us] [sample filter]
 *
 * One workbook can hold several samples: the optional filter keeps the rows whose "Sample / job name"
 * contains it (e.g. "Sample 7"). A row may list several positions ("124.8, 148.8") for identical connections.
 */

import fs from 'node:fs';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import XLSX from 'xlsx';
import { attachGeometry, extractPdfPages, linkLayout, parsePdfJob, pdfToGirderGroups, readLayoutPage } from '../src/lib/pdf';
import { buildSSTPayload, getCarriedSpecies, getGirderSpecies } from '../src/lib/sst-mapper';
import type { SSTRegion } from '../src/lib/sst-types';

const [engFile, layoutFile, sheetFile, regionArg, sampleFilter] = process.argv.slice(2);
if (!engFile || !layoutFile || !sheetFile) {
  console.error('usage: check-tester-sheet <engineering pdf> <layout pdf> <tester xlsx> [can|us]');
  process.exit(1);
}
const region: SSTRegion = regionArg === 'us' ? 'us' : 'can';

const open = (file: string) =>
  (pdfjs as any).getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;

/** the species token of a spec string such as "2x8 1950F 1.7E SPF" */
const speciesOf = (spec: string | undefined) => spec?.trim().split(/\s+/).pop()?.toUpperCase();

async function main() {
  const doc = await open(engFile);
  const job = parsePdfJob(await extractPdfPages(doc));
  await attachGeometry(job, (n) => doc.getPage(n), (pdfjs as any).OPS);
  const ldoc = await open(layoutFile);
  const links = linkLayout(await readLayoutPage(await ldoc.getPage(1), (pdfjs as any).OPS), job);
  const groups = pdfToGirderGroups(job, links);
  links.notes.forEach((n) => console.log('note:', n));

  const sheet = XLSX.readFile(sheetFile).Sheets['Connections'];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: null });
  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    if (ok) pass++;
    else fail++;
    if (!ok) console.log(`  MISMATCH ${label}: ${detail}`);
  };
  const num = (v: unknown) => (v === null || v === '' || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  const near = (a: number | null, b: number | null, tol = 0.15) => a !== null && b !== null && Math.abs(a - b) <= tol;

  for (const row of rows) {
    if (String(row['Sample / job name'] ?? '').startsWith('EXAMPLE') || !row['Girder (carrying)']) continue;
    const girder = String(row['Girder (carrying)']).toUpperCase();
    if (sampleFilter && !String(row['Sample / job name'] ?? '').includes(sampleFilter)) continue;
    const carried = String(row['Carried truss']).toUpperCase();
    const positions = String(row['Position on girder (in, from left bearing)'] ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => v.toString().trim() !== '' && Number.isFinite(v));
    if (positions.length === 0) continue;
    for (const position of positions) {
    const tag = `${girder} @${position} ${carried}`;
    const g = groups.find((x) => x.girder.label.toUpperCase() === girder);
    const c = g?.carriedTrusses.find((x) => position !== null && Math.abs((x.localX ?? 0) - position) <= 0.5);
    console.log(tag);
    check(`${tag} found`, !!g && !!c, g ? 'no connection at this position' : 'girder not found in the PDF');
    if (!g || !c) continue;
    check(`${tag} carried truss`, c.instance.label.toUpperCase() === carried, `PDF says ${c.instance.label}`);

    const p = buildSSTPayload(g, c, region) as any;
    const cm = p.carriedMembers[0];
    const gm = p.carryingMember;
    check(`${tag} girder species`, speciesOf(getGirderSpecies(g)) === String(row['Girder: species']).toUpperCase(), `PDF ${getGirderSpecies(g)}`);
    check(`${tag} girder bottom chord width`, near(gm.width, num(row['Girder: bottom chord width (in)'])), `PDF ${gm.width}`);
    check(`${tag} girder bottom chord depth`, near(gm.depth, num(row['Girder: bottom chord depth (in)'])), `PDF ${gm.depth}`);
    check(`${tag} girder plies`, gm.ply === num(row['Girder: plies']), `PDF ${gm.ply}`);
    const king = String(row['King post? (Y/N)'] ?? '').toUpperCase() === 'Y';
    check(`${tag} king post`, king === (gm.kingWidth > 0), `PDF ${gm.kingWidth > 0 ? 'yes' : 'no'}`);
    if (king) {
      check(`${tag} king width`, near(gm.kingWidth, num(row['King width (in)'])), `PDF ${gm.kingWidth}`);
      check(`${tag} king height`, near(gm.kingHeight, num(row['King height (in)']), 0.5), `PDF ${gm.kingHeight}`);
    }
    check(`${tag} carried species`, speciesOf(getCarriedSpecies(c)) === String(row['Carried: species']).toUpperCase(), `PDF ${getCarriedSpecies(c)}`);
    check(`${tag} carried bottom chord width`, near(cm.width, num(row['Carried: bottom chord width (in)'])), `PDF ${cm.width}`);
    check(`${tag} carried plies`, cm.ply === num(row['Carried: plies']), `PDF ${cm.ply}`);
    check(`${tag} heel`, near(cm.depth, num(row['Heel height (in)'])), `PDF ${cm.depth}`);
    check(`${tag} download`, near(cm.loads.load, num(row['Download (lb)']), 1), `PDF ${cm.loads.load}`);
    check(`${tag} uplift`, near(cm.loads.uplift, num(row['Uplift (lb)']), 1), `PDF ${cm.loads.uplift}`);
    check(`${tag} skew`, near(cm.angle.skewAngle, num(row['Skew (deg)']), 0.5), `PDF ${cm.angle.skewAngle}`);
    check(`${tag} slope`, near(cm.angle.slopeAngle, num(row['Slope (deg)']), 0.5), `PDF ${cm.angle.slopeAngle}`);
    // uplift duration, when the tester named one ("Short Term (1.15)" / "Standard Term (1.00)")
    const note = String(row['Uplift duration'] ?? row['Uplift load case / note'] ?? '');
    const factor = note.match(/\((\d\.\d\d)\)/)?.[1];
    if (factor) check(`${tag} uplift duration`, p.designInformations.upliftLoadDurationType === Math.round(Number(factor) * 100), `PDF ${p.designInformations.upliftLoadDurationType}, tester ${note}`);
    }
  }
  console.log(`\nResult (${region.toUpperCase()}): ${pass} fields matched, ${fail} mismatched`);
}

main();
