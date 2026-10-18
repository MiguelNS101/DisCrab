import { useEffect, useRef, useState, useCallback } from 'react';
import { WebRtcEngine, RemotePeer, PerformanceLogEntry } from '../services/webrtc/WebRtcEngine';
import { wasapiAudioBridge } from '../services/webrtc/AudioBridge';
import { isTauriEnvironment } from '../services/tauriBridge';
import { ChatMessage, ChatAttachment } from '../types';
import { listen } from '@tauri-apps/api/event';

const VOLUME_STORAGE_KEY = 'sc_stream_volumes_v1';
const PREMUTE_STORAGE_KEY = 'sc_stream_premute_volumes_v1';

function loadStoredVolumes(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function saveStoredVolumes(key: string, map: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function makeUserStreamKey(userName?: string, type: 'screen' | 'webcam' = 'screen'): string | null {
  if (!userName || !userName.trim()) return null;
  return `user:${userName.trim().toLowerCase()}:${type}`;
}

export interface UseWebRtcReturn {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  myPeerId: string | null;
  isHost: boolean;
  peers: RemotePeer[];
  error: string | null;
  clearError: () => void;
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  localStream: MediaStream | null;
  localWebcamStream: MediaStream | null;
  chatMessages: ChatMessage[];
  performanceLogs: PerformanceLogEntry[];
  clearPerformanceLogs: () => void;
  sendChatMessage: (text: string, senderName: string, attachment?: ChatAttachment) => void;
  connectToRoom: (wsUrl: string, token: string, nickname: string) => Promise<void>;
  disconnectFromRoom: () => void;
  reconnectAllPeers: () => void;
  resetPeerConnection: (peerId: string) => void;
  startScreenShare: (
    title: string,
    fps?: 30 | 60,
    resolution?: '720p' | '1080p' | '1440p',
    useWasapi?: boolean
  ) => Promise<void>;
  stopScreenShare: () => void;
  toggleWebcam: () => Promise<void>;
  requestPeerStream: (peerId: string, type: 'screen' | 'webcam') => void;
  getStreamVolume: (streamId: string, userName?: string, type?: 'screen' | 'webcam') => number;
  setStreamVolume: (
    streamId: string,
    volume: number,
    userName?: string,
    type?: 'screen' | 'webcam'
  ) => void;
  toggleStreamMute: (
    streamId: string,
    userName?: string,
    type?: 'screen' | 'webcam'
  ) => void;
  volumeMap: Record<string, number>;
}

export function useWebRtc(): UseWebRtcReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localWebcamStream, setLocalWebcamStream] = useState<MediaStream | null>(null);

  // Mapa persistente de volume por stream e por usuário (salvo em localStorage)
  const [volumeMap, setVolumeMap] = useState<Record<string, number>>(() =>
    loadStoredVolumes(VOLUME_STORAGE_KEY)
  );
  const preMuteRef = useRef<Record<string, number>>(loadStoredVolumes(PREMUTE_STORAGE_KEY));

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [performanceLogs, setPerformanceLogs] = useState<PerformanceLogEntry[]>([]);

  const engineRef = useRef<WebRtcEngine | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearPerformanceLogs = useCallback(() => {
    setPerformanceLogs([]);
  }, []);

  // Escuta pacotes PCM de áudio isolado enviados pelo Rust via Tauri Event
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    if (isTauriEnvironment()) {
      listen<any>('isolated-audio-chunk', (event) => {
        const { data_base64, bits_per_sample, channels, sample_rate } = event.payload;
        wasapiAudioBridge.feedBase64Chunk(
          data_base64,
          bits_per_sample,
          channels,
          sample_rate
        );
      })
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          } else {
            unlistenFn = unlisten;
          }
        })
        .catch((err) => {
          console.warn('[useWebRtc] Erro ao registrar listener de áudio:', err);
        });
    }

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const initEngine = useCallback(() => {
    if (engineRef.current) return engineRef.current;

    const engine = new WebRtcEngine({
      onPeersChange: (newPeers) => {
        setPeers([...newPeers]);
      },
      onSelfConnected: (peerId, hostStatus) => {
        setMyPeerId(peerId);
        setIsHost(hostStatus);
        setIsConnected(true);
        setIsReconnecting(false);
        setReconnectAttempt(0);
        setError(null);
        engine.startPerformanceMonitoring();
      },
      onDisconnected: () => {
        setIsConnected(false);
        setIsReconnecting(false);
        setReconnectAttempt(0);
        setMyPeerId(null);
        setPeers([]);
      },
      onReconnectingChange: (reconnecting, attempt) => {
        setIsReconnecting(reconnecting);
        setReconnectAttempt(attempt);
      },
      onError: (err) => {
        setError(err);
      },
      onRemoteStream: (peerId, type, _stream) => {
        console.log(`[useWebRtc] Stream remoto recebido de ${peerId} (${type})`);
      },
      onChatMessage: (msg) => {
        setChatMessages((prev) => [...prev, msg]);
      },
      onPerformanceLog: (entry) => {
        setPerformanceLogs((prev) => [entry, ...prev].slice(0, 50));
      },
    });

    engineRef.current = engine;
    return engine;
  }, []);

  const sendChatMessage = useCallback((text: string, senderName: string, attachment?: ChatAttachment) => {
    if (!engineRef.current) {
      const errMsg = 'Você não está conectado a nenhuma sala para enviar mensagens.';
      setError(errMsg);
      throw new Error(errMsg);
    }
    try {
      const sentMsg = engineRef.current.sendChatMessage(text, senderName, attachment);
      setChatMessages((prev) => [...prev, sentMsg]);
    } catch (err: any) {
      setError(err?.message || 'Falha ao transmitir mensagem via P2P DataChannel');
      throw err;
    }
  }, []);

  const connectToRoom = useCallback(
    async (wsUrl: string, token: string, nickname: string) => {
      setError(null);
      const engine = initEngine();
      try {
        await engine.connect(wsUrl, token, nickname);
      } catch (err: any) {
        setError(err.toString());
        throw err;
      }
    },
    [initEngine]
  );

  const disconnectFromRoom = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.disconnect();
      engineRef.current = null;
    }
    setIsConnected(false);
    setMyPeerId(null);
    setPeers([]);
    setIsScreenSharing(false);
    setIsWebcamActive(false);
    setLocalStream(null);
    setLocalWebcamStream(null);
    setChatMessages([]);
  }, []);

  const reconnectAllPeers = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.reconnectAllPeers();
    }
  }, []);

  const resetPeerConnection = useCallback((peerId: string) => {
    if (engineRef.current) {
      engineRef.current.resetPeerConnection(peerId, true);
    }
  }, []);

  const startScreenShare = useCallback(
    async (
      title: string,
      fps: 30 | 60 = 60,
      resolution: '720p' | '1080p' | '1440p' = '1080p',
      useWasapi = true
    ) => {
      const engine = initEngine();
      try {
        const stream = await engine.startScreenShare(title, fps, resolution, useWasapi);
        setLocalStream(stream);
        setIsScreenSharing(true);
      } catch (err: any) {
        setError(`Falha ao compartilhar tela: ${err.message}`);
      }
    },
    [initEngine]
  );

  const stopScreenShare = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stopScreenShare();
      setIsScreenSharing(false);
      setLocalStream(null);
    }
  }, []);

  const toggleWebcam = useCallback(async () => {
    const engine = initEngine();
    if (isWebcamActive) {
      engine.stopWebcam();
      setLocalWebcamStream(null);
      setIsWebcamActive(false);
    } else {
      try {
        const stream = await engine.startWebcam();
        setLocalWebcamStream(stream);
        setIsWebcamActive(true);
      } catch (err: any) {
        setError(`Falha ao ligar webcam: ${err.message}`);
      }
    }
  }, [initEngine, isWebcamActive]);

  const requestPeerStream = useCallback(
    (peerId: string, type: 'screen' | 'webcam') => {
      if (engineRef.current) {
        engineRef.current.requestPeerStream(peerId, type);
      }
    },
    []
  );

  /**
   * Recupera a altura (volume) salva de uma stream, buscando pelo ID exato ou pelo apelido do amigo
   */
  const getStreamVolume = useCallback(
    (streamId: string, userName?: string, type: 'screen' | 'webcam' = 'screen'): number => {
      if (typeof volumeMap[streamId] === 'number') {
        return volumeMap[streamId];
      }
      const userKey = makeUserStreamKey(userName, type);
      if (userKey && typeof volumeMap[userKey] === 'number') {
        return volumeMap[userKey];
      }
      const rawPeerId = streamId.replace('-screen', '').replace('-webcam', '');
      if (typeof volumeMap[rawPeerId] === 'number') {
        return volumeMap[rawPeerId];
      }
      return 100;
    },
    [volumeMap]
  );

  /**
   * Define e salva no localStorage a altura do áudio (0% a 150%) de uma transmissão assistida/escutada
   */
  const setStreamVolume = useCallback(
    (
      streamId: string,
      volume: number,
      userName?: string,
      type: 'screen' | 'webcam' = 'screen'
    ) => {
      const clamped = Math.max(0, Math.min(150, Math.round(volume)));
      const userKey = makeUserStreamKey(userName, type);

      if (clamped > 0) {
        const nextPreMute = {
          ...preMuteRef.current,
          [streamId]: clamped,
          ...(userKey ? { [userKey]: clamped } : {}),
        };
        preMuteRef.current = nextPreMute;
        saveStoredVolumes(PREMUTE_STORAGE_KEY, nextPreMute);
      }

      setVolumeMap((prev) => {
        const next = {
          ...prev,
          [streamId]: clamped,
          ...(userKey ? { [userKey]: clamped } : {}),
        };
        saveStoredVolumes(VOLUME_STORAGE_KEY, next);
        return next;
      });
    },
    []
  );

  /**
   * Alterna entre Mudo (0%) e a última altura de áudio salva para aquela stream
   */
  const toggleStreamMute = useCallback(
    (streamId: string, userName?: string, type: 'screen' | 'webcam' = 'screen') => {
      const currentVol = getStreamVolume(streamId, userName, type);
      const userKey = makeUserStreamKey(userName, type);

      if (currentVol > 0) {
        // Guarda o volume atual antes de mutar
        const nextPreMute = {
          ...preMuteRef.current,
          [streamId]: currentVol,
          ...(userKey ? { [userKey]: currentVol } : {}),
        };
        preMuteRef.current = nextPreMute;
        saveStoredVolumes(PREMUTE_STORAGE_KEY, nextPreMute);
        setStreamVolume(streamId, 0, userName, type);
      } else {
        // Restaura o volume que estava salvo antes de mutar (ou 100% por padrão)
        const restored =
          preMuteRef.current[streamId] ??
          (userKey ? preMuteRef.current[userKey] : undefined) ??
          100;
        setStreamVolume(streamId, restored > 0 ? restored : 100, userName, type);
      }
    },
    [getStreamVolume, setStreamVolume]
  );

  return {
    isConnected,
    isReconnecting,
    reconnectAttempt,
    myPeerId,
    isHost,
    peers,
    error,
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
    reconnectAllPeers,
    resetPeerConnection,
    startScreenShare,
    stopScreenShare,
    toggleWebcam,
    requestPeerStream,
    getStreamVolume,
    setStreamVolume,
    toggleStreamMute,
    volumeMap,
  };
}
