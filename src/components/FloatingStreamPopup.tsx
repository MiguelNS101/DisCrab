import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Minimize2,
  Maximize2,
  X,
  Settings2,
  Tv,
  PictureInPicture2,
  Sparkles,
  Gamepad2,
  User,
  Activity,
  Sliders,
  ChevronDown,
} from 'lucide-react';
import { PopupSizePreset, StreamQualityPreset } from '../types';

interface FloatingStreamPopupProps {
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
  initialX?: number;
  initialY?: number;
  onClose: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

export const FloatingStreamPopup: React.FC<FloatingStreamPopupProps> = ({
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
  initialX = 100,
  initialY = 100,
  onClose,
  onChangeVolume,
  onToggleMute,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Estados de Controle do Popup
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [sizePreset, setSizePreset] = useState<PopupSizePreset>('medium');
  const [customDimensions, setCustomDimensions] = useState({ width: 640, height: 360 });
  const [qualityPreset, setQualityPreset] = useState<StreamQualityPreset>('auto');
  const [isMinimized, setIsMinimized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPiPActive, setIsPiPActive] = useState(false);

  // Vincula o MediaStream ao elemento <video> apenas quando o stream muda
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch((err) => {
        console.warn('[FloatingPopup] Autoplay restrito pelo navegador, aguardando clique:', err);
      });
    }
  }, [stream]);

  // Volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isSelf ? true : isMuted;
      videoRef.current.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
    }
  }, [volume, isMuted, isSelf, stream]);

  // Define dimensões com base no preset
  useEffect(() => {
    switch (sizePreset) {
      case 'compact':
        setCustomDimensions({ width: 440, height: 248 });
        break;
      case 'medium':
        setCustomDimensions({ width: 640, height: 360 });
        break;
      case 'large':
        setCustomDimensions({ width: 854, height: 480 });
        break;
      case 'free':
        // Mantém dimensão customizada
        break;
    }
  }, [sizePreset]);

  // Ativa Picture-in-Picture nativo do navegador/OS
  const handleTogglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
      } else if (videoRef.current && document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
        setIsPiPActive(true);
      }
    } catch (err) {
      console.warn('[FloatingPopup] PiP não disponível:', err);
    }
  };

  // Drag and Drop da Janela Flutuante
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Apenas se clicou na barra de título e não em um botão
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 200, e.clientX - dragOffset.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, e.clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, position]);

  // Aplica estilos visuais de acordo com o preset de qualidade
  const getQualityStyles = () => {
    switch (qualityPreset) {
      case '360p30':
        return 'filter blur-[0.2px] contrast-95';
      case '480p30':
        return 'contrast-100';
      case '720p60':
      case '1080p60':
      case 'auto':
      default:
        return 'image-rendering-auto';
    }
  };

  return (
    <div
      ref={popupRef}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '320px' : `${customDimensions.width}px`,
        zIndex: 50,
      }}
      className={`fixed rounded-xl border border-cyan-500/40 bg-neutral-950/95 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col font-mono select-none transition-[width] duration-150 ${
        isDragging ? 'shadow-cyan-500/20 ring-2 ring-cyan-500/50 cursor-grabbing' : 'shadow-black/80'
      }`}
    >
      {/* Barra de Título (Draggable Header) */}
      <div
        onMouseDown={handleMouseDown}
        className="px-3 py-2 bg-gradient-to-r from-neutral-900 via-neutral-900 to-cyan-950/50 border-b border-neutral-800 flex items-center justify-between gap-2 cursor-grab"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-xs font-bold text-neutral-200 truncate">
            {userName} {isSelf && '(Você)'}
          </span>
          <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-1.5 py-0.2 rounded truncate hidden sm:inline-block">
            {title}
          </span>
        </div>

        {/* Controles de Janela */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Menu de Ajuste de Tamanho e Qualidade */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              showSettings ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Ajustar Tamanho e Qualidade"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Picture-in-Picture Nativo */}
          <button
            onClick={handleTogglePiP}
            className={`p-1 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              isPiPActive ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Picture-in-Picture (Flutuar sobre outros jogos)"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>

          {/* Minimizar / Restaurar */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer"
            title={isMinimized ? 'Restaurar' : 'Minimizar'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Fechar Popup e voltar ao Grid */}
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-red-400 rounded hover:bg-red-950/50 transition-colors cursor-pointer"
            title="Fechar Popup e ancorar na grade"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Painel Expansível de Controles de Tamanho e Qualidade */}
      {showSettings && !isMinimized && (
        <div className="bg-neutral-900 border-b border-neutral-800 p-2.5 space-y-2 text-[11px] animate-in fade-in duration-150">
          <div className="grid grid-cols-2 gap-3">
            {/* Controle de Tamanho */}
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Tamanho da Janela
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['compact', 'medium', 'large'] as PopupSizePreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setSizePreset(preset)}
                    className={`px-2 py-1 rounded text-[10px] border cursor-pointer capitalize transition-all ${
                      sizePreset === preset
                        ? 'bg-cyan-500 text-black font-bold border-cyan-400'
                        : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {preset === 'compact' ? '360p' : preset === 'medium' ? '720p' : '1080p'}
                  </button>
                ))}
              </div>
            </div>

            {/* Controle de Qualidade */}
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Qualidade de Vídeo
              </span>
              <select
                value={qualityPreset}
                onChange={(e) => setQualityPreset(e.target.value as StreamQualityPreset)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[11px] text-cyan-300 outline-none cursor-pointer"
              >
                <option value="auto">Auto (Original)</option>
                <option value="1080p60">1080p 60 FPS (Ultra)</option>
                <option value="720p60">720p 60 FPS (HD)</option>
                <option value="480p30">480p 30 FPS (Fluida)</option>
                <option value="360p30">360p 30 FPS (Econômica)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo de Vídeo (Oculto se minimizado) */}
      {!isMinimized && (
        <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden group">
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-contain bg-black ${getQualityStyles()}`}
            />
          ) : (
            <div className="w-full h-full bg-neutral-950 flex flex-col items-center justify-center text-neutral-500 space-y-2 p-4">
              {type === 'screen' ? (
                <Gamepad2 className="w-10 h-10 text-cyan-400 animate-pulse" />
              ) : (
                <User className="w-10 h-10 text-indigo-400 animate-pulse" />
              )}
              <span className="text-xs text-neutral-400">Aguardando dados de vídeo...</span>
            </div>
          )}

          {/* Badges de Status Flutuantes */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
            <span className="text-[10px] bg-neutral-950/80 backdrop-blur border border-neutral-800 px-2 py-0.5 rounded text-white flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {qualityPreset === 'auto' ? `${resolution} · ${fps}fps` : qualityPreset}
            </span>

            {hasIsolatedAudio && (
              <span className="text-[10px] bg-cyan-950/90 border border-cyan-800 text-cyan-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                {processName || 'WASAPI'}
              </span>
            )}
          </div>

          {/* Barra de Controles Inferior no Vídeo */}
          <div
            onWheel={(e) => {
              if (isSelf) return;
              e.preventDefault();
              const step = e.deltaY < 0 ? 5 : -5;
              const base = isMuted ? 0 : volume;
              onChangeVolume(Math.max(0, Math.min(150, base + step)));
            }}
            className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-neutral-950/90 via-neutral-950/60 to-transparent p-2.5 flex items-center justify-between gap-3 opacity-90 group-hover:opacity-100 transition-opacity"
          >
            {/* Controles de Áudio */}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleMute}
                disabled={isSelf}
                className={`p-1.5 rounded border cursor-pointer transition-colors ${
                  isMuted || isSelf
                    ? 'bg-red-950/80 border-red-800 text-red-400'
                    : 'bg-neutral-900/80 border-neutral-800 text-neutral-300 hover:text-white'
                }`}
                title={isMuted ? 'Desmutar (restaurar volume salvo)' : 'Mutar'}
              >
                {isMuted || isSelf ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                )}
              </button>

              <input
                type="range"
                min={0}
                max={150}
                value={isSelf ? 0 : isMuted ? 0 : volume}
                onChange={(e) => onChangeVolume(Number(e.target.value))}
                onDoubleClick={() => !isSelf && onChangeVolume(100)}
                disabled={isSelf}
                title="Altura do áudio salva automaticamente (use a roda do mouse ou duplo clique para 100%)"
                className="w-20 sm:w-24 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
              />
              <span
                onClick={() => !isSelf && onChangeVolume(100)}
                className="text-[10px] text-neutral-300 hover:text-cyan-300 w-9 cursor-pointer"
                title="Volume salvo automaticamente (clique para 100%)"
              >
                {isSelf ? 'Local' : isMuted ? '0%' : `${volume}%`}
              </span>
            </div>

            {/* Status Discreto de Telemetria P2P */}
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="text-cyan-400">Vol. Salvo</span>
              <span>·</span>
              <span className="text-emerald-400">P2P</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
