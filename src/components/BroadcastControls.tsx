import React from 'react';
import {
  Monitor,
  Video,
  Flame,
  Volume2,
  Tv,
  ChevronDown,
  ChevronUp,
  PowerOff,
  AppWindow,
} from 'lucide-react';
import { WindowItem, AudioSourceMode, LocalMediaSource } from '../types';

interface BroadcastControlsProps {
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  localMediaSources?: LocalMediaSource[];
  showSourceManager?: boolean;
  onToggleSourceManager?: () => void;
  showWindowSelector?: boolean;
  onToggleWindowSelector?: () => void;
  onStopAllSources?: () => void;
  selectedWindow: WindowItem | null;
  isolateAudio: boolean;
  audioSourceMode: AudioSourceMode;
  onChangeAudioSourceMode: (mode: AudioSourceMode) => void;
  fps: 30 | 60;
  resolution: '720p' | '1080p' | '1440p';
  onToggleScreenShare: () => void;
  onToggleWebcam: () => void;
  onToggleIsolateAudio: (val: boolean) => void;
  onChangeFps: (val: 30 | 60) => void;
  onChangeResolution: (res: '720p' | '1080p' | '1440p') => void;
  activeAudioLabel?: string;
}

export const BroadcastControls: React.FC<BroadcastControlsProps> = ({
  isScreenSharing,
  isWebcamActive,
  localMediaSources = [],
  showSourceManager = false,
  onToggleSourceManager,
  showWindowSelector = false,
  onToggleWindowSelector,
  onStopAllSources,
  selectedWindow,
  audioSourceMode,
  onChangeAudioSourceMode,
  fps,
  resolution,
  onToggleScreenShare,
  onToggleWebcam,
  onChangeFps,
  onChangeResolution,
  activeAudioLabel,
}) => {
  const activeCount = localMediaSources.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      {/* Controles Discretos de Captura: Tela, Câmeras/Captura e Seletor de Janela WASAPI */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Transmitir Tela */}
        <button
          onClick={onToggleScreenShare}
          className={`sc-btn sc-btn-sized flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
            isScreenSharing
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-950/60'
              : 'sc-btn-primary bg-cyan-500 hover:bg-cyan-400 text-black'
          }`}
        >
          {isScreenSharing ? (
            <>
              <Flame className="w-3.5 h-3.5 text-white animate-pulse" />
              <span>Parar Tela</span>
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5" />
              <span>Transmitir Tela</span>
            </>
          )}
        </button>

        {/* 2. Botão Discreto: Janela & Áudio WASAPI */}
        {onToggleWindowSelector && (
          <button
            type="button"
            onClick={onToggleWindowSelector}
            className={`sc-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer border ${
              showWindowSelector
                ? 'bg-neutral-800 border-cyan-500 text-white font-bold'
                : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
            }`}
            title="Abrir seletor de janela específica e roteamento avançado de áudio WASAPI"
          >
            <AppWindow className="w-3.5 h-3.5 text-cyan-400" />
            <span className="truncate max-w-[160px]">
              {selectedWindow ? selectedWindow.process_name : 'Janela & Áudio'}
            </span>
            {showWindowSelector ? (
              <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
            )}
          </button>
        )}

        {/* 3. Botão Discreto: Câmeras & Placa de Captura */}
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleSourceManager || onToggleWebcam}
            className={`sc-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer border ${
              activeCount > 0 || isWebcamActive
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-bold'
                : showSourceManager
                ? 'bg-neutral-800 border-indigo-500/60 text-white'
                : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
            }`}
            title="Gerenciar Webcams e Placas de Captura USB"
          >
            <Video className="w-3.5 h-3.5 text-indigo-400" />
            <Tv className="w-3 h-3 text-emerald-400 -ml-1" />
            <span>
              {activeCount > 0 ? `Câmeras (${activeCount})` : 'Câmeras / Captura'}
            </span>
            {showSourceManager ? (
              <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
            )}
          </button>

          {activeCount > 0 && onStopAllSources && (
            <button
              onClick={onStopAllSources}
              className="p-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-300 cursor-pointer transition-colors"
              title="Desligar todas as webcams e placas de captura ativas"
            >
              <PowerOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 4. Pílula Rápida de Modo de Áudio WASAPI */}
        <div className="flex items-center bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('selected_window')}
            className={`px-2 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'selected_window'
                ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Capturar áudio apenas da janela selecionada"
          >
            Janela
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeAudioSourceMode('other_window');
              if (onToggleWindowSelector && !showWindowSelector) {
                onToggleWindowSelector();
              }
            }}
            className={`px-2 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'other_window'
                ? 'bg-indigo-500 text-white font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Mixar áudio de múltiplas janelas escolhidas"
          >
            Multi-Áudio
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('all_except_discord')}
            className={`px-2 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'all_except_discord'
                ? 'bg-emerald-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Capturar todo o áudio do PC excluindo o Discord"
          >
            Sem Discord
          </button>
        </div>
      </div>

      {/* Seletores Compactos de Resolução, FPS e Resumo de Áudio */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          {(['720p', '1080p', '1440p'] as const).map((res) => (
            <button
              key={res}
              onClick={() => onChangeResolution(res)}
              className={`px-2 py-1 rounded cursor-pointer transition-colors ${
                resolution === res
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {res}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          {([30, 60] as const).map((f) => (
            <button
              key={f}
              onClick={() => onChangeFps(f)}
              className={`px-2 py-1 rounded cursor-pointer transition-colors ${
                fps === f
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f}fps
            </button>
          ))}
        </div>

        {activeAudioLabel && (
          <div
            onClick={onToggleWindowSelector}
            className="hidden xl:flex items-center gap-1.5 text-[11px] font-mono text-neutral-400 bg-neutral-950 px-2.5 py-1 rounded-lg border border-neutral-800 cursor-pointer hover:border-neutral-700"
            title="Clique para abrir configurações de janela e áudio WASAPI"
          >
            <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[180px] text-cyan-300 font-semibold">
              {activeAudioLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
