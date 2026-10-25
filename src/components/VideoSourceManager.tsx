import React, { useState, useEffect } from 'react';
import {
  Video,
  Tv,
  RefreshCw,
  Plus,
  PowerOff,
  FlipHorizontal,
  Volume2,
  CheckCircle2,
  Camera,
  Layers,
  X,
} from 'lucide-react';
import {
  VideoInputDeviceInfo,
  AudioInputDeviceInfo,
  LocalMediaSource,
} from '../types';
import { StartMediaSourceInput } from '../hooks/useWebRtc';

interface VideoSourceManagerProps {
  isOpen: boolean;
  onClose: () => void;
  videoDevices: VideoInputDeviceInfo[];
  audioDevices: AudioInputDeviceInfo[];
  localMediaSources: LocalMediaSource[];
  onRefreshDevices: (requestPermission?: boolean) => Promise<any>;
  onStartSource: (options: StartMediaSourceInput) => Promise<LocalMediaSource | null>;
  onStopSource: (sourceId: string) => void;
  onStopAllSources: () => void;
  isStreamMirrored: (streamId: string) => boolean;
  onToggleStreamMirror: (streamId: string, forceValue?: boolean) => void;
}

export const VideoSourceManager: React.FC<VideoSourceManagerProps> = ({
  isOpen,
  onClose,
  videoDevices,
  audioDevices,
  localMediaSources,
  onRefreshDevices,
  onStartSource,
  onStopSource,
  onStopAllSources,
  isStreamMirrored,
  onToggleStreamMirror,
}) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedKind, setSelectedKind] = useState<'webcam' | 'capture_card'>('webcam');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [selectedResolution, setSelectedResolution] = useState<'720p' | '1080p' | '1440p'>('1080p');
  const [selectedFps, setSelectedFps] = useState<30 | 60>(60);
  const [sendCaptureAudio, setSendCaptureAudio] = useState<boolean>(true);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('default');
  const [invertOnStart, setInvertOnStart] = useState<boolean>(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // Localiza automaticamente a entrada de áudio correspondente à Placa de Captura (mesmo groupId USB ou palavras-chave HDMI/USB)
  const findBestCaptureAudioDeviceId = (videoDev?: VideoInputDeviceInfo): string => {
    if (videoDev?.groupId) {
      const sameGroup = audioDevices.find((a) => a.groupId && a.groupId === videoDev.groupId);
      if (sameGroup) return sameGroup.deviceId;
    }
    const matchingKeyword = audioDevices.find((a) =>
      /capture|placa|hdmi|usb|digital audio|interface|elgato|avermedia|cam link|camlink|ezcap|mirabox|game/i.test(
        a.label
      )
    );
    if (matchingKeyword) return matchingKeyword.deviceId;
    return 'default';
  };

  // Quando abrir o painel, busca os dispositivos (pedindo permissão caso ainda não haja labels)
  useEffect(() => {
    if (isOpen) {
      setIsLoadingDevices(true);
      onRefreshDevices(videoDevices.length === 0)
        .finally(() => setIsLoadingDevices(false));
    }
  }, [isOpen]);

  // Seleciona o primeiro dispositivo disponível automaticamente se nenhum estiver selecionado
  useEffect(() => {
    if (!selectedDeviceId && videoDevices.length > 0) {
      const first = videoDevices[0];
      setSelectedDeviceId(first.deviceId);
      setSelectedKind(first.kind);
      setCustomTitle(first.label);
      setInvertOnStart(false); // Não inverte por padrão
      if (first.kind === 'capture_card') {
        setSelectedResolution('1080p');
        setSelectedFps(60);
        setSendCaptureAudio(true);
        setSelectedAudioDeviceId(findBestCaptureAudioDeviceId(first));
      } else {
        setSelectedResolution('720p');
        setSelectedFps(30);
        setSendCaptureAudio(false);
        setSelectedAudioDeviceId('none');
      }
    }
  }, [videoDevices, audioDevices, selectedDeviceId]);

  const handleSelectDevice = (dev: VideoInputDeviceInfo) => {
    setSelectedDeviceId(dev.deviceId);
    setSelectedKind(dev.kind);
    setCustomTitle(dev.label);
    // Nunca inverter automaticamente fontes além de webcam (e mesmo webcam fica a critério do botão)
    setInvertOnStart(false);

    if (dev.kind === 'capture_card') {
      setSelectedResolution('1080p');
      setSelectedFps(60);
      setSendCaptureAudio(true);
      setSelectedAudioDeviceId(findBestCaptureAudioDeviceId(dev));
    } else {
      setSelectedResolution('720p');
      setSelectedFps(30);
      setSendCaptureAudio(false);
      setSelectedAudioDeviceId('none');
    }
  };

  const handleAddSource = async () => {
    setIsStarting(true);
    try {
      const chosenDevice = videoDevices.find((d) => d.deviceId === selectedDeviceId);
      const titleToUse =
        customTitle.trim() ||
        chosenDevice?.label ||
        (selectedKind === 'capture_card' ? 'Placa de Captura' : 'Webcam');

      // Para Webcam: NUNCA envia áudio da câmera. Para Placa de Captura: envia o áudio HDMI/USB se a opção estiver marcada.
      const effectiveAudioId =
        selectedKind === 'webcam'
          ? 'none'
          : sendCaptureAudio
          ? selectedAudioDeviceId === 'none'
            ? 'default'
            : selectedAudioDeviceId
          : 'none';

      await onStartSource({
        deviceId: selectedDeviceId || undefined,
        audioDeviceId: effectiveAudioId,
        title: titleToUse,
        kind: selectedKind,
        resolution: selectedResolution,
        fps: selectedFps,
        mirrored: invertOnStart,
      });
    } finally {
      setIsStarting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="bg-neutral-900/95 border border-indigo-500/40 rounded-xl p-4 sm:p-5 shadow-2xl space-y-4 font-mono animate-in fade-in duration-150">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-indigo-300">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Gerenciador de Webcams & Placas de Captura (Multi-Fonte)
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-700 text-emerald-300">
                Simultâneo c/ Tela
              </span>
            </h3>
            <p className="text-[11px] text-neutral-400">
              Escolha qual USB ligar (Webcam, Placa de Captura HDMI, etc.) e transmita várias fontes ao mesmo tempo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsLoadingDevices(true);
              onRefreshDevices(true).finally(() => setIsLoadingDevices(false));
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-cyan-300 text-xs cursor-pointer transition-colors"
            title="Escanear todas as portas USB para listar Webcams e Placas de Captura"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevices ? 'animate-spin' : ''}`} />
            <span>Detectar USBs</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white cursor-pointer"
            title="Fechar painel de fontes"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lista de Fontes já Ativas */}
      {localMediaSources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Fontes Transmitindo Agora ({localMediaSources.length})
            </span>
            {localMediaSources.length > 1 && (
              <button
                type="button"
                onClick={onStopAllSources}
                className="text-[11px] text-red-400 hover:text-red-300 underline cursor-pointer"
              >
                Desligar Todas as Fontes
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {localMediaSources.map((src) => {
              const selfStreamId = `self-${src.sourceId}`;
              const mirrored = isStreamMirrored(selfStreamId);
              const hasAudioTrack = src.stream.getAudioTracks().length > 0;
              return (
                <div
                  key={src.sourceId}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-neutral-950 border border-emerald-800/60"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {src.kind === 'capture_card' ? (
                      <Tv className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Video className="w-4 h-4 text-indigo-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span className="truncate">{src.title}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-900 border border-neutral-700 text-neutral-300 shrink-0">
                          {src.resolution} · {src.fps}fps
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-400 truncate flex items-center gap-1.5">
                        <span>{src.kind === 'capture_card' ? 'Placa de Captura' : 'Webcam'}</span>
                        <span>·</span>
                        <span className={hasAudioTrack ? 'text-emerald-400 font-semibold' : 'text-neutral-500'}>
                          {hasAudioTrack ? 'Áudio da Placa Ativo' : 'Apenas Vídeo (Sem Áudio)'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleStreamMirror(selfStreamId)}
                      className={`px-2 py-1 rounded text-[11px] border flex items-center gap-1 cursor-pointer transition-colors ${
                        mirrored
                          ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
                      }`}
                      title="Inverter / Espelhar horizontalmente esta fonte"
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                      <span>{mirrored ? 'Invertido' : 'Inverter'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onStopSource(src.sourceId)}
                      className="px-2.5 py-1 rounded text-[11px] bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-200 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Parar esta fonte"
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      <span>Parar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Seleção de Dispositivo USB e Configuração da Nova Fonte */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
        {/* Coluna 1: Lista de Dispositivos de Vídeo Detectados (5 cols) */}
        <div className="lg:col-span-5 space-y-2">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-300">
            1. Escolha a Câmera ou Placa de Captura USB ({videoDevices.length})
          </label>

          {videoDevices.length === 0 ? (
            <div className="p-4 rounded-lg bg-neutral-950 border border-neutral-800 text-center space-y-2">
              <Camera className="w-6 h-6 text-neutral-500 mx-auto" />
              <p className="text-xs text-neutral-400">
                Nenhum dispositivo listado ainda ou permissão pendente.
              </p>
              <button
                type="button"
                onClick={() => onRefreshDevices(true)}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Liberar e Listar Dispositivos USB
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {videoDevices.map((dev, idx) => {
                const isSelected = dev.deviceId === selectedDeviceId;
                const activeInstance = localMediaSources.find((s) => s.deviceId === dev.deviceId);

                return (
                  <div
                    key={dev.deviceId || idx}
                    onClick={() => handleSelectDevice(dev)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-sm'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {dev.kind === 'capture_card' ? (
                        <Tv className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Video className="w-4 h-4 text-indigo-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{dev.label}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                          <span
                            className={
                              dev.kind === 'capture_card' ? 'text-emerald-400' : 'text-indigo-400'
                            }
                          >
                            {dev.kind === 'capture_card' ? 'Placa de Captura' : 'Webcam USB'}
                          </span>
                          {activeInstance && (
                            <span className="text-emerald-300 bg-emerald-950/90 border border-emerald-700 px-1.5 rounded">
                              Em uso
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna 2: Parâmetros da Fonte (7 cols) */}
        <div className="lg:col-span-7 bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tipo da Fonte */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">
                Tipo da Fonte
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKind('webcam');
                    setSendCaptureAudio(false);
                    setSelectedAudioDeviceId('none');
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    selectedKind === 'webcam'
                      ? 'bg-indigo-600 border-indigo-400 text-white font-bold'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Webcam</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedKind('capture_card');
                    setInvertOnStart(false); // Placa de captura não inverte por padrão
                    setSendCaptureAudio(true);
                    const chosenDev = videoDevices.find((d) => d.deviceId === selectedDeviceId);
                    setSelectedAudioDeviceId(findBestCaptureAudioDeviceId(chosenDev));
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    selectedKind === 'capture_card'
                      ? 'bg-emerald-600 border-emerald-400 text-black font-bold'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  <span>Placa Captura</span>
                </button>
              </div>
            </div>

            {/* Nome / Título de Exibição */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">
                Título na Live
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={selectedKind === 'capture_card' ? 'Ex: PS5 / Switch (Captura)' : 'Ex: Minha Webcam'}
                className="w-full bg-neutral-900 border border-neutral-800 focus:border-cyan-500 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Resolução da Fonte */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">
                Resolução
              </label>
              <div className="grid grid-cols-3 gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                {(['720p', '1080p', '1440p'] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setSelectedResolution(res)}
                    className={`py-1 rounded text-[11px] cursor-pointer transition-colors ${
                      selectedResolution === res
                        ? 'bg-cyan-500 text-black font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS da Fonte */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">
                Taxa de Quadros
              </label>
              <div className="grid grid-cols-2 gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                {([30, 60] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSelectedFps(f)}
                    className={`py-1 rounded text-[11px] cursor-pointer transition-colors ${
                      selectedFps === f
                        ? 'bg-cyan-500 text-black font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {f} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Opção de Inverter (Espelhar) */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">
                Orientação da Imagem
              </label>
              <button
                type="button"
                onClick={() => setInvertOnStart(!invertOnStart)}
                className={`w-full py-1.5 px-2.5 rounded-lg border text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  invertOnStart
                    ? 'bg-indigo-950 border-indigo-500 text-indigo-200 font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
                }`}
                title="Por padrão não invertemos a imagem. Ative se quiser espelhar horizontalmente."
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                <span>{invertOnStart ? 'Invertida (Espelho)' : 'Normal (Sem Inverter)'}</span>
              </button>
            </div>
          </div>

          {/* Configuração de Áudio: Apenas para Placa de Captura (Webcam fica sempre Sem Áudio) */}
          {selectedKind === 'capture_card' ? (
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/50 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-[11px] font-bold uppercase text-emerald-300 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  Enviar Áudio da Placa de Captura com o Vídeo
                </label>

                <button
                  type="button"
                  onClick={() => setSendCaptureAudio(!sendCaptureAudio)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer transition-all ${
                    sendCaptureAudio
                      ? 'bg-emerald-500 border-emerald-400 text-black'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white'
                  }`}
                >
                  {sendCaptureAudio ? '✓ Enviar Áudio Ativado' : 'Sem Áudio'}
                </button>
              </div>

              {sendCaptureAudio && (
                <div className="space-y-1">
                  <span className="block text-[10px] text-neutral-400">
                    Dispositivo de entrada de áudio da Placa de Captura (USB/HDMI Estéreo):
                  </span>
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                    className="w-full bg-neutral-900 border border-emerald-800/80 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none cursor-pointer"
                  >
                    <option value="default">
                      Automático (Detectar Interface de Áudio da Placa de Captura)
                    </option>
                    {audioDevices.map((aud) => (
                      <option key={aud.deviceId} value={aud.deviceId}>
                        {aud.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg bg-neutral-900/70 border border-neutral-800 flex items-center justify-between text-[11px] text-neutral-400">
              <span>Modo Webcam: transmite apenas o vídeo (sem capturar áudio da câmera).</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-indigo-300 shrink-0">
                Apenas Vídeo
              </span>
            </div>
          )}

          {/* Botão para Adicionar / Transmitir Fonte */}
          <div className="pt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isStarting}
              onClick={handleAddSource}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-black font-bold text-xs uppercase tracking-wider cursor-pointer shadow-lg transition-all"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isStarting
                  ? 'Iniciando Fonte...'
                  : localMediaSources.some((s) => s.deviceId === selectedDeviceId)
                  ? 'Atualizar / Reiniciar Esta Fonte'
                  : 'Ligar e Transmitir Esta Fonte'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
