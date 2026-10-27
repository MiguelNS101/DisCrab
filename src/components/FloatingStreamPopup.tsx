import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  BookmarkCheck,
  Pin,
  RefreshCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriEnvironment } from '../services/tauriBridge';
import { PopupSizePreset, StreamQualityPreset } from '../types';

const POPUP_CHANNEL_NAME = 'sc_popup_ipc_v2';
const externalBrowserWindowsMap = new Map<string, Window>();

function encodeBase64UrlSafe(str: string): string {
  try {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = '';
    utf8Bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return encodeURIComponent(str);
  }
}

function decodeBase64UrlSafe(encoded: string): string {
  try {
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
}

function sanitizeWindowName(id: string): string {
  return 'sc_ext_win_' + id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function applyStereoOpusToSdp(sdp: string): string {
  if (!sdp) return sdp;
  const lines = sdp.split(/\r?\n/);
  let opusPayloadType: string | null = null;

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  if (!opusPayloadType) return sdp;

  const extraParams =
    'stereo=1;sprop-stereo=1;maxaveragebitrate=160000;cbr=1;useinbandfec=1;usedtx=0';
  let foundFmtp = false;

  const updated = lines.map((line) => {
    if (line.startsWith(`a=fmtp:${opusPayloadType} `)) {
      foundFmtp = true;
      return `${line};${extraParams}`;
    }
    return line;
  });

  if (!foundFmtp) {
    const rtpmapIdx = updated.findIndex((l) =>
      l.startsWith(`a=rtpmap:${opusPayloadType} `)
    );
    if (rtpmapIdx !== -1) {
      updated.splice(rtpmapIdx + 1, 0, `a=fmtp:${opusPayloadType} ${extraParams}`);
    }
  }

  return updated.join('\r\n');
}

export interface PopupWindowUrlParams {
  streamId: string;
  userName: string;
  title: string;
}

/**
 * Verifica se a janela atual foi iniciada como uma Nova Janela Nativa de Popup (?popup_sid=...)
 */
export function getPopupWindowParamsFromUrl(): PopupWindowUrlParams | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const sidRaw = params.get('popup_sid');
  if (!sidRaw) return null;

  const usrRaw = params.get('popup_usr') || '';
  const ttlRaw = params.get('popup_ttl') || '';

  return {
    streamId: decodeBase64UrlSafe(sidRaw),
    userName: usrRaw ? decodeBase64UrlSafe(usrRaw) : 'Participante',
    title: ttlRaw ? decodeBase64UrlSafe(ttlRaw) : 'Transmissão Destacada',
  };
}

interface PopupIpcEnvelope {
  msgId: string;
  streamId: string;
  type:
    | 'POPUP_READY'
    | 'POPUP_HOST_PING'
    | 'POPUP_OFFER'
    | 'POPUP_ANSWER'
    | 'POPUP_ICE_FROM_HOST'
    | 'POPUP_ICE_FROM_VIEW'
    | 'POPUP_META'
    | 'POPUP_CONTROL'
    | 'POPUP_HOST_CLOSE';
  payload?: any;
}

function sendPopupIpcMessage(msg: Omit<PopupIpcEnvelope, 'msgId'>) {
  const fullMsg: PopupIpcEnvelope = {
    ...msg,
    msgId: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  };

  // 1. BroadcastChannel nativo (instantâneo quando na mesma origem)
  try {
    const bc = new BroadcastChannel(POPUP_CHANNEL_NAME);
    bc.postMessage(fullMsg);
    bc.close();
  } catch {}

  // 2. Relay IPC via Tauri Backend (garante entrega entre quaisquer WebviewWindows nativas)
  if (isTauriEnvironment()) {
    invoke('relay_popup_signal', { payload: fullMsg }).catch(() => {});
  }
}

function subscribePopupIpcMessages(
  targetStreamId: string,
  onMessage: (msg: PopupIpcEnvelope) => void
): () => void {
  const seenIds = new Set<string>();

  const handleIncoming = (raw: any) => {
    if (!raw || typeof raw !== 'object') return;
    if (raw.streamId !== targetStreamId) return;
    if (raw.msgId && seenIds.has(raw.msgId)) return;
    if (raw.msgId) {
      seenIds.add(raw.msgId);
      if (seenIds.size > 400) {
        const first = seenIds.values().next().value;
        if (first) seenIds.delete(first);
      }
    }
    onMessage(raw as PopupIpcEnvelope);
  };

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(POPUP_CHANNEL_NAME);
    bc.onmessage = (ev) => handleIncoming(ev.data);
  } catch {}

  let unlistenTauri: (() => void) | null = null;
  let isDisposed = false;

  if (isTauriEnvironment()) {
    listen<PopupIpcEnvelope>('sc-popup-ipc', (event) => {
      if (!isDisposed) {
        handleIncoming(event.payload);
      }
    })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
        } else {
          unlistenTauri = unlisten;
        }
      })
      .catch(() => {});
  }

  return () => {
    isDisposed = true;
    if (bc) {
      try {
        bc.close();
      } catch {}
    }
    if (unlistenTauri) {
      unlistenTauri();
    }
  };
}

