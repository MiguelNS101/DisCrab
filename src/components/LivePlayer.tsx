import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Radio,
  Gamepad2,
  User,
  Sliders,
  Sparkles,
  ExternalLink,
  PictureInPicture2,
  Activity,
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
  onOpenPopup?: () => void;
  onToggleWatch: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

export const LivePlayer: React.FC<LivePlayerProps> = ({
  id,
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
  onOpenPopup,
  onToggleWatch,
  onChangeVolume,
  onToggleMute,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Vincula o MediaStream nativo da RTCPeerConnection ao elemento <video>
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && isWatched) {
      el.srcObject = stream;
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.min(1.0, isMuted ? 0 : volume / 100);
      el.play().catch((err) => {
        console.warn('[LivePlayer] Autoplay restrito pelo navegador, aguardando interação do usuário:', err);
      });
    }
  }, [stream, isWatched, isSelf, isMuted, volume]);

  // Aplica o volume ao elemento de vídeo
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isSelf ? true : isMuted;
      videoRef.current.volume = isSelf ? 0 : Math.min(1.0, isMuted ? 0 : volume / 100);
    }
  }, [volume, isMuted, isSelf]);

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
                Controles de tamanho livre, qualidade e áudio disponíveis na janela destacada.
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
                className={`w-full h-full object-contain bg-black ${type === 'webcam' && isSelf ? 'scale-x-[-1]' : ''}`}
              />
            ) : (
              /* Simulação animada ultra suave quando em preview */
              <div className="w-full h-full relative bg-gradient-to-br from-neutral-950 via-neutral-900 to-cyan-950/40 flex items-center justify-center">
                <div className="text-center space-y-2 p-4">
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
                    <span className="text-cyan-400">&lt;28ms RTT</span>
                  </div>
                </div>
              </div>
            )}

            {/* Overlays Superior */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
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
            </div>

            {/* Botões de Ação Superior Direito (Popup + Tela Cheia) */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
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
            <button
              onClick={onToggleWatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all shadow-sm"
            >
              <Eye className="w-3.5 h-3.5" />
              Assistir Live (On-Demand)
            </button>
          </div>
        )}
      </div>

      {/* Controles de Áudio & Volume Individual */}
      <div className="p-3 bg-neutral-950/80 border-t border-neutral-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            className={`p-1.5 rounded border cursor-pointer transition-colors ${
              isMuted
                ? 'bg-red-950/60 border-red-800 text-red-400'
                : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={isMuted ? 'Desmutar' : 'Mutar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>

          {/* Slider de Volume Individual (0% até 150% boost) */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={150}
              value={isMuted ? 0 : volume}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              disabled={isMuted}
              className="w-24 sm:w-28 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
            <span className="text-[10px] font-mono text-neutral-400 w-8">
              {isMuted ? '0%' : `${volume}%`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
