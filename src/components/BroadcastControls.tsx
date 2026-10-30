import React, { useState } from 'react';
import {
  Monitor,
  Video,
  Flame,
  Volume2,
  ChevronDown,
  ChevronUp,
  PowerOff,
  AppWindow,
  ShieldCheck,
} from 'lucide-react';
import { WindowItem, AudioSourceMode, LocalMediaSource } from '../types';
import {
  isAndroidEnvironment,
  getAntiBlackScreenPreference,
  setNativeAntiBlackScreen,
} from '../services/tauriBridge';
import {
  androidAudioEngine,
  AndroidAudioCaptureMode,
} from '../services/webrtc/AndroidAudioEngine';

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
  fps,
  resolution,
  onToggleScreenShare,
  onToggleWebcam,
  onChangeFps,
  onChangeResolution,
}) => {
  const activeCount = localMediaSources.length;
  const isAndroid = isAndroidEnvironment();
  const [androidAudioMode, setAndroidAudioMode] = useState<AndroidAudioCaptureMode>(() =>
    androidAudioEngine.getMode()
  );
  const [antiBlackScreen, setAntiBlackScreen] = useState<boolean>(() =>
    getAntiBlackScreenPreference()
  );

  const handleToggleAntiBlackScreen = async () => {
    const nextVal = !antiBlackScreen;
    setAntiBlackScreen(nextVal);
    if (isScreenSharing) {
      await setNativeAntiBlackScreen(nextVal, selectedWindow?.hwnd || 0);
    } else {
      try {
        localStorage.setItem('sc_anti_black_screen', String(nextVal));
      } catch {}
    }
  };

  const handleCycleAndroidAudioMode = () => {
    const order: AndroidAudioCaptureMode[] = ['internal_system', 'mixed_live', 'voice_crystal'];
    const nextIdx = (order.indexOf(androidAudioMode) + 1) % order.length;
    const nextMode = order[nextIdx];
    setAndroidAudioMode(nextMode);
    androidAudioEngine.setMode(nextMode);
  };

  const androidAudioLabel =
    androidAudioMode === 'internal_system'
      ? 'Áudio Interno'
      : androidAudioMode === 'mixed_live'
      ? 'Interno+Voz'
      : 'Voz HD';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {/* Controles Compactos de Captura: Tela, Áudio, Câmera e Anti-Tela Preta */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 1. Transmitir Tela */}
        <button
          onClick={onToggleScreenShare}
          className={`sc-btn sc-btn-sized h-8 flex items-center gap-1.5 px-3 rounded-lg font-mono font-bold text-xs whitespace-nowrap transition-all cursor-pointer ${
            isScreenSharing
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-950/60'
              : 'sc-btn-primary bg-cyan-500 hover:bg-cyan-400 text-black'
          }`}
          title={isScreenSharing ? 'Parar transmissão de tela' : 'Iniciar transmissão de tela'}
        >
          {isScreenSharing ? (
            <>
              <Flame className="w-3.5 h-3.5 text-white animate-pulse shrink-0" />
              <span>Parar Tela</span>
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5 shrink-0" />
              <span>Tela</span>
            </>
          )}
        </button>

        {/* 2. Botão Compacto: Áudio (Android DSP no Mobile / Janela WASAPI no PC) */}
        {isAndroid ? (
          <button
            type="button"
            onClick={handleCycleAndroidAudioMode}
            className="sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all cursor-pointer border bg-neutral-950 border-emerald-500/50 text-emerald-300 hover:border-emerald-400"
            title="Alternar modo do Motor de Áudio DSP Android (Áudio Interno / Interno + Voz / Voz HD)"
          >
            <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{androidAudioLabel}</span>
          </button>
        ) : (
          onToggleWindowSelector && (
            <button
              type="button"
              onClick={onToggleWindowSelector}
              className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all cursor-pointer border ${
                showWindowSelector
                  ? 'bg-neutral-800 border-cyan-500 text-white font-bold'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
              }`}
              title="Selecionar janela e roteamento de áudio WASAPI"
            >
              <AppWindow className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate max-w-[95px]">
                {selectedWindow ? selectedWindow.process_name.replace(/\.exe$/i, '') : 'Áudio'}
              </span>
              {showWindowSelector ? (
                <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
              )}
            </button>
          )
        )}

        {/* 3. Botão Compacto: Câmera / Placa de Captura */}
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleSourceManager || onToggleWebcam}
            className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all cursor-pointer border ${
              activeCount > 0 || isWebcamActive
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-bold'
                : showSourceManager
                ? 'bg-neutral-800 border-indigo-500/60 text-white'
                : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
            }`}
            title="Gerenciar Webcams e Placas de Captura USB"
          >
            <Video className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{activeCount > 0 ? `Câmera (${activeCount})` : 'Câmera'}</span>
            {showSourceManager ? (
              <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
            )}
          </button>

          {activeCount > 0 && onStopAllSources && (
            <button
              onClick={onStopAllSources}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-300 cursor-pointer transition-colors shrink-0"
              title="Desligar todas as webcams e placas de captura ativas"
            >
              <PowerOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 4. Botão Anti-Tela Preta (Disney+ / Netflix / Navegadores quando o mouse fica parado) */}
        {!isAndroid && (
          <button
            type="button"
            onClick={handleToggleAntiBlackScreen}
            className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all cursor-pointer border ${
              antiBlackScreen
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:border-emerald-400'
                : 'bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300'
            }`}
            title={
              antiBlackScreen
                ? 'Modo Anti-Tela Preta ATIVO: impede que sites como Disney+ e navegadores deixem o vídeo preto quando você para de mexer o mouse (força composição DWM + keep-alive de vídeo)'
                : 'Modo Anti-Tela Preta DESATIVADO (clique para ativar proteção contra vídeo preto no Disney+ / Navegador)'
            }
          >
            <ShieldCheck
              className={`w-3.5 h-3.5 shrink-0 ${
                antiBlackScreen ? 'text-emerald-400' : 'text-neutral-600'
              }`}
            />
            <span className="hidden sm:inline">Anti-Tela Preta</span>
          </button>
        )}
      </div>

      {/* Seletores Alinhados de Resolução e FPS */}
      <div className="flex items-center gap-1.5">
        <div className="h-8 flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          {(['720p', '1080p', '1440p'] as const).map((res) => (
            <button
              key={res}
              onClick={() => onChangeResolution(res)}
              className={`h-full px-2 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                resolution === res
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {res}
            </button>
          ))}
        </div>

        <div className="h-8 flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          {([30, 60] as const).map((f) => (
            <button
              key={f}
              onClick={() => onChangeFps(f)}
              className={`h-full px-2 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                fps === f
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f}fps
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
