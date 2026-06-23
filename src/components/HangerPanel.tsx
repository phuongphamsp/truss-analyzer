/**
 * SST Hanger Selector Panel
 *
 * Integrated panel for GirderDetails right sidebar:
 * - Token input (collapsible, persisted to localStorage)
 * - "Find Hangers" button for selected carried truss
 * - "Find All Hangers" batch button
 * - Results table
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { GirderGroup, CarriedTruss } from '../types';
import type { SSTHangerResult, SSTAPIResponse, SSTPayload } from '../lib/sst-types';
import { buildSSTPayload, buildBatchPayloads } from '../lib/sst-mapper';
import {
  getSSTToken,
  setSSTToken,
  clearSSTToken,
  hasSSTToken,
  submitToSST,
  submitBatchToSST,
  type BatchResult,
} from '../lib/sst-api';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Token Input
// ---------------------------------------------------------------------------

interface TokenInputProps {
  onTokenChange: (hasToken: boolean) => void;
}

function TokenInput({ onTokenChange }: TokenInputProps) {
  const [token, setToken] = useState(getSSTToken() ?? '');
  const [saved, setSaved] = useState(hasSSTToken());
  const [expanded, setExpanded] = useState(!hasSSTToken());

  const handleSave = () => {
    if (token.trim()) {
      setSSTToken(token.trim());
      setSaved(true);
      setExpanded(false);
      onTokenChange(true);
    }
  };

  const handleClear = () => {
    clearSSTToken();
    setToken('');
    setSaved(false);
    setExpanded(true);
    onTokenChange(false);
  };

  return (
    <div className="space-y-1.5">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[8px] uppercase text-zinc-400 tracking-wider font-bold">
          SST API Token
        </span>
        <span className="text-[8px] font-mono">
          {saved ? (
            <span className="text-emerald-400">Connected</span>
          ) : (
            <span className="text-amber-400">Not Set</span>
          )}
        </span>
      </div>

      {expanded && (
        <div className="space-y-1.5">
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setSaved(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="Paste Bearer token from DevTools..."
            className="w-full bg-[#0A0B10] border border-[#1E293B] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
          />
          <div className="flex space-x-1.5">
            <button
              onClick={handleSave}
              disabled={!token.trim()}
              className={cn(
                'flex-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
                token.trim()
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              )}
            >
              Save Token
            </button>
            {saved && (
              <button
                onClick={handleClear}
                className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[8px] text-zinc-500 leading-relaxed">
            Open{' '}
            <span className="text-zinc-400">app.strongtie.com/hs</span> in
            browser, then DevTools &rarr; Network &rarr; any XHR &rarr; copy
            Authorization header value.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results Table
// ---------------------------------------------------------------------------

interface ResultsTableProps {
  hangers: SSTHangerResult[];
  compact?: boolean;
}

function ResultsTable({ hangers, compact }: ResultsTableProps) {
  if (hangers.length === 0) {
    return (
      <div className="text-[9px] text-zinc-500 font-mono text-center py-2">
        No matching hangers found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[10px] font-mono">
        <thead>
          <tr className="text-[8px] uppercase text-zinc-500 border-b border-[#1E293B]">
            <th className="py-1 pr-2">Model</th>
            <th className="py-1 pr-2 text-right">DL (lb)</th>
            <th className="py-1 pr-2 text-right">UL (lb)</th>
            {!compact && (
              <>
                <th className="py-1 pr-2 text-right">W"</th>
                <th className="py-1 text-right">H"</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {hangers.slice(0, compact ? 5 : 20).map((h, i) => (
            <tr
              key={`${h.model}-${i}`}
              className="border-b border-[#1E293B]/40 hover:bg-[#1E293B]/20"
            >
              <td className="py-1 pr-2 font-bold text-zinc-200">{h.model}</td>
              <td className="py-1 pr-2 text-right text-[#FFB74D]">
                {h.downloadLoad.toLocaleString()}
              </td>
              <td className="py-1 pr-2 text-right text-sky-400">
                {h.upliftLoad.toLocaleString()}
              </td>
              {!compact && (
                <>
                  <td className="py-1 pr-2 text-right text-zinc-400">
                    {h.width > 0 ? h.width.toFixed(3) : '\u2014'}
                  </td>
                  <td className="py-1 text-right text-zinc-400">
                    {h.height > 0 ? h.height.toFixed(3) : '\u2014'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {hangers.length > (compact ? 5 : 20) && (
        <div className="text-[8px] text-zinc-500 font-mono mt-1">
          +{hangers.length - (compact ? 5 : 20)} more results
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch Results
// ---------------------------------------------------------------------------

interface BatchResultsViewProps {
  results: BatchResult[];
}

function BatchResultsView({ results }: BatchResultsViewProps) {
  return (
    <div className="space-y-2">
      {results.map((r, i) => (
        <div key={i} className="border border-[#1E293B]/60 rounded p-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] font-bold text-zinc-300">
              {r.label}
            </span>
            <span
              className={cn(
                'text-[8px] font-mono',
                r.response.success ? 'text-emerald-400' : 'text-red-400'
              )}
            >
              {r.response.success
                ? `${r.response.hangers.length} hangers`
                : 'Error'}
            </span>
          </div>
          {r.response.success ? (
            <ResultsTable hangers={r.response.hangers} compact />
          ) : (
            <div className="text-[9px] text-red-400 font-mono">
              {r.response.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload Preview — mirrors SST Hanger Selector's 5-section INPUT layout
// ---------------------------------------------------------------------------

/** Decode SST enum integers to readable labels */
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

