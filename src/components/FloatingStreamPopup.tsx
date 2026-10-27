import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Volume2,
  VolumeX,
  Minimize2,
  Maximize2,
  X,
  Settings2,
  PictureInPicture2,
  Sparkles,
  Gamepad2,
  User,
  FlipHorizontal,
  Tv,
  ExternalLink,
  MonitorUp,
  BookmarkCheck,
} from 'lucide-react';
import { PopupSizePreset, StreamQualityPreset } from '../types';

// Mapa global das janelas externas reais do Sistema Operacional abertas via gesto direto do usuário
const externalWindowsMap = new Map<string, Window>();

function sanitizeWindowName(id: string): string {
  return 'sc_ext_win_' + id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Copia todas as folhas de estilo (<style> e <link rel="stylesheet">) da janela principal
 * para a nova janela do sistema operacional, garantindo que o Tailwind CSS funcione 100%.
 */
function syncStylesToExternalWindow(targetDoc: Document) {
  targetDoc.head.innerHTML = '';

  const metaCharset = targetDoc.createElement('meta');
  metaCharset.setAttribute('charset', 'utf-8');
  targetDoc.head.appendChild(metaCharset);

  const sourceNodes = document.querySelectorAll('style, link[rel="stylesheet"]');
  sourceNodes.forEach((node) => {
    try {
      targetDoc.head.appendChild(node.cloneNode(true));
    } catch {}
  });

  const baseStyle = targetDoc.createElement('style');
  baseStyle.textContent = `
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #09090b;
      color: #f4f4f5;
      overflow: hidden;
      user-select: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    #sc-popup-root {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background-color: #09090b;
    }
  `;
  targetDoc.head.appendChild(baseStyle);
}

/**
 * Deve ser chamado SINCRONAMENTE no evento onClick do botão "Popup / Nova Janela".
 * Isso garante que o WebView2 (Tauri) e os navegadores reconheçam `IsUserInitiated = true`
 * e abram uma janela real independente do sistema operacional que pode ser arrastada para outro monitor.
 */
export function openExternalStreamWindowSync(streamId: string, title?: string): Window | null {
  try {
    const existing = externalWindowsMap.get(streamId);
    if (existing && !existing.closed) {
      existing.focus();
      return existing;
    }

    const winName = sanitizeWindowName(streamId);
    const width = 900;
    const height = 540;
    const left = Math.max(40, Math.round((window.screen.availWidth - width) / 2));
    const top = Math.max(40, Math.round((window.screen.availHeight - height) / 2));

    const features = [
      'popup=yes',
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'resizable=yes',
      'scrollbars=no',
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
    ].join(',');

    const extWin = window.open('', winName, features);
    if (extWin) {
      extWin.document.title = title
        ? `DisCrab · ${title}`
        : 'DisCrab · Transmissão Destacada';
      syncStylesToExternalWindow(extWin.document);
      externalWindowsMap.set(streamId, extWin);
      extWin.focus();
      return extWin;
    }
  } catch (err) {
    console.warn('[FloatingStreamPopup] Falha ao abrir nova janela externa do SO:', err);
  }
  return null;
}

export function closeExternalStreamWindowSync(streamId: string) {
  const existing = externalWindowsMap.get(streamId);
  if (existing && !existing.closed) {
    try {
      existing.close();
    } catch {}
  }
  externalWindowsMap.delete(streamId);
}

interface FloatingStreamPopupProps {
  id: string;
  userName: string;
  title: string;
  type: 'screen' | 'webcam';
  sourceKind?: 'screen' | 'webcam' | 'capture_card';
  stream?: MediaStream | null;
  resolution: string;
  fps: number;
  isSelf?: boolean;
  hasIsolatedAudio?: boolean;
  processName?: string;
  volume: number;
  isMuted: boolean;
  isMirrored?: boolean;
  initialX?: number;
  initialY?: number;
  onClose: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleMirror?: () => void;
}

export const FloatingStreamPopup: React.FC<FloatingStreamPopupProps> = ({
  id,
  userName,
  title,
  type,
  sourceKind,
  stream,
  resolution,
  fps,
  isSelf,
  hasIsolatedAudio,
  processName,
  volume,
  isMuted,
  isMirrored = false,
  initialX = 100,
  initialY = 100,
  onClose,
  onChangeVolume,
  onToggleMute,
  onToggleMirror,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const effectiveKind = sourceKind || (type === 'screen' ? 'screen' : 'webcam');

  // Container DOM dentro da Nova Janela do Sistema Operacional (quando aberta)
  const [externalContainer, setExternalContainer] = useState<HTMLElement | null>(null);
  const externalWinRef = useRef<Window | null>(null);

  // Estados de Controle
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [sizePreset, setSizePreset] = useState<PopupSizePreset>('large');
  const [customDimensions, setCustomDimensions] = useState({ width: 854, height: 480 });
  const [qualityPreset, setQualityPreset] = useState<StreamQualityPreset>('auto');
  const [isMinimized, setIsMinimized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedVolumeFlash, setSavedVolumeFlash] = useState(false);
  const flashTimerRef = useRef<any>(null);

  // Web Audio API para amplificação limpa acima de 100% (101% até 150% boost)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const boostSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostStreamRef = useRef<MediaStream | null>(null);

  // Conecta ou inicializa a Nova Janela do Sistema Operacional
  const attachExternalWindow = (win: Window) => {
    externalWinRef.current = win;
    win.document.title = `${userName} · ${title} — DisCrab`;
    syncStylesToExternalWindow(win.document);

    let rootEl = win.document.getElementById('sc-popup-root');
    if (!rootEl) {
      rootEl = win.document.createElement('div');
      rootEl.id = 'sc-popup-root';
      win.document.body.innerHTML = '';
      win.document.body.appendChild(rootEl);
    }
    setExternalContainer(rootEl);

    const handleExternalUnload = () => {
      externalWindowsMap.delete(id);
      externalWinRef.current = null;
      setExternalContainer(null);
      onClose();
    };

    win.addEventListener('beforeunload', handleExternalUnload);
    win.addEventListener('pagehide', handleExternalUnload);
  };

  useEffect(() => {
    const existingWin = externalWindowsMap.get(id);
    if (existingWin && !existingWin.closed) {
      attachExternalWindow(existingWin);
    } else {
      const opened = openExternalStreamWindowSync(id, `${userName} - ${title}`);
      if (opened) {
        attachExternalWindow(opened);
      }
    }

    // Monitora fechamento da janela externa pelo botão X do Windows
    const checkTimer = setInterval(() => {
      const w = externalWinRef.current;
      if (w && w.closed) {
        externalWindowsMap.delete(id);
        externalWinRef.current = null;
        setExternalContainer(null);
        onClose();
      }
    }, 400);

    // Sincroniza novas tags <style> se o Vite/Tailwind injetar alguma regra
    const observer = new MutationObserver(() => {
      const w = externalWinRef.current;
      if (w && !w.closed) {
        syncStylesToExternalWindow(w.document);
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });

    return () => {
      clearInterval(checkTimer);
      observer.disconnect();
      closeExternalStreamWindowSync(id);
    };
  }, [id]);

  // Atualiza o título da janela externa se mudar
  useEffect(() => {
    if (externalWinRef.current && !externalWinRef.current.closed) {
      externalWinRef.current.document.title = `${userName} · ${title} — DisCrab`;
    }
  }, [userName, title]);

  const streamTracksKey = stream
    ? stream
        .getTracks()
        .map((t) => `${t.kind}:${t.id}:${t.readyState}`)
        .join('|')
    : '';

  // Vincula o MediaStream ao elemento <video> (tanto na janela externa quanto no fallback)
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      el.srcObject = stream;
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
      el.play().catch((err) => {
        console.warn('[FloatingPopup] Autoplay aguardando interação:', err);
      });
    }
  }, [stream, streamTracksKey, externalContainer, isSelf]);

  // Controle de Volume (0% a 150% com Boost via Web Audio API sem silenciar o decodificador WebRTC)
  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
    }

    const hasAudioTracks = !!stream && stream.getAudioTracks().length > 0;
    const useBoost = !isSelf && !isMuted && volume > 100 && hasAudioTracks;

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
      } catch {}
    }

    if (boostSourceRef.current || boostGainRef.current) {
      try {
        boostSourceRef.current?.disconnect();
        boostGainRef.current?.disconnect();
      } catch {}
      boostSourceRef.current = null;
      boostGainRef.current = null;
      boostStreamRef.current = null;
    }
  }, [volume, isMuted, isSelf, stream, streamTracksKey, externalContainer]);

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
    const clamped = Math.max(0, Math.min(200, Math.round(newVol)));
    onChangeVolume(clamped);
    setSavedVolumeFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSavedVolumeFlash(false), 1400);
  };

  // Define dimensões e redimensiona a janela externa do SO quando o usuário escolhe um preset
  const handleSelectSizePreset = (preset: PopupSizePreset) => {
    setSizePreset(preset);
    let w = 854;
    let h = 480;
    if (preset === 'compact') {
      w = 540;
      h = 340;
    } else if (preset === 'medium') {
      w = 760;
      h = 460;
    } else if (preset === 'large') {
      w = 1024;
      h = 620;
    }
    setCustomDimensions({ width: w, height: h });

    if (externalWinRef.current && !externalWinRef.current.closed) {
      try {
        externalWinRef.current.resizeTo(w, h + 40);
      } catch {}
    }
  };

  // Ativa Picture-in-Picture nativo do SO (sempre no topo sobre jogos)
  const handleTogglePiP = async () => {
    try {
      const targetDoc = externalWinRef.current?.document || document;
      if (targetDoc.pictureInPictureElement) {
        await targetDoc.exitPictureInPicture();
        setIsPiPActive(false);
      } else if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
        setIsPiPActive(true);
      }
    } catch (err) {
      console.warn('[FloatingPopup] PiP não disponível:', err);
    }
  };

  // Tela cheia na tela atual (ex: Tela Cheia no 2º Monitor!)
  const handleToggleFullscreen = () => {
    const targetDoc = externalWinRef.current?.document || document;
    const targetEl = externalWinRef.current?.document.documentElement || popupRef.current;
    if (!targetEl) return;

    if (!targetDoc.fullscreenElement) {
      targetEl
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      targetDoc
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  // Drag and Drop (usado apenas caso o modo in-app fallback esteja visível)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (externalContainer) return;
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    if (externalContainer) return;
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
  }, [isDragging, dragOffset, position, externalContainer]);

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

  const handleClosePopup = () => {
    closeExternalStreamWindowSync(id);
    onClose();
  };

  // Conteúdo completo do Player Destacado (renderizado dentro da Nova Janela do SO via Portal)
  const renderPopupContent = (isExternalOsWindow: boolean) => (
    <div
      ref={popupRef}
      style={
        isExternalOsWindow
          ? undefined
          : {
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: isMinimized ? '340px' : `${customDimensions.width}px`,
              zIndex: 50,
            }
      }
      className={
        isExternalOsWindow
          ? 'w-screen h-screen bg-neutral-950 text-neutral-100 flex flex-col font-mono select-none overflow-hidden'
          : `fixed rounded-xl border border-cyan-500/40 bg-neutral-950/95 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col font-mono select-none transition-[width] duration-150 ${
              isDragging
                ? 'shadow-cyan-500/20 ring-2 ring-cyan-500/50 cursor-grabbing'
                : 'shadow-black/80'
            }`
      }
    >
      {/* Barra de Título Superior */}
      <div
        onMouseDown={handleMouseDown}
        className={`px-3 py-2 bg-gradient-to-r from-neutral-900 via-neutral-900 to-cyan-950/50 border-b border-neutral-800 flex items-center justify-between gap-2 shrink-0 ${
          isExternalOsWindow ? '' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-xs font-bold text-neutral-200 truncate">
            {userName} {isSelf && '(Você)'}
          </span>
          <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-1.5 py-0.5 rounded truncate">
            {title}
          </span>
          {isExternalOsWindow && (
            <span className="text-[10px] text-emerald-300 bg-emerald-950/80 border border-emerald-800/70 px-1.5 py-0.5 rounded hidden sm:inline-block">
              Janela Independente (Livre p/ Outro Monitor)
            </span>
          )}
        </div>

        {/* Controles de Janela */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Se por algum motivo o navegador bloqueou o popup automático, permite abrir com 1 clique */}
          {!isExternalOsWindow && (
            <button
              onClick={() => {
                const opened = openExternalStreamWindowSync(id, `${userName} - ${title}`);
                if (opened) attachExternalWindow(opened);
              }}
              className="px-2 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-[10px] flex items-center gap-1 cursor-pointer shadow"
              title="Destacar em uma nova janela real do Windows para mover para outro monitor"
            >
              <MonitorUp className="w-3.5 h-3.5" />
              <span>Abrir em Nova Janela</span>
            </button>
          )}

          {/* Inverter / Espelhar */}
          {onToggleMirror && (
            <button
              onClick={onToggleMirror}
              className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer border ${
                isMirrored
                  ? 'text-indigo-200 bg-indigo-950/90 border-indigo-600'
                  : 'text-neutral-300 border-neutral-800 hover:text-white hover:bg-neutral-800'
              }`}
              title={
                isMirrored
                  ? 'Desativar inversão horizontal'
                  : 'Inverter / Espelhar horizontalmente'
              }
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isMirrored ? 'Invertido' : 'Inverter'}</span>
            </button>
          )}

          {/* Menu de Ajuste de Tamanho e Qualidade */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              showSettings ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Ajustar Dimensões e Qualidade"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Picture-in-Picture Nativo (Sempre no Topo) */}
          <button
            onClick={handleTogglePiP}
            className={`p-1.5 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              isPiPActive ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Picture-in-Picture (Flutuar sempre no topo sobre jogos)"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>

          {/* Tela Cheia no Monitor Atual */}
          <button
            onClick={handleToggleFullscreen}
            className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Tela Cheia neste Monitor"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Fechar Janela Externa e Ancorar de volta na Grade Principal */}
          <button
            onClick={handleClosePopup}
            className="px-2 py-1 text-[10px] text-red-300 hover:text-white bg-red-950/60 hover:bg-red-800 border border-red-800/80 rounded transition-colors cursor-pointer flex items-center gap-1"
            title="Fechar janela destacada e voltar a transmissão para a grade principal"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Voltar p/ Grade</span>
          </button>
        </div>
      </div>

      {/* Painel Expansível de Controles de Tamanho e Qualidade */}
      {showSettings && !isMinimized && (
        <div className="bg-neutral-900 border-b border-neutral-800 p-2.5 space-y-2 text-[11px] shrink-0">
          <div className="grid grid-cols-2 gap-3">
            {/* Controle de Tamanho da Janela */}
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Redimensionar Janela
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['compact', 'medium', 'large'] as PopupSizePreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handleSelectSizePreset(preset)}
                    className={`px-2 py-1 rounded text-[10px] border cursor-pointer transition-all ${
                      sizePreset === preset
                        ? 'bg-cyan-500 text-black font-bold border-cyan-400'
                        : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {preset === 'compact'
                      ? 'Compacta'
                      : preset === 'medium'
                      ? 'Média (HD)'
                      : 'Grande (Full)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Controle de Qualidade */}
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Filtro de Renderização
              </span>
              <select
                value={qualityPreset}
                onChange={(e) => setQualityPreset(e.target.value as StreamQualityPreset)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[11px] text-cyan-300 outline-none cursor-pointer"
              >
                <option value="auto">Auto ({resolution} · {fps} FPS)</option>
                <option value="1080p60">1080p 60 FPS (Ultra)</option>
                <option value="720p60">720p 60 FPS (HD)</option>
                <option value="480p30">480p 30 FPS (Fluida)</option>
                <option value="360p30">360p 30 FPS (Econômica)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Área Principal de Vídeo */}
      {!isMinimized && (
        <div
          className={`relative bg-black flex items-center justify-center overflow-hidden group ${
            isExternalOsWindow ? 'flex-1 min-h-0' : 'aspect-video'
          }`}
        >
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isSelf ? true : isMuted}
              className={`w-full h-full object-contain bg-black transition-transform duration-150 ${getQualityStyles()} ${
                isMirrored ? 'scale-x-[-1]' : ''
              }`}
            />
          ) : (
            <div className="w-full h-full bg-neutral-950 flex flex-col items-center justify-center text-neutral-500 space-y-2 p-4">
              {effectiveKind === 'screen' ? (
                <Gamepad2 className="w-10 h-10 text-cyan-400 animate-pulse" />
              ) : effectiveKind === 'capture_card' ? (
                <Tv className="w-10 h-10 text-emerald-400 animate-pulse" />
              ) : (
                <User className="w-10 h-10 text-indigo-400 animate-pulse" />
              )}
              <span className="text-xs text-neutral-400">Aguardando dados de vídeo...</span>
            </div>
          )}

          {/* Badges de Status Flutuantes */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none">
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
        </div>
      )}

      {/* Barra Inferior Fixa de Controles de Áudio & Ações */}
      <div
        onWheel={(e) => {
          if (isSelf) return;
          e.preventDefault();
          const step = e.deltaY < 0 ? 5 : -5;
          const base = isMuted ? 0 : volume;
          handleVolumeUpdate(base + step);
        }}
        className="px-3 py-2.5 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between gap-3 shrink-0"
      >
        {/* Controles de Áudio */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            disabled={isSelf}
            className={`p-1.5 rounded border cursor-pointer transition-colors ${
              isMuted || isSelf
                ? 'bg-red-950/80 border-red-800 text-red-400'
                : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={isMuted ? 'Desmutar (restaurar volume salvo)' : 'Mutar'}
          >
            {isMuted || isSelf ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={200}
            value={isSelf ? 0 : isMuted ? 0 : volume}
            onChange={(e) => handleVolumeUpdate(Number(e.target.value))}
            onDoubleClick={() => !isSelf && handleVolumeUpdate(100)}
            disabled={isSelf}
            title="Altura do áudio salva automaticamente (0% a 200%). Duplo clique volta para 100%."
            className="w-28 sm:w-36 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <span
            onClick={() => !isSelf && handleVolumeUpdate(100)}
            className={`text-[11px] w-10 cursor-pointer ${
              !isSelf && volume > 100
                ? 'text-amber-400 font-bold'
                : 'text-neutral-300 hover:text-cyan-300'
            }`}
            title="Volume salvo automaticamente (clique para 100%)"
          >
            {isSelf ? 'Local' : isMuted ? '0%' : `${volume}%`}
          </span>

          {!isSelf && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                savedVolumeFlash
                  ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                  : 'bg-neutral-900/70 border-neutral-800 text-neutral-500'
              }`}
            >
              <BookmarkCheck className="w-3 h-3 text-cyan-400" />
              <span>{savedVolumeFlash ? 'Salvo!' : 'Salvo'}</span>
            </span>
          )}
        </div>

        {/* Botão Inverter + Tela Cheia */}
        <div className="flex items-center gap-2 text-[10px] text-neutral-400">
          {onToggleMirror && (
            <button
              onClick={onToggleMirror}
              className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer transition-colors ${
                isMirrored
                  ? 'bg-indigo-950/80 border-indigo-600 text-indigo-200'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>{isMirrored ? 'Invertido' : 'Inverter'}</span>
            </button>
          )}
          <button
            onClick={handleToggleFullscreen}
            className="px-2 py-1 rounded border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-cyan-300 flex items-center gap-1 cursor-pointer"
            title="Expandir para Tela Cheia no monitor onde esta janela estiver"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Tela Cheia</span>
          </button>
        </div>
      </div>
    </div>
  );

  // Se a Nova Janela do Sistema Operacional está ativa, renderizamos o Player diretamente dentro dela via Portal!
  if (externalContainer) {
    return createPortal(renderPopupContent(true), externalContainer);
  }

  return renderPopupContent(false);
};