/**
 * Abre IMEDIATAMENTE uma Nova Janela Real do Sistema Operacional (sem janela flutuante interna intermediária).
 * - No Desktop Tauri (.exe): cria uma `WebviewWindow` nativa do Windows via `open_stream_popup_window`.
 * - No Navegador Web: abre uma janela popup real via `window.open`.
 */
export function openExternalStreamWindowSync(
  streamId: string,
  title = 'Transmissão Destacada',
  userName = 'DisCrab'
): void {
  if (isTauriEnvironment()) {
    invoke('open_stream_popup_window', {
      streamId,
      title,
      userName,
    }).catch((err) => {
      console.error('[Popup] Erro ao abrir janela nativa do SO:', err);
    });
    return;
  }

  try {
    const existing = externalBrowserWindowsMap.get(streamId);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }

    const sid = encodeBase64UrlSafe(streamId);
    const usr = encodeBase64UrlSafe(userName);
    const ttl = encodeBase64UrlSafe(title);
    const popupUrl = `${window.location.origin}${window.location.pathname}?popup_sid=${sid}&popup_usr=${usr}&popup_ttl=${ttl}`;

    const width = 960;
    const height = 580;
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

    const extWin = window.open(popupUrl, sanitizeWindowName(streamId), features);
    if (extWin) {
      externalBrowserWindowsMap.set(streamId, extWin);
      extWin.focus();
    }
  } catch (err) {
    console.warn('[Popup] Falha ao abrir janela popup no navegador:', err);
  }
}

export function closeExternalStreamWindowSync(streamId: string): void {
  sendPopupIpcMessage({
    streamId,
    type: 'POPUP_HOST_CLOSE',
  });

  if (isTauriEnvironment()) {
    invoke('close_stream_popup_window', { streamId }).catch(() => {});
  }

  const existing = externalBrowserWindowsMap.get(streamId);
  if (existing && !existing.closed) {
    try {
      existing.close();
    } catch {}
  }
  externalBrowserWindowsMap.delete(streamId);
}

