import React, { useState, useRef } from 'react';
import { analyzeFiles, type LogCallback } from '../lib/parser';
import { GirderGroup, LogEntry } from '../types';
import { getSSTToken, setSSTToken, clearSSTToken, hasSSTToken } from '../lib/sst-api';

interface FileUploadProps {
  onAnalyze: (girders: GirderGroup[]) => void;
  onLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

export function FileUpload({ onAnalyze, onLog }: FileUploadProps) {
  const [ifcFiles, setIfcFiles] = useState<File[]>([]);
  const [treFiles, setTreFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const ifcInputRef = useRef<HTMLInputElement>(null);
  const treInputRef = useRef<HTMLInputElement>(null);

  const handleIfcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setIfcFiles(Array.from(e.target.files));
      onLog({ message: `Queued ${e.target.files.length} IFC/Text file(s).`, type: 'info' });
    }
  };

  const handleTreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setTreFiles(Array.from(e.target.files));
      onLog({ message: `Queued ${e.target.files.length} TRE file(s).`, type: 'info' });
    }
  };

  const handleAnalyze = async () => {
    if (ifcFiles.length === 0 && treFiles.length === 0) {
      onLog({ message: "No files provided. Running with internal structured IFC + MiTek mock fallback...", type: 'warning' });
      
      const mockIfcText = [
        "/* Mock IFC Truss File with MiTek property sets */",
        "#10=IFCELEMENTASSEMBLY('guid1',#2,'T01-1');",
        "#20=IFCELEMENTASSEMBLY('guid2',#2,'T01-2');",
        "#30=IFCELEMENTASSEMBLY('guid3',#2,'G01');",
        "",
        "/* MiTek Left End properties for T01-1 */",
        "#101=IFCPROPERTYSINGLEVALUE('X',$,IFCLENGTHMEASURE(10.10417),$);",
        "#102=IFCPROPERTYSINGLEVALUE('Y',$,IFCLENGTHMEASURE(9.125),$);",
        "#103=IFCPROPERTYSINGLEVALUE('Z',$,IFCLENGTHMEASURE(16.60417),$);",
        "#100=IFCPROPERTYSET('pset-guid-1',#2,'MiTek_PSet_LeftEnd',$,(#101,#102,#103));",
        "#150=IFCRELDEFINESBYPROPERTIES('rel-guid-1',#2,$,$,(#10),#100);",
        "",
        "/* MiTek Left End properties for T01-2 */",
        "#201=IFCPROPERTYSINGLEVALUE('X',$,IFCLENGTHMEASURE(22.15000),$);",
        "#202=IFCPROPERTYSINGLEVALUE('Y',$,IFCLENGTHMEASURE(9.125),$);",
        "#203=IFCPROPERTYSINGLEVALUE('Z',$,IFCLENGTHMEASURE(18.25000),$);",
        "#200=IFCPROPERTYSET('pset-guid-2',#2,'MiTek_PSet_LeftEnd',$,(#201,#202,#203));",
        "#250=IFCRELDEFINESBYPROPERTIES('rel-guid-2',#2,$,$,(#20),#200);",
        "",
        "/* MiTek Left End properties for G01 */",
        "#301=IFCPROPERTYSINGLEVALUE('X',$,IFCLENGTHMEASURE(8.50000),$);",
        "#302=IFCPROPERTYSINGLEVALUE('Y',$,IFCLENGTHMEASURE(12.00000),$);",
        "#303=IFCPROPERTYSINGLEVALUE('Z',$,IFCLENGTHMEASURE(15.75000),$);",
        "#300=IFCPROPERTYSET('pset-guid-3',#2,'MiTek_PSet_LeftEnd',$,(#301,#302,#303));",
        "#350=IFCRELDEFINESBYPROPERTIES('rel-guid-3',#2,$,$,(#30),#300);"
      ].join("\n");

      const dummyIfc = new File([mockIfcText], "mock.ifc");
      const dummyTre = new File(["TRUSS T01\nTC 2x6 No.1 SP\nREACTION 1100"], "mock.tre");
      setIfcFiles([dummyIfc]);
      setTreFiles([dummyTre]);
      runAnalysis([dummyIfc], [dummyTre]);
      return;
    }
    runAnalysis(ifcFiles, treFiles);
  };

  const runAnalysis = async (iFiles: File[], tFiles: File[]) => {
    setIsAnalyzing(true);
    try {
      const girders = await analyzeFiles(iFiles, tFiles, (msg, type = 'info') => {
         onLog({ message: msg, type });
      });
      onAnalyze(girders);
    } catch (e) {
      onLog({ message: "Critical failure during analysis.", type: 'error' });
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col p-3 gap-2 bg-[#D4D3D0] border-b border-[#141414]">
        <div className="flex gap-2">
            <button 
                onClick={() => ifcInputRef.current?.click()}
                className="flex-1 px-2 py-1.5 border border-[#141414] bg-[#EDEDED] text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-white transition-colors truncate"
            >
                {ifcFiles.length > 0 ? `${ifcFiles.length} IFC Loaded` : '+ Import IFC'}
            </button>
            <input 
                ref={ifcInputRef} 
                type="file" 
                multiple 
                accept=".ifc" 
                className="hidden" 
                onChange={handleIfcChange} 
            />

            <button 
                onClick={() => treInputRef.current?.click()}
                className="flex-1 px-2 py-1.5 border border-[#141414] bg-[#EDEDED] text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-white transition-colors truncate"
            >
                {treFiles.length > 0 ? `${treFiles.length} TRE Loaded` : '+ Import TRE'}
            </button>
            <input 
                ref={treInputRef} 
                type="file" 
                multiple 
                accept=".tre" 
                className="hidden" 
                onChange={handleTreChange} 
            />
        </div>

        <button 
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="w-full px-4 py-2 bg-[#141414] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50"
        >
            {isAnalyzing ? 'Processing...' : 'Run Analysis Engine'}
        </button>

        {/* SST Token */}
        <SSTTokenSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SST Bearer Token — compact inline section
// ---------------------------------------------------------------------------

function SSTTokenSection() {
  const [tokenValue, setTokenValue] = useState(getSSTToken() ?? '');
  const [saved, setSaved] = useState(hasSSTToken());
  const [editing, setEditing] = useState(false);

  const handleSave = () => {
    if (tokenValue.trim()) {
      setSSTToken(tokenValue.trim());
      setSaved(true);
      setEditing(false);
    }
  };

  const handleClear = () => {
    clearSSTToken();
    setTokenValue('');
    setSaved(false);
    setEditing(false);
  };

  if (saved && !editing) {
    return (
      <div className="flex items-center justify-between bg-[#EDEDED] border border-[#141414]/30 rounded px-2 py-1.5">
        <div className="flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#141414]">SST Token</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <span className="text-[9px] font-mono text-green-700">Connected</span>
          <button
            onClick={() => setEditing(true)}
            className="text-[8px] font-bold uppercase text-zinc-500 hover:text-[#141414] transition-colors"
          >
            Edit
          </button>
          <button
            onClick={handleClear}
            className="text-[8px] font-bold uppercase text-red-500 hover:text-red-700 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#EDEDED] border border-[#141414]/30 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#141414]">SST Bearer Token</span>
        </div>
        {editing && (
          <button
            onClick={() => { setEditing(false); setTokenValue(getSSTToken() ?? ''); }}
            className="text-[8px] font-bold uppercase text-zinc-500 hover:text-[#141414]"
          >
            Cancel
          </button>
        )}
      </div>
      <input
        type="password"
        value={tokenValue}
        onChange={(e) => setTokenValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder="Paste token from app.strongtie.com/hs DevTools..."
        className="w-full bg-white border border-[#141414]/20 rounded px-2 py-1 text-[9px] font-mono text-[#141414] placeholder:text-zinc-400 focus:outline-none focus:border-[#141414]/60"
      />
      <button
        onClick={handleSave}
        disabled={!tokenValue.trim()}
        className="w-full px-2 py-1 bg-[#141414] text-white text-[9px] font-bold uppercase tracking-wider hover:bg-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded"
      >
        Save Token
      </button>
    </div>
  );
}
