import React, { useState, useEffect } from 'react';
import {
  AppWindow,
  Gamepad2,
  RefreshCw,
  Search,
  Volume2,
  AlertTriangle,
  Radio,
  Layers,
  Sparkles,
  Trash2,
  Monitor,
} from 'lucide-react';
import { WindowItem, AudioSourceMode } from '../types';
import { fetchSystemWindows, isTauriEnvironment } from '../services/tauriBridge';

interface WindowSelectorProps {
  selectedWindow: WindowItem | null;
  onSelectWindow: (w: WindowItem | null) => void;
  isScreenSharing?: boolean;
  activeScreenTitle?: string;
  isolateAudio: boolean;
  onToggleIsolateAudio: (val: boolean) => void;
  audioSourceMode: AudioSourceMode;
  onChangeAudioSourceMode: (mode: AudioSourceMode) => void;
  audioCustomWindows: WindowItem[];
  onToggleAudioCustomWindow: (w: WindowItem) => void;
  onClearAudioCustomWindows: () => void;
}

export const WindowSelector: React.FC<WindowSelectorProps> = ({
  selectedWindow,
  isScreenSharing = false,
  activeScreenTitle = 'Tela do Usuário',
  isolateAudio,
  onToggleIsolateAudio,
  audioSourceMode,
  onChangeAudioSourceMode,
  audioCustomWindows,
  onToggleAudioCustomWindow,
  onClearAudioCustomWindows,
}) => {
  const [windowsList, setWindowsList] = useState<WindowItem[]>([]);
  const [search, setSearch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadWindows = async () => {
    setIsRefreshing(true);
    setErrorMsg(null);
    try {
      const list = await fetchSystemWindows();
      setWindowsList(list);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao enumerar processos do Windows.');
      setWindowsList([]);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isTauriEnvironment() && audioSourceMode === 'other_window') {
      loadWindows();
    }
  }, [audioSourceMode]);

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
              Roteamento de Áudio WASAPI da Transmissão
            </h2>
            <span className="text-[10px] bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono px-2 py-0.5 rounded">
              WASAPI Process Loopback
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            No modo <strong>Janela da Live</strong>, o áudio da janela ou tela que você escolher em "Transmitir Tela" é capturado automaticamente.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleIsolateAudio(!isolateAudio)}
          className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer font-mono transition-colors shrink-0 ${
            isolateAudio
              ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 font-bold'
              : 'bg-neutral-900 border-neutral-800 text-neutral-500'
          }`}
        >
          {isolateAudio ? '✓ Isolamento WASAPI Ativo' : 'Áudio da Live Desativado'}
        </button>
      </div>

      {/* ROTEAMENTO DE ÁUDIO WASAPI: 3 Opções Claras */}
      {isolateAudio && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
          {/* Opção 1: Janela da Live (Automático) */}
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('selected_window')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              audioSourceMode === 'selected_window'
                ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-sm'
                : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Janela da Live (Automático)
              </span>
              {audioSourceMode === 'selected_window' && (
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
              )}
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight">
              Captura automaticamente o som da janela ou tela que está sendo transmitida na live.
            </p>
          </button>

          {/* Opção 2: Outras Janelas (Múltiplas Fontes de Áudio Mixadas) */}
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('other_window')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer relative ${
              audioSourceMode === 'other_window'
                ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200 shadow-sm'
                : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Outras Janelas (Multi-Áudio)
              </span>
              <span className="text-[10px] bg-indigo-900/90 text-indigo-200 border border-indigo-700 px-1.5 py-0.2 rounded font-bold">
                {audioCustomWindows.length}
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight">
              Escolha manualmente uma ou mais janelas para mixar (ex: Jogo + Spotify).
            </p>
          </button>

          {/* Opção 3: Áudio Total do PC (Sem Discord) */}
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('all_except_discord')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              audioSourceMode === 'all_except_discord'
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-sm'
                : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                Todo o PC (Sem Discord)
              </span>
              {audioSourceMode === 'all_except_discord' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight">
              Pega todo o áudio do sistema e exclui 100% as vozes do Discord.
            </p>
          </button>
        </div>
      )}

      {/* PAINEL DO MODO SELECIONADO */}
      {isolateAudio && audioSourceMode === 'selected_window' && (
        <div className="p-3.5 bg-neutral-950 border border-cyan-900/60 rounded-lg flex items-center justify-between flex-wrap gap-3 text-xs font-mono">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-700/70 flex items-center justify-center text-cyan-400 shrink-0">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <div className="text-neutral-200 font-bold flex items-center gap-2">
                <span>Captura Automática da Transmissão Ativa</span>
                {isScreenSharing && (
                  <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded">
                    AO VIVO
                  </span>
                )}
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {isScreenSharing ? (
                  selectedWindow ? (
                    <>
                      Capturando automaticamente a janela transmitida:{' '}
                      <strong className="text-cyan-300">
                        {selectedWindow.title} ({selectedWindow.process_name} · PID {selectedWindow.pid})
                      </strong>
                    </>
                  ) : (
                    <>
                      Capturando automaticamente a tela transmitida:{' '}
                      <strong className="text-cyan-300">
                        {activeScreenTitle} (Áudio da Tela Sem Discord)
                      </strong>
                    </>
                  )
                ) : (
                  'Ao clicar em "Transmitir Tela", o aplicativo detectará e capturará automaticamente o áudio da janela ou tela escolhida.'
                )}
              </p>
            </div>
          </div>
          <span className="text-emerald-400 text-[10px] shrink-0">48kHz · 32-bit Float</span>
        </div>
      )}

      {/* Lista Manual de Janelas exibida APENAS quando o usuário escolher 'Outras Janelas (Multi-Áudio)' */}
      {isolateAudio && audioSourceMode === 'other_window' && (
        <div className="space-y-3 pt-1">
          {errorMsg ? (
            <div className="p-3.5 bg-neutral-950 border border-amber-900/60 rounded-lg text-xs font-mono text-amber-300/90 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-amber-400">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Ambiente Web Detectado</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                A mixagem WASAPI de múltiplas janelas por PID requer o executável desktop compilado (StreamCompanion.exe).
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filtrar janelas para mixar (ex: cs2.exe, spotify.exe)..."
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-neutral-200 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {audioCustomWindows.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearAudioCustomWindows}
                      className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs font-mono text-neutral-400 hover:text-white cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      <span>Limpar ({audioCustomWindows.length})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={loadWindows}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-300 transition-colors cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`}
                    />
                    <span>Atualizar Janelas</span>
                  </button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {filteredWindows.length === 0 ? (
                  <div className="text-center py-6 text-xs text-neutral-500 font-mono">
                    {windowsList.length === 0
                      ? 'Nenhuma janela enumerada. Clique em "Atualizar Janelas" para buscar via Win32.'
                      : 'Nenhuma janela encontrada com esse filtro de busca.'}
                  </div>
                ) : (
                  filteredWindows.map((win) => {
                    const isSelectedForAudio = audioCustomWindows.some((w) => w.hwnd === win.hwnd);
                    const isDiscord = win.process_name.toLowerCase().includes('discord');

                    return (
                      <div
                        key={win.hwnd}
                        onClick={() => onToggleAudioCustomWindow(win)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                          isSelectedForAudio
                            ? 'bg-indigo-950/40 border-indigo-500/80 shadow-sm'
                            : 'bg-neutral-950/70 border-neutral-800/80 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div
                            className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs shrink-0 ${
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-neutral-200 truncate">
                                {win.title}
                              </span>
                              {isDiscord && (
                                <span className="text-[9px] bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 px-1.5 py-0.2 rounded font-mono">
                                  Discord
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-400">
                              <span>
                                Executável: <strong className="text-neutral-300">{win.process_name}</strong>
                              </span>
                              <span>·</span>
                              <span className="text-cyan-400">PID: {win.pid}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleAudioCustomWindow(win);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono border transition-all cursor-pointer shrink-0 ${
                            isSelectedForAudio
                              ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-white font-bold'
                              : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-700 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <Volume2
                            className={`w-3.5 h-3.5 ${
                              isSelectedForAudio ? 'text-white' : 'text-neutral-400'
                            }`}
                          />
                          {isSelectedForAudio ? '✓ Áudio Ativo' : '+ Áudio'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
