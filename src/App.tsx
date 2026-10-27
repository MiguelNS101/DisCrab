/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { RoomControl } from './components/RoomControl';
import { BroadcastControls } from './components/BroadcastControls';
import { VideoSourceManager } from './components/VideoSourceManager';
import { LivePlayer } from './components/LivePlayer';
import {
  FloatingStreamPopup,
  openExternalStreamWindowSync,
  closeExternalStreamWindowSync,
} from './components/FloatingStreamPopup';
import { PerformanceDrawer } from './components/PerformanceDrawer';
import { ChatBox } from './components/ChatBox';
import { WindowSelector } from './components/WindowSelector';
import {
  PresenceToastContainer,
  PresenceToastItem,
  playPresenceSound,
} from './components/PresenceToastContainer';
import { WindowItem, RoomDetails, StreamItem, ChatAttachment, AudioSourceMode } from './types';
import { useWebRtc } from './hooks/useWebRtc';
import { WebcamPreviewPip } from './components/WebcamPreviewPip';
import { startNativeMultiProcessAudio, isTauriEnvironment } from './services/tauriBridge';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeCustomizerModal } from './components/ThemeCustomizerModal';
import { AppIcon } from './components/AppIcon';
import {
  Radio,
  Users,
  AlertCircle,
  X,
  Tv,
  AppWindow,
  RefreshCw,
  ArrowLeft,
  Monitor,
  Video,
  Shield,
  Lock,
  Globe,
  Wifi,
  Loader2,
} from 'lucide-react';

