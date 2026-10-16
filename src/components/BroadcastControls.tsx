import React from 'react';
import {
  Monitor,
  Video,
  VideoOff,
  Flame,
  Volume2,
  VolumeX,
  Settings,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import { WindowItem } from '../types';

interface BroadcastControlsProps {
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  selectedWindow: WindowItem | null;
  isolateAudio: boolean;
  fps: 30 | 60;
  resolution: '720p' | '1080p' | '1440p';
  onToggleScreenShare: () => void;
  onToggleWebcam: () => void;
  onToggleIsolateAudio: (val: boolean) => void;
  onChangeFps: (val: 30 | 60) => void;
  onChangeResolution: (res: '720p' | '1080p' | '1440p') => void;
}

export const BroadcastControls: React.FC<BroadcastControlsProps> = ({
  isScreenSharing,
  isWebcamActive,
  selectedWindow,
  isolateAudio,
  fps,
  resolution,
  onToggleScreenShare,
  onToggleWebcam,
  onToggleIsolateAudio,
  onChangeFps,
  onChangeResolution,
}) => {
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
              Parar Transmissão
            </>
          ) : (
            <>
              <Monitor className="w-4 h-4" />
              Transmitir Tela
            </>
          )}
        </button>

        {/* Ligar / Desligar Webcam */}
        <button
          onClick={onToggleWebcam}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono text-xs transition-all cursor-pointer border ${
            isWebcamActive
              ? 'bg-indigo-950/70 border-indigo-500 text-indigo-300 font-bold'
              : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
          }`}
        >
          {isWebcamActive ? (
            <>
              <Video className="w-4 h-4 text-indigo-400" />
              Webcam Ativa
            </>
          ) : (
            <>
              <VideoOff className="w-4 h-4" />
              Ligar Webcam
            </>
          )}
        </button>

      </div>

      {/* Opções de Qualidade de Transmissão */}
      <div className="flex items-center gap-3">
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

        {selectedWindow && (
          <div className="hidden xl:flex items-center gap-1.5 text-[11px] font-mono text-neutral-400 bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-800">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              Alvo: <strong className="text-cyan-300">{selectedWindow.process_name}</strong> (PID {selectedWindow.pid})
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
