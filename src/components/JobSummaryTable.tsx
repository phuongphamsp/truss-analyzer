/**
 * JobSummaryTable — Bảng tổng hợp hanger tối ưu cho toàn bộ job.
 *
 * Mỗi connection (carried truss) → 1 hanger được chọn:
 *   - Nếu có inventory: chọn hanger rẻ nhất trong số các hanger available (in stock)
 *   - Nếu không có inventory: chọn hanger rẻ nhất overall
 *
 * Hiển thị bảng theo từng girder, kèm tổng giá toàn job.
 * Có nút Export Excel.
 */

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type { GirderGroup } from '../types';
import type { SSTHangerResult } from '../lib/sst-types';
import type { ParsedInventory } from '../lib/inventory';
import { isInStock } from '../lib/inventory';
import { Package, PackageCheck, Download, AlertCircle, FileSpreadsheet, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { loadInventoryFile } from '../lib/inventory';
import { buildSSTPayload } from '../lib/sst-mapper';
import { submitToSST, hasSSTToken } from '../lib/sst-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HangerResultsMap {
  /** key = `${girderId}::${carriedInstanceId}` */
  [key: string]: SSTHangerResult[];
}

interface SelectedHanger {
  girderId: string;
  girderLabel: string;
  carriedId: string;
  carriedLabel: string;
  offsetX: number;          // inches from girder left end
  downReaction: number;
  upliftReaction: number;
  hanger: SSTHangerResult | null;
  isInStock: boolean;
  selectionMode: 'available' | 'cheapest' | 'none';
}

// ---------------------------------------------------------------------------
// Helper: pick best hanger
// ---------------------------------------------------------------------------

