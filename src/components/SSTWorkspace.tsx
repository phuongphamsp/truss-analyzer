/**
 * SST Hanger Selector — Full Workspace View
 *
 * Replaces the diagrams+sidebar workspace when user clicks "Find Hanger"
 * on a carried truss. Layout mirrors the SST site:
 *   Left column  = INPUT (5 collapsible sections)
 *   Right column = OUTPUT (token, action button, results table)
 */

import React, { useState, useCallback } from 'react';
import type { GirderGroup, CarriedTruss } from '../types';
import type { SSTHangerResult, SSTAPIResponse, SSTPayload } from '../lib/sst-types';
import { buildSSTPayload } from '../lib/sst-mapper';
import {
  getSSTToken,
  setSSTToken,
  clearSSTToken,
  hasSSTToken,
  submitToSST,
} from '../lib/sst-api';
import { cn } from '../lib/utils';
import { Search, Key, AlertCircle, CheckCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Enum label maps
// ---------------------------------------------------------------------------

const MATERIAL_LABELS: Record<number, string> = {
  1: 'Solid Sawn', 2: 'Glulam', 3: 'LSL', 4: 'LVL',
  5: 'Truss', 6: 'I-Joist', 7: 'Floor Truss', 10: 'Concrete', 11: 'Steel',
};
const STYLE_LABELS: Record<number, string> = {
  0: 'All Types', 1: 'Face Mount', 2: 'Top Flange', 3: 'Concealed Flange',
};
const FASTENER_LABELS: Record<number, string> = {
  0: 'All', 1: 'Nails', 2: 'Bolts', 3: 'Screws',
};
const ANSITPI_LABELS: Record<number, string> = {
  0: 'Off', 3: 'On (End Connection)', 6: 'On (Interior Connection)',
};
const CODE_LABELS: Record<number, string> = {
  0: 'None', 10: 'IBC 2018', 20: 'IRC 2018', 30: 'IBC 2021', 40: 'IRC 2021',
};
const DL_DUR_LABELS: Record<number, string> = {
  90: 'Dead (90)', 100: 'Floor (100)', 115: 'Snow (115)', 125: 'Roof (125)', 160: 'Quake/Wind (160)',
};
const UL_DUR_LABELS: Record<number, string> = {
  100: 'Normal (100)', 160: 'Quake/Wind (160)',
};
const SKEW_LABELS: Record<number, string> = { 0: 'None', 1: 'Left', 2: 'Right' };
const SLOPE_LABELS: Record<number, string> = { 0: 'None', 1: 'Up', 2: 'Down' };

function widthToNominal(w: number): string {
  if (w <= 1.5) return '2x (1 1/2")';
  if (w <= 2.5) return '3x (2 1/2")';
  if (w <= 3.5) return '4x (3 1/2")';
  if (w <= 5.5) return '6x (5 1/2")';
  return `${w}"`;
}

function depthToNominal(d: number): string {
  if (d <= 3.5) return '4 (3 1/2")';
  if (d <= 4.5) return '5 (4 1/2")';
  if (d <= 5.5) return '6 (5 1/2")';
  if (d <= 7.25) return '8 (7 1/4")';
  if (d <= 9.25) return '10 (9 1/4")';
  if (d <= 11.25) return '12 (11 1/4")';
  return `${d}"`;
}

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  expanded,
  onToggle,
  color = 'text-zinc-300',
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  color?: string;
}) {
  return (
    <div
      className="flex items-center justify-between cursor-pointer py-2 px-3 bg-[#1A1B26] hover:bg-[#1E1F2E] transition-colors border-b border-[#1E293B]/60"
      onClick={onToggle}
    >
      <span className={cn('text-[10px] uppercase font-bold tracking-wider', color)}>
        {title}
      </span>
      <span className="text-[10px] font-mono text-zinc-500">
        {expanded ? '\u25BC' : '\u25B6'}
      </span>
    </div>
  );
}