export default function App() {
  // Inicializa o apelido do localStorage para não precisar digitar novamente
  const [nickname, setNickname] = useState<string>(() => {
    try {
      return localStorage.getItem('sc_nickname') || 'Jogador_1';
    } catch {
      return 'Jogador_1';
    }
  });

  // Salva o apelido sempre que alterado
  useEffect(() => {
    try {
      localStorage.setItem('sc_nickname', nickname);
    } catch {
      // ignore
    }
  }, [nickname]);

  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);
  const [isHost, setIsHost] = useState<boolean>(true);
  const [isLocalStudio, setIsLocalStudio] = useState<boolean>(false);
  const [externalUpdaterOpen, setExternalUpdaterOpen] = useState<boolean>(false);
  const [isEnteringRoomTransition, setIsEnteringRoomTransition] = useState<boolean>(false);
  const [hasEstablishedRoomSession, setHasEstablishedRoomSession] = useState<boolean>(false);

  // Controle de Popups de Transmissão Flutuantes Individuais
  const [activePopups, setActivePopups] = useState<Record<string, boolean>>({});
  // Controle Discreto do Gerenciador de Webcams & Placas de Captura USB
  const [showSourceManager, setShowSourceManager] = useState<boolean>(false);
  // Controle Discreto do Seletor de Janela & Áudio WASAPI (inicia fechado para priorizar as lives)
  const [showWindowSelector, setShowWindowSelector] = useState<boolean>(false);

  // Abre ou foca uma nova janela real do Sistema Operacional (permitindo arrastar para outro monitor)
  const openPopup = (streamId: string, title = 'DisCrab Live') => {
    openExternalStreamWindowSync(streamId, title);
    setActivePopups((prev) => ({
      ...prev,
      [streamId]: true,
    }));
  };

  const closePopup = (streamId: string) => {
    closeExternalStreamWindowSync(streamId);
    setActivePopups((prev) => ({
      ...prev,
      [streamId]: false,
    }));
  };

  // Hook WebRTC nativo P2P com DataChannel Chat integrado, auto-reconexão, multi-fonte e memória de volume/inversão
  const {
    isConnected,
    isReconnecting,
    reconnectAttempt,
    peers,
    error: rtcError,
    clearError,
    isScreenSharing,
    isWebcamActive,
    localStream,
    localMediaSources,
    videoDevices,
    audioDevices,
    refreshMediaDevices,
    startMediaSource,
    stopMediaSource,
    stopAllMediaSources,
    chatMessages,
    performanceLogs,
    telemetryHistory,
    clearPerformanceLogs,
    sendChatMessage,
    connectToRoom,
    disconnectFromRoom,
    reconnectAllPeers,
    resetPeerConnection,
    startScreenShare,
    updateStreamQuality,
    getDetectedWindowPid,
    detectedWindow,
    activeScreenTitle,
    stopScreenShare,
    toggleWebcam,
    requestPeerStream,
    getStreamVolume,
    setStreamVolume,
    toggleStreamMute,
    isStreamMirrored,
    toggleStreamMirror,
  } = useWebRtc();

  // Sistema de Notificações Toast de Presença (Entrada e Saída de Amigos na Sala)
  const [presenceToasts, setPresenceToasts] = useState<PresenceToastItem[]>([]);
  const knownPeersRef = useRef<Map<string, { nickname: string; isHost: boolean }>>(new Map());
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissPresenceToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setPresenceToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushPresenceToast = useCallback(
    (type: 'join' | 'leave', peerNickname: string, peerIsHost: boolean, participantCount: number) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const item: PresenceToastItem = {
        id,
        type,
        nickname: peerNickname,
        isHost: peerIsHost,
        participantCount,
        createdAt: Date.now(),
      };
      setPresenceToasts((prev) => [item, ...prev].slice(0, 5));
      playPresenceSound(type);

      const timer = setTimeout(() => {
        toastTimersRef.current.delete(id);
        setPresenceToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
      toastTimersRef.current.set(id, timer);
    },
    []
  );

  // Monitora alterações na lista de participantes para disparar toasts quando amigos entram ou saem
  useEffect(() => {
    if (!isConnected) {
      knownPeersRef.current.clear();
      return;
    }

    const currentIds = new Set<string>();
    const totalNow = peers.length + 1;

    for (const p of peers) {
      currentIds.add(p.id);
      const isPlaceholderName = !p.nickname || p.nickname === 'Conectando...';

      if (!knownPeersRef.current.has(p.id)) {
        if (isPlaceholderName) {
          // Aguarda o apelido definitivo do amigo chegar antes de notificar
          continue;
        }
        knownPeersRef.current.set(p.id, { nickname: p.nickname, isHost: p.isHost });
        pushPresenceToast('join', p.nickname, p.isHost, totalNow);
      } else if (!isPlaceholderName) {
        knownPeersRef.current.set(p.id, { nickname: p.nickname, isHost: p.isHost });
      }
    }

    for (const [oldId, oldMeta] of Array.from(knownPeersRef.current.entries())) {
      if (!currentIds.has(oldId)) {
        knownPeersRef.current.delete(oldId);
        pushPresenceToast('leave', oldMeta.nickname, oldMeta.isHost, totalNow);
      }
    }
  }, [peers, isConnected, pushPresenceToast]);

  // Limpa timers pendentes ao desmontar
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Seleção de janela e roteamento de áudio WASAPI por processo
  const [selectedWindow, setSelectedWindow] = useState<WindowItem | null>(null);
  const [audioSourceMode, setAudioSourceMode] = useState<AudioSourceMode>('selected_window');
  const [audioCustomWindows, setAudioCustomWindows] = useState<WindowItem[]>([]);
  const [isolateAudio, setIsolateAudio] = useState<boolean>(true);
  const [fps, setFps] = useState<30 | 60>(60);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '1440p'>('1080p');

  // Sincroniza automaticamente a janela detectada na transmissão ao vivo
  useEffect(() => {
    setSelectedWindow(detectedWindow);
  }, [detectedWindow]);

  // Atualiza resolução, escala, bitrate e FPS em tempo real durante a transmissão ativa
  useEffect(() => {
    if (isScreenSharing) {
      updateStreamQuality(resolution, fps).catch((err) =>
        console.warn('[App] Erro ao atualizar qualidade da transmissão em tempo real:', err)
      );
    }
  }, [resolution, fps, isScreenSharing, updateStreamQuality]);

  // Adiciona ou remove janela da lista de mixagem de áudio
  const handleToggleAudioCustomWindow = (win: WindowItem) => {
    setAudioCustomWindows((prev) => {
      const exists = prev.some((w) => w.hwnd === win.hwnd);
      if (exists) {
        return prev.filter((w) => w.hwnd !== win.hwnd);
      } else {
        return [...prev, win];
      }
    });
  };

  const handleClearAudioCustomWindows = () => {
    setAudioCustomWindows([]);
  };

  // Calcula a lista de PIDs efetivos para captura/mixagem WASAPI
  const getEffectiveAudioPids = (): number[] => {
    if (audioSourceMode === 'all_except_discord') return [0];
    const autoPid = detectedWindow ? detectedWindow.pid : getDetectedWindowPid();
    if (audioSourceMode === 'other_window') {
      if (audioCustomWindows.length > 0) return audioCustomWindows.map((w) => w.pid);
      return [autoPid];
    }
    // Modo 'selected_window' (Janela da Live): usa sempre o PID detectado automaticamente da janela/tela transmitida
    return [autoPid];
  };

  const getEffectiveAudioPid = (): number => {
    const pids = getEffectiveAudioPids();
    return pids[0] ?? 0;
  };

  const getEffectiveAudioLabel = (): string => {
    if (audioSourceMode === 'all_except_discord') return 'Todo o PC (Sem Discord)';
    if (audioSourceMode === 'other_window') {
      if (audioCustomWindows.length === 0) return 'Outras Janelas (Nenhuma Selecionada)';
      if (audioCustomWindows.length === 1) {
        return `${audioCustomWindows[0].process_name} (PID ${audioCustomWindows[0].pid})`;
      }
      return `${audioCustomWindows.length} Janelas Mixadas (${audioCustomWindows.map((w) => w.process_name).join(', ')})`;
    }
    if (detectedWindow) {
      return `${detectedWindow.process_name} (PID ${detectedWindow.pid})`;
    }
    const autoPid = getDetectedWindowPid();
    return autoPid > 0 ? `Janela da Live (PID ${autoPid})` : 'Tela da Live (Sem Discord)';
  };

  // Alternância dinâmica de áudio WASAPI em tempo real quando o usuário muda a fonte durante a live
  useEffect(() => {
    if (isScreenSharing && isolateAudio && isTauriEnvironment()) {
      const pids = getEffectiveAudioPids();
      startNativeMultiProcessAudio(pids).catch((err) =>
        console.warn('[App] Erro ao alternar fontes de áudio nativas:', err)
      );
    }
  }, [audioSourceMode, audioCustomWindows, detectedWindow, isScreenSharing, isolateAudio]);

  // Conecta ao WebSocket de sinalização sempre que uma sala é criada ou acessada
  useEffect(() => {
    if (roomDetails) {
      setIsEnteringRoomTransition(true);
      setHasEstablishedRoomSession(false);
      connectToRoom(roomDetails.ws_url, roomDetails.token, nickname).catch((err) => {
        console.error('[App] Erro na conexão WebRTC:', err);
      });
      const timer = setTimeout(() => {
        setIsEnteringRoomTransition(false);
      }, 650);
      return () => clearTimeout(timer);
    } else {
      setIsEnteringRoomTransition(false);
      setHasEstablishedRoomSession(false);
    }
  }, [roomDetails?.created_at]);

  useEffect(() => {
    if (isConnected && roomDetails) {
      setHasEstablishedRoomSession(true);
    }
  }, [isConnected, roomDetails]);

  // Monta a lista de streams estritamente REAIS a partir dos peers conectados
  const peerStreams: (StreamItem & { peerId: string; connectionState: RTCPeerConnectionState })[] = [];
  for (const p of peers) {
    if (p.hasScreen) {
      const sId = `${p.id}-screen`;
      const savedVol = getStreamVolume(sId, p.nickname, 'screen');
      peerStreams.push({
        id: sId,
        peerId: p.id,
        connectionState: p.connectionState,
        user_name: p.nickname,
        type: 'screen',
        source_kind: 'screen',
        title: p.screenTitle || 'Tela do Amigo',
        resolution: p.screenResolution || '1080p',
        fps: p.screenFps || 60,
        volume: savedVol,
        is_muted: savedVol === 0,
        is_watched: !!p.screenStream,
        isolated_audio: p.hasIsolatedAudio,
        process_name: p.hasIsolatedAudio ? 'WASAPI Process' : undefined,
        stream: p.screenStream,
      });
    }

    if (p.mediaSources && p.mediaSources.length > 0) {
      for (const src of p.mediaSources) {
        const mId = `${p.id}-source-${src.source_id}`;
        const savedVol = getStreamVolume(mId, p.nickname, src.source_id);
        const remoteStream = p.mediaStreams?.[src.source_id] || null;
        peerStreams.push({
          id: mId,
          peerId: p.id,
          source_id: src.source_id,
          source_kind: src.kind === 'capture_card' ? 'capture_card' : 'webcam',
          connectionState: p.connectionState,
          user_name: p.nickname,
          type: 'webcam',
          title: src.title || (src.kind === 'capture_card' ? 'Placa de Captura' : 'Webcam'),
          resolution: src.resolution || '720p',
          fps: src.fps || 30,
          volume: savedVol,
          is_muted: savedVol === 0,
          is_watched: !!remoteStream,
          isolated_audio: false,
          stream: remoteStream,
        });
      }
    } else if (p.hasWebcam) {
      const wId = `${p.id}-webcam`;
      const savedVol = getStreamVolume(wId, p.nickname, 'webcam');
      peerStreams.push({
        id: wId,
        peerId: p.id,
        source_kind: 'webcam',
        connectionState: p.connectionState,
        user_name: p.nickname,
        type: 'webcam',
        title: 'Câmera do Amigo',
        resolution: '720p',
        fps: 30,
        volume: savedVol,
        is_muted: savedVol === 0,
        is_watched: !!p.webcamStream,
        isolated_audio: false,
        stream: p.webcamStream,
      });
    }
  }

  const handleToggleWatch = (stream: StreamItem & { peerId: string }) => {
    if (stream.source_id) {
      requestPeerStream(stream.peerId, `source:${stream.source_id}`);
    } else {
      const type = stream.type === 'webcam' ? 'webcam' : 'screen';
      requestPeerStream(stream.peerId, type);
    }
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      const explicitPids =
        audioSourceMode === 'selected_window' ? undefined : getEffectiveAudioPids();
      await startScreenShare('Tela do Usuário', fps, resolution, isolateAudio, explicitPids);
    }
  };

  const handleSendMessage = (text: string, attachment?: ChatAttachment) => {
    sendChatMessage(text, nickname, attachment);
  };

  const totalActiveStreams =
    peerStreams.length + (isScreenSharing ? 1 : 0) + localMediaSources.length;

  const isInRoomWorkspace = Boolean(isConnected || roomDetails || isLocalStudio);
  const isShowingRoomTransition = Boolean(
    roomDetails && (isEnteringRoomTransition || (!isConnected && !hasEstablishedRoomSession))
  );

  return (
    <ThemeProvider>
      <div className="sc-app min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
        {/* Top Header */}
        <Header
          activePid={isScreenSharing && isolateAudio ? getEffectiveAudioPid() : null}
          activeProcessName={getEffectiveAudioLabel()}
          isInRoom={isInRoomWorkspace && !isShowingRoomTransition}
          externalUpdaterOpen={externalUpdaterOpen}
          onExternalUpdaterClose={() => setExternalUpdaterOpen(false)}
        />

        {/* Notificações Toast de Presença (Entrada / Saída de Amigos na Sala) */}
        <PresenceToastContainer toasts={presenceToasts} onDismiss={dismissPresenceToast} />

        {/* MODO 1: TELA INICIAL LIMPA (HOME / LOBBY) */}
        {!isInRoomWorkspace ? (
          <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
            {rtcError && (
              <div className="w-full max-w-md mb-4 bg-red-950/80 border border-red-800 rounded-xl p-3.5 flex items-start justify-between gap-3 text-xs font-mono">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-red-200">{rtcError}</span>
                </div>
                <button
                  onClick={clearError}
                  className="text-red-400 hover:text-white p-0.5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <RoomControl
              nickname={nickname}
              setNickname={setNickname}
              roomDetails={roomDetails}
              setRoomDetails={setRoomDetails}
              isHost={isHost}
              setIsHost={setIsHost}
              isConnected={isConnected}
              setIsConnected={(val) => {
                if (!val) {
                  disconnectFromRoom();
                  setRoomDetails(null);
                }
              }}
              onOpenUpdater={() => setExternalUpdaterOpen(true)}
              onEnterLocalStudio={() => setIsLocalStudio(true)}
            />
          </main>
        ) : isShowingRoomTransition && roomDetails ? (
          /* MODO TRANSIÇÃO DE TELA INTEIRA AO ENTRAR NA SALA */
          <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
            <div className="sc-card w-full max-w-md bg-neutral-900/95 border border-neutral-800 rounded-2xl p-7 sm:p-8 shadow-2xl text-center space-y-6 relative overflow-hidden">
              <div className="relative flex items-center justify-center mx-auto w-24 h-24">
                <span className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping" />
                <span className="absolute inset-1 rounded-full border-2 border-t-cyan-400 border-r-rose-500 border-b-transparent border-l-transparent animate-spin" />
                <AppIcon size={64} showLiveDot={true} animated={true} />
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-cyan-300">
                  {roomDetails.mode === 'mesh' ? (
                    <>
                      <Shield className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Sala Fixa:</span>
                      <strong className="text-white">{roomDetails.room_name}</strong>
                    </>
                  ) : roomDetails.mode === 'cloudflare' ? (
                    <>
                      <Globe className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Túnel P2P WAN</span>
                    </>
                  ) : (
                    <>
                      <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Rede Local (LAN)</span>
                    </>
                  )}
                </div>

                <h2 className="text-lg font-bold font-mono text-white tracking-wide">
                  {isConnected
                    ? 'Sala Conectada! Preparando Palco...'
                    : 'Conectando à Sala P2P...'}
                </h2>

                <p className="text-xs font-mono text-neutral-400 max-w-xs mx-auto">
                  {roomDetails.mode === 'mesh'
                    ? 'Autenticando chave criptografada AES-256 e sincronizando canais de vídeo e áudio...'
                    : 'Estabelecendo sinalização WebSocket de baixa latência e preparando canais WebRTC...'}
                </p>
              </div>

              {/* Barra de Progresso de Transição */}
              <div className="w-full space-y-2">
                <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
                  <div
                    className={`h-full bg-gradient-to-r from-cyan-500 via-rose-500 to-emerald-400 transition-all duration-300 ${
                      isConnected ? 'w-full' : 'w-2/3 animate-pulse'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 px-0.5">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span>{isConnected ? 'Sincronizado' : 'Negociando Handshake...'}</span>
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Lock className="w-3 h-3" />
                    <span>{nickname}</span>
                  </span>
                </div>
              </div>

              {rtcError && (
                <div className="bg-red-950/80 border border-red-800 rounded-xl p-3 text-left text-xs font-mono space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span className="text-red-200">{rtcError}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        connectToRoom(roomDetails.ws_url, roomDetails.token, nickname).catch(
                          () => {}
                        );
                      }}
                      className="px-3 py-1 bg-red-900/70 hover:bg-red-800 border border-red-700 text-red-100 rounded-lg cursor-pointer flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Tentar Novamente</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    disconnectFromRoom();
                    setRoomDetails(null);
                    setIsEnteringRoomTransition(false);
                    setHasEstablishedRoomSession(false);
                  }}
                  className="sc-btn inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white rounded-xl text-xs font-mono transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Cancelar e Voltar ao Início</span>
                </button>
              </div>
            </div>
          </main>
        ) : (
          /* MODO 2: SALA ATIVA (PALCO DE TRANSMISSÕES NO TOPO DE PONTA A PONTA + INFO DA SALA E CHAT EMBAIXO) */
          <main className="sc-container-width flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-5 space-y-5">
            {/* Banner de Reconexão Automática Transparente em Caso de Oscilação */}
            {isReconnecting && (
              <div className="bg-amber-950/80 border border-amber-700 rounded-xl p-3 flex items-center justify-between gap-3 shadow-lg text-xs font-mono">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-200">
                    Oscilação de rede detectada. Reconectando automaticamente à sala (tentativa {reconnectAttempt})...
                  </span>
                </div>
                <button
                  onClick={reconnectAllPeers}
                  className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-200 rounded cursor-pointer transition-colors shrink-0"
                >
                  Reconectar Agora
                </button>
              </div>
            )}

            {/* Alerta de Erro Real */}
            {rtcError && (
              <div className="bg-red-950/80 border border-red-800 rounded-xl p-3.5 flex items-start justify-between gap-3 shadow-lg text-xs font-mono">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-red-200 block">Erro Detectado:</strong>
                    <p className="text-red-300 mt-0.5">{rtcError}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {roomDetails && (
                    <button
                      onClick={() => {
                        clearError();
                        connectToRoom(roomDetails.ws_url, roomDetails.token, nickname).catch(() => {});
                      }}
                      className="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 border border-red-700 text-red-100 rounded cursor-pointer flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reconectar</span>
                    </button>
                  )}
                  <button
                    onClick={clearError}
                    className="text-red-400 hover:text-white p-1 rounded cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* 1. PALCO DE TRANSMISSÕES AO VIVO NO TOPO (DE PONTA A PONTA / 100% LARGURA) */}
            <section className="w-full space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2 px-1">
                <div className="flex items-center gap-2.5">
                  <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
                    Palco de Transmissões Ao Vivo ({totalActiveStreams})
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    Na Sala: <strong className="text-white">{peers.length + 1}</strong>
                  </span>
                  {isConnected && peers.length > 0 && (
                    <button
                      onClick={reconnectAllPeers}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-cyan-700 text-cyan-300 rounded-lg cursor-pointer transition-colors"
                      title="Forçar ressincronização P2P com todos os participantes"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Resetar P2P</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Estado sem lives abertas: botões rápidos diretos no palco principal de ponta a ponta */}
              {totalActiveStreams === 0 ? (
                <div className="sc-card w-full bg-neutral-900/70 border border-neutral-800 rounded-2xl p-8 sm:p-12 text-center space-y-4 shadow-xl">
                  <div className="w-14 h-14 rounded-2xl bg-neutral-950 border border-neutral-800 flex items-center justify-center mx-auto text-cyan-400">
                    <Tv className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-mono font-bold text-white">
                      Palco de Transmissões Pronto
                    </h3>
                    <p className="text-xs text-neutral-400 font-mono max-w-lg mx-auto">
                      As transmissões da sala aparecem aqui no topo de ponta a ponta. Inicie sua tela, jogo, webcam ou placa de captura abaixo:
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleToggleScreenShare}
                      className="sc-btn sc-btn-primary sc-btn-sized flex items-center gap-2 px-4 py-2 bg-cyan-500 text-black font-mono font-bold text-xs rounded-xl cursor-pointer"
                    >
                      <Monitor className="w-4 h-4" />
                      <span>Transmitir Tela Agora</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSourceManager(true)}
                      className="sc-btn sc-btn-sized flex items-center gap-2 px-4 py-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 font-mono text-xs rounded-xl cursor-pointer"
                    >
                      <Video className="w-4 h-4 text-indigo-400" />
                      <span>Ligar Câmera / Placa de Captura</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWindowSelector(true)}
                      className="sc-btn sc-btn-sized flex items-center gap-2 px-3.5 py-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 font-mono text-xs rounded-xl cursor-pointer"
                    >
                      <AppWindow className="w-4 h-4 text-cyan-400" />
                      <span>Configurar Janela de Áudio</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`sc-stream-grid w-full grid gap-4 ${
                    totalActiveStreams === 1
                      ? 'grid-cols-1'
                      : 'grid-cols-1 lg:grid-cols-2'
                  }`}
                >
                  {/* Transmissão de Tela do Próprio Usuário (Local) */}
                  {isScreenSharing && (
                    <LivePlayer
                      id="self-screen"
                      userName={nickname}
                      title={selectedWindow ? selectedWindow.title : activeScreenTitle}
                      type="screen"
                      sourceKind="screen"
                      stream={localStream}
                      resolution={resolution}
                      fps={fps}
                      isSelf={true}
                      hasIsolatedAudio={isolateAudio}
                      processName={selectedWindow?.process_name}
                      volume={100}
                      isMuted={false}
                      isWatched={true}
                      isPoppedOut={!!activePopups['self-screen']}
                      isMirrored={isStreamMirrored('self-screen')}
                      onToggleMirror={() => toggleStreamMirror('self-screen')}
                      onOpenPopup={() =>
                        openPopup(
                          'self-screen',
                          `${nickname} - ${selectedWindow ? selectedWindow.title : activeScreenTitle}`
                        )
                      }
                      onClosePopup={() => closePopup('self-screen')}
                      onToggleWatch={() => {}}
                      onChangeVolume={() => {}}
                      onToggleMute={() => {}}
                    />
                  )}

                  {/* Webcams e Placas de Captura do Próprio Usuário */}
                  {localMediaSources.map((src) => {
                    const selfId = `self-${src.sourceId}`;
                    return (
                      <LivePlayer
                        key={selfId}
                        id={selfId}
                        userName={nickname}
                        title={src.title}
                        type="webcam"
                        sourceKind={src.kind}
                        stream={src.stream}
                        resolution={src.resolution}
                        fps={src.fps}
                        isSelf={true}
                        hasIsolatedAudio={false}
                        volume={0}
                        isMuted={true}
                        isWatched={true}
                        isPoppedOut={!!activePopups[selfId]}
                        isMirrored={isStreamMirrored(selfId)}
                        onToggleMirror={() => toggleStreamMirror(selfId)}
                        onStopLocalSource={() => stopMediaSource(src.sourceId)}
                        onOpenPopup={() => openPopup(selfId, `${nickname} - ${src.title}`)}
                        onClosePopup={() => closePopup(selfId)}
                        onToggleWatch={() => {}}
                        onChangeVolume={() => {}}
                        onToggleMute={() => {}}
                      />
                    );
                  })}

                  {/* Transmissões Recebidas dos Amigos */}
                  {peerStreams.map((stream) => (
                    <LivePlayer
                      key={stream.id}
                      id={stream.id}
                      userName={stream.user_name}
                      title={stream.title}
                      type={stream.type}
                      sourceKind={stream.source_kind}
                      stream={stream.stream}
                      resolution={stream.resolution}
                      fps={stream.fps}
                      isSelf={false}
                      hasIsolatedAudio={stream.isolated_audio}
                      processName={stream.process_name}
                      volume={stream.volume}
                      isMuted={stream.is_muted}
                      isWatched={stream.is_watched}
                      isPoppedOut={!!activePopups[stream.id]}
                      isMirrored={isStreamMirrored(stream.id)}
                      onToggleMirror={() => toggleStreamMirror(stream.id)}
                      connectionState={stream.connectionState}
                      onOpenPopup={() =>
                        openPopup(stream.id, `${stream.user_name} - ${stream.title}`)
                      }
                      onClosePopup={() => closePopup(stream.id)}
                      onToggleWatch={() => handleToggleWatch(stream)}
                      onChangeVolume={(vol) =>
                        setStreamVolume(stream.id, vol, stream.user_name, stream.source_id || stream.type)
                      }
                      onToggleMute={() =>
                        toggleStreamMute(stream.id, stream.user_name, stream.source_id || stream.type)
                      }
                      onResetConnection={() => resetPeerConnection(stream.peerId)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 2. ÁREA INFERIOR: INFORMAÇÕES E CONTROLES DA SALA + CHAT P2P LADO A LADO */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Coluna Esquerda: Informações da Sala, Controles de Transmissão e Gavetas (7 colunas) */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-4">
                <div className="sc-card sc-toolbar bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 shadow-lg space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800/80">
                    {roomDetails ? (
                      <div className="w-full">
                        <RoomControl
                          nickname={nickname}
                          setNickname={setNickname}
                          roomDetails={roomDetails}
                          setRoomDetails={setRoomDetails}
                          isHost={isHost}
                          setIsHost={setIsHost}
                          isConnected={isConnected}
                          setIsConnected={(val) => {
                            if (!val) {
                              disconnectFromRoom();
                              setRoomDetails(null);
                              setIsLocalStudio(false);
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-full flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                          <span className="font-bold text-cyan-300 uppercase">Modo Estúdio Local</span>
                          <span className="text-neutral-500">·</span>
                          <span className="text-neutral-300">{nickname}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsLocalStudio(false)}
                          className="sc-btn flex items-center gap-1.5 px-3 py-1 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-xs font-mono text-neutral-200 cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Voltar para Criar / Entrar em Sala</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Controles Discretos de Captura & Qualidade */}
                  <BroadcastControls
                    isScreenSharing={isScreenSharing}
                    isWebcamActive={isWebcamActive}
                    localMediaSources={localMediaSources}
                    showSourceManager={showSourceManager}
                    onToggleSourceManager={() => {
                      setShowSourceManager((prev) => !prev);
                      if (!showSourceManager) setShowWindowSelector(false);
                    }}
                    showWindowSelector={showWindowSelector}
                    onToggleWindowSelector={() => {
                      setShowWindowSelector((prev) => !prev);
                      if (!showWindowSelector) setShowSourceManager(false);
                    }}
                    onStopAllSources={stopAllMediaSources}
                    selectedWindow={selectedWindow}
                    isolateAudio={isolateAudio}
                    audioSourceMode={audioSourceMode}
                    onChangeAudioSourceMode={setAudioSourceMode}
                    fps={fps}
                    resolution={resolution}
                    onToggleScreenShare={handleToggleScreenShare}
                    onToggleWebcam={toggleWebcam}
                    onToggleIsolateAudio={setIsolateAudio}
                    onChangeFps={setFps}
                    onChangeResolution={setResolution}
                    activeAudioLabel={getEffectiveAudioLabel()}
                  />

                  {/* Resumo dos Participantes Conectados na Sala */}
                  <div className="pt-2.5 border-t border-neutral-800/80 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-cyan-400" />
                        Participantes ({peers.length + 1}):
                      </span>

                      {/* Próprio Usuário */}
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-950/50 border border-cyan-800/60 text-cyan-200 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span>{nickname} (Você)</span>
                      </span>

                      {/* Amigos Conectados */}
                      {peers.map((p) => {
                        const isPeerOk = p.connectionState === 'connected';
                        return (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-950 border border-neutral-800 text-neutral-200 text-[11px]"
                            title={`Estado P2P: ${p.connectionState}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isPeerOk ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                              }`}
                            />
                            <span>{p.nickname}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Gaveta Discreta 1: Gerenciador Multi-Fonte (Webcams & Placas de Captura) */}
                <VideoSourceManager
                  isOpen={showSourceManager}
                  onClose={() => setShowSourceManager(false)}
                  videoDevices={videoDevices}
                  audioDevices={audioDevices}
                  localMediaSources={localMediaSources}
                  onRefreshDevices={refreshMediaDevices}
                  onStartSource={startMediaSource}
                  onStopSource={stopMediaSource}
                  onStopAllSources={stopAllMediaSources}
                  isStreamMirrored={isStreamMirrored}
                  onToggleStreamMirror={toggleStreamMirror}
                />

                {/* Gaveta Discreta 2: Seletor de Janela & Áudio WASAPI (Apenas quando aberto pelo usuário) */}
                {showWindowSelector && (
                  <div className="relative">
                    <WindowSelector
                      selectedWindow={selectedWindow}
                      onSelectWindow={setSelectedWindow}
                      isScreenSharing={isScreenSharing}
                      activeScreenTitle={activeScreenTitle}
                      isolateAudio={isolateAudio}
                      onToggleIsolateAudio={setIsolateAudio}
                      audioSourceMode={audioSourceMode}
                      onChangeAudioSourceMode={setAudioSourceMode}
                      audioCustomWindows={audioCustomWindows}
                      onToggleAudioCustomWindow={handleToggleAudioCustomWindow}
                      onClearAudioCustomWindows={handleClearAudioCustomWindows}
                    />
                  </div>
                )}
              </div>

              {/* Coluna Direita: Chat WebRTC P2P (5 colunas) */}
              <div className="sc-chat-panel lg:col-span-5 xl:col-span-4">
                <ChatBox
                  messages={chatMessages}
                  onSendMessage={handleSendMessage}
                  isConnected={isConnected}
                  peerCount={peers.length}
                  myNickname={nickname}
                />
              </div>
            </section>
          </main>
        )}

        {/* Janelas Flutuantes (Popups Externos Multi-Monitor) de Transmissão */}
        {isScreenSharing && activePopups['self-screen'] && (
          <FloatingStreamPopup
            id="self-screen"
            userName={nickname}
            title={selectedWindow ? selectedWindow.title : activeScreenTitle}
            type="screen"
            sourceKind="screen"
            stream={localStream}
            resolution={resolution}
            fps={fps}
            isSelf={true}
            hasIsolatedAudio={isolateAudio}
            processName={selectedWindow?.process_name}
            volume={100}
            isMuted={false}
            isMirrored={isStreamMirrored('self-screen')}
            onToggleMirror={() => toggleStreamMirror('self-screen')}
            initialX={80}
            initialY={100}
            onClose={() => closePopup('self-screen')}
            onChangeVolume={() => {}}
            onToggleMute={() => {}}
          />
        )}

        {localMediaSources.map((src, idx) => {
          const selfId = `self-${src.sourceId}`;
          if (!activePopups[selfId]) return null;
          return (
            <FloatingStreamPopup
              key={`popup-${selfId}`}
              id={selfId}
              userName={nickname}
              title={src.title}
              type="webcam"
              sourceKind={src.kind}
              stream={src.stream}
              resolution={src.resolution}
              fps={src.fps}
              isSelf={true}
              hasIsolatedAudio={false}
              volume={0}
              isMuted={true}
              isMirrored={isStreamMirrored(selfId)}
              onToggleMirror={() => toggleStreamMirror(selfId)}
              initialX={100 + idx * 45}
              initialY={120 + idx * 45}
              onClose={() => closePopup(selfId)}
              onChangeVolume={() => {}}
              onToggleMute={() => {}}
            />
          );
        })}

        {peerStreams.map((stream, idx) => {
          if (!activePopups[stream.id]) return null;
          return (
            <FloatingStreamPopup
              key={`popup-${stream.id}`}
              id={stream.id}
              userName={stream.user_name}
              title={stream.title}
              type={stream.type}
              sourceKind={stream.source_kind}
              stream={stream.stream}
              resolution={stream.resolution}
              fps={stream.fps}
              isSelf={false}
              hasIsolatedAudio={stream.isolated_audio}
              processName={stream.process_name}
              volume={stream.volume}
              isMuted={stream.is_muted}
              isMirrored={isStreamMirrored(stream.id)}
              onToggleMirror={() => toggleStreamMirror(stream.id)}
              initialX={120 + idx * 50}
              initialY={140 + idx * 50}
              onClose={() => closePopup(stream.id)}
              onChangeVolume={(vol) =>
                setStreamVolume(stream.id, vol, stream.user_name, stream.source_id || stream.type)
              }
              onToggleMute={() =>
                toggleStreamMute(stream.id, stream.user_name, stream.source_id || stream.type)
              }
            />
          );
        })}

        {/* Telinha Flutuante Rápida da Primeira Fonte Ativa */}
        {localMediaSources.length > 0 && (
          <WebcamPreviewPip
            stream={localMediaSources[0].stream}
            nickname={nickname}
            title={localMediaSources[0].title}
            sourceKind={localMediaSources[0].kind}
            isMirrored={isStreamMirrored(`self-${localMediaSources[0].sourceId}`)}
            onToggleMirror={() => toggleStreamMirror(`self-${localMediaSources[0].sourceId}`)}
            onStopWebcam={() => stopMediaSource(localMediaSources[0].sourceId)}
          />
        )}

        {/* Monitor Discreto de Desempenho e Telemetria P2P (Exibido quando na sala/estúdio) */}
        {isInRoomWorkspace && (
          <PerformanceDrawer
            logs={performanceLogs}
            telemetryHistory={telemetryHistory}
            peers={peers}
            onClearLogs={clearPerformanceLogs}
            myNickname={nickname}
            selectedWindow={selectedWindow}
            isolateAudio={isolateAudio}
            onToggleIsolateAudio={setIsolateAudio}
            isBroadcasting={isScreenSharing || localMediaSources.length > 0}
            activeAudioLabel={getEffectiveAudioLabel()}
          />
        )}

        {/* Modal do Estúdio de Temas & Customização CSS */}
        <ThemeCustomizerModal />
      </div>
    </ThemeProvider>
  );
}
