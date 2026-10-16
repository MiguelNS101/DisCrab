/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { RoomControl } from './components/RoomControl';
import { BroadcastControls } from './components/BroadcastControls';
import { LivePlayer } from './components/LivePlayer';
import { FloatingStreamPopup } from './components/FloatingStreamPopup';
import { PerformanceDrawer } from './components/PerformanceDrawer';
import { ChatBox } from './components/ChatBox';
import { WindowSelector } from './components/WindowSelector';
import { WindowItem, RoomDetails, StreamItem, ChatAttachment, AudioSourceMode } from './types';
import { useWebRtc } from './hooks/useWebRtc';
import { WebcamPreviewPip } from './components/WebcamPreviewPip';
import { startNativeProcessAudio, startNativeMultiProcessAudio, isTauriEnvironment } from './services/tauriBridge';
import { Radio, Users, AlertCircle, X, Tv, ChevronDown, ChevronUp, AppWindow } from 'lucide-react';

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

  const togglePopup = (streamId: string) => {
    setActivePopups((prev) => ({
      ...prev,
      [streamId]: !prev[streamId],
    }));
  };

  const closePopup = (streamId: string) => {
    setActivePopups((prev) => ({
      ...prev,
      [streamId]: false,
    }));
  };

  // Hook WebRTC nativo P2P com DataChannel Chat integrado e telemetria
  const {
    isConnected,
    myPeerId,
    peers,
    error: rtcError,
    clearError,
    isScreenSharing,
    isWebcamActive,
    localStream,
    localWebcamStream,
    chatMessages,
    performanceLogs,
    clearPerformanceLogs,
    sendChatMessage,
    connectToRoom,
    disconnectFromRoom,
    startScreenShare,
    stopScreenShare,
    toggleWebcam,
    requestPeerStream,
    setStreamVolume,
    volumeMap,
  } = useWebRtc();

  // Seleção de janela e roteamento de áudio WASAPI por processo
  const [selectedWindow, setSelectedWindow] = useState<WindowItem | null>(null);
  const [audioSourceMode, setAudioSourceMode] = useState<AudioSourceMode>('selected_window');
  const [audioCustomWindows, setAudioCustomWindows] = useState<WindowItem[]>([]);
  const [showWindowSelector, setShowWindowSelector] = useState<boolean>(true);
  const [isolateAudio, setIsolateAudio] = useState<boolean>(true);
  const [fps, setFps] = useState<30 | 60>(60);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '1440p'>('1080p');

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
    if (audioSourceMode === 'other_window') {
      if (audioCustomWindows.length > 0) return audioCustomWindows.map((w) => w.pid);
      return selectedWindow ? [selectedWindow.pid] : [0];
    }
    return selectedWindow ? [selectedWindow.pid] : [0];
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
    return selectedWindow ? `${selectedWindow.process_name} (PID ${selectedWindow.pid})` : 'Tela Inteira (Sem Discord)';
  };

  // Alternância dinâmica de áudio WASAPI em tempo real durante a live (suporte a mixagem de múltiplos PIDs)
  useEffect(() => {
    if (isScreenSharing && isolateAudio && isTauriEnvironment()) {
      const pids = getEffectiveAudioPids();
      startNativeMultiProcessAudio(pids).catch((err) =>
        console.warn('[App] Erro ao alternar fontes de áudio nativas:', err)
      );
    }
  }, [audioSourceMode, audioCustomWindows, selectedWindow, isScreenSharing, isolateAudio]);

  // Conecta ao WebSocket de sinalização quando a sala for criada ou acessada
  useEffect(() => {
    if (roomDetails && !isConnected) {
      connectToRoom(roomDetails.ws_url, roomDetails.token, nickname).catch((err) => {
        console.error('[App] Erro na conexão WebRTC:', err);
      });
    }
  }, [roomDetails, isConnected, connectToRoom, nickname]);

  // Monta a lista de streams estritamente REAIS a partir dos peers conectados
  const peerStreams: StreamItem[] = [];
  for (const p of peers) {
    if (p.hasScreen) {
      peerStreams.push({
        id: `${p.id}-screen`,
        user_name: p.nickname,
        type: 'screen',
        title: p.screenTitle || 'Tela do Amigo',
        resolution: '1080p',
        fps: 60,
        volume: volumeMap[`${p.id}-screen`] ?? volumeMap[p.id] ?? 100,
        is_muted: (volumeMap[`${p.id}-screen`] ?? volumeMap[p.id] ?? 100) === 0,
        is_watched: !!p.screenStream,
        isolated_audio: p.hasIsolatedAudio,
        process_name: p.hasIsolatedAudio ? 'WASAPI Process' : undefined,
        stream: p.screenStream,
      });
    }
    if (p.hasWebcam) {
      peerStreams.push({
        id: `${p.id}-webcam`,
        user_name: p.nickname,
        type: 'webcam',
        title: 'Câmera do Amigo',
        resolution: '720p',
        fps: 30,
        volume: volumeMap[`${p.id}-webcam`] ?? 100,
        is_muted: (volumeMap[`${p.id}-webcam`] ?? 100) === 0,
        is_watched: !!p.webcamStream,
        isolated_audio: false,
        stream: p.webcamStream,
      });
    }
  }

  const handleToggleWatch = (streamId: string) => {
    const rawPeerId = streamId.replace('-screen', '').replace('-webcam', '');
    const peer = peers.find((p) => p.id === rawPeerId || p.id === streamId);
    if (peer) {
      const type = streamId.endsWith('-webcam') ? 'webcam' : 'screen';
      requestPeerStream(peer.id, type);
    }
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      const title = selectedWindow ? selectedWindow.title : 'Tela do Usuário';
      // Se não houver janela selecionada e o usuário estiver compartilhando tela inteira, define default para sem discord
      if (!selectedWindow && audioSourceMode === 'selected_window') {
        setAudioSourceMode('all_except_discord');
      }
      await startScreenShare(title, fps, resolution, isolateAudio);
      if (isTauriEnvironment() && isolateAudio) {
        const pids = getEffectiveAudioPids();
        await startNativeMultiProcessAudio(pids).catch(() => {});
      }
    }
  };

  const handleSendMessage = (text: string, attachment?: ChatAttachment) => {
    sendChatMessage(text, nickname, attachment);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header */}
      <Header
        activePid={isScreenSharing && isolateAudio ? getEffectiveAudioPid() : null}
        activeProcessName={getEffectiveAudioLabel()}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
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
            <button
              onClick={clearError}
              className="text-red-400 hover:text-white p-1 rounded hover:bg-red-900/40 cursor-pointer"
              title="Fechar erro"
            >
              <X className="w-4 h-4" />
            </button>
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

        {/* Barra de Transmissão (Screen Share / Webcam / Resolução / FPS / Roteamento de Áudio) */}
        <BroadcastControls
          isScreenSharing={isScreenSharing}
          isWebcamActive={isWebcamActive}
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
          {/* Seção das Lives e Transmissões (7 colunas) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono">
                  Transmissões Ativas ({peerStreams.length + (isScreenSharing ? 1 : 0) + (isWebcamActive && localWebcamStream ? 1 : 0)})
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  Peers na Sala: <strong className="text-white">{peers.length}</strong>
                </span>
                <span>·</span>
                <span className="text-emerald-400">P2P WebRTC Direto</span>
              </div>
            </div>

            {/* Se não houver transmissões ativas */}
            {!isScreenSharing && (!isWebcamActive || !localWebcamStream) && peerStreams.length === 0 ? (
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-600">
                  <Tv className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-mono font-bold text-neutral-300">
                    Nenhuma transmissão ativa no momento
                  </h3>
                  <p className="text-xs text-neutral-500 font-mono max-w-md mx-auto mt-1">
                    Inicie sua transmissão no botão "Transmitir Tela" ou "Ligar Webcam", ou aguarde os amigos conectados abrirem suas lives.
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
                    onOpenPopup={() => togglePopup('self-screen')}
                    onToggleWatch={() => {}}
                    onChangeVolume={() => {}}
                    onToggleMute={() => {}}
                  />
                )}

                {/* Webcam do Próprio Usuário (Local Preview) */}
                {isWebcamActive && localWebcamStream && (
                  <LivePlayer
                    id="self-webcam"
                    userName={nickname}
                    title="Sua Câmera (Preview)"
                    type="webcam"
                    stream={localWebcamStream}
                    resolution="720p"
                    fps={30}
                    isSelf={true}
                    hasIsolatedAudio={false}
                    volume={0}
                    isMuted={true}
                    isWatched={true}
                    isPoppedOut={!!activePopups['self-webcam']}
                    onOpenPopup={() => togglePopup('self-webcam')}
                    onToggleWatch={() => {}}
                    onChangeVolume={() => {}}
                    onToggleMute={() => {}}
                  />
                )}

                {/* Transmissões Reais Recebidas dos Amigos */}
                {peerStreams.map((stream) => (
                  <LivePlayer
                    key={stream.id}
                    id={stream.id}
                    userName={stream.user_name}
                    title={stream.title}
                    type={stream.type}
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
                    onOpenPopup={() => togglePopup(stream.id)}
                    onToggleWatch={() => handleToggleWatch(stream.id)}
                    onChangeVolume={(vol) => setStreamVolume(stream.id, vol)}
                    onToggleMute={() => setStreamVolume(stream.id, stream.is_muted ? 100 : 0)}
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

      {/* Janelas Flutuantes (Popups) de Transmissão com Controle de Tamanho e Qualidade */}
      {isScreenSharing && activePopups['self-screen'] && (
        <FloatingStreamPopup
          id="self-screen"
          userName={nickname}
          title={selectedWindow ? selectedWindow.title : 'Tela do Usuário'}
          type="screen"
          stream={localStream}
          resolution={resolution}
          fps={fps}
          isSelf={true}
          hasIsolatedAudio={isolateAudio}
          processName={selectedWindow?.process_name}
          volume={100}
          isMuted={false}
          initialX={80}
          initialY={100}
          onClose={() => closePopup('self-screen')}
          onChangeVolume={() => {}}
          onToggleMute={() => {}}
        />
      )}

      {peerStreams.map((stream, idx) => {
        if (!activePopups[stream.id]) return null;
        return (
          <FloatingStreamPopup
            key={`popup-${stream.id}`}
            id={stream.id}
            userName={stream.user_name}
            title={stream.title}
            type={stream.type}
            stream={stream.stream}
            resolution={stream.resolution}
            fps={stream.fps}
            isSelf={false}
            hasIsolatedAudio={stream.isolated_audio}
            processName={stream.process_name}
            volume={stream.volume}
            isMuted={stream.is_muted}
            initialX={120 + (idx * 50)}
            initialY={140 + (idx * 50)}
            onClose={() => closePopup(stream.id)}
            onChangeVolume={(vol) => setStreamVolume(stream.id, vol)}
            onToggleMute={() => setStreamVolume(stream.id, stream.is_muted ? 100 : 0)}
          />
        );
      })}

      {/* Telinha de Preview da Webcam para o Usuário Transmitindo */}
      {isWebcamActive && localWebcamStream && (
        <WebcamPreviewPip
          stream={localWebcamStream}
          nickname={nickname}
          onStopWebcam={toggleWebcam}
        />
      )}

      {/* Monitor Discreto de Desempenho e Telemetria P2P com Identificação de Usuário e WASAPI */}
      <PerformanceDrawer
        logs={performanceLogs}
        peers={peers}
        onClearLogs={clearPerformanceLogs}
        myNickname={nickname}
        selectedWindow={selectedWindow}
        isolateAudio={isolateAudio}
        onToggleIsolateAudio={setIsolateAudio}
        isBroadcasting={isScreenSharing}
        activeAudioLabel={getEffectiveAudioLabel()}
      />

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950/80 px-4 py-3 text-center text-xs font-mono text-neutral-500">
        StreamCompanion · P2P WebRTC DataChannel Chat & WASAPI Process Streaming · Sem Servidor Central
      </footer>
    </div>
  );
}
