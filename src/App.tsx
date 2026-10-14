/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Header } from './components/Header';
import { RoomControl } from './components/RoomControl';
import { WindowSelector } from './components/WindowSelector';
import { WasapiVisualizer } from './components/WasapiVisualizer';
import { BroadcastControls } from './components/BroadcastControls';
import { LivePlayer } from './components/LivePlayer';
import { RustCodeViewer } from './components/RustCodeViewer';
import { WindowItem, RoomDetails, StreamItem } from './types';
import { SAMPLE_WINDOWS } from './services/tauriBridge';
import { useWebRtc } from './hooks/useWebRtc';
import { Radio, Users, Sparkles, Activity } from 'lucide-react';

export default function App() {
  const [nickname, setNickname] = useState<string>('Streamer_Pro');
  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);
  const [isHost, setIsHost] = useState<boolean>(true);

  // Hook WebRTC nativo P2P
  const {
    isConnected,
    myPeerId,
    peers,
    error: rtcError,
    isScreenSharing,
    isWebcamActive,
    localStream,
    connectToRoom,
    disconnectFromRoom,
    startScreenShare,
    stopScreenShare,
    toggleWebcam,
    requestPeerStream,
    setStreamVolume,
    volumeMap,
  } = useWebRtc();

  // Seleção de janela e áudio WASAPI por processo
  const [selectedWindow, setSelectedWindow] = useState<WindowItem | null>(SAMPLE_WINDOWS[0]);
  const [isolateAudio, setIsolateAudio] = useState<boolean>(true);
  const [fps, setFps] = useState<30 | 60>(60);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '1440p'>('1080p');

  // Modal para inspecionar os arquivos da Parte 1 e Parte 2
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState<boolean>(false);

  // Lista de transmissões simuladas/ativas para espectadores
  const [streams, setStreams] = useState<StreamItem[]>([
    {
      id: 'stream-peer-1',
      user_name: 'Alex_Valkyrie',
      type: 'screen',
      title: 'Cyberpunk 2077: Phantom Liberty',
      resolution: '1080p',
      fps: 60,
      volume: 85,
      is_muted: false,
      is_watched: true,
      isolated_audio: true,
      audio_pid: 9240,
      process_name: 'Cyberpunk2077.exe',
    },
    {
      id: 'stream-peer-2',
      user_name: 'Lucas_Sniper',
      type: 'webcam',
      title: 'Webcam C920 Pro HD',
      resolution: '720p',
      fps: 30,
      volume: 100,
      is_muted: false,
      is_watched: false,
      isolated_audio: false,
    },
  ]);

  const handleToggleWatch = (id: string) => {
    setStreams((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const nextWatched = !s.is_watched;
          if (nextWatched) {
            requestPeerStream(s.id, s.type);
          }
          return { ...s, is_watched: nextWatched };
        }
        return s;
      })
    );
  };

  const handleChangeVolume = (id: string, vol: number) => {
    setStreamVolume(id, vol);
    setStreams((prev) =>
      prev.map((s) => (s.id === id ? { ...s, volume: vol } : s))
    );
  };

  const handleToggleMute = (id: string) => {
    setStreams((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_muted: !s.is_muted } : s))
    );
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      const title = selectedWindow ? selectedWindow.title : 'Tela Inteira';
      await startScreenShare(title, fps, resolution, isolateAudio);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header */}
      <Header
        onOpenCodeViewer={() => setIsCodeViewerOpen(true)}
        activePid={isScreenSharing && isolateAudio && selectedWindow ? selectedWindow.pid : null}
        activeProcessName={selectedWindow?.process_name}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Banner Informativo Completo: Partes 1, 2 e 3 */}
        <div className="bg-gradient-to-r from-cyan-950/40 via-neutral-900 to-indigo-950/30 border border-cyan-800/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-300">
                StreamCompanion · Projeto Completo (Partes 1, 2 e 3 Entregues)
              </h2>
            </div>
            <p className="text-xs text-neutral-300 mt-0.5">
              Backend Rust WASAPI + WebRTC P2P On-Demand + Automação One-Click (<strong>CONSTRUIR_APP.bat</strong> e <strong>builder.ps1</strong> com entrega automática na pasta <code>PRONTO_PARA_USAR</code>).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCodeViewerOpen(true)}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-mono font-bold rounded cursor-pointer transition-all shrink-0 shadow-md shadow-cyan-950"
            >
              Inspecionar Scripts & Código
            </button>
          </div>
        </div>

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
            if (!val) disconnectFromRoom();
          }}
        />

        {/* Barra de Transmissão Rápida (Screen Share / Webcam / Resolução) */}
        <BroadcastControls
          isScreenSharing={isScreenSharing}
          isWebcamActive={isWebcamActive}
          selectedWindow={selectedWindow}
          isolateAudio={isolateAudio}
          fps={fps}
          resolution={resolution}
          onToggleScreenShare={handleToggleScreenShare}
          onToggleWebcam={toggleWebcam}
          onToggleIsolateAudio={setIsolateAudio}
          onChangeFps={setFps}
          onChangeResolution={setResolution}
        />

        {/* Linha 2: Seletor de Janelas & Telemetria WASAPI */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <WindowSelector
              selectedWindow={selectedWindow}
              onSelectWindow={setSelectedWindow}
              isolateAudio={isolateAudio}
              onToggleIsolateAudio={setIsolateAudio}
              fps={fps}
              onChangeFps={setFps}
              resolution={resolution}
              onChangeResolution={setResolution}
              isBroadcasting={isScreenSharing}
              onToggleBroadcast={handleToggleScreenShare}
            />
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between">
            <WasapiVisualizer
              selectedWindow={selectedWindow}
              isolateAudio={isolateAudio}
              isBroadcasting={isScreenSharing}
            />
          </div>
        </div>

        {/* Linha 3: Grid de Transmissões e Webcams On-Demand com Player de Alta Performance */}
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono">
                Transmissões & Webcams na Sala ({streams.length + (isScreenSharing ? 1 : 0)})
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                Peers Conectados: <strong className="text-white">{peers.length + 1}</strong>
              </span>
              <span>·</span>
              <span className="text-emerald-400">Modo On-Demand Ativo</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stream Local (Sua Transmissão) se estiver transmitindo */}
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
                onToggleWatch={() => {}}
                onChangeVolume={() => {}}
                onToggleMute={() => {}}
              />
            )}

            {/* Streams dos Amigos (Peers) */}
            {streams.map((stream) => (
              <LivePlayer
                key={stream.id}
                id={stream.id}
                userName={stream.user_name}
                title={stream.title}
                type={stream.type}
                resolution={stream.resolution}
                fps={stream.fps}
                isSelf={false}
                hasIsolatedAudio={stream.isolated_audio}
                processName={stream.process_name}
                volume={volumeMap[stream.id] ?? stream.volume}
                isMuted={stream.is_muted}
                isWatched={stream.is_watched}
                onToggleWatch={() => handleToggleWatch(stream.id)}
                onChangeVolume={(vol) => handleChangeVolume(stream.id, vol)}
                onToggleMute={() => handleToggleMute(stream.id)}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Modal de Código Rust & WebRTC */}
      <RustCodeViewer
        isOpen={isCodeViewerOpen}
        onClose={() => setIsCodeViewerOpen(false)}
      />

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950/80 px-4 py-3 text-center text-xs font-mono text-neutral-500">
        StreamCompanion · Arquitetura Zero-Server / Self-Hosted · Rust + Tauri v2 + WASAPI Process Loopback + WebRTC P2P
      </footer>
    </div>
  );
}
