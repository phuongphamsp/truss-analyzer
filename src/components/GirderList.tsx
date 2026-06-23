import { GirderGroup } from "../types";
import { cn } from "../lib/utils";
import { Baseline } from "lucide-react";

interface GirderListProps {
    girders: GirderGroup[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}

export function GirderList({ girders, selectedId, onSelect }: GirderListProps) {
    if (girders.length === 0) {
        return (
            <div className="flex flex-col h-full bg-[#EDEDED] text-center justify-center p-6 border-b border-[#141414]">
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-60">Awaiting Data...</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-[#EDEDED]">
            <div className="p-3 border-b border-[#141414] bg-[#141414] text-white flex justify-between items-center shrink-0">
                <h2 className="text-[10px] uppercase font-bold tracking-widest">Girder Trusses</h2>
                <span className="text-[10px] font-mono opacity-60">[{String(girders.length).padStart(2, '0')} Units]</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {girders.map(group => {
                    const isSelected = selectedId === group.girder.id;
                    return (
                        <div
                            key={group.girder.id}
                            onClick={() => onSelect(group.girder.id)}
                            className={cn(
                                "p-3 border-b border-[#141414] cursor-pointer",
                                isSelected ? "bg-[#141414] text-white" : "bg-[#F2F2F2] hover:bg-white"
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-mono text-sm font-bold">{group.girder.label}</span>
                                <span className={cn(
                                    "text-[10px] px-1",
                                    isSelected ? "bg-blue-600 text-white" : "bg-[#141414] text-white"
                                )}>
                                    {isSelected ? 'ACTIVE' : 'PRIMARY'}
                                </span>
                            </div>
                            <div className={cn("text-[9px] font-mono mb-1.5", isSelected ? "text-indigo-300" : "text-indigo-700 opacity-80")}>
                                {group.girder.id}
                            </div>
                            <div className="text-[10px] opacity-60">
                                Connects: {group.carriedTrusses.length} | Load Path Confirmed
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