function Row({ label, value, highlight, source }: {
  label: string;
  value: string;
  highlight?: 'down' | 'up';
  source?: string;
}) {
  const valueColor = highlight === 'down'
    ? 'text-[#FFB74D]'
    : highlight === 'up'
      ? 'text-sky-400'
      : 'text-zinc-200';
  return (
    <div className="flex justify-between items-start py-1 px-3 border-b border-[#1E293B]/30">
      <span className="text-zinc-400 text-[10px]">{label}</span>
      <div className="text-right">
        <span className={cn('font-bold text-[10px]', valueColor)}>{value}</span>
        {source && (
          <div className="text-[8px] text-zinc-600 leading-tight">{source}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INPUT Panel (left column)
// ---------------------------------------------------------------------------

function InputPanel({ payload, girderLabel, carriedLabel }: {
  payload: SSTPayload;
  girderLabel: string;
  carriedLabel: string;
}) {
  const [sections, setSections] = useState({
    connection: true,
    job: true,
    carrying: true,
    carried: true,
    hanger: true,
    mapping: false,
  });

  const toggle = (key: keyof typeof sections) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  const cm = payload.carryingMember;
  const cd = payload.carriedMembers[0];
  const isTruss = payload.flushOption === 'BOTTOM';

  return (
    <div className="flex flex-col h-full">
      {/* INPUT header */}
      <div className="px-3 py-2 bg-[#12131C] border-b border-[#1E293B] shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Input</span>
          <span className="text-[9px] font-mono text-zinc-500">{carriedLabel} on {girderLabel}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 1. CONNECTION TYPE */}
        <SectionHeader
          title="Connection Type"
          expanded={sections.connection}
          onToggle={() => toggle('connection')}
          color="text-amber-400"
        />
        {sections.connection && (
          <div className="p-3 flex items-center space-x-3">
            <div className={cn(
              'flex flex-col items-center px-3 py-2 rounded border text-[9px] min-w-[80px]',
              !isTruss
                ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                : 'border-[#1E293B]/40 text-zinc-600'
            )}>
              <span className="font-bold">Joist</span>
              <span className="text-[8px]">(Flush Top)</span>
            </div>
            <div className={cn(
              'flex flex-col items-center px-3 py-2 rounded border text-[9px] min-w-[80px]',
              isTruss
                ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                : 'border-[#1E293B]/40 text-zinc-600'
            )}>
              <span className="font-bold">Truss</span>
              <span className="text-[8px]">(Flush Bottom)</span>
              {isTruss && <CheckCircle className="w-3 h-3 text-amber-400 mt-0.5" />}
            </div>
            <div className="flex flex-col items-center px-3 py-2 rounded border border-[#1E293B]/40 text-zinc-600 text-[9px] min-w-[80px]">
              <span className="font-bold">Multi-Truss</span>
              <span className="text-[8px]">(Flush Bottom)</span>
            </div>
          </div>
        )}

        {/* 2. JOB SETTINGS */}
        <SectionHeader
          title="Job Settings"
          expanded={sections.job}
          onToggle={() => toggle('job')}
          color="text-indigo-400"
        />
        {sections.job && (
          <div className="py-1">
            <Row label="Hanger Type" value={STYLE_LABELS[payload.style] ?? String(payload.style)} source="default" />
            <Row label="Fastener Type" value={FASTENER_LABELS[payload.fastenerType] ?? String(payload.fastenerType)} source="default" />
            <Row label="Building Code" value={CODE_LABELS[payload.buildingCode] ?? String(payload.buildingCode)} source="default" />
            <Row label="Download Duration" value={DL_DUR_LABELS[payload.designInformations.downloadDurationType] ?? String(payload.designInformations.downloadDurationType)} source="mapped from truss type" />
            <Row label="Uplift Duration" value={UL_DUR_LABELS[payload.designInformations.upliftLoadDurationType] ?? String(payload.designInformations.upliftLoadDurationType)} source="default" />
            {isTruss && (
              <Row label="ANSI/TPI" value={ANSITPI_LABELS[payload.ansitpi] ?? String(payload.ansitpi)} source="truss connection" />
            )}
          </div>
        )}

        {/* 3. CARRYING MEMBER */}
        <SectionHeader
          title={isTruss ? 'Girder (Carrying Member)' : 'Header (Carrying Member)'}
          expanded={sections.carrying}
          onToggle={() => toggle('carrying')}
          color="text-emerald-400"
        />
        {sections.carrying && (
          <div className="py-1">
            <Row label="Material" value={MATERIAL_LABELS[cm.material] ?? String(cm.material)} source="girder = Truss type" />
            <Row label="Width" value={widthToNominal(cm.width)} source={`actual: ${cm.width}"`} />
            <Row label="Depth" value={depthToNominal(cm.depth)} source={`actual: ${cm.depth}"`} />
            <Row label="Ply" value={String(cm.ply)} source="default: 1" />
            {isTruss && (
              <>
                <Row label="King Width" value={cm.kingWidth > 0 ? `${cm.kingWidth}"` : 'N/A'} source="not in TRE" />
                <Row label="Total Height" value={`${cm.kingHeight}"`} source="from girder heel height" />
              </>
            )}
          </div>
        )}

        {/* 4. CARRIED MEMBER */}
        <SectionHeader
          title={isTruss ? 'Truss (Carried Member)' : 'Joist (Carried Member)'}
          expanded={sections.carried}
          onToggle={() => toggle('carried')}
          color="text-amber-400"
        />
        {sections.carried && (
          <div className="py-1">
            <Row label="Material" value={MATERIAL_LABELS[cd.material] ?? String(cd.material)} source="carried = Truss type" />
            <Row label="Width" value={widthToNominal(cd.width)} source={`actual: ${cd.width}"`} />
            {isTruss ? (
              <Row label="Heel Height" value={`${cd.depth}"`} source="from TRE heel at bearing side" />
            ) : (
              <Row label="Depth" value={depthToNominal(cd.depth)} source={`actual: ${cd.depth}"`} />
            )}
            <Row label="Ply" value={String(cd.ply)} source="default: 1" />
            <Row label="Download Load" value={`${cd.loads.load.toLocaleString()} lb`} highlight="down" source="from enrichCarriedTrusses()" />
            <Row label="Uplift Load" value={`${cd.loads.uplift.toLocaleString()} lb`} highlight="up" source="from enrichCarriedTrusses()" />
          </div>
        )}

        {/* 5. HANGER OPTIONS */}
        <SectionHeader
          title="Hanger Options"
          expanded={sections.hanger}
          onToggle={() => toggle('hanger')}
          color="text-zinc-400"
        />
        {sections.hanger && (
          <div className="py-1">
            <Row label="Skew Angle" value={`${cd.angle.skewAngle}\u00B0`} source={cd.angle.skewType === 0 ? 'no skew data in TRE' : SKEW_LABELS[cd.angle.skewType]} />
            <Row label="Skew Direction" value={SKEW_LABELS[cd.angle.skewType] ?? 'None'} />
            <Row label="Slope Angle" value={`${cd.angle.slopeAngle}\u00B0`} source={cd.angle.slopeType === 0 ? 'bottom chord is level' : SLOPE_LABELS[cd.angle.slopeType]} />
            <Row label="Slope Direction" value={SLOPE_LABELS[cd.angle.slopeType] ?? 'None'} />
          </div>
        )}

        {/* 6. DATA MAPPING REFERENCE */}
        <SectionHeader
          title="Data Mapping Reference"
          expanded={sections.mapping}
          onToggle={() => toggle('mapping')}
          color="text-cyan-400"
        />
        {sections.mapping && (
          <div className="py-2 px-3 space-y-3 text-[9px] font-mono">

            {/* Overview */}
            <div className="bg-[#0A0B10] border border-[#1E293B]/40 rounded p-2.5 space-y-1.5">
              <div className="text-[8px] uppercase text-cyan-400 font-bold tracking-wider">Overview</div>
              <p className="text-zinc-400 leading-relaxed">
                Data is extracted from <span className="text-zinc-200">IFC</span> (geometry, spatial layout) and <span className="text-zinc-200">TRE</span> (engineering properties, reactions) files,
                then mapped to SST Hanger Selector API input parameters.
              </p>
              <p className="text-zinc-400 leading-relaxed">
                Flow: <span className="text-emerald-400">IFC parse</span> &rarr; <span className="text-emerald-400">TRE parse</span> &rarr; <span className="text-amber-400">enrichCarriedTrusses()</span> &rarr; <span className="text-cyan-400">buildSSTPayload()</span> &rarr; <span className="text-indigo-400">SST API</span>
              </p>
            </div>

            {/* Mapping table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[8px] uppercase text-zinc-500 border-b border-[#1E293B]">
                    <th className="py-1.5 pr-2">SST Parameter</th>
                    <th className="py-1.5 pr-2">Source</th>
                    <th className="py-1.5">Mapping Logic</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-400">
                  {/* Connection Type */}
                  <MappingRow section="Connection Type" />
                  <MappingRow
                    param="flushOption"
                    source="Hardcoded"
                    logic="Always 'BOTTOM' (Truss/Flush Bottom) — girder-to-truss connections"
                  />

                  {/* Job Settings */}
                  <MappingRow section="Job Settings" />
                  <MappingRow
                    param="buildingCode"
                    source="Default"
                    logic="IRC 2018 (code 20) — residential building code"
                  />
                  <MappingRow
                    param="downloadDurationType"
                    source="Default"
                    logic="Roof (125) — standard for roof truss loading"
                  />
                  <MappingRow
                    param="upliftLoadDurationType"
                    source="Default"
                    logic="Wind/Quake (160) — conservative for uplift"
                  />
                  <MappingRow
                    param="ansitpi"
                    source="Default"
                    logic="Interior Connection (6) — carried truss bears on girder mid-span"
                  />
                  <MappingRow
                    param="style"
                    source="Default"
                    logic="All Types (0) — no filter on hanger style"
                  />

                  {/* Carrying Member */}
                  <MappingRow section="Carrying Member (Girder)" />
                  <MappingRow
                    param="material"
                    source="Hardcoded"
                    logic="Truss (5) — girder is a truss member"
                  />
                  <MappingRow
                    param="width"
                    source="TRE"
                    logic="treData.members[BottomChord].width — actual lumber width of girder bottom chord (e.g. 1.5&quot; for 2x)"
                    sourceTag="tre"
                  />
                  <MappingRow
                    param="depth"
                    source="TRE"
                    logic="treData.members[BottomChord].depth — actual lumber depth of girder bottom chord (e.g. 5.5&quot; for 2x6)"
                    sourceTag="tre"
                  />
                  <MappingRow
                    param="ply"
                    source="Default"
                    logic="1 — ply count not parsed from TRE files"
                  />
                  <MappingRow
                    param="kingHeight"
                    source="TRE"
                    logic="max(girder.treData.leftHeel, depth, 24.0) — overall girder height at connection, fallback 24&quot;"
                    sourceTag="tre"
                  />
                  <MappingRow
                    param="kingWidth"
                    source="N/A"
                    logic="0 — king post width not available in TRE data"
                  />

                  {/* Carried Member */}
                  <MappingRow section="Carried Member (Truss)" />
                  <MappingRow
                    param="material"
                    source="Hardcoded"
                    logic="Truss (5) — carried member is a truss"
                  />
                  <MappingRow
                    param="width"
                    source="TRE"
                    logic="carried.treData.members[BottomChord].width — actual lumber width (e.g. 1.5&quot; for 2x)"
                    sourceTag="tre"
                  />
                  <MappingRow
                    param="depth (heel)"
                    source="TRE"
                    logic="carried.treData.leftHeel or rightHeel based on bearingSide — heel height at the bearing point"
                    sourceTag="tre"
                  />
                  <MappingRow
                    param="ply"
                    source="Default"
                    logic="1 — ply count not parsed from TRE files"
                  />
                  <MappingRow
                    param="loads.load"
                    source="TRE + IFC"
                    logic="carried.downReaction — computed by enrichCarriedTrusses() from TRE maxReaction + IFC bearing side geometry"
                    sourceTag="both"
                  />
                  <MappingRow
                    param="loads.uplift"
                    source="TRE + IFC"
                    logic="abs(carried.upliftReaction) — computed from TRE uplift reactions + IFC bearing side"
                    sourceTag="both"
                  />

                  {/* Hanger Options */}
                  <MappingRow section="Hanger Options" />
                  <MappingRow
                    param="skewAngle"
                    source="N/A"
                    logic="0° — bearing skew angle not available in TRE/IFC data"
                  />
                  <MappingRow
                    param="slopeAngle"
                    source="N/A"
                    logic="0° — truss bottom chord assumed level at bearing"
                  />
                </tbody>
              </table>
            </div>

            {/* Data gaps */}
            <div className="bg-amber-950/20 border border-amber-500/20 rounded p-2.5 space-y-1">
              <div className="text-[8px] uppercase text-amber-400 font-bold tracking-wider">Known Data Gaps</div>
              <ul className="text-zinc-400 leading-relaxed space-y-0.5 list-disc list-inside">
                <li><span className="text-zinc-300">Ply count</span> — not parsed from TRE; defaults to 1</li>
                <li><span className="text-zinc-300">Skew angle</span> — bearing orientation not in TRE/IFC; defaults to 0°</li>
                <li><span className="text-zinc-300">King width</span> — king post width not in TRE; defaults to 0</li>
                <li><span className="text-zinc-300">Species</span> — available in TRE but not yet mapped to SST species codes</li>
                <li><span className="text-zinc-300">Lateral load</span> — not available in TRE/IFC data</li>
                <li><span className="text-zinc-300">Corrosion environment</span> — not available; assumes standard indoor</li>
              </ul>
            </div>

            {/* Source files */}
            <div className="bg-[#0A0B10] border border-[#1E293B]/40 rounded p-2.5 space-y-1">
              <div className="text-[8px] uppercase text-zinc-400 font-bold tracking-wider">Source Code References</div>
              <div className="text-zinc-500 leading-relaxed space-y-0.5">
                <div><span className="text-zinc-300">parser.ts</span> — enrichCarriedTrusses(): computes reactions, bearingSide from IFC+TRE</div>
                <div><span className="text-zinc-300">sst-mapper.ts</span> — buildSSTPayload(): maps GirderGroup+CarriedTruss to API payload</div>
                <div><span className="text-zinc-300">sst-types.ts</span> — API constants, enum values, TypeScript interfaces</div>
                <div><span className="text-zinc-300">sst-api.ts</span> — HTTP client, token management, response parsing</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Section divider row in mapping table */
function MappingRow({ section, param, source, logic, sourceTag }: {
  section?: string;
  param?: string;
  source?: string;
  logic?: string;
  sourceTag?: 'ifc' | 'tre' | 'both';
}) {
  if (section) {
    return (
      <tr>
        <td colSpan={3} className="pt-2.5 pb-1 text-[8px] uppercase font-bold text-zinc-300 tracking-wider border-b border-[#1E293B]/40">
          {section}
        </td>
      </tr>
    );
  }

  const sourceColor = sourceTag === 'ifc'
    ? 'text-emerald-400'
    : sourceTag === 'tre'
      ? 'text-amber-400'
      : sourceTag === 'both'
        ? 'text-cyan-400'
        : 'text-zinc-500';

  return (
    <tr className="border-b border-[#1E293B]/20 hover:bg-[#1E293B]/10">
      <td className="py-1 pr-2 text-zinc-200 font-bold whitespace-nowrap">{param}</td>
      <td className={cn('py-1 pr-2 whitespace-nowrap', sourceColor)}>{source}</td>
      <td className="py-1 text-zinc-500 leading-relaxed">{logic}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// OUTPUT Panel (right column)
// ---------------------------------------------------------------------------

function OutputPanel({
  payload,
  carriedLabel,
}: {
  payload: SSTPayload;
  carriedLabel: string;
}) {
  const [tokenReady, setTokenReady] = useState(hasSSTToken());
  const [tokenInput, setTokenInput] = useState(getSSTToken() ?? '');
  const [tokenExpanded, setTokenExpanded] = useState(!hasSSTToken());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SSTAPIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      setSSTToken(tokenInput.trim());
      setTokenReady(true);
      setTokenExpanded(false);
    }
  };

  const handleClearToken = () => {
    clearSSTToken();
    setTokenInput('');
    setTokenReady(false);
    setTokenExpanded(true);
  };

  const handleSubmit = useCallback(async () => {
    if (!tokenReady) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log('[SST] Payload for', carriedLabel, payload);
      const res = await submitToSST(payload);
      console.log('[SST] Response:', res);
      setResult(res);
      if (!res.success) setError(res.error ?? 'Unknown error');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [payload, carriedLabel, tokenReady]);

  return (
    <div className="flex flex-col h-full">
      {/* OUTPUT header */}
      <div className="px-4 py-2 bg-[#12131C] border-b border-[#1E293B] shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Output</span>
        {result?.success && (
          <span className="text-[9px] font-mono text-emerald-400">
            {result.hangers.length} hangers found
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Token Section */}
        <div className="border border-[#1E293B] bg-[#0F111A] rounded p-3 space-y-2">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setTokenExpanded(!tokenExpanded)}
          >
            <div className="flex items-center space-x-1.5">
              <Key className="w-3 h-3 text-zinc-400" />
              <span className="text-[9px] uppercase text-zinc-400 tracking-wider font-bold">
                API Token
              </span>
            </div>
            <span className={cn('text-[9px] font-mono', tokenReady ? 'text-emerald-400' : 'text-amber-400')}>
              {tokenReady ? 'Connected' : 'Not Set'}
            </span>
          </div>
          {tokenExpanded && (
            <div className="space-y-2">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => { setTokenInput(e.target.value); setTokenReady(false); }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                placeholder="Paste Bearer token from DevTools..."
                className="w-full bg-[#0A0B10] border border-[#1E293B] rounded px-2.5 py-1.5 text-[10px] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex space-x-2">
                <button
                  onClick={handleSaveToken}
                  disabled={!tokenInput.trim()}
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider',
                    tokenInput.trim() ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  )}
                >Save Token</button>
                {tokenReady && (
                  <button onClick={handleClearToken} className="px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[8px] text-zinc-500 leading-relaxed">
                Open <span className="text-zinc-400">app.strongtie.com/hs</span> &rarr; DevTools &rarr; Network &rarr; any XHR &rarr; copy Authorization header.
              </p>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={loading || !tokenReady}
          className={cn(
            'w-full py-2.5 rounded text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center space-x-2',
            loading || !tokenReady
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-amber-600 text-white hover:bg-amber-500'
          )}
        >
          <Search className="w-4 h-4" />
          <span>{loading ? 'Searching...' : `Find Hangers for ${carriedLabel}`}</span>
        </button>

        {/* Error */}
        {error && (
          <div className="flex items-start space-x-2 bg-red-950/50 border border-red-500/30 rounded p-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-red-400 font-mono leading-relaxed">{error}</span>
          </div>
        )}

        {/* Results Table */}
        {result?.success && result.hangers.length > 0 && (
          <div className="border border-[#1E293B] bg-[#0F111A] rounded overflow-hidden">
            <div className="px-3 py-2 bg-[#1A1B26] border-b border-[#1E293B]/60 flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Results</span>
              <span className="text-[9px] font-mono text-zinc-500">
                Showing {result.hangers.length} entries
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="text-[9px] uppercase text-zinc-500 border-b border-[#1E293B] bg-[#12131C]">
                    <th className="py-2 px-3">Model</th>
                    <th className="py-2 px-3 text-right">Download (lb)</th>
                    <th className="py-2 px-3 text-right">Uplift (lb)</th>
                    <th className="py-2 px-3 text-right">Width</th>
                    <th className="py-2 px-3 text-right">Height</th>
                    <th className="py-2 px-3 text-right">Bearing</th>
                  </tr>
                </thead>
                <tbody>
                  {result.hangers.map((h, i) => (
                    <tr
                      key={`${h.model}-${i}`}
                      className="border-b border-[#1E293B]/40 hover:bg-[#1E293B]/20 transition-colors"
                    >
                      <td className="py-2 px-3 font-bold text-zinc-200">{h.model}</td>
                      <td className="py-2 px-3 text-right text-[#FFB74D] font-bold">{h.downloadLoad.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-sky-400">{h.upliftLoad.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-zinc-400">{h.width > 0 ? `${h.width.toFixed(3)}"` : '\u2014'}</td>
                      <td className="py-2 px-3 text-right text-zinc-400">{h.height > 0 ? `${h.height.toFixed(3)}"` : '\u2014'}</td>
                      <td className="py-2 px-3 text-right text-zinc-400">{h.bearing > 0 ? `${h.bearing.toFixed(3)}"` : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result?.success && result.hangers.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-[11px] font-mono">
            No matching hangers found for this configuration.
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-12 text-zinc-600 text-[11px] font-mono">
            Click "Find Hangers" to search for compatible hanger models.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SSTWorkspace
// ---------------------------------------------------------------------------

interface SSTWorkspaceProps {
  group: GirderGroup;
  selectedCarried: CarriedTruss;
}

export function SSTWorkspace({ group, selectedCarried }: SSTWorkspaceProps) {
  const payload = buildSSTPayload(group, selectedCarried);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: INPUT */}
      <div className="w-[380px] border-r border-[#1E293B] bg-[#0F111A] flex flex-col shrink-0 overflow-hidden">
        <InputPanel
          payload={payload}
          girderLabel={group.girder.label}
          carriedLabel={selectedCarried.instance.label}
        />
      </div>

      {/* Right: OUTPUT */}
      <div className="flex-1 bg-[#0C0D14] flex flex-col overflow-hidden">
        <OutputPanel
          payload={payload}
          carriedLabel={selectedCarried.instance.label}
        />
      </div>
    </div>
  );
}
