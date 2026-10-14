import React, { useState } from 'react';
import {
  AppWindow,
  Gamepad2,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  Sliders,
  CheckCircle2,
  Monitor,
  Flame,
} from 'lucide-react';
import { WindowItem } from '../types';
import { SAMPLE_WINDOWS } from '../services/tauriBridge';

interface WindowSelectorProps {
  selectedWindow: WindowItem | null;
  onSelectWindow: (w: WindowItem | null) => void;
  isolateAudio: boolean;
  onToggleIsolateAudio: (val: boolean) => void;
  fps: 30 | 60;
  onChangeFps: (val: 30 | 60) => void;
  resolution: '720p' | '1080p' | '1440p';
  onChangeResolution: (res: '720p' | '1080p' | '1440p') => void;
  isBroadcasting: boolean;
  onToggleBroadcast: () => void;
}

export const WindowSelector: React.FC<WindowSelectorProps> = ({
  selectedWindow,
  onSelectWindow,
  isolateAudio,
  onToggleIsolateAudio,
  fps,
  onChangeFps,
  resolution,
  onChangeResolution,
  isBroadcasting,
  onToggleBroadcast,
}) => {
  const [windowsList, setWindowsList] = useState<WindowItem[]>(SAMPLE_WINDOWS);
  const [search, setSearch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulação ou chamada real via Tauri invoke('list_windows')
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  const filteredWindows = windowsList.filter(
    (w) =>
      w.title.toLowerCase().includes(search.toLowerCase()) ||
      w.process_name.toLowerCase().includes(search.toLowerCase()) ||
      w.pid.toString().includes(search)
  );

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-5 shadow-xl space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono flex items-center gap-2">
              <AppWindow className="w-4 h-4 text-cyan-400" />
              Seletor de Janela & PID (WASAPI Loopback)
            </h2>
            <span className="text-[10px] bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono px-2 py-0.5 rounded">
              Win32 EnumWindows + WASAPI
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Escolha o jogo ou aplicativo desejado para transmitir apenas seu áudio nativo (Discord excluído).
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 rounded text-xs font-mono text-neutral-300 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          Atualizar Janelas
        </button>
      </div>

      {/* Barra de Busca de Janelas */}
      <div className="relative">
        <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrar por nome do jogo, executável (ex: cs2.exe) ou PID..."
          className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-neutral-200 outline-none"
        />
      </div>

      {/* Lista de Janelas do Windows com PIDs visíveis */}
      <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
        {filteredWindows.length === 0 ? (
          <div className="text-center py-6 text-xs text-neutral-500 font-mono">
            Nenhuma janela encontrada com esse filtro.
          </div>
        ) : (
          filteredWindows.map((win) => {
            const isSelected = selectedWindow?.hwnd === win.hwnd;
            const isDiscord = win.process_name.toLowerCase().includes('discord');

            return (
              <div
                key={win.hwnd}
                onClick={() => onSelectWindow(win)}
                className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/50'
                    : 'bg-neutral-950/70 border-neutral-800/80 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div
                    className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs ${
                      win.category === 'game'
                        ? 'bg-amber-950/60 text-amber-400 border border-amber-800'
                        : isDiscord
                        ? 'bg-indigo-950/60 text-indigo-400 border border-indigo-800'
                        : 'bg-neutral-900 text-neutral-400 border border-neutral-800'
                    }`}
                  >
                    {win.category === 'game' ? (
                      <Gamepad2 className="w-4 h-4" />
                    ) : (
                      <AppWindow className="w-4 h-4" />
                    )}
                  </div>

                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200 truncate">
                        {win.title}
                      </span>
                      {isDiscord && (
                        <span className="text-[9px] bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 px-1.5 py-0.2 rounded font-mono">
                          Voz do Discord
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-400">
                      <span>Executável: <strong className="text-neutral-300">{win.process_name}</strong></span>
                      <span>·</span>
                      <span className="text-cyan-400">PID: {win.pid}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isSelected && (
                    <span className="flex items-center gap-1 text-[11px] font-mono text-cyan-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Selecionada
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Configurações de Transmissão e Isolamento de Áudio */}
      <div className="pt-3 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-4">
        {/* Toggle WASAPI Loopback Process Isolation */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onToggleIsolateAudio(!isolateAudio)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-mono transition-all cursor-pointer ${
              isolateAudio
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 font-bold'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400'
            }`}
          >
            {isolateAudio ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>Áudio Isolado por PID (Sem Discord)</span>
          </button>

          {selectedWindow && (
            <span className="text-[11px] font-mono text-neutral-400">
              Alvo: <span className="text-cyan-400 font-semibold">{selectedWindow.process_name}</span> (PID {selectedWindow.pid})
            </span>
          )}
        </div>

        {/* Resolução e Taxa de Quadros (FPS) */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="flex bg-neutral-950 border border-neutral-800 rounded p-0.5">
            {(['720p', '1080p', '1440p'] as const).map((r) => (
              <button
                key={r}
                onClick={() => onChangeResolution(r)}
                className={`px-2 py-1 rounded text-[11px] cursor-pointer ${
                  resolution === r
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex bg-neutral-950 border border-neutral-800 rounded p-0.5">
            {([30, 60] as const).map((f) => (
              <button
                key={f}
                onClick={() => onChangeFps(f)}
                className={`px-2 py-1 rounded text-[11px] cursor-pointer ${
                  fps === f
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {f} FPS
              </button>
            ))}
          </div>

          {/* Botão de Transmitir */}
          <button
            onClick={onToggleBroadcast}
            disabled={!selectedWindow}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md ${
              isBroadcasting
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-950'
                : selectedWindow
                ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-cyan-950'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
            }`}
          >
            {isBroadcasting ? (
              <>
                <Flame className="w-3.5 h-3.5 text-white animate-pulse" />
                Parar Live
              </>
            ) : (
              <>
                <Monitor className="w-3.5 h-3.5" />
                Iniciar Live
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
