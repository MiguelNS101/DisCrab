import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Gamepad2,
  User,
  Sparkles,
  ExternalLink,
  BookmarkCheck,
  RefreshCw,
} from 'lucide-react';

interface LivePlayerProps {
  id: string;
  userName: string;
  title: string;
  type: 'screen' | 'webcam';
  stream?: MediaStream | null;
  resolution: string;
  fps: number;
  isSelf?: boolean;
  hasIsolatedAudio?: boolean;
  processName?: string;
  volume: number;
  isMuted: boolean;
  isWatched: boolean;
  isPoppedOut?: boolean;
  connectionState?: RTCPeerConnectionState;
  onOpenPopup?: () => void;
  onToggleWatch: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onResetConnection?: () => void;
}

export const LivePlayer: React.FC<LivePlayerProps> = ({
  userName,
  title,
  type,
  stream,
  resolution,
  fps,
  isSelf,
  hasIsolatedAudio,
  processName,
  volume,
  isMuted,
  isWatched,
  isPoppedOut = false,
  connectionState,
  onOpenPopup,
  onToggleWatch,
  onChangeVolume,
  onToggleMute,
  onResetConnection,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedVolumeFlash, setSavedVolumeFlash] = useState(false);
  const flashTimerRef = useRef<any>(null);

  // Web Audio API para amplificação limpa acima de 100% (101% até 150% boost) sem duplicação de fase
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const boostSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostStreamRef = useRef<MediaStream | null>(null);

  // Vincula o MediaStream nativo da RTCPeerConnection ao elemento <video> apenas quando o stream muda
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && isWatched && !isPoppedOut) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
      el.play().catch((err) => {
        console.warn('[LivePlayer] Autoplay restrito pelo navegador, aguardando interação do usuário:', err);
      });
    }
  }, [stream, isWatched, isPoppedOut]);

  // Aplica o volume salvo sem reiniciar o elemento <video> e sem silenciar a faixa WebRTC no Chromium
  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
    }

    const hasAudioTracks = !!stream && stream.getAudioTracks().length > 0;
    const useBoost = !isSelf && !isMuted && volume > 100 && hasAudioTracks && isWatched && !isPoppedOut;

    if (useBoost && stream) {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new AudioCtx({ latencyHint: 'interactive' });
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (boostStreamRef.current !== stream) {
          try {
            boostSourceRef.current?.disconnect();
            boostGainRef.current?.disconnect();
          } catch {}
          boostSourceRef.current = ctx.createMediaStreamSource(stream);
          boostGainRef.current = ctx.createGain();
          boostSourceRef.current.connect(boostGainRef.current);
          boostGainRef.current.connect(ctx.destination);
          boostStreamRef.current = stream;
        }
        if (boostGainRef.current) {
          boostGainRef.current.gain.value = (volume - 100) / 100;
        }
        return;
      } catch {
        // fallback para áudio nativo do elemento <video>
      }
    }

    if (boostGainRef.current) {
      boostGainRef.current.gain.value = 0;
    }
  }, [volume, isMuted, isSelf, stream, isWatched, isPoppedOut]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      try {
        boostSourceRef.current?.disconnect();
        boostGainRef.current?.disconnect();
        audioCtxRef.current?.close();
      } catch {}
    };
  }, []);

  const handleVolumeUpdate = (newVol: number) => {
    const clamped = Math.max(0, Math.min(150, Math.round(newVol)));
    onChangeVolume(clamped);
    setSavedVolumeFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSavedVolumeFlash(false), 1400);
  };

  // Permite ajustar a altura do áudio girando a roda do mouse sobre o controle de volume
  const handleVolumeWheel = (e: React.WheelEvent) => {
    if (isSelf) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 5 : -5;
    const base = isMuted ? 0 : volume;
    handleVolumeUpdate(base + step);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  return (
    <div
      ref={containerRef}
      className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl flex flex-col transition-all hover:border-neutral-700 relative group"
    >
      {/* Viewport Principal de Vídeo */}
      <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden">
        {isPoppedOut ? (
          <div className="w-full h-full bg-neutral-950/95 flex flex-col items-center justify-center text-center p-6 space-y-3 border-2 border-dashed border-cyan-500/30">
            <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-500/50 flex items-center justify-center mx-auto text-cyan-400">
              <ExternalLink className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-cyan-300">
                Aberta em Janela Flutuante (Popup)
              </h4>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5 max-w-xs">
                Controles de tamanho livre, qualidade e áudio salvos disponíveis na janela destacada.
              </p>
            </div>
            {onOpenPopup && (
              <button
                onClick={onOpenPopup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/60 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all"
              >
                Focar Janela Flutuante
              </button>
            )}
          </div>
        ) : isWatched ? (
          <>
            {stream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isSelf ? true : isMuted}
                className={`w-full h-full object-contain bg-black ${type === 'webcam' && isSelf ? 'scale-x-[-1]' : ''}`}
              />
            ) : (
              /* Estado aguardando stream ou reconectando */
              <div className="w-full h-full relative bg-gradient-to-br from-neutral-950 via-neutral-900 to-cyan-950/40 flex items-center justify-center">
                <div className="text-center space-y-2.5 p-4">
                  {type === 'screen' ? (
                    <Gamepad2 className="w-12 h-12 text-cyan-400 mx-auto animate-pulse" />
                  ) : (
                    <User className="w-12 h-12 text-indigo-400 mx-auto animate-pulse" />
                  )}
                  <h4 className="text-xs font-mono font-bold text-neutral-200">{title}</h4>
                  <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-neutral-400">
                    <span className="text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded">
                      WEBRTC P2P
                    </span>
                    <span>{resolution}</span>
                    <span>{fps} FPS</span>
                  </div>
                  {onResetConnection && !isSelf && (
                    <button
                      onClick={onResetConnection}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-cyan-300 text-[11px] font-mono rounded cursor-pointer transition-colors mt-1"
                      title="Forçar ressincronização da transmissão P2P"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Ressincronizar Stream
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Overlays Superior */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10 flex-wrap">
              <span className="text-[10px] font-mono font-bold bg-neutral-950/80 backdrop-blur border border-neutral-800 px-2 py-0.5 rounded text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {userName} {isSelf && '(Você)'}
              </span>

              {hasIsolatedAudio && (
                <span className="text-[10px] font-mono bg-cyan-950/80 border border-cyan-800 text-cyan-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                  WASAPI {processName ? `[${processName}]` : 'Isolado'}
                </span>
              )}

              {!isSelf && connectionState && connectionState !== 'connected' && (
                <span className="text-[10px] font-mono bg-amber-950/90 border border-amber-700 text-amber-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  Reconectando P2P...
                </span>
              )}
            </div>

            {/* Botões de Ação Superior Direito (Reset P2P + Popup + Tela Cheia) */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              {!isSelf && onResetConnection && (
                <button
                  onClick={onResetConnection}
                  className="p-1.5 bg-neutral-950/80 hover:bg-amber-950 text-neutral-300 hover:text-amber-300 rounded border border-neutral-800 hover:border-amber-700 cursor-pointer backdrop-blur"
                  title="Resetar e Reconectar este Stream P2P"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              {onOpenPopup && (
                <button
                  onClick={onOpenPopup}
                  className="p-1.5 bg-neutral-950/80 hover:bg-cyan-950 text-neutral-300 hover:text-cyan-300 rounded border border-neutral-800 hover:border-cyan-700 cursor-pointer backdrop-blur"
                  title="Abrir em Janela Popup Flutuante"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 rounded border border-neutral-800 cursor-pointer backdrop-blur"
                title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </>
        ) : (
          /* Estado On-Demand Desativado (Economia de Banda e CPU) */
          <div className="text-center p-6 space-y-3">
            <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
              <EyeOff className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-neutral-300">
                {userName} está transmitindo {type === 'screen' ? 'a Tela' : 'a Webcam'}
              </h4>
              <p className="text-[11px] text-neutral-500 font-mono">
                {title} ({resolution} · {fps} FPS)
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={onToggleWatch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                Assistir Live (On-Demand)
              </button>
              {onResetConnection && !isSelf && (
                <button
                  onClick={onResetConnection}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-cyan-300 text-xs font-mono rounded cursor-pointer transition-all"
                  title="Resetar conexão P2P com este participante"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controles de Áudio & Volume Individual com Memória Persistente */}
      <div
        onWheel={handleVolumeWheel}
        className="p-3 bg-neutral-950/80 border-t border-neutral-800 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            disabled={isSelf}
            className={`p-1.5 rounded border cursor-pointer transition-colors ${
              isSelf
                ? 'bg-neutral-900/50 border-neutral-800 text-neutral-600 cursor-not-allowed'
                : isMuted
                ? 'bg-red-950/60 border-red-800 text-red-400'
                : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={
              isSelf
                ? 'Sua própria transmissão fica mutada localmente para evitar eco'
                : isMuted
                ? 'Desmutar (restaurar volume salvo)'
                : 'Mutar áudio'
            }
          >
            {isMuted || isSelf ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            )}
          </button>

          {/* Slider de Volume Individual (0% até 150% boost) com salvamento automático */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={150}
              value={isSelf ? 0 : isMuted ? 0 : volume}
              onChange={(e) => handleVolumeUpdate(Number(e.target.value))}
              onDoubleClick={() => !isSelf && handleVolumeUpdate(100)}
              disabled={isSelf}
              title="Arraste ou use a roda do mouse para ajustar a altura do áudio (duplo clique volta para 100%). Salvo automaticamente."
              className="w-24 sm:w-28 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
            <span
              onClick={() => !isSelf && handleVolumeUpdate(100)}
              title="Volume salvo automaticamente para esta transmissão (clique para resetar em 100%)"
              className={`text-[10px] font-mono w-10 cursor-pointer select-none transition-colors ${
                !isSelf && volume > 100
                  ? 'text-amber-400 font-bold'
                  : 'text-neutral-300 hover:text-cyan-300'
              }`}
            >
              {isSelf ? 'Local' : isMuted ? '0%' : `${volume}%`}
            </span>

            {!isSelf && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all ${
                  savedVolumeFlash
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                    : 'bg-neutral-900/70 border-neutral-800 text-neutral-500'
                }`}
                title={`Altura do áudio (${isMuted ? '0%' : `${volume}%`}) guardada para ${userName}`}
              >
                <BookmarkCheck className="w-3 h-3 text-cyan-400" />
                <span className="hidden sm:inline">{savedVolumeFlash ? 'Salvo!' : 'Salvo'}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Botão de Destacar em Popup */}
          {isWatched && onOpenPopup && !isPoppedOut && (
            <button
              onClick={onOpenPopup}
              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer bg-cyan-950/40 hover:bg-cyan-950/80 border border-cyan-800/60 px-2 py-1 rounded transition-colors"
              title="Abrir esta live em janela popup com tamanho e qualidade ajustáveis"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Popup</span>
            </button>
          )}

          {/* Botão de Pausar Visualização */}
          {isWatched && !isSelf && (
            <button
              onClick={onToggleWatch}
              className="text-[11px] font-mono text-neutral-400 hover:text-neutral-200 flex items-center gap-1 cursor-pointer"
              title="Economizar banda parando de assistir este stream"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Pausar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
