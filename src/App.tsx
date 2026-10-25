/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
import { WindowItem, RoomDetails, StreamItem, ChatAttachment, AudioSourceMode } from './types';
import { useWebRtc } from './hooks/useWebRtc';
import { WebcamPreviewPip } from './components/WebcamPreviewPip';
import { startNativeMultiProcessAudio, isTauriEnvironment } from './services/tauriBridge';
import { Radio, Users, AlertCircle, X, Tv, ChevronDown, ChevronUp, AppWindow, RefreshCw } from 'lucide-react';

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

  // Controle de Popups de Transmissão Flutuantes Individuais
  const [activePopups, setActivePopups] = useState<Record<string, boolean>>({});
  // Controle do Gerenciador de Webcams & Placas de Captura USB
  const [showSourceManager, setShowSourceManager] = useState<boolean>(false);

  // Abre ou foca uma nova janela real do Sistema Operacional (permitindo arrastar para outro monitor)
  const openPopup = (streamId: string, title = 'StreamCompanion Live') => {
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
    stopScreenShare,
    toggleWebcam,
    requestPeerStream,
    getStreamVolume,
    setStreamVolume,
    toggleStreamMute,
    isStreamMirrored,
    toggleStreamMirror,
  } = useWebRtc();

  // Seleção de janela e roteamento de áudio WASAPI por processo
  const [selectedWindow, setSelectedWindow] = useState<WindowItem | null>(null);
  const [audioSourceMode, setAudioSourceMode] = useState<AudioSourceMode>('selected_window');
  const [audioCustomWindows, setAudioCustomWindows] = useState<WindowItem[]>([]);
  const [showWindowSelector, setShowWindowSelector] = useState<boolean>(true);
  const [isolateAudio, setIsolateAudio] = useState<boolean>(true);
  const [fps, setFps] = useState<30 | 60>(60);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '1440p'>('1080p');

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
    const fallbackWindowPid = selectedWindow ? selectedWindow.pid : getDetectedWindowPid();
    if (audioSourceMode === 'other_window') {
      if (audioCustomWindows.length > 0) return audioCustomWindows.map((w) => w.pid);
      return [fallbackWindowPid];
    }
    return [fallbackWindowPid];
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
    if (selectedWindow) {
      return `${selectedWindow.process_name} (PID ${selectedWindow.pid})`;
    }
    const autoPid = getDetectedWindowPid();
    return autoPid > 0 ? `Janela Detectada (PID ${autoPid})` : 'Janela / Tela (Sem Discord)';
  };

  // Alternância dinâmica de áudio WASAPI em tempo real quando o usuário muda a fonte durante a live
  useEffect(() => {
    if (isScreenSharing && isolateAudio && isTauriEnvironment()) {
      const pids = getEffectiveAudioPids();
      startNativeMultiProcessAudio(pids).catch((err) =>
        console.warn('[App] Erro ao alternar fontes de áudio nativas:', err)
      );
    }
  }, [audioSourceMode, audioCustomWindows, selectedWindow, isScreenSharing, isolateAudio]);

  // Conecta ao WebSocket de sinalização sempre que uma sala é criada ou acessada
  useEffect(() => {
    if (roomDetails) {
      connectToRoom(roomDetails.ws_url, roomDetails.token, nickname).catch((err) => {
        console.error('[App] Erro na conexão WebRTC:', err);
      });
    }
  }, [roomDetails?.created_at]);

  // Monta a lista de streams estritamente REAIS a partir dos peers conectados (Tela + Múltiplas Webcams / Placas de Captura)
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
      const title = selectedWindow ? selectedWindow.title : 'Tela do Usuário';
      const pids = getEffectiveAudioPids();
      await startScreenShare(title, fps, resolution, isolateAudio, pids);
    }
  };

  const handleSendMessage = (text: string, attachment?: ChatAttachment) => {
    sendChatMessage(text, nickname, attachment);
  };

  const totalActiveStreams =
    peerStreams.length + (isScreenSharing ? 1 : 0) + localMediaSources.length;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header */}
      <Header
        activePid={isScreenSharing && isolateAudio ? getEffectiveAudioPid() : null}
        activeProcessName={getEffectiveAudioLabel()}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Banner de Reconexão Automática Transparente em Caso de Oscilação */}
        {isReconnecting && (
          <div className="bg-amber-950/80 border border-amber-700 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-lg text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
              <span className="text-amber-200">
                Oscilação de rede detectada. Reconectando automaticamente à sala sem fechar suas lives (tentativa {reconnectAttempt})...
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

        {/* Alerta de Erro Real (Sem Mensagens Falsas) */}
        {rtcError && (
          <div className="bg-red-950/80 border border-red-800 rounded-xl p-4 flex items-start justify-between gap-3 shadow-lg shadow-red-950/40 text-xs font-mono">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-red-200 block text-sm">Erro Detectado:</strong>
                <p className="text-red-300 mt-0.5 leading-relaxed">{rtcError}</p>
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
                  <span>Tentar Reconectar</span>
                </button>
              )}
              <button
                onClick={clearError}
                className="text-red-400 hover:text-white p-1 rounded hover:bg-red-900/40 cursor-pointer"
                title="Fechar erro"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Linha 1: Controle de Sala (Criar / Entrar sem cadastro) */}
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
        />

        {/* Barra de Transmissão (Screen Share / Multi-Webcam & Placa de Captura / Resolução / FPS / Roteamento de Áudio) */}
        <BroadcastControls
          isScreenSharing={isScreenSharing}
          isWebcamActive={isWebcamActive}
          localMediaSources={localMediaSources}
          showSourceManager={showSourceManager}
          onToggleSourceManager={() => setShowSourceManager((prev) => !prev)}
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

        {/* Painel Multi-Fonte: Escolher Webcams e Placas de Captura USB (Com suporte simultâneo e botão Inverter) */}
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

        {/* Alternador e Painel do Seletor de Janela & Áudio WASAPI */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowWindowSelector(!showWindowSelector)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-mono text-cyan-300 transition-colors cursor-pointer"
            >
              <AppWindow className="w-3.5 h-3.5 text-cyan-400" />
              <span>{showWindowSelector ? 'Ocultar Seletor de Janela & Áudio' : 'Selecionar Janela & Configurar Áudio WASAPI'}</span>
              {showWindowSelector ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <span className="text-xs font-mono text-neutral-400">
              Fonte Atual: <strong className="text-cyan-300">{getEffectiveAudioLabel()}</strong>
            </span>
          </div>

          {showWindowSelector && (
            <WindowSelector
              selectedWindow={selectedWindow}
              onSelectWindow={setSelectedWindow}
              isolateAudio={isolateAudio}
              onToggleIsolateAudio={setIsolateAudio}
              audioSourceMode={audioSourceMode}
              onChangeAudioSourceMode={setAudioSourceMode}
              audioCustomWindows={audioCustomWindows}
              onToggleAudioCustomWindow={handleToggleAudioCustomWindow}
              onClearAudioCustomWindows={handleClearAudioCustomWindows}
            />
          )}
        </div>

        {/* Linha 3: Transmissões em Tempo Real e Chat WebRTC P2P */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Seção das Lives e Transmissões (8 colunas) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono">
                  Transmissões Ativas ({totalActiveStreams})
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  Peers na Sala: <strong className="text-white">{peers.length}</strong>
                </span>
                <span>·</span>
                <span className="text-emerald-400">P2P WebRTC Direto</span>
                {isConnected && peers.length > 0 && (
                  <>
                    <span>·</span>
                    <button
                      onClick={reconnectAllPeers}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-cyan-700 text-cyan-300 rounded cursor-pointer transition-colors"
                      title="Forçar reset e ressincronização de todas as conexões P2P na sala sem fechar o app"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Resetar P2P</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Se não houver transmissões ativas */}
            {totalActiveStreams === 0 ? (
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-600">
                  <Tv className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-mono font-bold text-neutral-300">
                    Nenhuma transmissão ativa no momento
                  </h3>
                  <p className="text-xs text-neutral-500 font-mono max-w-md mx-auto mt-1">
                    Inicie sua transmissão em "Transmitir Tela" ou escolha suas Webcams e Placas de Captura em "Câmeras & Placa de Captura".
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Transmissão de Tela do Próprio Usuário (Local) */}
                {isScreenSharing && (
                  <LivePlayer
                    id="self-screen"
                    userName={nickname}
                    title={selectedWindow ? selectedWindow.title : 'Tela do Usuário'}
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
                        `${nickname} - ${selectedWindow ? selectedWindow.title : 'Tela do Usuário'}`
                      )
                    }
                    onClosePopup={() => closePopup('self-screen')}
                    onToggleWatch={() => {}}
                    onChangeVolume={() => {}}
                    onToggleMute={() => {}}
                  />
                )}

                {/* Webcams e Placas de Captura do Próprio Usuário (Suporte Multi-Fonte Simultâneo) */}
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

                {/* Transmissões Reais Recebidas dos Amigos (Tela + Webcams + Placas de Captura) */}
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
          </div>

          {/* Componente de Chat WebRTC P2P (4 colunas) */}
          <div className="lg:col-span-4">
            <ChatBox
              messages={chatMessages}
              onSendMessage={handleSendMessage}
              isConnected={isConnected}
              peerCount={peers.length}
              myNickname={nickname}
            />
          </div>
        </div>
      </main>

      {/* Janelas Flutuantes (Popups) de Transmissão com Controle de Tamanho, Qualidade e Inversão */}
      {isScreenSharing && activePopups['self-screen'] && (
        <FloatingStreamPopup
          id="self-screen"
          userName={nickname}
          title={selectedWindow ? selectedWindow.title : 'Tela do Usuário'}
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

      {/* Telinha Flutuante Rápida da Primeira Fonte Ativa (Com botão de Inverter sincronizado) */}
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

      {/* Monitor Discreto de Desempenho e Telemetria P2P com Gráfico Recharts em Tempo Real */}
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

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950/80 px-4 py-3 text-center text-xs font-mono text-neutral-500">
        StreamCompanion · P2P WebRTC DataChannel Chat & WASAPI Process Streaming · Sem Servidor Central
      </footer>
    </div>
  );
}
