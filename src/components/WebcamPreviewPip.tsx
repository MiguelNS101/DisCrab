import React, { useState, useRef, useEffect } from 'react';
import {
  Video,
  Minimize2,
  Maximize2,
  FlipHorizontal,
  X,
  GripHorizontal,
  Tv,
} from 'lucide-react';

interface WebcamPreviewPipProps {
  stream: MediaStream | null;
  nickname: string;
  title?: string;
  sourceKind?: 'webcam' | 'capture_card';
  isMirrored?: boolean;
  onToggleMirror?: () => void;
  onStopWebcam: () => void;
}

export const WebcamPreviewPip: React.FC<WebcamPreviewPipProps> = ({
  stream,
  nickname,
  title = 'Sua Câmera (Preview)',
  sourceKind = 'webcam',
  isMirrored = false,
  onToggleMirror,
  onStopWebcam,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [localMirrored, setLocalMirrored] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('md');

  const effectiveMirrored = onToggleMirror ? isMirrored : localMirrored;
  const handleMirrorClick = () => {
    if (onToggleMirror) {
      onToggleMirror();
    } else {
      setLocalMirrored((prev) => !prev);
    }
  };

  // Controle de arrastar (Draggable)
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
      el.muted = true; // Mudo localmente para prevenir microfonia/eco
      el.play().catch((err) => {
        console.warn('[WebcamPreviewPip] Autoplay restrito:', err);
      });
    }
  }, [stream]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
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
  }, [isDragging]);

  if (!stream) return null;

  const widthClass =
    size === 'sm' ? 'w-48 sm:w-56' : size === 'md' ? 'w-64 sm:w-72' : 'w-80 sm:w-96';

  return (
    <div
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
      className={`fixed bottom-5 right-5 z-40 transition-shadow ${widthClass} select-none shadow-2xl rounded-xl bg-neutral-900/95 border ${
        sourceKind === 'capture_card' ? 'border-emerald-500/50' : 'border-indigo-500/50'
      } backdrop-blur-md overflow-hidden`}
    >
      {/* Barra de Título / Handle de Arraste */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-950/80 via-neutral-900 to-neutral-900 border-b border-indigo-500/30 cursor-move text-xs font-mono"
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <GripHorizontal className="w-3.5 h-3.5 text-indigo-400 shrink-0 opacity-60" />
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="font-bold text-indigo-200 truncate">{title}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Toggle Espelho / Inverter */}
          <button
            onClick={handleMirrorClick}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveMirrored
                ? 'text-indigo-200 bg-indigo-950/90 border border-indigo-600/80'
                : 'text-neutral-400 hover:text-white'
            }`}
            title={effectiveMirrored ? 'Inversão ativada (Clique para normal)' : 'Inverter / Espelhar horizontalmente'}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>

          {/* Tamanhos */}
          {!isMinimized && (
            <button
              onClick={() =>
                setSize((prev) => (prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm'))
              }
              className="px-1.5 py-0.5 text-[10px] rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors uppercase font-bold cursor-pointer"
              title="Alterar tamanho do preview"
            >
              {size}
            </button>
          )}

          {/* Minimizar */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer"
            title={isMinimized ? 'Expandir preview' : 'Minimizar preview'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Desligar Câmera */}
          <button
            onClick={onStopWebcam}
            className="p-1 text-neutral-400 hover:text-red-400 rounded hover:bg-red-950/60 transition-colors cursor-pointer"
            title="Desligar esta fonte"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Área de Vídeo (Ocultada se minimizado) */}
      {!isMinimized && (
        <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain bg-black transition-transform duration-150 ${
              effectiveMirrored ? 'scale-x-[-1]' : ''
            }`}
          />

          {/* Overlay Inferior */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] font-mono pointer-events-none">
            <span className="bg-neutral-950/80 backdrop-blur px-2 py-0.5 rounded text-neutral-300 border border-neutral-800">
              {nickname} (Você)
            </span>
            <span className="bg-indigo-950/80 backdrop-blur px-1.5 py-0.5 rounded text-indigo-300 border border-indigo-800 flex items-center gap-1">
              {sourceKind === 'capture_card' ? (
                <Tv className="w-3 h-3 text-emerald-400" />
              ) : (
                <Video className="w-3 h-3 text-indigo-400" />
              )}
              Ao Vivo
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
