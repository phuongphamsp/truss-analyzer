import { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { cn } from '../lib/utils';

interface LogPanelProps {
  logs: LogEntry[];
}


export function LogPanel({ logs }: LogPanelProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="flex flex-col bg-[#141414] overflow-hidden h-full">
            <div className="p-2 border-b border-[#333] bg-black text-white flex justify-between items-center shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#E4E3E0]">System Log</span>
                <span className="text-[10px] font-mono opacity-60">Status: OK</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1 font-mono text-[9px] text-[#D4D3D0] custom-scrollbar">
                {logs.length === 0 ? (
                    <div className="opacity-50 tracking-wider">Awaiting operations...</div>
                ) : (
                    logs.map(log => {
                        return (
                            <div key={log.id} className="flex items-start gap-2">
                                <span className="opacity-40 shrink-0">
                                    [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}]
                                </span>
                                <span className={cn(
                                    log.type === 'error' && "text-red-400 font-bold",
                                    log.type === 'warning' && "text-amber-400",
                                    log.type === 'success' && "text-green-400",
                                    log.type === 'info' && "text-[#D4D3D0]"
                                )}>
                                    {log.message}
                                </span>
                            </div>
                        );
                    })
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    )
}
