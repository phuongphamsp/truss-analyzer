import { useState, useCallback, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { LogPanel } from './components/LogPanel';
import { GirderList } from './components/GirderList';
import { GirderDetails } from './components/GirderDetails';
import { ExportTab } from './components/ExportTab';
import { GirderGroup, LogEntry } from './types';
import { analyzeFiles } from './lib/parser';
import { Cpu, Download } from 'lucide-react';
import { cn } from './lib/utils';

import t07Raw from '../t07.tre.txt?raw';
import t02Raw from '../t02.tre.txt?raw';
import ifcRaw from '../2214224-08T.ifc.txt?raw';

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>([
      { id: '1', timestamp: new Date(), message: 'System initialized. Loading default project files...', type: 'info' }
  ]);
  const [girders, setGirders] = useState<GirderGroup[]>([]);
  const [selectedGirderId, setSelectedGirderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'analyzer' | 'export'>('analyzer');

  const handleLog = useCallback((entry: Omit<LogEntry, 'id'|'timestamp'>) => {
      setLogs(prev => [...prev, { ...entry, id: Math.random().toString(36).substring(2, 9), timestamp: new Date() }]);
  }, []);

  const handleAnalyze = useCallback((extractedGirders: GirderGroup[]) => {
      setGirders(extractedGirders);
      if (extractedGirders.length > 0) {
          setSelectedGirderId(extractedGirders[0].girder.id);
      } else {
          setSelectedGirderId(null);
      }
  }, []);

  // Run analysis on built-in files on mount
  useEffect(() => {
    let isMounted = true;
    const runDefaultAnalysis = async () => {
      try {
        const t07File = new File([t07Raw], "t07.tre.txt", { type: "text/plain" });
        const t02File = new File([t02Raw], "t02.tre.txt", { type: "text/plain" });
        const ifcFile = new File([ifcRaw], "2214224-08T.ifc.txt", { type: "text/plain" });

        const extractedGirders = await analyzeFiles(
          [ifcFile],
          [t07File, t02File],
          (msg, type) => {
            if (isMounted) handleLog({ message: msg, type: type || 'info' });
          }
        );

        if (isMounted) {
          setGirders(extractedGirders);
          if (extractedGirders.length > 0) {
              setSelectedGirderId(extractedGirders[0].girder.id);
          }
        }
      } catch (err) {
        if (isMounted) {
          handleLog({ message: "Failed to parse default files: " + String(err), type: 'error' });
        }
      }
    };
    runDefaultAnalysis();
    return () => { isMounted = false; };
  }, [handleLog]);

  const selectedGirder = girders.find(g => g.girder.id === selectedGirderId) || null;

  return (
    <div className="h-screen w-full bg-[#E4E3E0] text-[#141414] font-sans flex flex-col overflow-hidden select-none">
        <header className="h-14 border-b border-[#141414] flex items-center justify-between px-6 bg-[#D4D3D0] shrink-0">
            <div className="flex items-center space-x-4">
                <div className="w-8 h-8 bg-[#141414] text-white flex items-center justify-center font-bold text-lg italic">T</div>
                {/* App name to be added later */}
            </div>
            <div className="flex items-center space-x-2">
                {/* Engine status text removed */}
            </div>
        </header>

        <main className="flex-1 flex overflow-hidden">
            {/* Left Sidebar */}
            <aside className="w-80 border-r border-[#141414] shrink-0 flex flex-col bg-[#EDEDED]">
                <div className="border-b border-[#141414] bg-[#F2F2F2]">
                    <FileUpload onAnalyze={handleAnalyze} onLog={handleLog} />
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                    <GirderList 
                        girders={girders} 
                        selectedId={selectedGirderId}
                        onSelect={setSelectedGirderId} 
                    />
                </div>
            </aside>

            {/* Main Content Area */}
            <section className="flex-1 flex flex-col min-w-0 bg-[#DEDCD7]">
                <div className="flex-1 flex overflow-hidden">
                    <GirderDetails group={selectedGirder} />
                </div>
            </section>
        </main>

        <footer className="h-8 border-t border-[#141414] bg-[#D4D3D0] flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center space-x-6 text-[9px] font-bold uppercase tracking-tight">
                <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-green-600 mr-2"></span> IFC Engine Ready</div>
                <div className="flex items-center opacity-60">TRE Solver Connected</div>
            </div>
            <div className="text-[9px] font-mono opacity-40">2023-10-27 14:42:01</div>
        </footer>
    </div>
  );
}