/** Convert actual inches to nominal label, e.g. 1.5 -> '2x (1 1/2")' */
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

/** Collapsible section header matching SST site style */
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
      className="flex items-center justify-between cursor-pointer py-1.5 border-b border-[#1E293B]/60"
      onClick={onToggle}
    >
      <span className={cn('text-[9px] uppercase font-bold tracking-wider', color)}>
        {title}
      </span>
      <span className="text-[9px] font-mono text-zinc-500">
        {expanded ? '\u25BC' : '\u25B6'}
      </span>
    </div>
  );
}

/** Single key-value row */
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
    <div className="flex justify-between items-start py-0.5">
      <span className="text-zinc-500 text-[9px]">{label}</span>
      <div className="text-right">
        <span className={cn('font-bold text-[9px]', valueColor)}>{value}</span>
        {source && (
          <div className="text-[7px] text-zinc-600 leading-tight">{source}</div>
        )}
      </div>
    </div>
  );
}

interface PayloadPreviewProps {
  payload: SSTPayload;
  carriedLabel: string;
  girderLabel: string;
}

function PayloadPreview({ payload, carriedLabel, girderLabel }: PayloadPreviewProps) {
  const [sections, setSections] = useState({
    connection: true,
    job: false,
    carrying: true,
    carried: true,
    hanger: false,
  });

  const toggle = (key: keyof typeof sections) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  const cm = payload.carryingMember;
  const cd = payload.carriedMembers[0];
  const isTruss = payload.flushOption === 'BOTTOM';

  return (
    <div className="border border-[#1E293B]/60 bg-[#0A0B10] rounded overflow-hidden">
      {/* Title bar */}
      <div className="bg-[#1A1B26] px-2.5 py-1.5 border-b border-[#1E293B]/60 flex items-center justify-between">
        <span className="text-[8px] uppercase text-zinc-400 tracking-wider font-bold">
          SST Input Parameters
        </span>
        <span className="text-[8px] font-mono text-zinc-500">
          {carriedLabel} on {girderLabel}
        </span>
      </div>

      <div className="px-2.5 py-1 space-y-0.5 font-mono">

        {/* ── 1. CONNECTION TYPE ── */}
        <SectionHeader
          title="Connection Type"
          expanded={sections.connection}
          onToggle={() => toggle('connection')}
          color="text-amber-400"
        />
        {sections.connection && (
          <div className="py-1.5 pl-1">
            <div className="flex items-center space-x-3">
              {/* Joist option */}
              <div className={cn(
                'flex flex-col items-center px-2 py-1.5 rounded border text-[8px]',
                !isTruss
                  ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                  : 'border-[#1E293B]/40 text-zinc-600'
              )}>
                <span className="font-bold">Joist</span>
                <span className="text-[7px]">(Flush Top)</span>
              </div>
              {/* Truss option */}
              <div className={cn(
                'flex flex-col items-center px-2 py-1.5 rounded border text-[8px]',
                isTruss
                  ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                  : 'border-[#1E293B]/40 text-zinc-600'
              )}>
                <span className="font-bold">Truss</span>
                <span className="text-[7px]">(Flush Bottom)</span>
              </div>
              {/* Multi-Truss option */}
              <div className="flex flex-col items-center px-2 py-1.5 rounded border border-[#1E293B]/40 text-zinc-600 text-[8px]">
                <span className="font-bold">Multi-Truss</span>
                <span className="text-[7px]">(Flush Bottom)</span>
              </div>
            </div>
          </div>
        )}

        {/* ── 2. JOB SETTINGS ── */}
        <SectionHeader
          title="Job Settings"
          expanded={sections.job}
          onToggle={() => toggle('job')}
          color="text-indigo-400"
        />
        {sections.job && (
          <div className="py-1.5 pl-1 space-y-0.5">
            <Row label="Hanger Type" value={STYLE_LABELS[payload.style] ?? String(payload.style)} source="default: All Types" />
            <Row label="Fastener Type" value={FASTENER_LABELS[payload.fastenerType] ?? String(payload.fastenerType)} source="default: All" />
            <Row label="Building Code" value={CODE_LABELS[payload.buildingCode] ?? String(payload.buildingCode)} source="default: IRC 2018" />
            <Row label="Download Duration" value={DL_DUR_LABELS[payload.designInformations.downloadDurationType] ?? String(payload.designInformations.downloadDurationType)} source="mapped from truss type" />
            <Row label="Uplift Duration" value={UL_DUR_LABELS[payload.designInformations.upliftLoadDurationType] ?? String(payload.designInformations.upliftLoadDurationType)} source="default: Wind/Quake" />
            {isTruss && (
              <Row label="ANSI/TPI" value={ANSITPI_LABELS[payload.ansitpi] ?? String(payload.ansitpi)} source="truss connection" />
            )}
          </div>
        )}

        {/* ── 3. CARRYING MEMBER ── */}
        <SectionHeader
          title={isTruss ? 'Girder (Carrying Member)' : 'Header (Carrying Member)'}
          expanded={sections.carrying}
          onToggle={() => toggle('carrying')}
          color="text-emerald-400"
        />
        {sections.carrying && (
          <div className="py-1.5 pl-1 space-y-0.5">
            <Row label="Material" value={MATERIAL_LABELS[cm.material] ?? String(cm.material)} source="girder = Truss type" />
            <Row label="Width" value={widthToNominal(cm.width)} source={`actual: ${cm.width}"`} />
            <Row label="Depth" value={depthToNominal(cm.depth)} source={`actual: ${cm.depth}"`} />
            <Row label="Ply" value={String(cm.ply)} source="default: 1" />
            {isTruss && (
              <>
                <Row label="King Width" value={cm.kingWidth > 0 ? `${cm.kingWidth}"` : 'N/A'} source="not available in TRE" />
                <Row label="Total Height" value={`${cm.kingHeight}"`} source="from girder heel height" />
              </>
            )}
            {!isTruss && (
              <Row label="Top Chord" value={cm.topChord === 1 ? 'Single' : cm.topChord === 2 ? 'Double' : 'N/A'} />
            )}
          </div>
        )}

        {/* ── 4. CARRIED MEMBER ── */}
        <SectionHeader
          title={isTruss ? 'Truss (Carried Member)' : 'Joist (Carried Member)'}
          expanded={sections.carried}
          onToggle={() => toggle('carried')}
          color="text-amber-400"
        />
        {sections.carried && (
          <div className="py-1.5 pl-1 space-y-0.5">
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

        {/* ── 5. HANGER OPTIONS ── */}
        <SectionHeader
          title="Hanger Options"
          expanded={sections.hanger}
          onToggle={() => toggle('hanger')}
          color="text-zinc-400"
        />
        {sections.hanger && (
          <div className="py-1.5 pl-1 space-y-0.5">
            <Row label="Skew Angle" value={`${cd.angle.skewAngle}\u00B0`} source={cd.angle.skewType === 0 ? 'no skew data in TRE' : SKEW_LABELS[cd.angle.skewType]} />
            <Row label="Skew Direction" value={SKEW_LABELS[cd.angle.skewType] ?? 'None'} />
            <Row label="Slope Angle" value={`${cd.angle.slopeAngle}\u00B0`} source={cd.angle.slopeType === 0 ? 'bottom chord is level' : SLOPE_LABELS[cd.angle.slopeType]} />
            <Row label="Slope Direction" value={SLOPE_LABELS[cd.angle.slopeType] ?? 'None'} />
          </div>
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

interface HangerPanelProps {
  group: GirderGroup;
  selectedCarried: CarriedTruss | undefined;
}

type ViewMode = 'idle' | 'single' | 'batch';

export function HangerPanel({ group, selectedCarried }: HangerPanelProps) {
  const [tokenReady, setTokenReady] = useState(hasSSTToken());
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('idle');
  const [singleResult, setSingleResult] = useState<SSTAPIResponse | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset results when selected carried changes
  useEffect(() => {
    if (viewMode === 'single') {
      setSingleResult(null);
      setViewMode('idle');
      setError(null);
    }
  }, [selectedCarried?.instance.id]);

  const handleFindHangers = useCallback(async () => {
    if (!selectedCarried || !tokenReady) return;

    setLoading(true);
    setError(null);
    setViewMode('single');
    setSingleResult(null);

    try {
      const payload = buildSSTPayload(group, selectedCarried);
      console.log('[SST] Payload for', selectedCarried.instance.label, payload);
      const result = await submitToSST(payload);
      console.log('[SST] Response:', result);
      setSingleResult(result);
      if (!result.success) {
        setError(result.error ?? 'Unknown error');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [group, selectedCarried]);

  const handleFindAllHangers = useCallback(async () => {
    if (!tokenReady) return;

    setLoading(true);
    setError(null);
    setViewMode('batch');
    setBatchResults([]);
    setBatchProgress(null);

    try {
      const items = buildBatchPayloads(group).map((b) => ({
        label: b.carried.instance.label,
        payload: b.payload,
      }));

      if (items.length === 0) {
        setError('No carried trusses with load data to query.');
        setLoading(false);
        return;
      }

      setBatchProgress({ done: 0, total: items.length });

      const results = await submitBatchToSST(items, 1000, (done, total) => {
        setBatchProgress({ done, total });
      });

      setBatchResults(results);

      const failures = results.filter((r) => !r.response.success);
      if (failures.length > 0) {
        setError(`${failures.length} of ${results.length} queries failed.`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
      setBatchProgress(null);
    }
  }, [group]);

  return (
    <div className="border border-[#1E293B] bg-[#121422]/50 rounded p-3 space-y-3">
      {/* Header */}
      <div className="text-[9px] font-bold uppercase tracking-wider text-amber-400 flex items-center space-x-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
        <span>SST Hanger Selector</span>
      </div>

      {/* Token */}
      <TokenInput onTokenChange={setTokenReady} />

      {/* Action Buttons */}
      <div className="flex space-x-1.5">
        <button
          onClick={handleFindHangers}
          disabled={loading || !tokenReady || !selectedCarried}
          className={cn(
            'flex-1 px-2 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
            loading || !tokenReady || !selectedCarried
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-amber-600 text-white hover:bg-amber-500'
          )}
        >
          {loading && viewMode === 'single'
            ? 'Searching...'
            : `Find Hangers${selectedCarried ? ` (${selectedCarried.instance.label})` : ''}`}
        </button>
        <button
          onClick={handleFindAllHangers}
          disabled={loading || !tokenReady}
          className={cn(
            'px-2 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
            loading || !tokenReady
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
          )}
        >
          {loading && viewMode === 'batch' ? 'Batch...' : 'Find All'}
        </button>
      </div>

      {/* Payload Preview — mirrors SST site's 5-section INPUT layout */}
      {selectedCarried && (
        <PayloadPreview
          payload={buildSSTPayload(group, selectedCarried)}
          carriedLabel={selectedCarried.instance.label}
          girderLabel={group.girder.label}
        />
      )}

      {/* Progress */}
      {batchProgress && (
        <div className="space-y-1">
          <div className="flex justify-between text-[8px] font-mono text-zinc-400">
            <span>
              Processing {batchProgress.done}/{batchProgress.total}
            </span>
            <span>
              {Math.round((batchProgress.done / batchProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{
                width: `${(batchProgress.done / batchProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-950/50 border border-red-500/30 rounded p-2 text-[9px] text-red-400 font-mono leading-relaxed">
          {error}
        </div>
      )}

      {/* Single Result */}
      {viewMode === 'single' && singleResult?.success && (
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[8px] uppercase text-zinc-400 tracking-wider font-bold">
              Results for {selectedCarried?.instance.label}
            </span>
            <span className="text-[8px] font-mono text-emerald-400">
              {singleResult.hangers.length} hangers found
            </span>
          </div>
          <ResultsTable hangers={singleResult.hangers} />
        </div>
      )}

      {/* Batch Results */}
      {viewMode === 'batch' && batchResults.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[8px] uppercase text-zinc-400 tracking-wider font-bold">
              Batch Results
            </span>
            <span className="text-[8px] font-mono text-emerald-400">
              {batchResults.filter((r) => r.response.success).length}/
              {batchResults.length} successful
            </span>
          </div>
          <BatchResultsView results={batchResults} />
        </div>
      )}
    </div>
  );
}
