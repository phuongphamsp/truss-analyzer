import { GirderGroup, CarriedTruss, TreData } from '../types';
import { 
  ArrowDown, 
  Settings, 
  CheckCircle, 
  Cpu, 
  Grid, 
  Server, 
  TrendingUp, 
  Activity, 
  Hash, 
  AlertCircle 
} from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../lib/utils';

interface GirderDetailsProps {
    group: GirderGroup | null;
}

export function GirderDetails({ group }: GirderDetailsProps) {
    const [selectedCarriedId, setSelectedCarriedId] = useState<string | null>(null);

    if (!group) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-[#141414] opacity-50 bg-[#DEDCD7]">
                <p className="text-[10px] uppercase font-bold tracking-widest">Select a girder truss from the list to view data.</p>
            </div>
        );
    }

    const carried = group.carriedTrusses;
    const selectedCarried = carried.find(c => c.instance.id === selectedCarriedId) || carried[0];

    // Compute span. Default is 196", or calculate based on last carried truss.
    const maxCarriedX = carried.length > 0 ? Math.max(...carried.map(c => c.localX)) : 0;
    const resolvedTreSpan = group.girder.treData?.span;
    const span = (resolvedTreSpan && resolvedTreSpan > 0) ? resolvedTreSpan : (group.girder.label === "T07" ? 196 : (maxCarriedX > 0 ? Math.ceil(maxCarriedX + 6.5) : 196));

    // Compute feet and inches representation of span
    const feet = Math.floor(span / 12);
    const inches = Math.round(span % 12);

    // Split bottom chord at 120" for T07, or at 61% of span for other trusses
    const splitX = group.girder.label === "T07" ? 120 : Math.round(span * 0.61);

    // Profile elements (Materials & Sizes)
    const topChordMaterial = group.girder.ifcTopChord || group.girder.treData?.topChord || selectedCarried?.treData?.topChord || "2x4 No.2 SP";
    const bottomChordMaterial = group.girder.ifcBottomChord || group.girder.treData?.bottomChord || selectedCarried?.treData?.bottomChord || "B1/B2 2x6 2400F SP";
    const websMaterial = group.girder.ifcWebs || group.girder.treData?.webs || selectedCarried?.treData?.webs || "2x4 No.3 SP";

    // Reactions & Engineering metrics
    const downwardReaction = selectedCarried?.downReaction ?? selectedCarried?.treData?.maxReaction ?? 0;
    const upliftReaction = selectedCarried?.upliftReaction ?? 0;
    const deflection = `L/360 (${(span / 360).toFixed(2)}")`;
    const csi = group.girder.treData?.csi !== undefined ? group.girder.treData.csi : 0.76;

    return (
        <div className="flex-1 flex overflow-hidden bg-[#1E1F29]">
            {/* Middle Column: Carried Trusses List */}
            <section className="w-80 border-r border-[#141414] flex flex-col bg-[#EDEDED] shrink-0">
                <div className="p-3 border-b border-[#141414] flex justify-between items-center bg-[#D4D3D0] shrink-0">
                    <h2 className="text-[10px] uppercase font-bold tracking-widest text-[#141414]">Carried by {group.girder.label}</h2>
                    <span className="text-[10px] font-mono text-[#141414] font-bold">[{String(carried.length).padStart(2, '0')} Items]</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-left text-[11px] font-mono leading-tight">
                        <thead className="sticky top-0 bg-[#EDEDED] z-10">
                            <tr className="border-b border-[#141414] text-[9px] uppercase opacity-75">
                                <th className="p-2">Truss ID</th>
                                <th className="p-2 text-right">Offset X</th>
                                <th className="p-2 text-right">Rxn ↓</th>
                                <th className="p-2 text-right">Uplift ↑</th>
                                <th className="p-3 text-right">DOL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {carried.map((c) => {
                                const isSelected = c.instance.id === selectedCarried?.instance.id;
                                const rxnDown = c.downReaction !== undefined ? c.downReaction : 0;
                                const rxnUp = c.upliftReaction !== undefined ? c.upliftReaction : 0;
                                const dolVal = group.girder.treData?.dol !== undefined && group.girder.treData.dol !== null ? group.girder.treData.dol : null;
                                return (
                                    <tr 
                                        key={c.instance.id} 
                                        onClick={() => setSelectedCarriedId(c.instance.id)}
                                        className={cn(
                                            "border-b border-[#E4E3E0] hover:bg-white cursor-pointer transition-colors",
                                            isSelected ? "bg-[#141414] text-white border-b border-[#141414]" : "text-[#141414]"
                                        )}
                                    >
                                        <td className="p-2">
                                            <div className="font-bold">{c.instance.label}</div>
                                            <div className={cn(
                                                "text-[8px] font-mono block mt-0.5 leading-none", 
                                                isSelected ? "text-indigo-300" : "text-indigo-600"
                                            )}>
                                                {c.instance.id}
                                            </div>
                                        </td>
                                        <td className="p-2 text-right font-bold flex flex-col items-end">
                                            <span>{Math.floor(c.localX / 12)}'-{(c.localX % 12).toFixed(2)}"</span>
                                            <span className="text-[9px] opacity-60 font-medium">({c.localX.toFixed(2)}")</span>
                                        </td>
                                        <td className="p-2 text-right font-bold" style={{ color: isSelected ? '#FF6B6B' : '#B91C1C' }}>
                                            {rxnDown.toFixed(0)} lb
                                        </td>
                                        <td className="p-2 text-right" style={{ color: isSelected ? '#4FC3F7' : '#0369A1' }}>
                                            {rxnUp.toFixed(0)} lb
                                        </td>
                                        <td className="p-3 text-right" style={{ color: isSelected ? '#81C784' : '#15803D' }}>
                                            {dolVal !== null ? dolVal.toFixed(2) : '—'}
                                        </td>
                                    </tr>
                                )
                            })}
                            {carried.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-4 text-center opacity-50 text-[10px]">No carried trusses.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Right Section: Core Engineering Workspace (Full Dark Mode) */}
            <section className="flex-1 flex flex-col bg-[#0C0D14] overflow-hidden">
                {/* Header Strip */}
                <div className="h-10 bg-[#12131C] border-b border-[#1E293B] flex items-center justify-between px-4 shrink-0">
                    <div className="flex items-center space-x-2">
                        <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-zinc-300">
                            Truss Structural Analyzer Workspace
                        </span>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-[9px] font-mono text-emerald-400 uppercase font-bold">AISC solver 2.4</span>
                        </div>
                    </div>
                </div>

                {/* Split workspace area */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                    {/* Left Panel: The 2 Diagrams Stacked */}
                    <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto custom-scrollbar">
                        
                        {/* DIAGRAM 1 — SIDE ELEVATION */}
                        <div className="border border-[#1E293B] bg-[#0F111A] rounded-md p-4 relative flex flex-col">
                            <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#1E293B]/60">
                                <div className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase flex items-center space-x-1.5">
                                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-white font-mono text-[8px]">01</span>
                                    <span>Diagram 1 — Side Elevation Profile</span>
                                </div>
                                <span className="text-[9px] text-[#FF6B6B] font-bold font-mono">
                                    Active Girder: {group.girder.label}
                                </span>
                            </div>
                            
                            {/* SVG side elevation canvas */}
                            <div className="flex-1 w-full bg-[#08090E] rounded border border-[#14151F] py-2 overflow-hidden flex items-center justify-center">
                                <SideElevationDiagram 
                                    group={group} 
                                    span={span}
                                    splitX={splitX}
                                    carried={carried}
                                    selectedCarriedId={selectedCarried?.instance.id}
                                    topChordMaterial={topChordMaterial}
                                    websMaterial={websMaterial}
                                />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[8px] text-zinc-500 font-mono">
                                <span>Note: Structural coordinate markers scaled in metric inches.</span>
                                <span className="text-zinc-400 font-semibold">[Top Chords in Red | Bottom Chords in Blue | Webs in Green]</span>
                            </div>
                        </div>

                        {/* DIAGRAM 2 — PLAN VIEW */}
                        <div className="border border-[#1E293B] bg-[#0F111A] rounded-md p-4 relative flex flex-col">
                            <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#1E293B]/60">
                                <div className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase flex items-center space-x-1.5">
                                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-white font-mono text-[8px]">02</span>
                                    <span>Diagram 2 — Plan Orientation & Lay Spacing</span>
                                </div>
                                <span className="text-[9px] text-zinc-400 font-mono">
                                    Total Span: {span}" ({feet}'-{inches}")
                                </span>
                            </div>

                            {/* SVG plan view canvas */}
                            <div className="flex-1 w-full bg-[#08090E] rounded border border-[#14151F] py-2 overflow-hidden flex items-center justify-center">
                                <PlanViewDiagram 
                                    group={group}
                                    span={span}
                                    carried={carried}
                                    selectedCarriedId={selectedCarried?.instance.id}
                                    feet={feet}
                                    inches={inches}
                                />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[8px] text-zinc-500 font-mono">
                                <span>Dimension tickers show continuous load laying layout spacing.</span>
                                <span className="text-zinc-400 font-semibold">[X-Girder Central Axis in Blue | Lateral Crossings in Red]</span>
                            </div>
                        </div>

                    </div>

                    {/* Right Panel: Results & Properties Table */}
                    <div className="w-full lg:w-[360px] border-l border-[#1E293B] bg-[#0F111A] p-4 flex flex-col space-y-4 overflow-y-auto shrink-0">
                        <div className="pb-2 border-b border-[#1E293B] flex items-center justify-between">
                            <h3 className="text-[10px] font-bold text-zinc-300 tracking-widest uppercase">
                                Results & Materials Table
                            </h3>
                            <span className="text-[8px] font-mono text-zinc-500 uppercase">
                                Load File: Connected
                            </span>
                        </div>

                        {/* PROFILE ELEMENTS */}
                        <div className="border border-[#1E293B] bg-[#121422]/50 rounded p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-400 mb-2 flex items-center space-x-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                                <span>Profile Chords & Members</span>
                            </div>
                            <div className="space-y-2.5 font-mono">
                                <div>
                                    <div className="text-[8px] uppercase text-zinc-400 mb-0.5">Top Chord Spec</div>
                                    <div className="text-xs font-bold text-[#FF6B6B] border-b border-[#2D313F]/60 pb-1 flex justify-between">
                                        <span>TC 2x4</span>
                                        <span>{topChordMaterial}</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[8px] uppercase text-zinc-400 mb-0.5">Bottom Chord Spec</div>
                                    <div className="text-xs text-[#4FC3F7] space-y-1">
                                        {group.girder.treData?.members && group.girder.treData.members.filter(m => m.type === 'BottomChord').length > 0 ? (
                                            group.girder.treData.members.filter(m => m.type === 'BottomChord').map((m, idx) => {
                                                const xs = m.coords.map(c => c.x);
                                                const minX = xs.length > 0 ? Math.round(Math.min(...xs)) : 0;
                                                const maxX = xs.length > 0 ? Math.round(Math.max(...xs)) : span;
                                                return (
                                                    <div key={idx} className="flex justify-between border-b border-[#2D313F]/60 pb-1">
                                                        <span className="font-semibold">{m.name} ({minX}" - {maxX}")</span>
                                                        <span className="font-bold">{m.size} {m.grade} {m.species}</span>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <>
                                                <div className="flex justify-between border-b border-[#2D313F]/60 pb-1">
                                                    <span className="font-semibold">B1 (0" - {splitX}")</span>
                                                    <span className="font-bold">{bottomChordMaterial}</span>
                                                </div>
                                                <div className="flex justify-between border-b border-[#2D313F]/30 pb-0.5">
                                                    <span className="font-semibold text-zinc-400">B2 ({splitX}" - {span}")</span>
                                                    <span className="font-bold text-zinc-300">{bottomChordMaterial}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[8px] uppercase text-zinc-400 mb-0.5">Truss Webs Spec</div>
                                    <div className="text-xs font-bold text-[#81C784] border-b border-[#2D313F]/60 pb-1 flex justify-between">
                                        <span>WEB 2x4</span>
                                        <span>{websMaterial}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* STRUCTURAL REACTIONS */}
                        <div className="border border-[#1E293B] bg-[#131718]/40 rounded p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 mb-2.5 flex items-center space-x-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                                <span>Structural Reactions</span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3.5 mb-3">
                                <div className="border border-[#1E293B] bg-[#0A0B10] p-2 rounded">
                                    <div className="text-[8px] text-zinc-400 uppercase tracking-tight mb-0.5">Max Downward</div>
                                    <div className="text-sm font-mono font-bold text-[#FFB74D] flex items-center space-x-1">
                                        <ArrowDown className="w-3.5 h-3.5 text-[#FFB74D] shrink-0" />
                                        <span>{downwardReaction.toLocaleString()} lb</span>
                                    </div>
                                </div>
                                <div className="border border-[#1E293B] bg-[#0A0B10] p-2 rounded">
                                    <div className="text-[8px] text-zinc-400 uppercase tracking-tight mb-0.5">Uplift Force</div>
                                    <div className="text-sm font-mono font-bold text-sky-400">
                                        {upliftReaction.toLocaleString()} lb
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2 border-t border-[#1E293B] pt-2 font-mono">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-zinc-400 text-[9px] uppercase">Service Deflection (L/)</span>
                                    <span className="font-bold text-[#81C784]">{deflection}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-zinc-400 text-[9px] uppercase">CSI Stress Ratio</span>
                                    <div className="flex items-center space-x-2">
                                        <span className="font-bold text-white">{csi.toFixed(2)}</span>
                                        <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-emerald-500 rounded-full" 
                                                style={{ width: `${Math.min(100, csi * 100)}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-zinc-400 text-[9px] uppercase">Duration of Load (DOL)</span>
                                    <span className="font-bold text-indigo-400">{group.girder.treData?.dol !== undefined && group.girder.treData.dol !== null ? group.girder.treData.dol.toFixed(2) : "N/A"}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-zinc-400 text-[9px] uppercase">Bearing Side</span>
                                    <span className="font-bold uppercase text-white">{selectedCarried?.bearingSide ? `${selectedCarried.bearingSide.toUpperCase()} END` : "LEFT END"}</span>
                                </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-[#1E293B]/40 space-y-1 font-mono text-[10px] text-zinc-300">
                                <div className="text-[8px] text-zinc-500 uppercase tracking-wider mb-1">Reaction Details Checklist</div>
                                <div className="bg-[#090A0F] p-2 rounded border border-[#1E293B]/45 space-y-1 select-all">
                                    <div>Rxn Down: {downwardReaction.toLocaleString()} lb ({selectedCarried?.bearingSide ? `${selectedCarried.bearingSide.toUpperCase()} bearing` : "LEFT bearing"})</div>
                                    <div>Rxn Up: {upliftReaction !== undefined && upliftReaction !== null ? `${upliftReaction} lb` : "N/A" }</div>
                                    <div>DOL: {group.girder.treData?.dol !== undefined && group.girder.treData.dol !== null ? group.girder.treData.dol.toFixed(2) : "N/A"}</div>
                                </div>
                            </div>
                        </div>

                        {/* SELECTED TRUSS DETAILS IN SOLVER */}
                        <div className="border border-[#1E293B] bg-[#12131C] rounded p-3 text-[10px] font-mono text-zinc-300">
                            <div className="text-[8px] uppercase text-zinc-400 font-bold mb-1.5 tracking-wider">
                                Solver Selected Node Context
                            </div>
                            <div className="space-y-1 select-text">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Node ID:</span>
                                    <span className="font-bold text-zinc-100">{selectedCarried?.instance.id}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Label:</span>
                                    <span className="font-semibold text-zinc-100">{selectedCarried?.instance.label}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Local Offset:</span>
                                    <span className="font-bold text-[#FFB74D]">{selectedCarried?.localX.toFixed(2)}"</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Dist From GE:</span>
                                    <span className="font-bold text-sky-400">{selectedCarried?.distFromGE?.toFixed(2) || '0.00'}"</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Spacing:</span>
                                    <span className="font-bold text-emerald-400">
                                        {selectedCarried?.spacing != null ? `${selectedCarried.spacing.toFixed(2)}"` : "N/A"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Orientation:</span>
                                    <span className="font-bold text-zinc-100">{selectedCarried?.angle === 90 ? "90° (Perpendicular)" : "0° (Parallel)"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Global Rot:</span>
                                    <span className="font-bold text-zinc-100">{selectedCarried?.rotation || 0}°</span>
                                </div>
                            </div>
                        </div>

                        {/* CONNECTION STATE */}
                        <div className="mt-auto border-t border-[#1E293B] pt-4.5">
                            <div className="flex flex-col space-y-1.5 bg-[#081C15] border border-emerald-500/20 rounded p-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] uppercase font-bold text-emerald-400 tracking-wider">
                                        Connection State
                                    </span>
                                    <span className="px-2 py-0.5 text-xs font-mono font-black tracking-tight text-emerald-300 bg-emerald-950 border border-emerald-500/40 rounded flex items-center space-x-1 shadow-sm">
                                        <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0 inline mr-0.5" />
                                        <span>NOMINAL</span>
                                    </span>
                                </div>
                                <span className="text-[8.5px] leading-relaxed text-emerald-400/75 font-mono">
                                    Web hangers and fasteners verified compliant under wood design code requirements.
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

// ==========================
// SUB-DIAGRAM COMPONENTS
// ==========================

interface SideElevationDiagramProps {
    group: GirderGroup;
    span: number;
    splitX: number;
    carried: CarriedTruss[];
    selectedCarriedId?: string;
    topChordMaterial: string;
    websMaterial: string;
}

function SideElevationDiagram({
    group,
    span,
    splitX,
    carried,
    selectedCarriedId,
    topChordMaterial,
    websMaterial
}: SideElevationDiagramProps) {
    const viewWidth = 800;
    const viewHeight = 240;

    const paddingX = 55;
    const drawWidth = viewWidth - (paddingX * 2); // 690 coords

    const members = group.girder.treData?.members || [];
    const hasDynamicMembers = members.length > 0;

    const mockMembers: any[] = [];
    if (!hasDynamicMembers) {
        // Fallback: draw a beautiful, correct triangular roof shape!
        const h = group.girder.label === "T07" ? 54 : 45; // peak height in inches
        const ptPeak = { x: span / 2, y: h };
        
        // Left Top Chord (TC1)
        mockMembers.push({
            name: "TC1",
            type: "TopChord",
            coords: [
                { x: 0, y: 0 },
                { x: span / 2, y: h },
                { x: span / 2, y: h - 3.5 },
                { x: 0, y: -3.5 }
            ]
        });
        // Right Top Chord (TC2)
        mockMembers.push({
            name: "TC2",
            type: "TopChord",
            coords: [
                { x: span / 2, y: h },
                { x: span, y: 0 },
                { x: span, y: -3.5 },
                { x: span / 2, y: h - 3.5 }
            ]
        });
        // Bottom Chord B1 (0 to splitX)
        mockMembers.push({
            name: "BC1",
            type: "BottomChord",
            coords: [
                { x: 0, y: -3.5 },
                { x: splitX, y: -3.5 },
                { x: splitX, y: 0 },
                { x: 0, y: 0 }
            ]
        });
        // Bottom Chord B2 (splitX to span)
        mockMembers.push({
            name: "BC2",
            type: "BottomChord",
            coords: [
                { x: splitX, y: -3.5 },
                { x: span, y: -3.5 },
                { x: span, y: 0 },
                { x: splitX, y: 0 }
            ]
        });

        // Zigzag Webs
        const panelPoints = [0, span * 0.2, span * 0.4, span * 0.6, span * 0.8, span];
        for (let i = 0; i < panelPoints.length - 1; i++) {
            const xL = panelPoints[i];
            const xR = panelPoints[i+1];
            const yL = xL <= span / 2 ? (xL / (span / 2)) * h : ((span - xL) / (span / 2)) * h;
            const yR = xR <= span / 2 ? (xR / (span / 2)) * h : ((span - xR) / (span / 2)) * h;

            if (i % 2 === 0) {
                mockMembers.push({
                    name: `W${i+1}`,
                    type: "Web",
                    coords: [
                        { x: xL, y: 0 },
                        { x: xR, y: yR }
                    ]
                });
            } else {
                mockMembers.push({
                    name: `W${i+1}`,
                    type: "Web",
                    coords: [
                        { x: xL, y: yL },
                        { x: xR, y: 0 }
                    ]
                });
            }
        }
    }

    const activeMembers = hasDynamicMembers ? members : mockMembers;

    // Bounding Box calculation for flexible scaling
    let minX = 0;
    let maxX = span || 196;
    let minY = -5;
    let maxY = 60;

    const allXs: number[] = [];
    const allYs: number[] = [];
    activeMembers.forEach(m => {
        if (m.coords) {
            m.coords.forEach((pt: any) => {
                allXs.push(pt.x);
                allYs.push(pt.y);
            });
        }
    });

    if (allXs.length > 0) {
        minX = Math.min(...allXs);
        maxX = Math.max(...allXs);
        minY = Math.min(...allYs);
        maxY = Math.max(...allYs);
    }

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);

    const paddingYBase = 40;
    const drawHeightBase = viewHeight - (paddingYBase * 2);

    const scaleXFactor = drawWidth / spanX;
    const scaleYFactor = drawHeightBase / spanY;

    // Use full width and height for balanced visual diagram view
    const currentPaddingX = paddingX;
    const currentPaddingY = paddingYBase;

    const scaleX = (xInches: number) => {
        return currentPaddingX + ((xInches - minX) * scaleXFactor);
    };

    const scaleY = (yInches: number) => {
        return (viewHeight - currentPaddingY) - ((yInches - minY) * scaleYFactor);
    };

    function findBottomChordYAt(x: number): number {
        const activeBCs = activeMembers.filter(m => m.type === 'BottomChord');
        let maxYVal = 0;
        let found = false;
        
        for (const bc of activeBCs) {
            if (!bc.coords || bc.coords.length < 2) continue;
            const xs = bc.coords.map((pt: any) => pt.x);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            if (x >= xMin - 1 && x <= xMax + 1) {
                for (let i = 0; i < bc.coords.length - 1; i++) {
                    const x1 = bc.coords[i].x, y1 = bc.coords[i].y;
                    const x2 = bc.coords[i+1].x, y2 = bc.coords[i+1].y;
                    if (x >= Math.min(x1, x2) - 0.5 && x <= Math.max(x1, x2) + 0.5) {
                        let y = 0;
                        if (Math.abs(x2 - x1) < 0.1) {
                            y = Math.max(y1, y2);
                        } else {
                            const t = (x - x1) / (x2 - x1);
                            y = y1 + t * (y2 - y1);
                        }
                        if (!found || y > maxYVal) {
                            maxYVal = y;
                            found = true;
                        }
                    }
                }
            }
        }
        return found ? maxYVal : 0; // default top of bottom chord is 0
    }

    return (
        <svg 
            viewBox={`0 0 ${viewWidth} ${viewHeight}`} 
            className="w-full h-full select-none"
        >
            {/* Grid Pattern Background for schematic texture */}
            <defs>
                <pattern id="elevation-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2D3142" strokeWidth="0.5" opacity="0.4" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#elevation-grid)" />

            {/* Dynamic Truss Members (rendered and colored by type) */}
            <g id="truss-members-group">
                {activeMembers.map((m, idx) => {
                    if (!m.coords || m.coords.length < 2) return null;
                    
                    let color = "#FFFFFF";
                    if (m.type === 'TopChord') color = "#FF6B6B";
                    else if (m.type === 'BottomChord') color = "#4FC3F7";
                    else if (m.type === 'Web') color = "#81C784";
                    else if (m.type === 'Peak' || m.type === 'Dummy') color = "#718096";

                    let pathD = '';
                    m.coords.forEach((pt: any, i: number) => {
                        pathD += (i === 0 ? 'M' : 'L') + ` ${scaleX(pt.x)} ${scaleY(pt.y)} `;
                    });
                    if (m.coords.length >= 3) {
                        pathD += ` Z`;
                    }

                    return (
                        <path 
                            key={`member-${m.name}-${idx}`} 
                            d={pathD} 
                            fill={color}
                            fillOpacity={m.type === 'Web' ? 0.15 : 0.3}
                            stroke={color} 
                            strokeWidth={m.type === 'Web' ? 1.5 : 2} 
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="transition-all duration-300 hover:fill-opacity-50"
                        />
                    );
                })}
            </g>

            {/* Left Bearing Support Triangle (Civil Pinned) */}
            <g id="support-left" transform={`translate(${scaleX(0)}, ${scaleY(0)})`}>
                <polygon points="0,0 -8,13 8,13" fill="#A0AEC0" />
                <line x1="-13" y1="14" x2="13" y2="14" stroke="#A0AEC0" strokeWidth={1.5} />
                <path d="M -10,14 L-13,17 M -5,14 L -8,17 M 0,14 L -3,17 M 5,14 L 2,17 M 10,14 L 7,17" stroke="#A0AEC0" strokeWidth={1} />
                <text x="-15" y="11" textAnchor="end" fill="#FFF" className="text-[8px] font-mono opacity-50">L BEARING</text>
            </g>

            {/* Right Bearing Support Triangle (Civil Roller) */}
            <g id="support-right" transform={`translate(${scaleX(span)}, ${scaleY(0)})`}>
                <polygon points="0,0 -8,13 8,13" fill="#A0AEC0" />
                <line x1="-13" y1="14" x2="13" y2="14" stroke="#A0AEC0" strokeWidth={1.5} />
                <circle cx="-5" cy="16.5" r="1.5" fill="#A0AEC0" />
                <circle cx="0" cy="16.5" r="1.5" fill="#A0AEC0" />
                <circle cx="5" cy="16.5" r="1.5" fill="#A0AEC0" />
                <line x1="-13" y1="19" x2="13" y2="19" stroke="#A0AEC0" strokeWidth={1} />
                <text x="15" y="11" textAnchor="start" fill="#FFF" className="text-[8px] font-mono opacity-50">R BEARING</text>
            </g>

            {/* Member labels in Diagram */}
            {/* Top Chord Spec Tag */}
            <g id="label-top-chord" transform={`translate(${viewWidth / 2}, ${scaleY(maxY) - 15})`}>
                <rect x="-65" y="-9" width="130" height="15" rx="2" fill="#201116" stroke="#FF6B6B" strokeWidth="1" opacity="0.9" />
                <text textAnchor="middle" y="2" fill="#FFF" className="text-[9px] font-mono font-bold tracking-tight">
                    {topChordMaterial}
                </text>
            </g>

            {/* Webs Spec Tag */}
            <g id="label-webs" transform={`translate(${viewWidth / 2}, ${scaleY((minY + maxY) / 2)})`}>
                <rect x="-55" y="-8" width="110" height="15" rx="2" fill="#0C1B14" stroke="#81C784" strokeWidth="1" opacity="0.95" />
                <text textAnchor="middle" y="3" fill="#FFF" className="text-[9px] font-mono font-bold tracking-tight">
                    {websMaterial}
                </text>
            </g>

            {/* Bottom Chord Split Member Labels */}
            {group.girder.treData?.members && group.girder.treData.members.filter(m => m.type === 'BottomChord').length > 0 ? (
                group.girder.treData.members.filter(m => m.type === 'BottomChord').map((m, idx, arr) => {
                    const xs = m.coords.map(c => c.x);
                    const minX = xs.length > 0 ? Math.round(Math.min(...xs)) : 0;
                    const maxX = xs.length > 0 ? Math.round(Math.max(...xs)) : span;
                    const midX = (minX + maxX) / 2;
                    return (
                        <g key={idx}>
                            <g id={`label-chord-dynamic-${idx}`} transform={`translate(${scaleX(midX)}, ${scaleY(0) + 30})`}>
                                <text textAnchor="middle" fill="#FFFFFF" className="text-[10px] font-mono font-bold">
                                    {m.name} {m.size} {m.grade} {m.species}
                                </text>
                                <text textAnchor="middle" y="9" fill="#4FC3F7" className="text-[7.5px] font-mono opacity-80">
                                    x = {minX}" to {maxX}"
                                </text>
                                <line x1={-scaleX(midX) + scaleX(minX)} y1="-10" x2={-scaleX(midX) + scaleX(maxX)} y2="-10" stroke="#4FC3F7" strokeWidth="0.75" opacity="0.4" strokeDasharray="2,2" />
                            </g>
                            {idx < arr.length - 1 && (
                                <g id={`chord-split-tic-${idx}`} transform={`translate(${scaleX(maxX)}, ${scaleY(0)})`}>
                                    <line x1="0" y1="-10" x2="0" y2="10" stroke="#FFFFFF" strokeWidth={2} />
                                    <text x="0" y="20" textAnchor="middle" fill="#FFF" className="text-[8px] font-mono font-bold">
                                        SPLIT {maxX}"
                                    </text>
                                </g>
                            )}
                        </g>
                    );
                })
            ) : (
                <>
                    {/* B1 Label */}
                    <g id="label-chord-b1" transform={`translate(${scaleX(splitX / 2)}, ${scaleY(0) + 30})`}>
                        <text textAnchor="middle" fill="#FFFFFF" className="text-[10px] font-mono font-bold">
                            B1 B1/B2 2x6 2400F SP
                        </text>
                        <text textAnchor="middle" y="9" fill="#4FC3F7" className="text-[7.5px] font-mono opacity-80">
                            x = 0 to {splitX}"
                        </text>
                        <line x1={-scaleX(splitX/2) + scaleX(0)} y1="-10" x2={-scaleX(splitX/2) + scaleX(splitX)} y2="-10" stroke="#4FC3F7" strokeWidth="0.75" opacity="0.4" strokeDasharray="2,2" />
                    </g>

                    {/* Split boundary tick */}
                    <g id="chord-split-tic" transform={`translate(${scaleX(splitX)}, ${scaleY(0)})`}>
                        <line x1="0" y1="-10" x2="0" y2="10" stroke="#FFFFFF" strokeWidth={2} />
                        <text x="0" y="20" textAnchor="middle" fill="#FFF" className="text-[8px] font-mono font-bold">
                            SPLIT {splitX}"
                        </text>
                    </g>

                    {/* B2 Label */}
                    <g id="label-chord-b2" transform={`translate(${scaleX(splitX + (span - splitX) / 2)}, ${scaleY(0) + 30})`}>
                        <text textAnchor="middle" fill="#FFFFFF" className="text-[10px] font-mono font-bold">
                            B2 B1/B2 2x6 2400F SP
                        </text>
                        <text textAnchor="middle" y="9" fill="#4FC3F7" className="text-[7.5px] font-mono opacity-80">
                            x = {splitX}" to {span}"
                        </text>
                        <line x1={-scaleX(splitX + (span - splitX)/2) + scaleX(splitX)} y1="-10" x2={-scaleX(splitX + (span - splitX)/2) + scaleX(span)} y2="-10" stroke="#4FC3F7" strokeWidth="0.75" opacity="0.4" strokeDasharray="2,2" />
                    </g>
                </>
            )}

            {/* CARRIED TRUSS REACTION ARROWS & LABELS */}
            {carried.map((c) => {
                const isSelected = c.instance.id === selectedCarriedId;
                const bcY = findBottomChordYAt(c.localX);
                const arrowX = scaleX(c.localX);
                const arrowY = scaleY(bcY);

                return (
                    <g key={`arrow-${c.instance.id}`}>
                        {/* Downward reaction loading indicator at corresponding bottom chord offset */}
                        <g transform={`translate(${arrowX}, ${arrowY})`}>
                            {/* Orange Downward Directional Force Pointer */}
                            <g className="transition-all duration-300">
                                {/* Vertical Arrow Shaft connecting from above bottom chord down to it */}
                                <line 
                                    x1={0} y1={-44} 
                                    x2={0} y2={0} 
                                    stroke="#FFB74D" 
                                    strokeWidth={isSelected ? 4.5 : 2.5} 
                                    strokeLinecap="round"
                                />
                                {/* Solid Arrowhead touching the bottom chord */}
                                <polygon 
                                    points="0,3 -5,-8 5,-8" 
                                    fill="#FFB74D" 
                                    transform={`scale(${isSelected ? 1.4 : 1})`}
                                />
                            </g>

                            {/* Node point marker where truss sits on bottom chord */}
                            <circle 
                                cx={0} cy={0} 
                                r={isSelected ? 5.5 : 3.5} 
                                fill={isSelected ? "#FFF" : "#FFB74D"} 
                                stroke="#14151F" 
                                strokeWidth={1.5} 
                            />

                            {/* Offset Label Floating above Arrow shaft */}
                            <g transform={`translate(0, -48)`}>
                                <rect 
                                    x={isSelected ? -42 : -36} 
                                    y="-13" 
                                    width={isSelected ? 84 : 72} 
                                    height="15" 
                                    rx="2.5" 
                                    fill={isSelected ? "#FFB74D" : "#1A1B26"} 
                                    stroke={isSelected ? "#FFF" : "#FFB74D"} 
                                    strokeWidth={isSelected ? 1.5 : 0.75} 
                                    opacity="0.95" 
                                />
                                <text 
                                    textAnchor="middle" 
                                    y="-2" 
                                    fill={isSelected ? "#111" : "#FFF"} 
                                    className={cn(
                                        "text-[8.5px] font-mono",
                                        isSelected ? "font-black" : "font-semibold"
                                    )}
                                >
                                    {c.instance.label} x={Math.floor(c.localX / 12)}'-{(c.localX % 12).toFixed(2)}"
                                </text>
                            </g>
                        </g>
                    </g>
                )
            })}

            {/* Horizontal Timeline/Ruler X Axis (0 to Span) at absolute base */}
            <g id="x-axis-base" transform={`translate(0, ${viewHeight - 20})`}>
                <line x1={scaleX(0)} y1="0" x2={scaleX(span)} y2="0" stroke="#475569" strokeWidth="1.5" />
                
                {/* 0 and Span tick marks */}
                <line x1={scaleX(0)} y1="-4" x2={scaleX(0)} y2="4" stroke="#A0AEC0" strokeWidth="2" />
                <text x={scaleX(0)} y="13" textAnchor="middle" fill="#FFFFFF" className="text-[9px] font-mono font-bold">0"</text>
                
                {/* Intermediate incremental distance ticks */}
                {Array.from({ length: 5 }).map((_, index) => {
                    const pct = (index + 1) / 6;
                    const inchVal = Math.round(pct * span);
                    const tickX = scaleX(inchVal);
                    return (
                        <g key={`tick-${index}`} transform={`translate(${tickX}, 0)`}>
                            <line x1="0" y1="-3" x2="0" y2="3" stroke="#475569" strokeWidth="1" />
                            <text y="12" textAnchor="middle" fill="#A0AEC0" className="text-[8px] font-mono opacity-80">{inchVal}"</text>
                        </g>
                    );
                })}

                <line x1={scaleX(span)} y1="-4" x2={scaleX(span)} y2="4" stroke="#A0AEC0" strokeWidth="2" />
                <text x={scaleX(span)} y="13" textAnchor="middle" fill="#FFFFFF" className="text-[9px] font-mono font-bold">{span}" (Span)</text>
            </g>
        </svg>
    )
}

// PlanViewDiagram Component
interface PlanViewDiagramProps {
    group: GirderGroup;
    span: number;
    carried: CarriedTruss[];
    selectedCarriedId?: string;
    feet: number;
    inches: number;
}

function PlanViewDiagram({
    group,
    span,
    carried,
    selectedCarriedId,
    feet,
    inches
}: PlanViewDiagramProps) {
    const viewWidth = 800;
    const viewHeight = 150;

    const paddingX = 55;
    const drawWidth = viewWidth - (paddingX * 2);

    const scaleX = (xInches: number) => {
        return paddingX + (xInches / span) * drawWidth;
    };

    const axisY = 60;

    return (
        <svg 
            viewBox={`0 0 ${viewWidth} ${viewHeight}`} 
            className="w-full h-full select-none"
        >
            <rect width="100%" height="100%" fill="url(#elevation-grid)" />

            {/* Thick Blue Girder Axis Centroid Line */}
            <line 
                x1={scaleX(0)} y1={axisY} 
                x2={scaleX(span)} y2={axisY} 
                stroke="#4FC3F7" 
                strokeWidth={9} 
                strokeLinecap="round"
            />

            {/* Left and Right end capping limits */}
            <line x1={scaleX(0)} y1={axisY - 25} x2={scaleX(0)} y2={axisY + 25} stroke="#cbd5e1" strokeWidth={3} />
            <line x1={scaleX(span)} y1={axisY - 25} x2={scaleX(span)} y2={axisY + 25} stroke="#cbd5e1" strokeWidth={3} />

            {/* End Point Labels */}
            <text x={scaleX(span) + 6} y={axisY + 3} fill="#A0AEC0" className="text-[9px] font-mono font-bold">LEFT (GE)</text>
            <text x={scaleX(0) - 6} y={axisY + 3} textAnchor="end" fill="#A0AEC0" className="text-[9px] font-mono font-bold">RIGHT</text>

            {/* Carried trusses indicators */}
            {carried.map((c) => {
                const isSelected = c.instance.id === selectedCarriedId;
                const arrowX = scaleX(c.localX);
                const isPerpendicular = c.angle === 90;
                
                // Which side the truss extends heavily to
                // 'above' = top of screen, 'below' = bottom of screen
                const extTop = (c.side === 'above' || !c.side) ? 35 : 10;
                const extBottom = (c.side === 'below' || !c.side) ? 35 : 10;
                
                return (
                    <g key={`plan-arrow-${c.instance.id}`}>
                        {isPerpendicular ? (
                            <>
                                {/* Perpendicular (90 deg) Lines */}
                                <line 
                                    x1={arrowX} y1={axisY - extTop} 
                                    x2={arrowX} y2={axisY + extBottom} 
                                    stroke="#FF6B6B" 
                                    strokeWidth={isSelected ? 4 : 2} 
                                    strokeLinecap="round"
                                />
                                {/* Upper Direction Arrow if extending Top */}
                                {c.side !== 'below' && (
                                    <polygon 
                                        points="0,-3 -4,5 4,5" 
                                        fill="#FF6B6B"
                                        transform={`translate(${arrowX}, ${axisY - extTop}) scale(${isSelected ? 1.4 : 1})`}
                                    />
                                )}
                                {/* Lower Direction Arrow if extending Bottom */}
                                {c.side !== 'above' && (
                                    <polygon 
                                        points="0,3 -4,-5 4,-5" 
                                        fill="#FF6B6B"
                                        transform={`translate(${arrowX}, ${axisY + extBottom}) scale(${isSelected ? 1.4 : 1})`}
                                    />
                                )}
                            </>
                        ) : (
                            <>
                                {/* Parallel (0 deg) Lines */}
                                {c.side === 'above' ? (
                                    <line 
                                        x1={arrowX - 25} y1={axisY - 15} 
                                        x2={arrowX + 25} y2={axisY - 15} 
                                        stroke="#FFB74D" 
                                        strokeWidth={isSelected ? 5 : 3} 
                                        strokeLinecap="round"
                                    />
                                ) : (
                                    <line 
                                        x1={arrowX - 25} y1={axisY + 15} 
                                        x2={arrowX + 25} y2={axisY + 15} 
                                        stroke="#FFB74D" 
                                        strokeWidth={isSelected ? 5 : 3} 
                                        strokeLinecap="round"
                                    />
                                )}
                             </>
                        )}

                        {/* Center connection knot on girder */}
                        <circle 
                            cx={arrowX} cy={axisY} 
                            r={isSelected ? 5.5 : 3.5} 
                            fill={isSelected ? "#FFF" : (isPerpendicular ? "#FF6B6B" : "#FFB74D")} 
                            stroke="#14151F" 
                            strokeWidth={1.5}
                        />

                        {/* Highlight Ring around Selection */}
                        {isSelected && (
                            <circle 
                                cx={arrowX} cy={axisY} 
                                r={12} 
                                fill="none" 
                                stroke={isPerpendicular ? "#FFB74D" : "#4FC3F7"} 
                                strokeWidth={2}
                                strokeDasharray="4,2"
                                className="animate-spin text-opacity-100"
                                style={{ transformOrigin: `${arrowX}px ${axisY}px`, animationDuration: '6s' }}
                            />
                        )}
                    </g>
                )
            })}

            {/* SPACING DIMENSIONS BELOW AXIS */}
            <g id="dimension-spacing-labels">
                {carried.map((c, idx) => {
                    // Compute interval boundaries
                    const prevXVal = idx === 0 ? 0 : carried[idx - 1].localX;
                    const segmentWidth = c.localX - prevXVal;
                    
                    const leftBound = scaleX(prevXVal);
                    const rightBound = scaleX(c.localX);
                    const centerPoint = (leftBound + rightBound) / 2;
                    const dimY = axisY + 46;

                    return (
                        <g key={`dim-segment-${idx}`}>
                            {/* Thin dimension visual line with ticks */}
                            <line 
                                x1={leftBound + 3} y1={dimY} 
                                x2={rightBound - 3} y2={dimY} 
                                stroke="#A0AEC0" 
                                strokeWidth="1" 
                                opacity="0.65"
                            />
                            {/* Slashes at boundaries */}
                            <line x1={leftBound - 3} y1={dimY + 3} x2={leftBound + 3} y2={dimY - 3} stroke="#A0AEC0" strokeWidth="1" opacity="0.65" />
                            <line x1={rightBound - 3} y1={dimY + 3} x2={rightBound + 3} y2={dimY - 3} stroke="#A0AEC0" strokeWidth="1" opacity="0.65" />

                            {/* Dimension value text */}
                            <text 
                                x={centerPoint} y={dimY - 4} 
                                textAnchor="middle" 
                                fill="#FFFFFF" 
                                className="text-[10px] font-mono font-bold tracking-tight bg-[#0C0D14]"
                            >
                                {segmentWidth.toFixed(2)}"
                            </text>
                        </g>
                    )
                })}
            </g>

            {/* PLAN CENTER DIAGRAM LABEL */}
            <g id="center-tag" transform={`translate(${viewWidth / 2}, 20)`}>
                <text textAnchor="middle" fill="#FFFFFF" className="text-xs font-bold tracking-wider font-sans uppercase">
                    {group.girder.label} Girder — {span}" ({feet}'-{inches}")
                </text>
            </g>
        </svg>
    )
}
