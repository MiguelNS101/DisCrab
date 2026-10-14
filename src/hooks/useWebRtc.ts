import { useEffect, useRef, useState, useCallback } from 'react';
import { WebRtcEngine, RemotePeer } from '../services/webrtc/WebRtcEngine';
import { wasapiAudioBridge } from '../services/webrtc/AudioBridge';
import { isTauriEnvironment } from '../services/tauriBridge';

export interface UseWebRtcReturn {
  isConnected: boolean;
  myPeerId: string | null;
  isHost: boolean;
  peers: RemotePeer[];
  error: string | null;
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  localStream: MediaStream | null;
  connectToRoom: (wsUrl: string, token: string, nickname: string) => Promise<void>;
  disconnectFromRoom: () => void;
  startScreenShare: (
    title: string,
    fps?: 30 | 60,
    resolution?: '720p' | '1080p' | '1440p',
    useWasapi?: boolean
  ) => Promise<void>;
  stopScreenShare: () => void;
  toggleWebcam: () => Promise<void>;
  requestPeerStream: (peerId: string, type: 'screen' | 'webcam') => void;
  setStreamVolume: (streamId: string, volume: number) => void;
  volumeMap: Record<string, number>;
}

export function useWebRtc(): UseWebRtcReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [volumeMap, setVolumeMap] = useState<Record<string, number>>({});

  const engineRef = useRef<WebRtcEngine | null>(null);

  // Escuta pacotes PCM de áudio isolado enviados pelo Rust via Tauri Event
  useEffect(() => {
    if (isTauriEnvironment() && (window as any).__TAURI__?.event) {
      const unlistenPromise = (window as any).__TAURI__.event.listen(
        'isolated-audio-chunk',
        (event: any) => {
          const { data_base64, bits_per_sample, channels, sample_rate } = event.payload;
          wasapiAudioBridge.feedBase64Chunk(
            data_base64,
            bits_per_sample,
            channels,
            sample_rate
          );
        }
      );

      return () => {
        unlistenPromise.then((unlisten: any) => unlisten());
      };
    }
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
      },
      onError: (err) => {
        setError(err);
      },
      onRemoteStream: (peerId, type, stream) => {
        console.log(`[useWebRtc] Stream remoto recebido de ${peerId} (${type})`);
      },
    });

    engineRef.current = engine;
    return engine;
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
      setIsWebcamActive(false);
    } else {
      try {
        await engine.startWebcam();
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

  const setStreamVolume = useCallback((streamId: string, volume: number) => {
    setVolumeMap((prev) => ({ ...prev, [streamId]: volume }));
  }, []);

  return {
    isConnected,
    myPeerId,
    isHost,
    peers,
    error,
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
  };
}
