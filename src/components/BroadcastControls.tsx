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
} from 'lucide-react';
import { WindowItem, AudioSourceMode, LocalMediaSource } from '../types';

interface BroadcastControlsProps {
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  localMediaSources?: LocalMediaSource[];
  showSourceManager?: boolean;
  onToggleSourceManager?: () => void;
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
  onStopAllSources,
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
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
      {/* Botões de Ação Principais */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Compartilhar Tela / Jogo */}
        <button
          onClick={onToggleScreenShare}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg ${
            isScreenSharing
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-950/60'
              : 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-cyan-950/60'
          }`}
        >
          {isScreenSharing ? (
            <>
              <Flame className="w-4 h-4 text-white animate-pulse" />
              Parar Tela
            </>
          ) : (
            <>
              <Monitor className="w-4 h-4" />
              Transmitir Tela
            </>
          )}
        </button>

        {/* Seletor Multi-Fonte: Webcams & Placas de Captura USB */}
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleSourceManager || onToggleWebcam}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono text-xs transition-all cursor-pointer border ${
              activeCount > 0 || isWebcamActive
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-bold shadow-md shadow-indigo-950/40'
                : showSourceManager
                ? 'bg-neutral-800 border-indigo-500/60 text-white'
                : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
            }`}
            title="Escolher Webcam(s) ou Placa(s) de Captura USB e transmitir várias fontes ao mesmo tempo"
          >
            <Video className="w-4 h-4 text-indigo-400" />
            <Tv className="w-3.5 h-3.5 text-emerald-400 -ml-1" />
            <span>
              {activeCount > 0
                ? `Câmeras / Captura (${activeCount} Ativa${activeCount > 1 ? 's' : ''})`
                : 'Câmeras & Placa de Captura'}
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
              className="p-2 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-300 cursor-pointer transition-colors"
              title="Desligar todas as webcams e placas de captura ativas"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Alternador Rápido de Áudio WASAPI Ao Vivo */}
        <div className="flex items-center bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-xs font-mono">
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('selected_window')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'selected_window'
                ? 'bg-cyan-500 text-black font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Mandar áudio apenas da janela transmitida"
          >
            <span>Janela</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('other_window')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'other_window'
                ? 'bg-indigo-500 text-white font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Mandar áudio de outras janelas selecionadas (Multi-Áudio)"
          >
            <span>Outras Janelas</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioSourceMode('all_except_discord')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-all ${
              audioSourceMode === 'all_except_discord'
                ? 'bg-emerald-500 text-black font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Mandar áudio de todas as janelas do PC exceto o Discord"
          >
            <span>Todo PC (Sem DC)</span>
          </button>
        </div>
      </div>

      {/* Opções de Qualidade de Transmissão & Áudio Atual */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 rounded-lg p-1 text-xs font-mono">
          {(['720p', '1080p', '1440p'] as const).map((res) => (
            <button
              key={res}
              onClick={() => onChangeResolution(res)}
              className={`px-2.5 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                resolution === res
                  ? 'bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {res}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 rounded-lg p-1 text-xs font-mono">
          {([30, 60] as const).map((f) => (
            <button
              key={f}
              onClick={() => onChangeFps(f)}
              className={`px-2.5 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                fps === f
                  ? 'bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f} FPS
            </button>
          ))}
        </div>

        {activeAudioLabel && (
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono text-neutral-400 bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-800">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              Áudio: <strong className="text-cyan-300">{activeAudioLabel}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
