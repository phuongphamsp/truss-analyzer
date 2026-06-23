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
import type { SSTHangerResult, SSTAPIResponse } from '../lib/sst-types';
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
