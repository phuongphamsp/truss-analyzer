/**
 * SST Hanger Selector — Full Workspace View
 *
 * Replaces the diagrams+sidebar workspace when user clicks "Find Hanger"
 * on a carried truss. Layout mirrors the SST site:
 *   Left column  = INPUT (5 collapsible sections, editable Job Settings)
 *   Right column = OUTPUT (token, action button, results table + filter bar)
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { GirderGroup, CarriedTruss } from '../types';
import type { SSTHangerResult, SSTAPIResponse, SSTPayload } from '../lib/sst-types';
import { buildSSTPayload, computeAnsitpi } from '../lib/sst-mapper';
import {
  hasSSTToken,
  submitToSST,
} from '../lib/sst-api';
import { cn } from '../lib/utils';
import { Search, AlertCircle, CheckCircle, Maximize2, Columns, ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Job Settings overrides — user-editable fields lifted to SSTWorkspace
// ---------------------------------------------------------------------------

export interface JobOverrides {
  style: number;
  fastenerType: number;
  downloadDurationType: number;
  upliftLoadDurationType: number;
  ansitpi: number;
}

// ---------------------------------------------------------------------------
// Enum label maps
// ---------------------------------------------------------------------------

const MATERIAL_LABELS: Record<number, string> = {
  1: 'Solid Sawn', 2: 'Glulam', 3: 'LSL', 4: 'LVL',
  5: 'Truss', 6: 'I-Joist', 7: 'Floor Truss', 10: 'Concrete', 11: 'Steel',
};

/** Lumber Species labels keyed by SST material code (truss species variant) */
const SPECIES_LABELS: Record<number, string> = {
  5: 'DF — Douglas Fir',
  6: 'HF — Hem Fir',
  7: 'SP — Southern Pine',
  8: 'SPF — Spruce Pine Fir',
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

/** How a field's value was obtained — drives the badge color */
type SourceType = 'tre' | 'computed' | 'default' | 'unknown';

const SOURCE_META: Record<SourceType, { label: string; color: string }> = {
  tre:      { label: 'TRE/IFC',   color: 'text-emerald-500' },
  computed: { label: 'computed',  color: 'text-amber-400'   },
  default:  { label: 'default',   color: 'text-zinc-500'    },
  unknown:  { label: 'unknown',   color: 'text-rose-400'    },
};

function Row({ label, value, highlight, sourceType, sourceNote }: {
  label: string;
  value: string;
  highlight?: 'down' | 'up';
  sourceType?: SourceType;
  sourceNote?: string;
}) {
  const valueColor = highlight === 'down'
    ? 'text-[#FFB74D]'
    : highlight === 'up'
      ? 'text-sky-400'
      : 'text-zinc-200';
  const meta = sourceType ? SOURCE_META[sourceType] : null;
  return (
    <div className="flex justify-between items-start py-1 px-3 border-b border-[#1E293B]/30">
      <span className="text-zinc-400 text-[10px]">{label}</span>
      <div className="text-right">
        <span className={cn('font-bold text-[10px]', valueColor)}>{value}</span>
        {meta && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span className={cn('text-[7px] font-semibold uppercase tracking-wide', meta.color)}>
              [{meta.label}]
            </span>
            {sourceNote && (
              <span className="text-[7px] text-zinc-600 leading-tight">{sourceNote}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INPUT Panel (left column)
// ---------------------------------------------------------------------------

type ViewMode = 'split' | 'input-only' | 'output-only';

// ---------------------------------------------------------------------------
// Reusable select control for Job Settings
// ---------------------------------------------------------------------------

function SelectRow<T extends number>({
  label,
  value,
  options,
  onChange,
  sourceType,
  sourceNote,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  sourceType?: SourceType;
  sourceNote?: string;
}) {
  const meta = sourceType ? SOURCE_META[sourceType] : null;
  return (
    <div className="flex justify-between items-center py-1 px-3 border-b border-[#1E293B]/30 gap-2">
      <span className="text-zinc-400 text-[10px] shrink-0">{label}</span>
      <div className="flex flex-col items-end gap-0.5">
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value) as T)}
          className="bg-[#1A1B26] border border-[#2E3A4E] text-zinc-200 text-[10px] rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-cyan-500/60 hover:border-[#3E4A5E] transition-colors"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {meta && (
          <div className="flex items-center justify-end gap-1">
            <span className={cn('text-[7px] font-semibold uppercase tracking-wide', meta.color)}>
              [{meta.label}]
            </span>
            {sourceNote && (
              <span className="text-[7px] text-zinc-600 leading-tight">{sourceNote}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InputPanel({ payload, girderLabel, carriedLabel, viewMode, onViewChange, overrides, onOverridesChange, carried, group }: {
  payload: SSTPayload;
  girderLabel: string;
  carriedLabel: string;
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  overrides: JobOverrides;
  onOverridesChange: (o: JobOverrides) => void;
  carried: CarriedTruss;
  group: GirderGroup;
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

  // Resolve species string for display (from cuttingMembers → bottomChord spec → ifcBottomChord)
  const girderSpeciesStr =
    group.girder.treData?.cuttingMembers?.find(m => m.type === 'BottomChord')?.species
    ?? group.girder.treData?.bottomChord
    ?? group.girder.ifcBottomChord
    ?? null;
  const carriedSpeciesStr =
    carried.treData?.cuttingMembers?.find(m => m.type === 'BottomChord')?.species
    ?? carried.treData?.bottomChord
    ?? null;

  // ANSI/TPI 1 connection type — computed from 5d rule
  const ansitpiComputed = computeAnsitpi(group, carried);
  const hasAnsitpiData = (group.girder.treData?.span ?? 0) > 0;

  const set = <K extends keyof JobOverrides>(key: K, val: JobOverrides[K]) =>
    onOverridesChange({ ...overrides, [key]: val });

  const defaultOverrides: JobOverrides = {
    style: payload.style,
    fastenerType: payload.fastenerType,
    downloadDurationType: payload.designInformations.downloadDurationType,
    upliftLoadDurationType: payload.designInformations.upliftLoadDurationType,
    ansitpi: payload.ansitpi,
  };

  const isDirty = JSON.stringify(overrides) !== JSON.stringify(defaultOverrides);

  return (
    <div className="flex flex-col h-full">
      {/* INPUT header */}
      <div className="px-3 py-2 bg-[#12131C] border-b border-[#1E293B] shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Input</span>
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-mono text-zinc-500">{carriedLabel} on {girderLabel}</span>
            {isDirty && (
              <button
                onClick={() => onOverridesChange(defaultOverrides)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-amber-400 hover:text-amber-300 hover:bg-amber-900/20 transition-colors"
                title="Reset to defaults"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
            <button
              onClick={() => onViewChange(viewMode === 'input-only' ? 'split' : 'input-only')}
              className={cn(
                'p-1 rounded transition-colors',
                viewMode === 'input-only'
                  ? 'bg-cyan-600/30 text-cyan-400'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1E293B]/50'
              )}
              title={viewMode === 'input-only' ? 'Show split view' : 'Expand Input'}
            >
              {viewMode === 'input-only' ? <Columns className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 1. CONNECTION TYPE */}
        <SectionHeader
          title="Connection Type"
          expanded={sections.connection}
          onToggle={() => toggle('connection')}
          color="text-zinc-300"
        />
        {sections.connection && (
          <div className="p-3 flex items-center space-x-3">
            <div className={cn(
              'flex flex-col items-center px-3 py-2 rounded border text-[9px] min-w-[80px]',
              !isTruss
                ? 'border-cyan-500/50 bg-cyan-950/20 text-cyan-300'
                : 'border-[#1E293B]/40 text-zinc-600'
            )}>
              <span className="font-bold">Joist</span>
              <span className="text-[8px]">(Flush Top)</span>
            </div>
            <div className={cn(
              'flex flex-col items-center px-3 py-2 rounded border text-[9px] min-w-[80px]',
              isTruss
                ? 'border-cyan-500/50 bg-cyan-950/20 text-cyan-300'
                : 'border-[#1E293B]/40 text-zinc-600'
            )}>
              <span className="font-bold">Truss</span>
              <span className="text-[8px]">(Flush Bottom)</span>
              {isTruss && <CheckCircle className="w-3 h-3 text-cyan-400 mt-0.5" />}
            </div>
            <div className="flex flex-col items-center px-3 py-2 rounded border border-[#1E293B]/40 text-zinc-600 text-[9px] min-w-[80px]">
              <span className="font-bold">Multi-Truss</span>
              <span className="text-[8px]">(Flush Bottom)</span>
            </div>
          </div>
        )}

        {/* 2. JOB SETTINGS — editable */}
        <SectionHeader
          title="Job Settings"
          expanded={sections.job}
          onToggle={() => toggle('job')}
          color={isDirty ? 'text-amber-400' : 'text-zinc-300'}
        />
        {sections.job && (
          <div className="py-1">
            <SelectRow
              label="Hanger Type"
              value={overrides.style}
              onChange={(v) => set('style', v)}
              sourceType="default"
              sourceNote="filter by mount type"
              options={[
                { value: 0, label: 'All Types' },
                { value: 1, label: 'Face Mount' },
                { value: 2, label: 'Top Flange' },
                { value: 3, label: 'Concealed Flange' },
              ]}
            />
            <SelectRow
              label="Fastener Type"
              value={overrides.fastenerType}
              onChange={(v) => set('fastenerType', v)}
              sourceType="default"
              sourceNote="filter by fastener"
              options={[
                { value: 0, label: 'All' },
                { value: 1, label: 'Nails' },
                { value: 2, label: 'Bolts' },
                { value: 3, label: 'Screws' },
              ]}
            />
            <Row label="Building Code" value={CODE_LABELS[payload.buildingCode] ?? String(payload.buildingCode)} sourceType="default" sourceNote="IRC 2018" />
            <SelectRow
              label="Download Duration"
              value={overrides.downloadDurationType}
              onChange={(v) => set('downloadDurationType', v)}
              sourceType={carried.downDolFactor != null ? 'computed' : 'default'}
              sourceNote={carried.downDolFactor != null
                ? `DOL ${carried.downDolFactor.toFixed(2)} from downReaction LC`
                : 'load duration factor'}
              options={[
                { value: 90, label: 'Dead (90)' },
                { value: 100, label: 'Floor (100)' },
                { value: 115, label: 'Snow (115)' },
                { value: 125, label: 'Roof (125)' },
                { value: 160, label: 'Wind/Quake (160)' },
              ]}
            />
            <SelectRow
              label="Uplift Duration"
              value={overrides.upliftLoadDurationType}
              onChange={(v) => set('upliftLoadDurationType', v)}
              sourceType={carried.upliftDolFactor != null ? 'computed' : 'default'}
              sourceNote={carried.upliftDolFactor != null
                ? `DOL ${carried.upliftDolFactor.toFixed(2)} from upliftReaction LC`
                : 'uplift duration factor'}
              options={[
                { value: 100, label: 'Normal (100)' },
                { value: 160, label: 'Wind/Quake (160)' },
              ]}
            />
            {isTruss && (
              <SelectRow
                label="ANSI/TPI 1 Evaluation"
                value={overrides.ansitpi}
                onChange={(v) => set('ansitpi', v)}
                sourceType={hasAnsitpiData ? 'computed' : 'default'}
                sourceNote={hasAnsitpiData
                  ? `${ansitpiComputed.isEndConnection ? 'End' : 'Interior'}: dist=${ansitpiComputed.distFromNearestBearing.toFixed(2)}" vs 5d=${ansitpiComputed.threshold.toFixed(2)}" (d=${ansitpiComputed.girderBCDepth}")`
                  : 'no TRE span data'}
                options={[
                  { value: 0, label: 'Off' },
                  { value: 3, label: 'On (End Connection)' },
                  { value: 6, label: 'On (Interior Connection)' },
                ]}
              />
            )}
            <Row label="Job ID" value={`${carriedLabel} on ${girderLabel}`} sourceType="tre" sourceNote="carried + girder label" />
          </div>
        )}

        {/* 3. CARRYING MEMBER */}
        <SectionHeader
          title={isTruss ? 'Girder (Carrying Member)' : 'Header (Carrying Member)'}
          expanded={sections.carrying}
          onToggle={() => toggle('carrying')}
          color="text-zinc-300"
        />
        {sections.carrying && (
          <div className="py-1">
            <Row label="Type" value={MATERIAL_LABELS[cm.material] ?? String(cm.material)} sourceType="default" sourceNote="girder = Truss type" />
            <Row
              label="Lumber Species"
              value={SPECIES_LABELS[cm.material] ?? String(cm.material)}
              sourceType={girderSpeciesStr ? 'tre' : 'default'}
              sourceNote={girderSpeciesStr ? `from TRE: "${girderSpeciesStr}"` : 'default: DF'}
            />
            <Row label="Bottom Chord Width" value={widthToNominal(cm.width)} sourceType="tre" sourceNote={`actual: ${cm.width}"`} />
            <Row label="Bottom Chord Height" value={depthToNominal(cm.depth)} sourceType="tre" sourceNote={`actual: ${cm.depth}"`} />
            <Row
              label="Number of Plies"
              value={String(cm.ply)}
              sourceType={group.girder.treData?.ply != null ? 'tre' : 'default'}
              sourceNote={group.girder.treData?.ply != null
                ? `Ply=${group.girder.treData.ply} from [ADDITIONAL TRUSS INFO]`
                : 'not in TRE'}
            />
            {isTruss && (
              <>
                <Row label="Vertical Width (King Post)" value={cm.kingWidth > 0 ? `${cm.kingWidth}"` : 'N/A'} sourceType="computed" sourceNote={cm.kingWidth > 0 ? 'vertical web at connection point' : 'no vertical web detected'} />
                <Row label="Total Height" value={`${cm.kingHeight}"`} sourceType="computed" sourceNote={cm.kingWidth > 0 ? 'vertical web segment height' : 'from girder heel height'} />
              </>
            )}
            <Row label="Member ID" value={girderLabel} sourceType="tre" sourceNote="girder label" />
          </div>
        )}

        {/* 4. CARRIED MEMBER */}
        <SectionHeader
          title={isTruss ? 'Truss (Carried Member)' : 'Joist (Carried Member)'}
          expanded={sections.carried}
          onToggle={() => toggle('carried')}
          color="text-zinc-300"
        />
        {sections.carried && (
          <div className="py-1">
            <Row label="Member Type" value={MATERIAL_LABELS[cd.material] ?? String(cd.material)} sourceType="default" sourceNote="carried = Truss type" />
            <Row
              label="Lumber Species"
              value={SPECIES_LABELS[cd.material] ?? String(cd.material)}
              sourceType={carriedSpeciesStr ? 'tre' : 'default'}
              sourceNote={carriedSpeciesStr ? `from TRE: "${carriedSpeciesStr}"` : 'default: DF'}
            />
            <Row label="Bottom Chord Width" value={widthToNominal(cd.width)} sourceType="tre" sourceNote={`actual: ${cd.width}"`} />
            {isTruss ? (
              <Row label="Heel Height" value={`${cd.depth}"`} sourceType="tre" sourceNote="TRE heel at bearing side" />
            ) : (
              <Row label="Bottom Chord Height" value={depthToNominal(cd.depth)} sourceType="tre" sourceNote={`actual: ${cd.depth}"`} />
            )}
            <Row
              label="Number of Plies"
              value={String(cd.ply)}
              sourceType={carried.treData?.ply != null ? 'tre' : 'default'}
              sourceNote={carried.treData?.ply != null
                ? `Ply=${carried.treData.ply} from [ADDITIONAL TRUSS INFO]`
                : 'not in TRE'}
            />
            <Row label="Member ID" value={carriedLabel} sourceType="tre" sourceNote="carried label" />
            <Row label="Download (ASD)" value={`${cd.loads.load.toLocaleString()} lb`} highlight="down" sourceType="computed" sourceNote="from reaction analysis" />
            <Row label="Uplift (ASD)" value={`${cd.loads.uplift.toLocaleString()} lb`} highlight="up" sourceType="computed" sourceNote="from reaction analysis" />
          </div>
        )}

        {/* 5. HANGER OPTIONS */}
        <SectionHeader
          title="Hanger Options"
          expanded={sections.hanger}
          onToggle={() => toggle('hanger')}
          color="text-zinc-300"
        />
        {sections.hanger && (
          <div className="py-1">
            <Row
              label="Skew (Degrees)"
              value={`${cd.angle.skewAngle}°`}
              sourceType={carried.hangerAngle != null ? 'computed' : 'unknown'}
              sourceNote={carried.hangerAngle != null
                ? `LG*T field[14]=${carried.hangerAngle}° → skew=${cd.angle.skewAngle}°`
                : 'not available in TRE/IFC'}
            />
            <Row label="Slope (Degrees)" value={`${cd.angle.slopeAngle}\u00B0`} sourceType="unknown" sourceNote="not available in TRE/IFC" />
            <Row label="Top Flange Bend (Degrees)" value="0°" sourceType="unknown" sourceNote="not available in TRE/IFC" />
            <Row label="Top Flange Slope (Degrees)" value="0°" sourceType="unknown" sourceNote="not available in TRE/IFC" />
          </div>
        )}

        {/* 6. DATA MAPPING REFERENCE */}
        <SectionHeader
          title="Data Mapping Reference"
          expanded={sections.mapping}
          onToggle={() => toggle('mapping')}
          color="text-zinc-300"
        />
        {sections.mapping && (
          <div className="py-2 px-3 space-y-3 text-[9px] font-mono">

            {/* Data Flow */}
            <div className="bg-[#0A0B10] border border-[#1E293B]/40 rounded p-2.5 space-y-2">
              <div className="text-[8px] uppercase text-zinc-400 font-bold tracking-wider mb-1">Data Flow</div>
              <div className="flex items-center gap-1 flex-wrap text-[9px]">
                {(['TRE file', '→', 'parser.ts', '→', 'enrichCarriedTrusses()', '→', 'buildSSTPayload()', '→', 'SST API'] as string[]).map((s, i) =>
                  s === '→'
                    ? <span key={i} className="text-zinc-600">→</span>
                    : <span key={i} className="bg-[#1E293B]/60 text-zinc-300 px-1.5 py-0.5 rounded">{s}</span>
                )}
              </div>
              <div className="text-zinc-500 leading-relaxed pt-0.5">
                Each field below shows exactly which TRE section/field it reads from, so engineers can cross-check values directly in the source file.
              </div>
            </div>

            {/* Bearing Side Detection */}
            <div className="bg-[#0A0B10] border border-amber-900/30 rounded p-2.5 space-y-1.5">
              <div className="text-[8px] uppercase text-amber-500 font-bold tracking-wider">Bearing Side Detection (Critical)</div>
              <div className="space-y-1 text-zinc-400 leading-relaxed">
                <div><span className="text-zinc-200">Step 1 — Girder TRE</span> · Section <span className="text-amber-400">[Hanger Loading Info.]</span> · Line <span className="text-amber-400">LG{'{n}'}T=...</span> · Field <span className="text-amber-400">parts[16]</span> = bearing coordinate on carried truss (inches)</div>
                <div><span className="text-zinc-200">Step 2 — Carried TRE</span> · Section <span className="text-amber-400">REACTION INFO</span> · Header line <span className="text-amber-400">2 -1 -1 -1 -1 &lt;bearingA&gt; &lt;bearingB&gt;</span></div>
                <div><span className="text-zinc-200">Step 3 — Match</span> · <span className="text-amber-400">bearingA</span> (smaller, x≈0) = <span className="text-green-400">LEFT end</span> · <span className="text-amber-400">bearingB</span> (larger, x≈span) = <span className="text-green-400">RIGHT end</span> · Tolerance ±4.1"</div>
                <div><span className="text-zinc-200">Fallback</span> · If no match → IFC bounding box geometry used to determine bearing side</div>
              </div>
            </div>

            {/* Field-by-field mapping */}
            <div className="space-y-2">

              {/* JOB SETTINGS */}
              <div className="text-[8px] uppercase text-zinc-300 font-bold tracking-wider border-b border-[#1E293B]/60 pb-0.5">Job Settings</div>
              <div className="space-y-1">
                <MappingRow2 label="Job ID" badge="TRE" badgeColor="green" treSection="[Hanger Loading Info.]" treField={`LG{n}T= parts[4] (carried label) + girder label`} note="e.g. T07 on T04" />
                <MappingRow2 label="Building Code" badge="Default" badgeColor="gray" note="IRC 2018" />
                <MappingRow2 label="Duration of Load" badge="Default" badgeColor="gray" note="Roof = 1.25 (download) · Wind/Quake = 1.60 (uplift)" />
                <MappingRow2 label="ANSI/TPI 1 Evaluation" badge="Computed" badgeColor="amber" treSection="[Hanger Loading Info.] + MEMBER INFO" treField="LG*T field[2]=xInches vs 5×BC_depth from nearest bearing" note="End (3) if dist &lt; 5d · Interior (6) if dist ≥ 5d · fallback: Interior" />
                <MappingRow2 label="Hanger Type" badge="Default" badgeColor="gray" note="All Types (0) — no filter" />
              </div>

              {/* CARRYING MEMBER */}
              <div className="text-[8px] uppercase text-zinc-300 font-bold tracking-wider border-b border-[#1E293B]/60 pb-0.5 pt-1">Carrying Member (Girder)</div>
              <div className="space-y-1">
                <MappingRow2 label="Member ID" badge="TRE" badgeColor="green" treSection="[Hanger Loading Info.]" treField="LG{n}T= parts[4] → girder label" note="e.g. T07" />
                <MappingRow2 label="Type" badge="Default" badgeColor="gray" note="Truss (5)" />
                <MappingRow2 label="Lumber Species" badge="TRE" badgeColor="green" treSection="[ADDITIONAL CUTTING INFO]" treField="BottomChord → species token (DF/HF/SP/SPF) → material code 5/6/7/8" note="fallback: bottomChord spec string → default DF (5)" />
                <MappingRow2 label="Bottom Chord Width" badge="TRE" badgeColor="green" treSection="MEMBER INFO" treField="BottomChord member → width (inches)" note="e.g. 1.5&quot; for 2x lumber" />
                <MappingRow2 label="Bottom Chord Height" badge="TRE" badgeColor="green" treSection="MEMBER INFO" treField="BottomChord member → depth (inches)" note="e.g. 5.5&quot; for 2x6" />
                <MappingRow2 label="Number of Plies" badge="Default" badgeColor="gray" note="1 — not available in TRE" />
                <MappingRow2 label="Total Height (King)" badge="Computed" badgeColor="amber" note="vertical web height if king post found, otherwise BC depth — overall girder height at connection point" />
                <MappingRow2 label="Vertical Width (King Post)" badge="Computed" badgeColor="amber" note="Scans Web members for vertical segment at connection X ±2&quot; · width of that web member" />
              </div>

              {/* CARRIED MEMBER */}
              <div className="text-[8px] uppercase text-zinc-300 font-bold tracking-wider border-b border-[#1E293B]/60 pb-0.5 pt-1">Carried Member (Truss)</div>
              <div className="space-y-1">
                <MappingRow2 label="Member ID" badge="TRE" badgeColor="green" treSection="[Hanger Loading Info.]" treField="LG{n}T= parts[4] → carried label" note="e.g. T02" />
                <MappingRow2 label="Type" badge="Default" badgeColor="gray" note="Truss (5)" />
                <MappingRow2 label="Lumber Species" badge="TRE" badgeColor="green" treSection="[ADDITIONAL CUTTING INFO]" treField="BottomChord → species token (DF/HF/SP/SPF) → material code 5/6/7/8" note="fallback: bottomChord spec string → default DF (5)" />
                <MappingRow2 label="Bottom Chord Width" badge="TRE" badgeColor="green" treSection="MEMBER INFO" treField="BottomChord member → width (inches)" note="e.g. 1.5&quot; for 2x lumber" />
                <MappingRow2 label="Heel Height" badge="TRE" badgeColor="green"
                  treSection="[TRUSS DETAILS]"
                  treField="Left Heel Height= or Right Heel Height= (chosen by bearing side)"
                  note="bearingSide=left → Left Heel Height · bearingSide=right → Right Heel Height"
                />
                <MappingRow2 label="Number of Plies" badge="Default" badgeColor="gray" note="1 — not available in TRE" />
                <MappingRow2 label="Download (ASD)" badge="Computed" badgeColor="amber"
                  treSection="REACTION INFO"
                  treField="max(col[1]) where col[6]=-1 (governing) and col[3] matches bearing coordinate"
                  note="max downward reaction across all load cases at the bearing end"
                />
                <MappingRow2 label="Uplift (ASD)" badge="Computed" badgeColor="amber"
                  treSection="REACTION INFO"
                  treField="min(col[1]) where col[6]=-1 (governing) and col[3] matches bearing coordinate"
                  note="min (most negative) uplift reaction across all load cases"
                />
              </div>

              {/* HANGER OPTIONS */}
              <div className="text-[8px] uppercase text-zinc-300 font-bold tracking-wider border-b border-[#1E293B]/60 pb-0.5 pt-1">Hanger Options</div>
              <div className="space-y-1">
                <MappingRow2 label="Skew (Degrees)" badge="N/A" badgeColor="red" note="Not available in TRE/IFC — defaults to 0°" />
                <MappingRow2 label="Slope (Degrees)" badge="N/A" badgeColor="red" note="Not available in TRE/IFC — defaults to 0°" />
                <MappingRow2 label="Top Flange Bend (Degrees)" badge="N/A" badgeColor="red" note="Not available in TRE/IFC — defaults to 0°" />
                <MappingRow2 label="Top Flange Slope (Degrees)" badge="N/A" badgeColor="red" note="Not available in TRE/IFC — defaults to 0°" />
              </div>
            </div>

            {/* Known gaps */}
            <div className="bg-[#0A0B10] border border-[#1E293B]/40 rounded p-2.5 space-y-1">
              <div className="text-[8px] uppercase text-zinc-400 font-bold tracking-wider">Known Data Gaps</div>
              <ul className="text-zinc-500 leading-relaxed space-y-0.5 list-disc list-inside">
                <li><span className="text-zinc-300">Ply count</span> — not in TRE; defaults to 1</li>
                <li><span className="text-zinc-300">Skew / Slope / Top Flange angles</span> — not in TRE/IFC; all default to 0°</li>
                <li><span className="text-zinc-300">Lateral load</span> — not available in TRE/IFC</li>
              </ul>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

/** Legacy mapping row — kept for compatibility */
function MappingRow({ section, param, source, logic, sourceTag }: {
  section?: string; param?: string; source?: string; logic?: string; sourceTag?: 'ifc' | 'tre' | 'both';
}) {
  if (section) return <tr><td colSpan={3} className="pt-2.5 pb-1 text-[8px] uppercase font-bold text-zinc-300 tracking-wider border-b border-[#1E293B]/40">{section}</td></tr>;
  return (
    <tr className="border-b border-[#1E293B]/20 hover:bg-[#1E293B]/10">
      <td className="py-1 pr-2 text-zinc-200 font-bold whitespace-nowrap">{param}</td>
      <td className="py-1 pr-2 text-zinc-300 whitespace-nowrap">{source}</td>
      <td className="py-1 text-zinc-500 leading-relaxed">{logic}</td>
    </tr>
  );
}

/** Engineering-friendly mapping row */
function MappingRow2({ label, badge, badgeColor, treSection, treField, note }: {
  label: string;
  badge: string;
  badgeColor: 'green' | 'amber' | 'gray' | 'red';
  treSection?: string;
  treField?: string;
  note?: string;
}) {
  const badgeCls = {
    green: 'bg-green-900/40 text-green-400 border border-green-800/40',
    amber: 'bg-amber-900/40 text-amber-400 border border-amber-800/40',
    gray:  'bg-zinc-800/60 text-zinc-400 border border-zinc-700/40',
    red:   'bg-red-900/30 text-red-400 border border-red-800/40',
  }[badgeColor];

  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-2 py-1 border-b border-[#1E293B]/20 hover:bg-[#1E293B]/10 rounded px-1">
      <div className="flex items-start gap-1.5 min-w-0">
        <span className={cn('shrink-0 text-[7px] px-1 py-0.5 rounded font-bold uppercase tracking-wide', badgeCls)}>{badge}</span>
        <span className="text-zinc-200 leading-tight">{label}</span>
      </div>
      <div className="space-y-0.5 min-w-0">
        {treSection && <div className="text-zinc-500">Section: <span className="text-amber-400/80">{treSection}</span></div>}
        {treField   && <div className="text-zinc-500">Field: <span className="text-zinc-300">{treField}</span></div>}
        {note       && <div className="text-zinc-600 italic">{note}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output filter state
// ---------------------------------------------------------------------------

interface OutputFilters {
  model: string;
  minDownload: string;
  maxDownload: string;
  minUplift: string;
  maxUplift: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
}

const EMPTY_FILTERS: OutputFilters = {
  model: '',
  minDownload: '',
  maxDownload: '',
  minUplift: '',
  maxUplift: '',
  minWidth: '',
  maxWidth: '',
  minHeight: '',
  maxHeight: '',
};

function applyFilters(hangers: SSTHangerResult[], f: OutputFilters): SSTHangerResult[] {
  return hangers.filter((h) => {
    if (f.model && !h.model.toLowerCase().includes(f.model.toLowerCase())) return false;
    if (f.minDownload !== '' && h.downloadLoad < Number(f.minDownload)) return false;
    if (f.maxDownload !== '' && h.downloadLoad > Number(f.maxDownload)) return false;
    if (f.minUplift !== '' && h.upliftLoad < Number(f.minUplift)) return false;
    if (f.maxUplift !== '' && h.upliftLoad > Number(f.maxUplift)) return false;
    if (f.minWidth !== '' && h.width < Number(f.minWidth)) return false;
    if (f.maxWidth !== '' && h.width > Number(f.maxWidth)) return false;
    if (f.minHeight !== '' && h.height < Number(f.minHeight)) return false;
    if (f.maxHeight !== '' && h.height > Number(f.maxHeight)) return false;
    return true;
  });
}

function isFiltersEmpty(f: OutputFilters): boolean {
  return Object.values(f).every((v) => v === '');
}

// ---------------------------------------------------------------------------
// OUTPUT Panel (right column)
// ---------------------------------------------------------------------------

function OutputPanel({
  payload,
  carriedLabel,
  viewMode,
  onViewChange,
  overrides,
}: {
  payload: SSTPayload;
  carriedLabel: string;
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  overrides: JobOverrides;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SSTAPIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<OutputFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  // Build effective payload with user overrides applied
  const effectivePayload: SSTPayload = {
    ...payload,
    style: overrides.style,
    fastenerType: overrides.fastenerType,
    ansitpi: overrides.ansitpi,
    designInformations: {
      downloadDurationType: overrides.downloadDurationType,
      upliftLoadDurationType: overrides.upliftLoadDurationType,
    },
  };

  const runQuery = useCallback(async () => {
    if (!hasSSTToken()) {
      setError('No SST token set. Please set the Bearer token in the left sidebar first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setFilters(EMPTY_FILTERS);

    try {
      console.log('[SST] Payload for', carriedLabel, effectivePayload);
      const res = await submitToSST(effectivePayload);
      console.log('[SST] Response:', res);
      setResult(res);
      if (!res.success) setError(res.error ?? 'Unknown error');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(effectivePayload), carriedLabel]);

  // Auto-run on mount and when overrides change
  useEffect(() => {
    runQuery();
  }, [runQuery]);

  const allHangers = result?.success ? result.hangers : [];
  const filtered = applyFilters(allHangers, filters);
  const hasActiveFilters = !isFiltersEmpty(filters);

  const setFilter = <K extends keyof OutputFilters>(key: K, val: string) =>
    setFilters((f) => ({ ...f, [key]: val }));

  return (
    <div className="flex flex-col h-full">
      {/* OUTPUT header */}
      <div className="px-4 py-2 bg-[#12131C] border-b border-[#1E293B] shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Output</span>
          {loading && (
            <span className="text-[9px] font-mono text-zinc-400 animate-pulse">Searching...</span>
          )}
          {result?.success && !loading && (
            <span className="text-[9px] font-mono text-emerald-400">
              {hasActiveFilters
                ? `${filtered.length} / ${allHangers.length} hangers`
                : `${allHangers.length} hangers found`}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {result?.success && allHangers.length > 0 && (
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
                showFilters || hasActiveFilters
                  ? 'bg-cyan-700/30 text-cyan-400 border border-cyan-500/30'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
              )}
              title="Toggle result filters"
            >
              <SlidersHorizontal className="w-3 h-3" />
              Filter
              {hasActiveFilters && (
                <span className="ml-0.5 bg-cyan-500 text-black rounded-full w-3.5 h-3.5 flex items-center justify-center text-[8px] font-black">
                  {Object.values(filters).filter((v) => v !== '').length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={runQuery}
            disabled={loading}
            className={cn(
              'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
              loading
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            )}
          >
            {loading ? 'Searching...' : 'Re-run'}
          </button>
          <button
            onClick={() => onViewChange(viewMode === 'output-only' ? 'split' : 'output-only')}
            className={cn(
              'p-1 rounded transition-colors',
              viewMode === 'output-only'
                ? 'bg-cyan-600/30 text-cyan-400'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1E293B]/50'
            )}
            title={viewMode === 'output-only' ? 'Show split view' : 'Expand Output'}
          >
            {viewMode === 'output-only' ? <Columns className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* FILTER BAR */}
      {showFilters && result?.success && allHangers.length > 0 && (
        <div className="bg-[#12131C] border-b border-[#1E293B] px-3 py-2 shrink-0">
          <div className="flex items-center gap-1 mb-2">
            <SlidersHorizontal className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Filter Results</span>
            {hasActiveFilters && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="ml-auto flex items-center gap-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {/* Model search */}
            <div className="col-span-2 flex items-center gap-2">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Model</label>
              <div className="relative flex-1">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  value={filters.model}
                  onChange={(e) => setFilter('model', e.target.value)}
                  placeholder="e.g. LUS, HUS, HHUS..."
                  className="w-full bg-[#1A1B26] border border-[#2E3A4E] text-zinc-200 text-[10px] rounded pl-6 pr-2 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600"
                />
                {filters.model && (
                  <button onClick={() => setFilter('model', '')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Download Load range */}
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Download ≥</label>
              <input
                type="number"
                value={filters.minDownload}
                onChange={(e) => setFilter('minDownload', e.target.value)}
                placeholder="lb"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-[#FFB74D] text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Download ≤</label>
              <input
                type="number"
                value={filters.maxDownload}
                onChange={(e) => setFilter('maxDownload', e.target.value)}
                placeholder="lb"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-[#FFB74D] text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>

            {/* Uplift Load range */}
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Uplift ≥</label>
              <input
                type="number"
                value={filters.minUplift}
                onChange={(e) => setFilter('minUplift', e.target.value)}
                placeholder="lb"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-sky-400 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Uplift ≤</label>
              <input
                type="number"
                value={filters.maxUplift}
                onChange={(e) => setFilter('maxUplift', e.target.value)}
                placeholder="lb"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-sky-400 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>

            {/* Width range */}
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Width ≥ (in)</label>
              <input
                type="number"
                step="0.125"
                value={filters.minWidth}
                onChange={(e) => setFilter('minWidth', e.target.value)}
                placeholder="in"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-zinc-300 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Width ≤ (in)</label>
              <input
                type="number"
                step="0.125"
                value={filters.maxWidth}
                onChange={(e) => setFilter('maxWidth', e.target.value)}
                placeholder="in"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-zinc-300 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>

            {/* Height range */}
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Height ≥ (in)</label>
              <input
                type="number"
                step="0.125"
                value={filters.minHeight}
                onChange={(e) => setFilter('minHeight', e.target.value)}
                placeholder="in"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-zinc-300 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[9px] text-zinc-500 w-20 shrink-0">Height ≤ (in)</label>
              <input
                type="number"
                step="0.125"
                value={filters.maxHeight}
                onChange={(e) => setFilter('maxHeight', e.target.value)}
                placeholder="in"
                className="flex-1 bg-[#1A1B26] border border-[#2E3A4E] text-zinc-300 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-500/60 placeholder:text-zinc-600 w-0"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error */}
        {error && (
          <div className="flex items-start space-x-2 bg-red-950/50 border border-red-500/30 rounded p-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-red-400 font-mono leading-relaxed">
              {error.split(/(https?:\/\/\S+)/g).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-red-300 hover:text-red-100 break-all"
                  >
                    {part}
                  </a>
                ) : (
                  part
                )
              )}
            </span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block w-6 h-6 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin mb-3"></div>
            <div className="text-[11px] font-mono text-zinc-500">Querying SST Hanger Selector API...</div>
          </div>
        )}

        {/* Results Table */}
        {result?.success && allHangers.length > 0 && (
          <div className="border border-[#1E293B] bg-[#0F111A] rounded overflow-hidden">
            <div className="px-3 py-2 bg-[#1A1B26] border-b border-[#1E293B]/60 flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Results</span>
              <span className="text-[9px] font-mono text-zinc-500">
                {hasActiveFilters
                  ? `${filtered.length} of ${allHangers.length} entries`
                  : `${allHangers.length} entries`}
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
                  {filtered.length > 0 ? (
                    filtered.map((h, i) => (
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
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-500 text-[10px] font-mono">
                        No hangers match the current filters.{' '}
                        <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-cyan-400 hover:text-cyan-300 underline">
                          Clear filters
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result?.success && allHangers.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-[11px] font-mono">
            No matching hangers found for this configuration.
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
  const [viewMode, setViewMode] = useState<ViewMode>('output-only');

  // Job Settings overrides — lifted here so OutputPanel re-runs when changed
  const [overrides, setOverrides] = useState<JobOverrides>({
    style: payload.style,
    fastenerType: payload.fastenerType,
    downloadDurationType: payload.designInformations.downloadDurationType,
    upliftLoadDurationType: payload.designInformations.upliftLoadDurationType,
    ansitpi: payload.ansitpi,
  });

  // Reset overrides when selected truss changes
  useEffect(() => {
    setOverrides({
      style: payload.style,
      fastenerType: payload.fastenerType,
      downloadDurationType: payload.designInformations.downloadDurationType,
      upliftLoadDurationType: payload.designInformations.upliftLoadDurationType,
      ansitpi: payload.ansitpi,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCarried.instance.id]);

  const showInput = viewMode === 'split' || viewMode === 'input-only';
  const showOutput = viewMode === 'split' || viewMode === 'output-only';

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: INPUT */}
      {showInput && (
        <div className={cn(
          'border-r border-[#1E293B] bg-[#0F111A] flex flex-col overflow-hidden transition-all',
          viewMode === 'input-only' ? 'flex-1' : 'w-[380px] shrink-0'
        )}>
          <InputPanel
            payload={payload}
            girderLabel={group.girder.label}
            carriedLabel={selectedCarried.instance.label}
            viewMode={viewMode}
            onViewChange={setViewMode}
            overrides={overrides}
            onOverridesChange={setOverrides}
            carried={selectedCarried}
            group={group}
          />
        </div>
      )}

      {/* Collapsed INPUT tab */}
      {!showInput && (
        <div
          className="w-8 bg-[#12131C] border-r border-[#1E293B] flex flex-col items-center pt-3 cursor-pointer hover:bg-[#1A1B26] transition-colors shrink-0"
          onClick={() => setViewMode('split')}
          title="Show Input panel"
        >
          <ChevronRight className="w-4 h-4 text-zinc-500 mb-2" />
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest [writing-mode:vertical-lr]">Input</span>
        </div>
      )}

      {/* Right: OUTPUT */}
      {showOutput && (
        <div className={cn(
          'bg-[#0C0D14] flex flex-col overflow-hidden',
          viewMode === 'output-only' ? 'flex-1' : 'flex-1'
        )}>
          <OutputPanel
            payload={payload}
            carriedLabel={selectedCarried.instance.label}
            viewMode={viewMode}
            onViewChange={setViewMode}
            overrides={overrides}
          />
        </div>
      )}

      {/* Collapsed OUTPUT tab */}
      {!showOutput && (
        <div
          className="w-8 bg-[#12131C] border-l border-[#1E293B] flex flex-col items-center pt-3 cursor-pointer hover:bg-[#1A1B26] transition-colors shrink-0"
          onClick={() => setViewMode('split')}
          title="Show Output panel"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-500 mb-2" />
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest [writing-mode:vertical-lr]">Output</span>
        </div>
      )}
    </div>
  );
}
