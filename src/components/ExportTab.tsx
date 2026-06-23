import React, { useState, useMemo } from 'react';
import { GirderGroup, LogEntry } from '../types';
import { Download, CheckSquare, Square, Grid } from 'lucide-react';
import { cn } from '../lib/utils';

interface ExportTabProps {
  girders: GirderGroup[];
  onLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

export function ExportTab({ girders, onLog }: ExportTabProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(girders.map(g => g.girder.id)));

  const handleSelectAll = () => {
    if (selectedIds.size === girders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(girders.map(g => g.girder.id)));
    }
  };

  const handleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleExport = () => {
    if (selectedIds.size === 0) return;
    try {
      const selectedGirders = girders.filter(g => selectedIds.has(g.girder.id));
      const payload = selectedGirders.map(g => {
        // Compute basic metrics to include explicitly if needed, but we can just export the whole object
        // The user said "export json file" so we export the raw data they selected.
        return {
           girderId: g.girder.id,
           label: g.girder.label,
           span: g.girder.treData?.span,
           pitch: g.girder.treData?.pitch,
           spacing: g.girder.treData?.spacing,
           dol: g.girder.treData?.dol,
           carriedTrussesCount: g.carriedTrusses.length,
           maxReaction: g.girder.treData?.maxReaction,
           rawTreData: g.girder.treData,
           carriedTrusses: g.carriedTrusses.map(c => ({
              label: c.instance.label,
              downReaction: c.downReaction || c.treData?.maxReaction || 0,
              upliftReaction: c.upliftReaction || 0,
              localX: c.localX
           }))
        };
      });

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `girders_export_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onLog({ message: `Exported ${selectedGirders.length} girders to JSON`, type: 'success' });
    } catch (e) {
      onLog({ message: `Export failed: ${e}`, type: 'error' });
    }
  };

  const allSelected = girders.length > 0 && selectedIds.size === girders.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < girders.length;

  return (
    <div className="flex-1 flex flex-col bg-[#EDEDED] overflow-hidden">
      <div className="p-4 border-b border-[#141414] bg-[#D4D3D0] shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-[#141414]">
          <Grid className="w-4 h-4" />
          <h2 className="text-xs uppercase font-bold tracking-widest text-[#141414]">JSON Export Explorer</h2>
        </div>
        <button
          onClick={handleExport}
          disabled={selectedIds.size === 0}
          className="flex items-center space-x-2 bg-[#141414] text-white px-3 py-1.5 rounded disabled:opacity-50 hover:bg-[#2A2A2A] transition-colors text-xs font-bold uppercase"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Selected as JSON ({selectedIds.size})</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-[#F2F2F2] p-4 text-[#141414]">
        <div className="bg-white border text-left border-[#141414] rounded shadow-sm overflow-hidden">
          <table className="w-full text-[11px] font-mono leading-tight">
            <thead className="bg-[#D4D3D0] border-b border-[#141414] text-[9px] uppercase">
              <tr>
                <th className="p-3 w-10 text-center border-r border-[#141414]">
                  <button onClick={handleSelectAll} className="flex items-center justify-center w-full focus:outline-none">
                    {allSelected ? (
                       <CheckSquare className="w-4 h-4 text-[#141414]" />
                    ) : someSelected ? (
                       <div className="relative w-4 h-4 border-2 border-[#141414] rounded-sm flex items-center justify-center">
                          <div className="w-2 h-2 bg-[#141414]"></div>
                       </div>
                    ) : (
                       <Square className="w-4 h-4 text-[#141414]" />
                    )}
                  </button>
                </th>
                <th className="p-3 border-r border-[#141414]">Girder Label</th>
                <th className="p-3 text-right border-r border-[#141414]">Span (in)</th>
                <th className="p-3 text-right border-r border-[#141414]">Pitch (in/12)</th>
                <th className="p-3 text-right border-r border-[#141414]">DOL</th>
                <th className="p-3 text-right border-r border-[#141414]">Max Rxn ↓ (lb)</th>
                <th className="p-3 text-right">Carried Trusses</th>
              </tr>
            </thead>
            <tbody>
              {girders.map((group, idx) => {
                const isSelected = selectedIds.has(group.girder.id);
                const td = group.girder.treData;
                return (
                  <tr 
                    key={group.girder.id} 
                    className={cn(
                      "border-b border-[#E4E3E0] hover:bg-[#F9F9F9] cursor-pointer transition-colors",
                      isSelected ? "bg-indigo-50/30" : ""
                    )}
                    onClick={() => handleSelect(group.girder.id)}
                  >
                    <td className="p-3 text-center border-r border-[#E4E3E0]">
                      <div className="flex items-center justify-center pointer-events-none">
                        {isSelected ? <CheckSquare className="w-4 h-4 text-emerald-600" /> : <Square className="w-4 h-4 text-zinc-300" />}
                      </div>
                    </td>
                    <td className="p-3 border-r border-[#E4E3E0] font-bold">
                       {group.girder.label}
                    </td>
                    <td className="p-3 text-right border-r border-[#E4E3E0] text-indigo-700">
                       {td?.span ? td.span.toFixed(2) : '—'}
                    </td>
                    <td className="p-3 text-right border-r border-[#E4E3E0]">
                       {td?.pitch ? td.pitch.toFixed(2) : '—'}
                    </td>
                    <td className="p-3 text-right border-r border-[#E4E3E0]">
                       {td?.dol ? td.dol.toFixed(2) : '—'}
                    </td>
                    <td className="p-3 text-right border-r border-[#E4E3E0] text-[#B91C1C] font-semibold">
                       {td?.maxReaction ? td.maxReaction.toFixed(0) : '—'}
                    </td>
                    <td className="p-3 text-right">
                       {group.carriedTrusses.length} 
                    </td>
                  </tr>
                );
              })}
              {girders.length === 0 && (
                <tr>
                   <td colSpan={7} className="p-8 text-center uppercase tracking-widest text-xs font-bold text-zinc-400">
                     No Data Available
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