interface PopupStreamMetadata {
  userName: string;
  title: string;
  type: 'screen' | 'webcam';
  sourceKind?: 'screen' | 'webcam' | 'capture_card';
  resolution: string;
  fps: number;
  isSelf?: boolean;
  hasIsolatedAudio?: boolean;
  processName?: string;
  volume: number;
  isMuted: boolean;
  isMirrored: boolean;
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

/**
 * Ponte Invisível na Janela Principal (Host Bridge):
 * Não renderiza nenhuma janela interna falsa no meio da tela!
 * Transmite o MediaStream via WebRTC Loopback local (127.0.0.1) direto para a Nova Janela Nativa do Sistema Operacional.
 */
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
  onClose,
  onChangeVolume,
  onToggleMute,
  onToggleMirror,
}) => {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null | undefined>(stream);
  streamRef.current = stream;

  const metaRef = useRef<PopupStreamMetadata>({
    userName,
    title,
    type,
    sourceKind,
    resolution,
    fps,
    isSelf,
    hasIsolatedAudio,
    processName,
    volume,
    isMuted,
    isMirrored,
  });

  metaRef.current = {
    userName,
    title,
    type,
    sourceKind,
    resolution,
    fps,
    isSelf,
    hasIsolatedAudio,
    processName,
    volume,
    isMuted,
    isMirrored,
  };

  const callbacksRef = useRef({
    onClose,
    onChangeVolume,
    onToggleMute,
    onToggleMirror,
  });
  callbacksRef.current = {
    onClose,
    onChangeVolume,
    onToggleMute,
    onToggleMirror,
  };

  const startLoopbackOffer = useCallback(async () => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      sendPopupIpcMessage({
        streamId: id,
        type: 'POPUP_META',
        payload: metaRef.current,
      });
      return;
    }

    try {
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }

      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendPopupIpcMessage({
            streamId: id,
            type: 'POPUP_ICE_FROM_HOST',
            payload: ev.candidate.toJSON(),
          });
        }
      };

      currentStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentStream);
      });

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      const stereoSdp = applyStereoOpusToSdp(offer.sdp || '');
      await pc.setLocalDescription({
        type: offer.type,
        sdp: stereoSdp,
      });

      sendPopupIpcMessage({
        streamId: id,
        type: 'POPUP_OFFER',
        payload: {
          sdp: {
            type: offer.type,
            sdp: stereoSdp,
          },
          meta: metaRef.current,
        },
      });
    } catch (err) {
      console.warn('[PopupHostBridge] Erro ao criar oferta loopback para janela externa:', err);
    }
  }, [id]);

  // Escuta mensagens da Nova Janela Nativa e evento de fechamento do SO
  useEffect(() => {
    const unsubscribeIpc = subscribePopupIpcMessages(id, async (msg) => {
      if (msg.type === 'POPUP_READY') {
        await startLoopbackOffer();
      } else if (msg.type === 'POPUP_ANSWER' && msg.payload?.sdp) {
        const pc = pcRef.current;
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
          } catch (err) {
            console.warn('[PopupHostBridge] Erro ao aplicar POPUP_ANSWER:', err);
          }
        }
      } else if (msg.type === 'POPUP_ICE_FROM_VIEW' && msg.payload) {
        const pc = pcRef.current;
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
          } catch {}
        }
      } else if (msg.type === 'POPUP_CONTROL' && msg.payload) {
        const { action, value } = msg.payload;
        if (action === 'volume' && typeof value === 'number') {
          callbacksRef.current.onChangeVolume(value);
        } else if (action === 'mute') {
          callbacksRef.current.onToggleMute();
        } else if (action === 'mirror') {
          callbacksRef.current.onToggleMirror?.();
        } else if (action === 'close') {
          callbacksRef.current.onClose();
        }
      }
    });

    let unlistenWindowClosed: (() => void) | null = null;
    let disposed = false;

    if (isTauriEnvironment()) {
      listen<string>('popup-window-closed', (event) => {
        if (!disposed && event.payload === id) {
          callbacksRef.current.onClose();
        }
      })
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenWindowClosed = unlisten;
        })
        .catch(() => {});
    }

    // Monitora fechamento caso tenha sido aberto em navegador comum
    const browserCheckInterval = !isTauriEnvironment()
      ? setInterval(() => {
          const w = externalBrowserWindowsMap.get(id);
          if (w && w.closed) {
            externalBrowserWindowsMap.delete(id);
            callbacksRef.current.onClose();
          }
        }, 500)
      : null;

    // Avisa a janela externa que o host está pronto
    sendPopupIpcMessage({
      streamId: id,
      type: 'POPUP_HOST_PING',
      payload: metaRef.current,
    });

    return () => {
      disposed = true;
      unsubscribeIpc();
      if (unlistenWindowClosed) unlistenWindowClosed();
      if (browserCheckInterval) clearInterval(browserCheckInterval);
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }
    };
  }, [id, startLoopbackOffer]);

  // Se as faixas do MediaStream mudarem (ex: áudio WASAPI entrou ou trocou de janela), renegocia automaticamente
  const streamTracksKey = stream
    ? stream
        .getTracks()
        .map((t) => `${t.kind}:${t.id}:${t.readyState}`)
        .join('|')
    : '';

  useEffect(() => {
    if (stream) {
      startLoopbackOffer();
    }
  }, [stream, streamTracksKey, startLoopbackOffer]);

  // Sincroniza metadados (volume, mute, espelhamento, título) em tempo real com a janela externa
  useEffect(() => {
    sendPopupIpcMessage({
      streamId: id,
      type: 'POPUP_META',
      payload: {
        userName,
        title,
        type,
        sourceKind,
        resolution,
        fps,
        isSelf,
        hasIsolatedAudio,
        processName,
        volume,
        isMuted,
        isMirrored,
      } satisfies PopupStreamMetadata,
    });
  }, [
    id,
    userName,
    title,
    type,
    sourceKind,
    resolution,
    fps,
    isSelf,
    hasIsolatedAudio,
    processName,
    volume,
    isMuted,
    isMirrored,
  ]);

  // Não renderiza absolutamente nada dentro da janela principal!
  return null;
};