function pickBestHanger(
  hangers: SSTHangerResult[],
  inventory: ParsedInventory | null,
): { hanger: SSTHangerResult | null; mode: 'available' | 'cheapest' | 'none' } {
  if (!hangers || hangers.length === 0) return { hanger: null, mode: 'none' };

  const withCost = (h: SSTHangerResult) => h.installedCost > 0 ? h.installedCost : Infinity;

  if (inventory) {
    // Try to find cheapest in-stock hanger
    const inStockHangers = hangers.filter((h) => isInStock(h.model, inventory));
    if (inStockHangers.length > 0) {
      const best = inStockHangers.reduce((a, b) => withCost(a) <= withCost(b) ? a : b);
      return { hanger: best, mode: 'available' };
    }
    // No in-stock → fall back to cheapest overall
    const best = hangers.reduce((a, b) => withCost(a) <= withCost(b) ? a : b);
    return { hanger: best, mode: 'cheapest' };
  }

  // No inventory → cheapest overall
  const best = hangers.reduce((a, b) => withCost(a) <= withCost(b) ? a : b);
  return { hanger: best, mode: 'cheapest' };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function fmtOffset(inches: number): string {
  const ft = Math.floor(inches / 12);
  const ins = (inches % 12).toFixed(2);
  return `${ft}'-${ins}"`;
}

function fmtLoad(lb: number): string {
  return lb > 0 ? `${lb.toLocaleString()} lb` : '—';
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batch query state
// ---------------------------------------------------------------------------

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  running: boolean;
  aborted: boolean;
}

interface JobSummaryTableProps {
  girders: GirderGroup[];
  hangerResultsMap: HangerResultsMap;
  inventory: ParsedInventory | null;
  onInventoryChange: (inv: ParsedInventory | null) => void;
  onHangersLoaded: (girderId: string, carriedId: string, hangers: SSTHangerResult[]) => void;
}

export function JobSummaryTable({
  girders,
  hangerResultsMap,
  inventory,
  onInventoryChange,
  onHangersLoaded,
}: JobSummaryTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [noToken, setNoToken] = useState(false);

  // ---------------------------------------------------------------------------
  // Batch auto-query: run on mount for all connections not yet queried
  // ---------------------------------------------------------------------------

  const runBatchQuery = useCallback(async () => {
    if (!hasSSTToken()) {
      setNoToken(true);
      return;
    }
    setNoToken(false);

    // Collect connections that haven't been queried yet
    const pending: Array<{ girderId: string; carriedId: string; group: GirderGroup; carriedIdx: number }> = [];
    for (const group of girders) {
      for (let i = 0; i < group.carriedTrusses.length; i++) {
        const carried = group.carriedTrusses[i];
        const key = `${group.girder.id}::${carried.instance.id}`;
        if (!hangerResultsMap[key] && (carried.downReaction ?? 0) > 0) {
          pending.push({ girderId: group.girder.id, carriedId: carried.instance.id, group, carriedIdx: i });
        }
      }
    }

    if (pending.length === 0) return;

    abortRef.current = false;
    setBatchProgress({ total: pending.length, completed: 0, failed: 0, running: true, aborted: false });

    let completed = 0;
    let failed = 0;

    for (const item of pending) {
      if (abortRef.current) {
        setBatchProgress(prev => prev ? { ...prev, running: false, aborted: true } : null);
        return;
      }

      const carried = item.group.carriedTrusses[item.carriedIdx];
      try {
        const payload = buildSSTPayload(item.group, carried);
        const res = await submitToSST(payload);
        if (res.success) {
          onHangersLoaded(item.girderId, item.carriedId, res.hangers);
        } else {
          failed++;
          // If 401/403, abort the whole batch — token is invalid
          if (res.error?.includes('401') || res.error?.includes('403')) {
            setBatchProgress(prev => prev ? { ...prev, running: false, aborted: true, failed: failed + (pending.length - completed - 1) } : null);
            setNoToken(true);
            return;
          }
        }
      } catch {
        failed++;
      }

      completed++;
      setBatchProgress(prev => prev ? { ...prev, completed, failed, running: completed < pending.length } : null);

      // 800ms delay between calls to avoid rate limiting (skip after last)
      if (completed < pending.length && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    setBatchProgress(prev => prev ? { ...prev, running: false } : null);
  }, [girders, hangerResultsMap, onHangersLoaded]);

  // Auto-run on mount
  useEffect(() => {
    runBatchQuery();
    return () => { abortRef.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only on mount (tab open)

  // Build the selected-hanger rows for all connections
  const rows: SelectedHanger[] = useMemo(() => {
    const result: SelectedHanger[] = [];
    for (const group of girders) {
      for (const carried of group.carriedTrusses) {
        const key = `${group.girder.id}::${carried.instance.id}`;
        const hangers = hangerResultsMap[key] ?? [];
        const { hanger, mode } = pickBestHanger(hangers, inventory);
        result.push({
          girderId: group.girder.id,
          girderLabel: group.girder.label,
          carriedId: carried.instance.id,
          carriedLabel: carried.instance.label,
          offsetX: carried.localX,
          downReaction: carried.downReaction ?? 0,
          upliftReaction: carried.upliftReaction ?? 0,
          hanger,
          isInStock: hanger ? isInStock(hanger.model, inventory) : false,
          selectionMode: mode,
        });
      }
    }
    return result;
  }, [girders, hangerResultsMap, inventory]);

  // Group rows by girder
  const byGirder = useMemo(() => {
    const map = new Map<string, SelectedHanger[]>();
    for (const row of rows) {
      if (!map.has(row.girderId)) map.set(row.girderId, []);
      map.get(row.girderId)!.push(row);
    }
    return map;
  }, [rows]);

  // Stats
  const totalConnections = rows.length;
  const resolvedConnections = rows.filter((r) => r.hanger !== null).length;
  const pendingConnections = totalConnections - resolvedConnections;
  const hasInventory = inventory !== null;

  // Total cost
  const totalCost = useMemo(() => rows.reduce((s, r) => s + (r.hanger?.cost ?? 0), 0), [rows]);

  // Model summary: count per hanger model
  const modelSummary = useMemo(() => {
    const map = new Map<string, { count: number; inStockCount: number }>();
    for (const row of rows) {
      if (!row.hanger) continue;
      const model = row.hanger.model;
      const existing = map.get(model) ?? { count: 0, inStockCount: 0 };
      map.set(model, {
        count: existing.count + 1,
        inStockCount: existing.inStockCount + (row.isInStock ? 1 : 0),
      });
    }
    // Sort by count descending
    return Array.from(map.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([model, stats]) => ({ model, ...stats }));
  }, [rows]);

  // Handle inventory file import
  const handleInventoryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await loadInventoryFile(file);
      onInventoryChange(parsed);
    } catch {
      // silently ignore — user can retry
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Export to Excel
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary per connection
    const summaryData: (string | number)[][] = [
      ['Girder', 'Carried Truss', 'Offset X', 'Down Rxn (lb)', 'Uplift Rxn (lb)', 'Hanger Model', 'Download Cap (lb)', 'Uplift Cap (lb)', 'Width (in)', 'Height (in)', 'Bearing (in)', 'MSRP ($)', 'In Stock', 'Selection'],
    ];
    for (const row of rows) {
      summaryData.push([
        row.girderLabel,
        row.carriedLabel,
        fmtOffset(row.offsetX),
        row.downReaction,
        row.upliftReaction,
        row.hanger?.model ?? 'N/A — No SST results',
        row.hanger?.downloadLoad ?? '',
        row.hanger?.upliftLoad ?? '',
        row.hanger?.width ?? '',
        row.hanger?.height ?? '',
        row.hanger?.bearing ?? '',
        row.hanger?.cost ?? '',
        row.hanger ? (row.isInStock ? 'Yes' : 'No') : '',
        row.selectionMode === 'available' ? 'Cheapest In-Stock'
          : row.selectionMode === 'cheapest' ? 'Cheapest Overall'
          : 'Pending',
      ]);
    }
    // Totals row
    summaryData.push([]);
    summaryData.push(['', '', '', '', '', 'TOTAL HANGER COST', '', '', '', '', '', totalCost.toFixed(2), '', '']);

    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    // Column widths
    ws1['!cols'] = [
      { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Hanger Schedule');

    // Sheet 2: Per-girder summary
    const girderData: (string | number)[][] = [
      ['Girder', 'Connections', 'Resolved', 'Total MSRP ($)'],
    ];
    for (const [girderId, gRows] of byGirder) {
      const label = gRows[0].girderLabel;
      const resolved = gRows.filter((r) => r.hanger !== null).length;
      const cost = gRows.reduce((s, r) => s + (r.hanger?.cost ?? 0), 0);
      girderData.push([label, gRows.length, resolved, cost.toFixed(2)]);
      void girderId;
    }
    girderData.push([]);
    girderData.push(['TOTAL', totalConnections, resolvedConnections, totalCost.toFixed(2)]);

    const ws2 = XLSX.utils.aoa_to_sheet(girderData);
    ws2['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Girder Summary');

    // Sheet 3: Model summary
    const modelData: (string | number)[][] = [
      ['Hanger Model', 'Qty', 'In Stock'],
    ];
    for (const item of modelSummary) {
      modelData.push([item.model, item.count, item.inStockCount > 0 ? item.inStockCount : '—']);
    }
    modelData.push([]);
    modelData.push(['TOTAL', modelSummary.reduce((s, m) => s + m.count, 0), '']);

    const ws3 = XLSX.utils.aoa_to_sheet(modelData);
    ws3['!cols'] = [{ wch: 20 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Model Summary');

    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    XLSX.writeFile(wb, `hanger_schedule_${timestamp}.xlsx`);
  };

  const isQuerying = batchProgress?.running === true;
  const batchDone = batchProgress && !batchProgress.running;
  const batchPct = batchProgress && batchProgress.total > 0
    ? Math.round((batchProgress.completed / batchProgress.total) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col bg-[#0C0D14] overflow-hidden text-zinc-200">
      {/* Header */}
      <div className="bg-[#12131C] border-b border-[#1E293B] px-5 py-3 shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-200">Job Hanger Schedule</span>
          <span className="text-[9px] font-mono text-zinc-500">
            {resolvedConnections}/{totalConnections} connections resolved
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Inventory import */}
          <input ref={fileInputRef} type="file" accept=".xml" className="hidden" onChange={handleInventoryFile} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[9px] font-mono border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <Package className="w-3 h-3" />
            {hasInventory ? 'Replace Inventory XML' : 'Import Inventory XML'}
          </button>
          {hasInventory && (
            <>
              <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                <PackageCheck className="w-3 h-3" />
                {inventory!.inStockSet.size} models in stock
              </span>
              <button
                onClick={() => onInventoryChange(null)}
                className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Remove
              </button>
            </>
          )}

          {/* Re-query button (shown when not running) */}
          {!isQuerying && (
            <button
              onClick={runBatchQuery}
              disabled={!hasSSTToken()}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-[9px] font-mono border transition-colors',
                hasSSTToken()
                  ? 'border-cyan-700 text-cyan-400 hover:border-cyan-500 hover:text-cyan-200'
                  : 'border-zinc-700 text-zinc-600 cursor-not-allowed'
              )}
              title="Re-query SST for all connections"
            >
              Re-query All
            </button>
          )}

          {/* Stop button (shown while running) */}
          {isQuerying && (
            <button
              onClick={() => { abortRef.current = true; }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[9px] font-mono border border-red-700 text-red-400 hover:border-red-500 transition-colors"
            >
              Stop
            </button>
          )}

          {/* Export Excel */}
          <button
            onClick={handleExportExcel}
            disabled={resolvedConnections === 0}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors',
              resolvedConnections > 0
                ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            )}
          >
            <Download className="w-3 h-3" />
            Export Excel
          </button>
        </div>
      </div>

      {/* No token warning */}
      {noToken && (
        <div className="bg-red-950/40 border-b border-red-700/40 px-5 py-2 shrink-0 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-[9px] font-mono text-red-400">
            No SST token found. Set the Bearer token in the SST Workspace (Analyzer tab) first, then re-query.
          </span>
        </div>
      )}

      {/* Batch progress bar */}
      {batchProgress && (
        <div className="bg-[#0F111A] border-b border-[#1E293B] px-5 py-2 shrink-0">
          <div className="flex items-center gap-3 mb-1.5">
            {isQuerying ? (
              <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
            ) : batchDone && batchProgress.failed === 0 ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
            )}
            <span className="text-[9px] font-mono text-zinc-400">
              {isQuerying
                ? `Querying SST API… ${batchProgress.completed}/${batchProgress.total}`
                : batchProgress.aborted
                  ? `Stopped — ${batchProgress.completed}/${batchProgress.total} completed`
                  : `Done — ${batchProgress.completed}/${batchProgress.total} queried${batchProgress.failed > 0 ? `, ${batchProgress.failed} failed` : ''}`
              }
            </span>
            {batchProgress.failed > 0 && (
              <span className="text-[9px] font-mono text-red-400">{batchProgress.failed} failed</span>
            )}
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isQuerying ? 'bg-cyan-500' : batchProgress.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500'
              )}
              style={{ width: `${batchPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="bg-[#0F111A] border-b border-[#1E293B] px-5 py-2 shrink-0 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-500 uppercase">Total Connections</span>
          <span className="text-[13px] font-bold text-zinc-200">{totalConnections}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-500 uppercase">Hangers Selected</span>
          <span className="text-[13px] font-bold text-emerald-400">{resolvedConnections}</span>
        </div>

        {hasInventory && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-zinc-500 uppercase">Selection Mode</span>
            <span className="text-[9px] font-mono text-emerald-400">Cheapest In-Stock (fallback: cheapest overall)</span>
          </div>
        )}
        {!hasInventory && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-zinc-500 uppercase">Selection Mode</span>
            <span className="text-[9px] font-mono text-zinc-400">Cheapest Overall (no inventory loaded)</span>
          </div>
        )}
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {girders.length === 0 && (
          <div className="text-center py-16 text-zinc-500 text-[11px] font-mono">
            No girder data loaded.
          </div>
        )}

        {Array.from(byGirder.entries()).map(([girderId, gRows]) => {
          const girderLabel = gRows[0].girderLabel;
          const girderResolved = gRows.filter((r) => r.hanger !== null).length;

          return (
            <div key={girderId} className="border border-[#1E293B] rounded overflow-hidden">
              {/* Girder header */}
              <div className="bg-[#1A1B26] border-b border-[#1E293B] px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-zinc-100 uppercase tracking-wider">
                    Girder: {girderLabel}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">
                    {girderResolved}/{gRows.length} connections
                  </span>
                </div>

              </div>

              {/* Connections table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead>
                    <tr className="text-[9px] uppercase text-zinc-500 border-b border-[#1E293B] bg-[#12131C]">
                      <th className="py-2 px-3">Carried Truss</th>
                      <th className="py-2 px-3 text-right">Offset X</th>
                      <th className="py-2 px-3">Hanger Model</th>
                      <th className="py-2 px-3 text-right">DL Cap (lb)</th>
                      <th className="py-2 px-3 text-right">UL Cap (lb)</th>
                      <th className="py-2 px-3 text-right">Width</th>
                      <th className="py-2 px-3 text-right">Height</th>
                      <th className="py-2 px-3 text-center">Stock</th>
                      <th className="py-2 px-3">Selection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gRows.map((row) => (
                      <tr
                        key={row.carriedId}
                        className="border-b border-[#1E293B]/40 hover:bg-[#1E293B]/20 transition-colors"
                      >
                        {/* Carried truss */}
                        <td className="py-2 px-3">
                          <div className="font-bold text-zinc-200">{row.carriedLabel}</div>
                          <div className="text-[8px] text-zinc-600 truncate max-w-[120px]">{row.carriedId}</div>
                        </td>

                        {/* Offset X */}
                        <td className="py-2 px-3 text-right text-zinc-400">
                          {fmtOffset(row.offsetX)}
                        </td>

                        {/* Hanger model */}
                        <td className="py-2 px-3">
                          {row.hanger ? (
                            <div className="flex items-center gap-1.5">
                              {row.isInStock && (
                                <PackageCheck className="w-3 h-3 text-emerald-400 shrink-0" title="In stock" />
                              )}
                              <span className={cn(
                                'font-bold',
                                row.isInStock ? 'text-emerald-400' : 'text-zinc-200'
                              )}>
                                {row.hanger.model}
                              </span>
                            </div>
                          ) : (
                            <span className="text-zinc-600 italic text-[9px]">
                              {Object.keys(hangerResultsMap).some(k => k.startsWith(row.girderId) && k.endsWith(row.carriedId))
                                ? 'No results from SST'
                                : 'Run SST query first'}
                            </span>
                          )}
                        </td>

                        {/* Hanger capacities */}
                        <td className="py-2 px-3 text-right text-zinc-400">
                          {row.hanger ? row.hanger.downloadLoad.toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-400">
                          {row.hanger ? row.hanger.upliftLoad.toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-400">
                          {row.hanger && row.hanger.width > 0 ? `${row.hanger.width.toFixed(3)}"` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-400">
                          {row.hanger && row.hanger.height > 0 ? `${row.hanger.height.toFixed(3)}"` : '—'}
                        </td>

                        {/* In stock */}
                        <td className="py-2 px-3 text-center">
                          {row.hanger ? (
                            row.isInStock
                              ? <PackageCheck className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                              : <span className="text-[9px] text-zinc-600">—</span>
                          ) : (
                            <span className="text-[9px] text-zinc-700">—</span>
                          )}
                        </td>

                        {/* Selection mode badge */}
                        <td className="py-2 px-3">
                          {row.selectionMode === 'available' && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                              In-Stock
                            </span>
                          )}
                          {row.selectionMode === 'cheapest' && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                              Cheapest
                            </span>
                          )}
                          {row.selectionMode === 'none' && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-500 border border-amber-700/30">
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>


                </table>
              </div>
            </div>
          );
        })}

        {/* ── Model Summary Table ── */}
        {modelSummary.length > 0 && (
          <div className="border border-[#1E293B] rounded overflow-hidden">
            <div className="bg-[#1A1B26] border-b border-[#1E293B] px-4 py-2 flex items-center gap-3">
              <span className="text-[11px] font-bold text-zinc-100 uppercase tracking-wider">
                Hanger Model Summary
              </span>
              <span className="text-[9px] font-mono text-zinc-500">
                {modelSummary.length} model{modelSummary.length !== 1 ? 's' : ''} · {resolvedConnections} total hangers
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="text-[9px] uppercase text-zinc-500 border-b border-[#1E293B] bg-[#12131C]">
                    <th className="py-2 px-3">Hanger Model</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    {hasInventory && (
                      <th className="py-2 px-3 text-right">In Stock</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {modelSummary.map(({ model, count, inStockCount }) => (
                    <tr
                      key={model}
                      className="border-b border-[#1E293B]/40 hover:bg-[#1E293B]/20 transition-colors"
                    >
                      <td className="py-2 px-3 font-bold text-zinc-200">{model}</td>
                      <td className="py-2 px-3 text-right text-zinc-200 font-bold">{count}</td>
                      {hasInventory && (
                        <td className="py-2 px-3 text-right">
                          {inStockCount > 0
                            ? <span className="text-emerald-400 font-bold">{inStockCount}</span>
                            : <span className="text-zinc-600">—</span>
                          }
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#1E293B] bg-[#12131C]">
                    <td className="py-2 px-3 text-[9px] uppercase text-zinc-500 font-bold">Total</td>
                    <td className="py-2 px-3 text-right font-bold text-zinc-200">
                      {modelSummary.reduce((s, m) => s + m.count, 0)}
                    </td>
                    {hasInventory && (
                      <td className="py-2 px-3 text-right font-bold text-emerald-400">
                        {modelSummary.reduce((s, m) => s + m.inStockCount, 0) || '—'}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
