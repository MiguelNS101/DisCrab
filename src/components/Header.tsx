import React, { useState, useEffect } from 'react';
import { Radio, Cpu, ShieldCheck, Activity, Terminal } from 'lucide-react';
import { isTauriEnvironment, getProcessMemory } from '../services/tauriBridge';

interface HeaderProps {
  onOpenCodeViewer?: () => void;
  activePid?: number | null;
  activeProcessName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCodeViewer,
  activePid,
  activeProcessName,
}) => {
  const isNative = isTauriEnvironment();
  const [memoryMb, setMemoryMb] = useState<number>(38.4);

  // Monitoramento em tempo real da memória do processo
  useEffect(() => {
    let isMounted = true;
    const fetchMemory = async () => {
      try {
        const mem = await getProcessMemory();
        if (isMounted && mem > 0) {
          setMemoryMb(mem);
        }
      } catch (_) {}
    };

    fetchMemory();
    const interval = setInterval(fetchMemory, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="border-b border-cyan-950/60 bg-neutral-950/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 p-[1px] shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-neutral-950 rounded-[7px] flex items-center justify-center">
              <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-neutral-950" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-wider text-white font-mono uppercase">
                Stream<span className="text-cyan-400">Companion</span>
              </h1>
              <span className="text-[10px] font-mono tracking-widest px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800 text-cyan-300">
                v2.0 RUST + WASAPI
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              P2P Screen & Process Audio Streaming · Zero Discord Echo
            </p>
          </div>
        </div>

        {/* Telemetry & Quick Metrics */}
        <div className="flex items-center gap-3 text-xs">
          {/* WASAPI Process Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800">
            <ShieldCheck className={`w-4 h-4 ${activePid !== null && activePid !== undefined ? 'text-emerald-400' : 'text-neutral-500'}`} />
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase font-mono">
                WASAPI Process Loopback
              </span>
              <span className="font-mono font-semibold text-neutral-200">
                {activePid === 0
                  ? 'Áudio Total (Sem Discord)'
                  : activePid !== null && activePid !== undefined
                  ? `${activeProcessName || 'Processo'} [PID: ${activePid}]`
                  : 'Aguardando Janela/Tela'}
              </span>
            </div>
          </div>

          {/* RAM & Motor em Tempo Real */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800">
            <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Memória / Motor
              </span>
              <span className="font-mono text-neutral-200 text-xs">
                {memoryMb.toFixed(1)} MB{' '}
                <span className="text-cyan-400 font-bold hidden sm:inline">
                  {isNative ? 'Rust + Tauri v2' : 'Chromium Core'}
                </span>
              </span>
            </div>
          </div>

          {onOpenCodeViewer && (
            <button
              onClick={onOpenCodeViewer}
              className="hidden items-center gap-2 px-3 py-1.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono transition-all text-xs cursor-pointer shadow-sm shadow-cyan-950"
              title="Ver arquivos do Backend Rust"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Código</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