/**
 * Componente Principal Renderizado Dentro da Nova Janela Nativa do Sistema Operacional (?popup_sid=...)
 */
export const StandalonePopupWindowView: React.FC<{
  params: PopupWindowUrlParams;
}> = ({ params }) => {
  const { streamId, userName: initialUser, title: initialTitle } = params;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [streamRev, setStreamRev] = useState(0);

  const [meta, setMeta] = useState<PopupStreamMetadata>({
    userName: initialUser,
    title: initialTitle,
    type: 'screen',
    sourceKind: 'screen',
    resolution: '1080p',
    fps: 60,
    isSelf: false,
    hasIsolatedAudio: false,
    volume: 100,
    isMuted: false,
    isMirrored: false,
  });

  const [sizePreset, setSizePreset] = useState<PopupSizePreset>('large');
  const [qualityPreset, setQualityPreset] = useState<StreamQualityPreset>('auto');
  const [showSettings, setShowSettings] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedVolumeFlash, setSavedVolumeFlash] = useState(false);
  const flashTimerRef = useRef<any>(null);

  // Web Audio API para Boost de Volume até 200%
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const boostSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    document.title = `DisCrab · ${meta.userName} — ${meta.title}`;
  }, [meta.userName, meta.title]);

  // Configura receptor WebRTC Loopback e comunicação IPC com a janela principal
  useEffect(() => {
    let hasReceivedStream = false;

    const handleOffer = async (sdp: RTCSessionDescriptionInit, incomingMeta?: PopupStreamMetadata) => {
      if (incomingMeta) {
        setMeta(incomingMeta);
      }

      try {
        if (pcRef.current) {
          try {
            pcRef.current.close();
          } catch {}
        }

        const pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;

        const inboundStream = new MediaStream();

        pc.ontrack = (ev) => {
          hasReceivedStream = true;
          if (ev.streams && ev.streams[0]) {
            ev.streams[0].getTracks().forEach((t) => {
              if (!inboundStream.getTracks().some((existing) => existing.id === t.id)) {
                inboundStream.addTrack(t);
              }
            });
          } else if (ev.track) {
            inboundStream.addTrack(ev.track);
          }
          setRemoteStream(inboundStream);
          setStreamRev((prev) => prev + 1);
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            sendPopupIpcMessage({
              streamId,
              type: 'POPUP_ICE_FROM_VIEW',
              payload: ev.candidate.toJSON(),
            });
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        const stereoSdp = applyStereoOpusToSdp(answer.sdp || '');
        await pc.setLocalDescription({
          type: answer.type,
          sdp: stereoSdp,
        });

        sendPopupIpcMessage({
          streamId,
          type: 'POPUP_ANSWER',
          payload: {
            sdp: {
              type: answer.type,
              sdp: stereoSdp,
            },
          },
        });
      } catch (err) {
        console.warn('[StandalonePopupWindow] Erro ao processar POPUP_OFFER:', err);
      }
    };

    const unsubscribe = subscribePopupIpcMessages(streamId, async (msg) => {
      if (msg.type === 'POPUP_OFFER' && msg.payload?.sdp) {
        await handleOffer(msg.payload.sdp, msg.payload.meta);
      } else if (msg.type === 'POPUP_HOST_PING') {
        if (msg.payload) setMeta(msg.payload);
        sendPopupIpcMessage({ streamId, type: 'POPUP_READY' });
      } else if (msg.type === 'POPUP_ICE_FROM_HOST' && msg.payload) {
        if (pcRef.current) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.payload));
          } catch {}
        }
      } else if (msg.type === 'POPUP_META' && msg.payload) {
        setMeta(msg.payload);
      } else if (msg.type === 'POPUP_HOST_CLOSE') {
        if (isTauriEnvironment()) {
          invoke('close_stream_popup_window', { streamId }).catch(() => {});
        } else {
          window.close();
        }
      }
    });

    // Envia POPUP_READY imediatamente e repete até o stream conectar
    sendPopupIpcMessage({ streamId, type: 'POPUP_READY' });
    const retryInterval = setInterval(() => {
      if (!hasReceivedStream) {
        sendPopupIpcMessage({ streamId, type: 'POPUP_READY' });
      }
    }, 550);

    const handleBeforeUnload = () => {
      sendPopupIpcMessage({
        streamId,
        type: 'POPUP_CONTROL',
        payload: { action: 'close' },
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(retryInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubscribe();
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
      }
    };
  }, [streamId]);

  // Vincula o stream recebido ao elemento <video>
  useEffect(() => {
    const el = videoRef.current;
    if (el && remoteStream) {
      remoteStream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      el.srcObject = remoteStream;
      el.muted = meta.isSelf ? true : meta.isMuted;
      el.volume = meta.isSelf
        ? 0
        : Math.max(0, Math.min(1.0, meta.isMuted ? 0 : meta.volume / 100));
      el.play().catch(() => {});
    }
  }, [remoteStream, streamRev, meta.isSelf]);

  // Controle de Volume de 0% até 200% (com amplificador WebAudio acima de 100%)
  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = meta.isSelf ? true : meta.isMuted;
      el.volume = meta.isSelf
        ? 0
        : Math.max(0, Math.min(1.0, meta.isMuted ? 0 : meta.volume / 100));
    }

    const hasAudioTracks = !!remoteStream && remoteStream.getAudioTracks().length > 0;
    const useBoost = !meta.isSelf && !meta.isMuted && meta.volume > 100 && hasAudioTracks;

    if (useBoost && remoteStream) {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new AudioCtx({ latencyHint: 'interactive' });
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (boostStreamRef.current !== remoteStream) {
          try {
            boostSourceRef.current?.disconnect();
            boostGainRef.current?.disconnect();
          } catch {}
          boostSourceRef.current = ctx.createMediaStreamSource(remoteStream);
          boostGainRef.current = ctx.createGain();
          boostSourceRef.current.connect(boostGainRef.current);
          boostGainRef.current.connect(ctx.destination);
          boostStreamRef.current = remoteStream;
        }
        if (boostGainRef.current) {
          boostGainRef.current.gain.value = (meta.volume - 100) / 100;
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
  }, [meta.volume, meta.isMuted, meta.isSelf, remoteStream, streamRev]);

  const handleVolumeChange = (newVol: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(newVol)));
    setMeta((prev) => ({ ...prev, volume: clamped, isMuted: clamped === 0 }));
    sendPopupIpcMessage({
      streamId,
      type: 'POPUP_CONTROL',
      payload: { action: 'volume', value: clamped },
    });
    setSavedVolumeFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSavedVolumeFlash(false), 1400);
  };

  const handleToggleMute = () => {
    setMeta((prev) => ({ ...prev, isMuted: !prev.isMuted }));
    sendPopupIpcMessage({
      streamId,
      type: 'POPUP_CONTROL',
      payload: { action: 'mute' },
    });
  };

  const handleToggleMirror = () => {
    setMeta((prev) => ({ ...prev, isMirrored: !prev.isMirrored }));
    sendPopupIpcMessage({
      streamId,
      type: 'POPUP_CONTROL',
      payload: { action: 'mirror' },
    });
  };

  const handleToggleAlwaysOnTop = () => {
    const next = !isAlwaysOnTop;
    setIsAlwaysOnTop(next);
    if (isTauriEnvironment()) {
      invoke('configure_stream_popup_window', {
        streamId,
        width: null,
        height: null,
        alwaysOnTop: next,
        fullscreen: null,
      }).catch(() => {});
    }
  };

  const handleSelectSizePreset = (preset: PopupSizePreset) => {
    setSizePreset(preset);
    let w = 960;
    let h = 580;
    if (preset === 'compact') {
      w = 560;
      h = 360;
    } else if (preset === 'medium') {
      w = 854;
      h = 520;
    } else if (preset === 'large') {
      w = 1280;
      h = 760;
    }

    if (isTauriEnvironment()) {
      invoke('configure_stream_popup_window', {
        streamId,
        width: w,
        height: h,
        alwaysOnTop: null,
        fullscreen: null,
      }).catch(() => {});
    } else {
      try {
        window.resizeTo(w, h);
      } catch {}
    }
  };

  const handleTogglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
      } else if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
        setIsPiPActive(true);
      }
    } catch {}
  };

  const handleToggleFullscreen = () => {
    const nextFs = !isFullscreen;
    setIsFullscreen(nextFs);

    if (isTauriEnvironment()) {
      invoke('configure_stream_popup_window', {
        streamId,
        width: null,
        height: null,
        alwaysOnTop: null,
        fullscreen: nextFs,
      }).catch(() => {});
      return;
    }

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleReturnToGrid = () => {
    sendPopupIpcMessage({
      streamId,
      type: 'POPUP_CONTROL',
      payload: { action: 'close' },
    });
    if (isTauriEnvironment()) {
      invoke('close_stream_popup_window', { streamId }).catch(() => {});
    } else {
      window.close();
    }
  };

  const effectiveKind = meta.sourceKind || (meta.type === 'screen' ? 'screen' : 'webcam');

  const getQualityStyles = () => {
    switch (qualityPreset) {
      case '360p30':
        return 'filter blur-[0.2px] contrast-95';
      case '480p30':
        return 'contrast-100';
      default:
        return 'image-rendering-auto';
    }
  };

  return (
    <div className="w-screen h-screen bg-neutral-950 text-neutral-100 flex flex-col font-mono select-none overflow-hidden">
      {/* Barra Superior de Controles da Janela Nativa */}
      <div className="px-3.5 py-2 bg-gradient-to-r from-neutral-900 via-neutral-900 to-cyan-950/50 border-b border-neutral-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-xs font-bold text-neutral-100 truncate">
            {meta.userName} {meta.isSelf && '(Você)'}
          </span>
          <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-1.5 py-0.5 rounded truncate">
            {meta.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Fixar Sempre no Topo (Always on Top) */}
          {isTauriEnvironment() && (
            <button
              onClick={handleToggleAlwaysOnTop}
              className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer border ${
                isAlwaysOnTop
                  ? 'text-amber-200 bg-amber-950/90 border-amber-600'
                  : 'text-neutral-300 border-neutral-800 hover:text-white hover:bg-neutral-800'
              }`}
              title="Manter esta janela sempre no topo sobre jogos e outros aplicativos"
            >
              <Pin className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {isAlwaysOnTop ? 'Fixada no Topo' : 'Fixar no Topo'}
              </span>
            </button>
          )}

          {/* Inverter / Espelhar */}
          <button
            onClick={handleToggleMirror}
            className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer border ${
              meta.isMirrored
                ? 'text-indigo-200 bg-indigo-950/90 border-indigo-600'
                : 'text-neutral-300 border-neutral-800 hover:text-white hover:bg-neutral-800'
            }`}
            title="Inverter / Espelhar horizontalmente"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {meta.isMirrored ? 'Invertido' : 'Inverter'}
            </span>
          </button>

          {/* Reconectar Loopback */}
          <button
            onClick={() => sendPopupIpcMessage({ streamId, type: 'POPUP_READY' })}
            className="p-1.5 rounded text-neutral-400 hover:text-cyan-300 hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Ressincronizar vídeo da janela"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Menu de Ajuste de Tamanho e Qualidade */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              showSettings ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Ajustar Dimensões da Janela e Qualidade"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Picture-in-Picture */}
          <button
            onClick={handleTogglePiP}
            className={`p-1.5 rounded hover:bg-neutral-800 transition-colors cursor-pointer ${
              isPiPActive ? 'text-cyan-400 bg-neutral-800' : 'text-neutral-400 hover:text-white'
            }`}
            title="Modo Picture-in-Picture"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>

          {/* Tela Cheia */}
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

          {/* Voltar para a Grade Principal */}
          <button
            onClick={handleReturnToGrid}
            className="px-2.5 py-1 text-[10px] text-red-300 hover:text-white bg-red-950/60 hover:bg-red-800 border border-red-800/80 rounded transition-colors cursor-pointer flex items-center gap-1"
            title="Fechar esta janela e voltar a transmissão para a grade principal"
          >
            <X className="w-3.5 h-3.5" />
            <span>Voltar p/ Grade</span>
          </button>
        </div>
      </div>

      {/* Painel Expansível de Controles de Tamanho e Qualidade */}
      {showSettings && (
        <div className="bg-neutral-900 border-b border-neutral-800 p-2.5 space-y-2 text-[11px] shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Redimensionar Janela Nativa
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

            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider">
                Filtro de Renderização
              </span>
              <select
                value={qualityPreset}
                onChange={(e) => setQualityPreset(e.target.value as StreamQualityPreset)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[11px] text-cyan-300 outline-none cursor-pointer"
              >
                <option value="auto">
                  Auto ({meta.resolution} · {meta.fps} FPS)
                </option>
                <option value="1080p60">1080p 60 FPS (Ultra)</option>
                <option value="720p60">720p 60 FPS (HD)</option>
                <option value="480p30">480p 30 FPS (Fluida)</option>
                <option value="360p30">360p 30 FPS (Econômica)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Área Central de Vídeo (100% da Janela Nativa) */}
      <div className="relative bg-black flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {remoteStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={meta.isSelf ? true : meta.isMuted}
            className={`w-full h-full object-contain bg-black transition-transform duration-150 ${getQualityStyles()} ${
              meta.isMirrored ? 'scale-x-[-1]' : ''
            }`}
          />
        ) : (
          <div className="w-full h-full bg-neutral-950 flex flex-col items-center justify-center text-neutral-500 space-y-2.5 p-4">
            {effectiveKind === 'screen' ? (
              <Gamepad2 className="w-10 h-10 text-cyan-400 animate-pulse" />
            ) : effectiveKind === 'capture_card' ? (
              <Tv className="w-10 h-10 text-emerald-400 animate-pulse" />
            ) : (
              <User className="w-10 h-10 text-indigo-400 animate-pulse" />
            )}
            <span className="text-xs text-neutral-300">
              Conectando vídeo à nova janela...
            </span>
          </div>
        )}

        {/* Badges de Status */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none">
          <span className="text-[10px] bg-neutral-950/80 backdrop-blur border border-neutral-800 px-2 py-0.5 rounded text-white flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {qualityPreset === 'auto' ? `${meta.resolution} · ${meta.fps}fps` : qualityPreset}
          </span>

          {meta.hasIsolatedAudio && (
            <span className="text-[10px] bg-cyan-950/90 border border-cyan-800 text-cyan-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
              {meta.processName || 'WASAPI'}
            </span>
          )}
        </div>
      </div>

      {/* Barra Inferior de Áudio (0% até 200% Boost) e Ações */}
      <div
        onWheel={(e) => {
          if (meta.isSelf) return;
          e.preventDefault();
          const step = e.deltaY < 0 ? 5 : -5;
          const base = meta.isMuted ? 0 : meta.volume;
          handleVolumeChange(base + step);
        }}
        className="px-3.5 py-2.5 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between gap-3 shrink-0"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleMute}
            disabled={meta.isSelf}
            className={`p-1.5 rounded border cursor-pointer transition-colors ${
              meta.isMuted || meta.isSelf
                ? 'bg-red-950/80 border-red-800 text-red-400'
                : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={meta.isMuted ? 'Desmutar' : 'Mutar'}
          >
            {meta.isMuted || meta.isSelf ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={200}
            value={meta.isSelf ? 0 : meta.isMuted ? 0 : meta.volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            onDoubleClick={() => !meta.isSelf && handleVolumeChange(100)}
            disabled={meta.isSelf}
            title="Volume de 0% a 200% (duplo clique volta para 100%)"
            className="w-28 sm:w-40 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />

          <span
            onClick={() => !meta.isSelf && handleVolumeChange(100)}
            className={`text-[11px] w-11 cursor-pointer ${
              !meta.isSelf && meta.volume > 100
                ? 'text-amber-400 font-bold'
                : 'text-neutral-300 hover:text-cyan-300'
            }`}
            title="Clique para voltar a 100%"
          >
            {meta.isSelf ? 'Local' : meta.isMuted ? '0%' : `${meta.volume}%`}
          </span>

          {!meta.isSelf && (
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

        <div className="flex items-center gap-2 text-[10px] text-neutral-400">
          <button
            onClick={handleToggleMirror}
            className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer transition-colors ${
              meta.isMirrored
                ? 'bg-indigo-950/80 border-indigo-600 text-indigo-200'
                : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span>{meta.isMirrored ? 'Invertido' : 'Inverter'}</span>
          </button>

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
};
