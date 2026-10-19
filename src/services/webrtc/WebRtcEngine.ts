/**
 * Motor WebRTC P2P com Suporte a Modo On-Demand, Keep-Alive Anti-Queda,
 * Reconexão Automática Transparente de Sala, Auto-Reset de Túnel P2P,
 * Aceleração de Hardware H.264 (720p/1080p/1440p High-Bitrate) e Áudio Opus Estéreo 160kbps CBR.
 */

import { wasapiAudioBridge } from './AudioBridge';
import {
  isTauriEnvironment,
  startNativeProcessAudio,
  startNativeMultiProcessAudio,
  stopNativeProcessAudio,
  findWindowPid,
} from '../tauriBridge';

import { ChatMessage, ChatAttachment } from '../../types';

export const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 8,
};

export interface VideoQualityProfile {
  width: number;
  height: number;
  fps: 30 | 60;
  maxBitrate: number; // bps para RTCRtpSender.setParameters
  minBitrateKbps: number; // kbps para SDP x-google-min-bitrate
  startBitrateKbps: number; // kbps para SDP x-google-start-bitrate
  maxBitrateKbps: number; // kbps para SDP b=AS e x-google-max-bitrate
}

export function getVideoQualityProfile(
  resolution: '720p' | '1080p' | '1440p',
  fps: 30 | 60
): VideoQualityProfile {
  switch (resolution) {
    case '1440p':
      return {
        width: 2560,
        height: 1440,
        fps,
        maxBitrate: fps === 60 ? 25_000_000 : 18_000_000,
        minBitrateKbps: 8000,
        startBitrateKbps: 16000,
        maxBitrateKbps: fps === 60 ? 25000 : 18000,
      };
    case '1080p':
      return {
        width: 1920,
        height: 1080,
        fps,
        maxBitrate: fps === 60 ? 14_000_000 : 10_000_000,
        minBitrateKbps: 4500,
        startBitrateKbps: 9500,
        maxBitrateKbps: fps === 60 ? 14000 : 10000,
      };
    case '720p':
    default:
      return {
        width: 1280,
        height: 720,
        fps,
        maxBitrate: fps === 60 ? 6_000_000 : 4_500_000,
        minBitrateKbps: 2000,
        startBitrateKbps: 4500,
        maxBitrateKbps: fps === 60 ? 6000 : 4500,
      };
  }
}

export interface RemotePeer {
  id: string;
  nickname: string;
  isHost: boolean;
  connectionState: RTCPeerConnectionState;
  hasScreen: boolean;
  screenTitle?: string;
  screenResolution?: '720p' | '1080p' | '1440p';
  screenFps?: 30 | 60;
  hasWebcam: boolean;
  hasIsolatedAudio: boolean;
  screenStream?: MediaStream;
  webcamStream?: MediaStream;
}

export interface PerformanceLogEntry {
  id: string;
  timestamp: number;
  peerId: string;
  userName: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  metric?: {
    fps?: number;
    rttMs?: number;
    packetLossPct?: number;
    bitrateKbps?: number;
  };
}

export type EngineEventCallback = {
  onPeersChange?: (peers: RemotePeer[]) => void;
  onSelfConnected?: (peerId: string, isHost: boolean) => void;
  onDisconnected?: () => void;
  onReconnectingChange?: (isReconnecting: boolean, attempt: number) => void;
  onError?: (err: string) => void;
  onRemoteStream?: (peerId: string, type: 'screen' | 'webcam', stream: MediaStream) => void;
  onStatsUpdate?: (stats: { rttMs: number; bytesReceived: number; bytesSent: number }) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onPerformanceLog?: (entry: PerformanceLogEntry) => void;
};

interface InternalPeerEntry {
  pc: RTCPeerConnection;
  info: RemotePeer;
  dc?: RTCDataChannel;
  sendersMap: Map<string, RTCRtpSender>;
  pendingCandidates: RTCIceCandidateInit[];
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  initialHandshakeDone: boolean;
  pendingNegotiation: boolean;
  isFreshJoinOffer: boolean;
  resetTimer?: any;
  recoveryAttempts: number;
  watchedScreen: boolean;
  watchedWebcam: boolean;
}

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private myPeerId: string | null = null;
  private clientId: string;
  private isHost = false;
  private peers: Map<string, InternalPeerEntry> = new Map();
  private incomingChunksMap = new Map<
    string,
    {
      chunks: string[];
      total: number;
      msg: { id: string; senderName: string; text: string; timestamp: number; attachmentMeta: any };
    }
  >();
  private callbacks: EngineEventCallback = {};

  // Parâmetros da última conexão para reconexão automática em caso de queda
  private lastWsUrl: string | null = null;
  private lastToken: string | null = null;
  private lastNickname: string | null = null;
  private manualDisconnect = false;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private pingInterval: any = null;

  // Streams locais e configuração de qualidade ativa
  private localScreenStream: MediaStream | null = null;
  private localWebcamStream: MediaStream | null = null;
  private screenTitle: string = '';
  private currentResolution: '720p' | '1080p' | '1440p' = '1080p';
  private currentFps: 30 | 60 = 60;
  private nativeCaptureHeight: number = 0;
  private isBroadcastingScreen = false;
  private isBroadcastingWebcam = false;

  constructor(callbacks: EngineEventCallback) {
    this.callbacks = callbacks;
    this.clientId = this.getOrCreateClientId();
  }

  private getOrCreateClientId(): string {
    try {
      const existing = sessionStorage.getItem('sc_client_instance_id');
      if (existing) return existing;
      const created = `cid_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;
      sessionStorage.setItem('sc_client_instance_id', created);
      return created;
    } catch {
      return `cid_${Math.random().toString(36).substring(2, 10)}`;
    }
  }

  /**
   * Conecta ao WebSocket do Host (via LAN ou Cloudflare Tunnel) e envia o Token
   */
  public connect(
    wsUrl: string,
    token: string,
    nickname: string,
    retryCount = 0,
    isAutoReconnect = false
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.manualDisconnect = false;
      this.lastWsUrl = wsUrl;
      this.lastToken = token;
      this.lastNickname = nickname;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.closeWsOnly();

      if (!isAutoReconnect) {
        this.cleanupPeersOnly();
      }

      if (typeof window !== 'undefined' && window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
        const errorMsg =
          'Bloqueado pelo Navegador (Mixed Content): Páginas HTTPS não podem conectar em ws:// inseguro. Para conexões LAN locais por IP, utilize o aplicativo desktop compilado (StreamCompanion.exe), ou no navegador utilize uma sala com WSS seguro (Cloudflare Tunnel ou Servidor Web).';
        this.callbacks.onError?.(errorMsg);
        return reject(errorMsg);
      }

      console.log(
        `[WebRTC Engine] Conectando a: ${wsUrl} (tentativa ${retryCount + 1}, autoReconnect=${isAutoReconnect})`
      );
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e: any) {
        return reject(`Falha ao abrir WebSocket: ${e.message}`);
      }

      let connected = false;

      this.ws.onopen = () => {
        connected = true;
        this.reconnectAttempts = 0;
        this.callbacks.onReconnectingChange?.(false, 0);
        console.log('[WebRTC Engine] WebSocket aberto. Enviando autenticação...');
        this.startPingHeartbeat();

        this.sendWsMessage({
          type: 'auth',
          token: token.trim(),
          nickname: nickname.trim(),
          client_id: this.clientId,
        });
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleSignalingMessage(msg, resolve, reject);
        } catch (err) {
          console.error('[WebRTC Engine] Erro ao processar mensagem do servidor:', err);
        }
      };

      this.ws.onerror = (e) => {
        console.error('[WebRTC Engine] Erro no WebSocket:', e);
        if (!connected && retryCount < 5 && wsUrl.includes('trycloudflare')) {
          console.log(
            `[WebRTC Engine] Aguardando propagação do túnel Cloudflare... Tentativa ${retryCount + 1}/5`
          );
          this.callbacks.onError?.(
            `Aguardando propagação do túnel Cloudflare... Tentativa ${retryCount + 1}/5`
          );
          setTimeout(() => {
            this.connect(wsUrl, token, nickname, retryCount + 1, isAutoReconnect)
              .then(resolve)
              .catch(reject);
          }, 2000);
        } else if (!connected && !isAutoReconnect) {
          let detailedMsg = `Não foi possível conectar ao servidor (${wsUrl}).`;
          if (wsUrl.includes('trycloudflare')) {
            detailedMsg +=
              ' O túnel Cloudflare pode estar inativo ou o Host fechou a sala. Verifique se o Host está com o app aberto e com o cloudflared.exe ativo.';
          } else if (wsUrl.includes('127.0.0.1') || wsUrl.includes('localhost')) {
            detailedMsg +=
              ' Servidor local não respondeu. Certifique-se de que o Host iniciou a sala antes de tentar entrar.';
          } else {
            detailedMsg +=
              ' Verifique se o Host está com a sala aberta, se o código digitado está correto e se o firewall permite a conexão.';
          }
          this.callbacks.onError?.(detailedMsg);
          reject(detailedMsg);
        } else if (!connected && isAutoReconnect) {
          reject('Falha na tentativa de reconexão automática');
        }
      };

      this.ws.onclose = () => {
        console.log('[WebRTC Engine] WebSocket desconectado.');
        this.stopPingHeartbeat();

        if (!this.manualDisconnect && this.lastWsUrl && this.lastToken && this.lastNickname) {
          this.scheduleWsReconnect();
        } else {
          this.cleanup();
        }
      };
    });
  }

  private startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendWsMessage({ type: 'ping' });
      }
    }, 8000);
  }

  private stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleWsReconnect() {
    if (this.manualDisconnect || !this.lastWsUrl || !this.lastToken || !this.lastNickname) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 15) {
      this.callbacks.onReconnectingChange?.(false, 0);
      this.callbacks.onError?.(
        'Conexão com a sala perdida após várias tentativas de reconexão automática.'
      );
      this.cleanup();
      this.callbacks.onDisconnected?.();
      return;
    }

    this.callbacks.onReconnectingChange?.(true, this.reconnectAttempts);
    const delayMs = Math.min(6000, 1200 * this.reconnectAttempts);
    console.log(
      `[WebRTC Engine] Tentando reconexão automática com a sala em ${delayMs}ms (tentativa ${this.reconnectAttempts})...`
    );

    this.callbacks.onPerformanceLog?.({
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      peerId: 'system',
      userName: 'Sistema',
      type: 'warning',
      message: `Oscilação na conexão da sala. Reconectando automaticamente (tentativa ${this.reconnectAttempts})...`,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || !this.lastWsUrl || !this.lastToken || !this.lastNickname) return;
      this.connect(this.lastWsUrl, this.lastToken, this.lastNickname, 0, true).catch(() => {
        this.scheduleWsReconnect();
      });
    }, delayMs);
  }

  /**
   * Força o reset completo de todas as conexões P2P ou reconecta à sala sem fechar lives locais
   */
  public reconnectAllPeers(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.lastWsUrl && this.lastToken && this.lastNickname) {
        this.connect(this.lastWsUrl, this.lastToken, this.lastNickname, 0, true).catch(() => {});
      }
      return;
    }

    for (const [peerId] of this.peers.entries()) {
      this.resetPeerConnection(peerId, true);
    }
  }

  /**
   * Reconstrói do zero a RTCPeerConnection com um peer específico quando há falha ICE / P2P
   */
  public resetPeerConnection(peerId: string, notifyRemote = true): void {
    const existing = this.peers.get(peerId);
    if (!existing) return;

    const {
      nickname,
      isHost,
      hasScreen,
      screenTitle,
      screenResolution,
      screenFps,
      hasWebcam,
      hasIsolatedAudio,
    } = existing.info;
    const screenTrackId = (existing.info as any).screenTrackId;
    const webcamTrackId = (existing.info as any).webcamTrackId;
    const watchedScreen = existing.watchedScreen || !!existing.info.screenStream;
    const watchedWebcam = existing.watchedWebcam || !!existing.info.webcamStream;

    console.log(
      `[WebRTC] Resetando conexão P2P com ${nickname} (${peerId}), notifyRemote=${notifyRemote}`
    );

    if (existing.resetTimer) {
      clearTimeout(existing.resetTimer);
    }
    try {
      existing.pc.onconnectionstatechange = null;
      existing.pc.oniceconnectionstatechange = null;
      existing.pc.ontrack = null;
      existing.pc.onicecandidate = null;
      existing.pc.onnegotiationneeded = null;
      existing.pc.close();
    } catch {}

    this.peers.delete(peerId);

    if (notifyRemote) {
      this.sendWsMessage({
        type: 'webrtc_signal',
        to_peer_id: peerId,
        payload: { reset: true },
      });
    }

    const shouldInitiate = notifyRemote;
    this.createPeerConnection(peerId, nickname, isHost, shouldInitiate, {
      hasScreen,
      screenTitle,
      screenResolution,
      screenFps,
      screenTrackId,
      hasWebcam,
      webcamTrackId,
      hasIsolatedAudio,
      watchedScreen,
      watchedWebcam,
    });

    this.broadcastStreamStatus();
    this.emitPeersChange();
  }

  private async handleSignalingMessage(
    msg: any,
    onAuthSuccess?: () => void,
    onAuthFail?: (err: string) => void
  ) {
    switch (msg.type) {
      case 'pong':
        break;

      case 'auth_ok': {
        this.myPeerId = msg.peer_id;
        this.isHost = msg.is_host;
        console.log(`[WebRTC Engine] Autenticado! Meu ID: ${this.myPeerId}, Host: ${this.isHost}`);
        this.callbacks.onSelfConnected?.(this.myPeerId!, this.isHost);
        onAuthSuccess?.();

        const serverPeerIds = new Set<string>();

        if (Array.isArray(msg.peers)) {
          for (const p of msg.peers) {
            serverPeerIds.add(p.id);
            const existing = this.peers.get(p.id);

            if (existing) {
              existing.info.nickname = p.nickname;
              existing.info.isHost = p.is_host;
              existing.info.hasScreen = !!p.has_screen;
              existing.info.screenTitle = p.screen_title || existing.info.screenTitle;
              existing.info.hasWebcam = !!p.has_webcam;
              existing.info.hasIsolatedAudio = !!p.has_isolated_audio;
              (existing.info as any).screenTrackId = p.screen_track_id;
              (existing.info as any).webcamTrackId = p.webcam_track_id;

              const st = existing.pc.connectionState;
              if (st === 'failed' || st === 'disconnected' || st === 'closed') {
                this.resetPeerConnection(p.id, true);
              }
            } else {
              this.createPeerConnection(p.id, p.nickname, p.is_host, true, {
                hasScreen: !!p.has_screen,
                screenTitle: p.screen_title,
                screenTrackId: p.screen_track_id,
                hasWebcam: !!p.has_webcam,
                webcamTrackId: p.webcam_track_id,
                hasIsolatedAudio: !!p.has_isolated_audio,
                watchedScreen: false,
                watchedWebcam: false,
              });
            }
          }
        }

        for (const [existingId] of Array.from(this.peers.entries())) {
          if (!serverPeerIds.has(existingId)) {
            this.removePeer(existingId);
          }
        }

        this.emitPeersChange();

        if (this.isBroadcastingScreen || this.isBroadcastingWebcam) {
          setTimeout(() => this.broadcastStreamStatus(), 150);
        }
        break;
      }

      case 'auth_failed':
        console.error('[WebRTC Engine] Falha na autenticação:', msg.reason);
        this.manualDisconnect = true;
        this.callbacks.onError?.(msg.reason || 'Token da Sala inválido.');
        onAuthFail?.(msg.reason);
        this.disconnect();
        this.callbacks.onDisconnected?.();
        break;

      case 'peer_joined': {
        const p = msg.peer;
        console.log('[WebRTC Engine] Peer entrou/reconectou:', p.nickname, p.id);

        const existing = this.peers.get(p.id);
        if (existing) {
          existing.info.nickname = p.nickname;
          existing.info.isHost = p.is_host;
          if (typeof p.has_screen === 'boolean') existing.info.hasScreen = p.has_screen;
          if (p.screen_title) existing.info.screenTitle = p.screen_title;
          if (typeof p.has_webcam === 'boolean') existing.info.hasWebcam = p.has_webcam;
          if (typeof p.has_isolated_audio === 'boolean') {
            existing.info.hasIsolatedAudio = p.has_isolated_audio;
          }

          const st = existing.pc.connectionState;
          if (st === 'failed' || st === 'disconnected' || st === 'closed') {
            this.resetPeerConnection(p.id, false);
          }
        } else {
          this.createPeerConnection(p.id, p.nickname, p.is_host, false, {
            hasScreen: !!p.has_screen,
            screenTitle: p.screen_title,
            screenTrackId: p.screen_track_id,
            hasWebcam: !!p.has_webcam,
            webcamTrackId: p.webcam_track_id,
            hasIsolatedAudio: !!p.has_isolated_audio,
          });
        }

        this.emitPeersChange();
        this.broadcastStreamStatus();
        break;
      }

      case 'peer_left':
        console.log('[WebRTC Engine] Peer saiu:', msg.peer_id);
        this.removePeer(msg.peer_id);
        break;

      case 'webrtc_signal':
        await this.handleRemoteSignal(msg.from_peer_id, msg.payload);
        break;

      case 'stream_status': {
        const peer = this.peers.get(msg.peer_id);
        if (peer) {
          peer.info.hasScreen = !!msg.has_screen;
          peer.info.screenTitle = msg.screen_title;
          if (msg.screen_resolution) peer.info.screenResolution = msg.screen_resolution;
          if (msg.screen_fps) peer.info.screenFps = msg.screen_fps;
          peer.info.hasWebcam = !!msg.has_webcam;
          peer.info.hasIsolatedAudio = !!msg.has_isolated_audio;
          (peer.info as any).webcamTrackId = msg.webcam_track_id;
          (peer.info as any).screenTrackId = msg.screen_track_id;

          if (!msg.has_screen) {
            peer.info.screenStream = undefined;
          } else if (peer.watchedScreen && !peer.info.screenStream) {
            this.requestPeerStream(msg.peer_id, 'screen');
          }

          if (!msg.has_webcam) {
            peer.info.webcamStream = undefined;
          } else if (peer.watchedWebcam && !peer.info.webcamStream) {
            this.requestPeerStream(msg.peer_id, 'webcam');
          }

          this.emitPeersChange();
        }
        break;
      }

      case 'request_stream':
        console.log(
          `[WebRTC Engine] Peer ${msg.from_peer_id} solicitou stream: ${msg.stream_type}`
        );
        if (msg.from_peer_id) {
          this.attachTracksForPeer(msg.from_peer_id, msg.stream_type);
        }
        break;
    }
  }

  /**
   * Cria e gerencia a RTCPeerConnection para um peer remoto sem conflito de m-lines (Unified Plan puro)
   */
  private createPeerConnection(
    peerId: string,
    nickname: string,
    isHost: boolean,
    initiator: boolean,
    preservedState?: {
      hasScreen?: boolean;
      screenTitle?: string;
      screenResolution?: '720p' | '1080p' | '1440p';
      screenFps?: 30 | 60;
      screenTrackId?: string;
      hasWebcam?: boolean;
      webcamTrackId?: string;
      hasIsolatedAudio?: boolean;
      watchedScreen?: boolean;
      watchedWebcam?: boolean;
    }
  ): RTCPeerConnection {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId)!.pc;
    }

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);

    const info: RemotePeer = {
      id: peerId,
      nickname,
      isHost,
      connectionState: pc.connectionState,
      hasScreen: preservedState?.hasScreen ?? false,
      screenTitle: preservedState?.screenTitle,
      screenResolution: preservedState?.screenResolution ?? '1080p',
      screenFps: preservedState?.screenFps ?? 60,
      hasWebcam: preservedState?.hasWebcam ?? false,
      hasIsolatedAudio: preservedState?.hasIsolatedAudio ?? false,
    };
    if (preservedState?.screenTrackId) (info as any).screenTrackId = preservedState.screenTrackId;
    if (preservedState?.webcamTrackId) (info as any).webcamTrackId = preservedState.webcamTrackId;

    const peerEntry: InternalPeerEntry = {
      pc,
      info,
      dc: undefined,
      sendersMap: new Map<string, RTCRtpSender>(),
      pendingCandidates: [],
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      initialHandshakeDone: false,
      pendingNegotiation: false,
      isFreshJoinOffer: initiator,
      recoveryAttempts: 0,
      watchedScreen: preservedState?.watchedScreen ?? false,
      watchedWebcam: preservedState?.watchedWebcam ?? false,
    };
    this.peers.set(peerId, peerEntry);

    if (initiator) {
      try {
        const dc = pc.createDataChannel('streamcompanion-chat', { ordered: true });
        this.setupDataChannel(dc, peerId, peerEntry);
      } catch (err) {
        console.error(`[WebRTC] Falha ao criar DataChannel para peer ${peerId}:`, err);
      }

      if (this.isBroadcastingScreen && this.localScreenStream) {
        this.addTracksOnly(peerEntry, 'screen');
      }
      if (this.isBroadcastingWebcam && this.localWebcamStream) {
        this.addTracksOnly(peerEntry, 'webcam');
      }
    }

    pc.ondatachannel = (event) => {
      console.log(`[WebRTC] DataChannel recebido do peer ${peerId}:`, event.channel.label);
      this.setupDataChannel(event.channel, peerId, peerEntry);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWsMessage({
          type: 'webrtc_signal',
          to_peer_id: peerId,
          payload: { candidate: event.candidate },
        });
      }
    };

    const triggerAutoRecovery = (stateLabel: string) => {
      if (peerEntry.resetTimer) clearTimeout(peerEntry.resetTimer);

      if (stateLabel === 'failed') {
        peerEntry.recoveryAttempts += 1;
        this.callbacks.onPerformanceLog?.({
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          peerId,
          userName: info.nickname || 'Amigo',
          type: 'warning',
          message: `Recuperando conexão P2P automaticamente com ${info.nickname} (tentativa ${peerEntry.recoveryAttempts})...`,
        });

        const delay = this.myPeerId && this.myPeerId > peerId ? 700 : 1800;
        peerEntry.resetTimer = setTimeout(() => {
          const current = this.peers.get(peerId);
          if (!current) return;
          if (
            current.pc.connectionState === 'failed' ||
            current.pc.connectionState === 'disconnected'
          ) {
            this.resetPeerConnection(peerId, true);
          }
        }, delay);
      } else if (stateLabel === 'disconnected') {
        peerEntry.resetTimer = setTimeout(() => {
          const current = this.peers.get(peerId);
          if (!current) return;
          if (
            current.pc.connectionState === 'disconnected' ||
            current.pc.connectionState === 'failed'
          ) {
            this.callbacks.onPerformanceLog?.({
              id: Math.random().toString(36).substring(2, 9),
              timestamp: Date.now(),
              peerId,
              userName: info.nickname || 'Amigo',
              type: 'warning',
              message: `Instabilidade P2P prolongada com ${info.nickname}. Resetando conexão automaticamente...`,
            });
            this.resetPeerConnection(peerId, true);
          }
        }, 3500);
      }
    };

    pc.onconnectionstatechange = () => {
      info.connectionState = pc.connectionState;
      this.emitPeersChange();
      console.log(`[WebRTC] Peer ${peerId} (${info.nickname}) estado de conexão:`, pc.connectionState);

      if (pc.connectionState === 'connected') {
        if (peerEntry.resetTimer) {
          clearTimeout(peerEntry.resetTimer);
          peerEntry.resetTimer = null;
        }
        peerEntry.recoveryAttempts = 0;

        // Reaplica os parâmetros de alto bitrate / 60fps assim que o transporte DTLS/SRTP estiver ativo
        this.applySenderQualityParameters(peerEntry);

        this.callbacks.onPerformanceLog?.({
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          peerId,
          userName: info.nickname || 'Amigo',
          type: 'info',
          message: 'Túnel P2P direto WebRTC estabelecido.',
        });

        if (peerEntry.watchedScreen && info.hasScreen && !info.screenStream) {
          this.requestPeerStream(peerId, 'screen');
        }
        if (peerEntry.watchedWebcam && info.hasWebcam && !info.webcamStream) {
          this.requestPeerStream(peerId, 'webcam');
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        triggerAutoRecovery(pc.connectionState);
      }
    };

    pc.ontrack = (event) => {
      console.log(
        `[WebRTC] Faixa recebida do peer ${peerId}: ${event.track.kind} (${event.track.id})`
      );

      // Configura o jitter buffer do receptor (NetEq / Video Playout) para eliminar cortes de áudio e micro-travadas
      try {
        const receiver = event.receiver as any;
        if (receiver && 'playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = event.track.kind === 'audio' ? 0.055 : 0.025;
        }
      } catch {}

      const streamId = event.streams[0]?.id || '';
      const isWebcam =
        streamId.toLowerCase().includes('webcam') ||
        event.track.id === (info as any).webcamTrackId;

      if (isWebcam) {
        if (!info.webcamStream) {
          info.webcamStream = new MediaStream();
        }
        info.webcamStream.getTracks().forEach((t) => {
          if (t.kind === event.track.kind && t.id !== event.track.id) {
            info.webcamStream?.removeTrack(t);
          }
        });
        if (!info.webcamStream.getTracks().some((t) => t.id === event.track.id)) {
          info.webcamStream.addTrack(event.track);
          info.webcamStream = new MediaStream(info.webcamStream.getTracks());
        }
        info.hasWebcam = true;
        peerEntry.watchedWebcam = true;
        this.callbacks.onRemoteStream?.(peerId, 'webcam', info.webcamStream);
      } else {
        if (!info.screenStream) {
          info.screenStream = new MediaStream();
        }
        info.screenStream.getTracks().forEach((t) => {
          if (t.kind === event.track.kind && t.id !== event.track.id) {
            info.screenStream?.removeTrack(t);
          }
        });
        if (!info.screenStream.getTracks().some((t) => t.id === event.track.id)) {
          info.screenStream.addTrack(event.track);
          info.screenStream = new MediaStream(info.screenStream.getTracks());
        }
        if (event.track.kind === 'video') {
          info.hasScreen = true;
        }
        if (event.track.kind === 'audio') {
          info.hasIsolatedAudio = true;
        }
        peerEntry.watchedScreen = true;
        this.callbacks.onRemoteStream?.(peerId, 'screen', info.screenStream);
      }

      this.emitPeersChange();
    };

    if (initiator) {
      this.renegotiatePeer(peerId);
    }

    return pc;
  }

  /**
   * Prioriza o codec H.264 com aceleração de hardware (NVENC / AMF / QuickSync) no transceiver de vídeo
   * para evitar que o VP8 por software na CPU derrube o framerate em 1080p/1440p.
   */
  private preferHardwareH264OnTransceiver(pc: RTCPeerConnection, sender: RTCRtpSender) {
    try {
      if (typeof RTCRtpSender.getCapabilities !== 'function') return;
      const caps = RTCRtpSender.getCapabilities('video');
      if (!caps || !caps.codecs) return;

      const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
      if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') return;

      const h264Codecs = caps.codecs.filter(
        (c) =>
          c.mimeType.toLowerCase() === 'video/h264' &&
          (!c.sdpFmtpLine || c.sdpFmtpLine.includes('packetization-mode=1'))
      );
      const otherCodecs = caps.codecs.filter(
        (c) => !h264Codecs.includes(c)
      );

      if (h264Codecs.length > 0) {
        transceiver.setCodecPreferences([...h264Codecs, ...otherCodecs]);
      }
    } catch (err) {
      console.warn('[WebRTC] Aviso ao definir preferência de codec H.264:', err);
    }
  }

  /**
   * Aplica maxBitrate, maxFramerate, scaleResolutionDownBy, degradationPreference = 'maintain-framerate'
   * e prioridade alta para o áudio Opus.
   */
  private applySenderQualityParameters(peerEntry: InternalPeerEntry) {
    const profile = getVideoQualityProfile(this.currentResolution, this.currentFps);

    const screenVideoSender = peerEntry.sendersMap.get('screen_video');
    if (screenVideoSender) {
      try {
        const params = screenVideoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }

        // IMPORTANTE: 'maintain-framerate' impede que o Chromium derrube os FPS quando a resolução sobe para 1080p/1440p!
        (params as any).degradationPreference = 'maintain-framerate';

        // Calcula scaleResolutionDownBy caso o capturador do Windows mantenha a resolução nativa do monitor
        let scaleDown = 1.0;
        const vTrack = this.localScreenStream?.getVideoTracks()[0];
        const actualHeight = vTrack?.getSettings?.().height || this.nativeCaptureHeight || profile.height;
        if (actualHeight > profile.height) {
          scaleDown = Number((actualHeight / profile.height).toFixed(2));
        }

        params.encodings[0].maxBitrate = profile.maxBitrate;
        params.encodings[0].maxFramerate = profile.fps;
        params.encodings[0].scaleResolutionDownBy = Math.max(1.0, scaleDown);
        (params.encodings[0] as any).priority = 'high';
        (params.encodings[0] as any).networkPriority = 'high';

        screenVideoSender.setParameters(params).catch((err) => {
          console.warn('[WebRTC] Aviso ao aplicar setParameters no vídeo:', err);
        });
      } catch (err) {
        console.warn('[WebRTC] Erro ao configurar parâmetros do sender de vídeo:', err);
      }
    }

    const screenAudioSender = peerEntry.sendersMap.get('screen_audio');
    if (screenAudioSender) {
      try {
        const aParams = screenAudioSender.getParameters();
        if (!aParams.encodings || aParams.encodings.length === 0) {
          aParams.encodings = [{}];
        }
        aParams.encodings[0].maxBitrate = 160_000; // 160 kbps CBR Estéreo
        (aParams.encodings[0] as any).priority = 'high';
        (aParams.encodings[0] as any).networkPriority = 'high';
        screenAudioSender.setParameters(aParams).catch(() => {});
      } catch {}
    }
  }

  /**
   * Otimiza o SDP para:
   * 1. Áudio Opus Estéreo 160kbps CBR com usedtx=0 (elimina cortes em sons baixos/música)
   * 2. Vídeo High-Bitrate real de acordo com a resolução (6 Mbps em 720p, 14 Mbps em 1080p, 25 Mbps em 1440p)
   */
  private enhanceSdpForHighQuality(sdpStr: string): string {
    if (!sdpStr) return sdpStr;
    const profile = getVideoQualityProfile(this.currentResolution, this.currentFps);
    const lines = sdpStr.split(/\r?\n/);
    const outLines: string[] = [];
    let currentMediaSection: 'none' | 'audio' | 'video' | 'application' = 'none';

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.startsWith('m=audio')) {
        currentMediaSection = 'audio';
      } else if (line.startsWith('m=video')) {
        currentMediaSection = 'video';
      } else if (line.startsWith('m=application')) {
        currentMediaSection = 'application';
      }

      // Configura Opus para som de jogo/música contínuo (Estéreo, 160kbps, CBR, sem corte DTX)
      if (currentMediaSection === 'audio' && line.startsWith('a=fmtp:') && line.includes('minptime=')) {
        const base = line.split(' ')[0];
        line = `${base} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=160000;cbr=1;usedtx=0`;
      }

      // Injeta parâmetros de bitrate nos codecs de vídeo para destravar o estimador de banda do Chromium
      if (
        currentMediaSection === 'video' &&
        line.startsWith('a=fmtp:') &&
        !line.includes('apt=') &&
        !line.includes('x-google-max-bitrate')
      ) {
        line = `${line};x-google-min-bitrate=${profile.minBitrateKbps};x-google-start-bitrate=${profile.startBitrateKbps};x-google-max-bitrate=${profile.maxBitrateKbps}`;
      }

      outLines.push(line);

      // Adiciona linha b=AS e b=TIAS logo após c=IN na seção de vídeo se ainda não existir
      if (currentMediaSection === 'video' && line.startsWith('c=IN')) {
        const nextLine = lines[i + 1] || '';
        if (!nextLine.startsWith('b=AS:')) {
          outLines.push(`b=AS:${profile.maxBitrateKbps}`);
          outLines.push(`b=TIAS:${profile.maxBitrate}`);
        }
      }
    }

    return outLines.join('\r\n');
  }

  private addTracksOnly(peerEntry: InternalPeerEntry, streamType: 'screen' | 'webcam'): boolean {
    const stream = streamType === 'webcam' ? this.localWebcamStream : this.localScreenStream;
    if (!stream) return false;

    let added = false;
    stream.getTracks().forEach((track) => {
      track.enabled = true;
      try {
        if (track.kind === 'video' && streamType === 'screen' && 'contentHint' in track) {
          // 'motion' evita que o codificador WebRTC trave o framerate em 1080p/1440p!
          track.contentHint = 'motion';
        } else if (track.kind === 'audio' && 'contentHint' in track) {
          track.contentHint = 'music';
        }
      } catch {}

      const key = `${streamType}_${track.kind}`;
      const existingSender = peerEntry.sendersMap.get(key);

      if (existingSender) {
        existingSender.replaceTrack(track).catch((err) => {
          console.warn(`[WebRTC] replaceTrack falhou para ${key}:`, err);
        });
      } else {
        try {
          const sender = peerEntry.pc.addTrack(track, stream);
          peerEntry.sendersMap.set(key, sender);
          if (track.kind === 'video' && streamType === 'screen') {
            this.preferHardwareH264OnTransceiver(peerEntry.pc, sender);
          }
          added = true;
        } catch (err) {
          console.warn(`[WebRTC] pc.addTrack falhou para ${key}:`, err);
        }
      }
    });

    this.applySenderQualityParameters(peerEntry);
    return added;
  }

  private setupDataChannel(
    dc: RTCDataChannel,
    peerId: string,
    peerEntry: InternalPeerEntry
  ) {
    peerEntry.dc = dc;

    dc.onopen = () => {
      console.log(`[WebRTC DataChannel] Canal de texto P2P ABERTO com peer ${peerId}`);
    };

    dc.onclose = () => {
      console.log(`[WebRTC DataChannel] Canal fechado com peer ${peerId}`);
      if (peerEntry.dc === dc) {
        peerEntry.dc = undefined;
      }
    };

    dc.onerror = (err) => {
      console.error(`[WebRTC DataChannel] Erro no canal com peer ${peerId}:`, err);
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chat') {
          const chatMsg: ChatMessage = {
            id: data.id || Math.random().toString(36).substring(2),
            senderId: peerId,
            senderName: data.senderName || peerEntry.info.nickname || 'Amigo',
            text: data.text || '',
            timestamp: data.timestamp || Date.now(),
            isSelf: false,
            attachment: data.attachment,
          };
          this.callbacks.onChatMessage?.(chatMsg);
        } else if (data.type === 'chat_chunk') {
          const {
            msgId,
            chunkIndex,
            totalChunks,
            chunkData,
            senderName,
            text,
            timestamp,
            attachmentMeta,
          } = data;
          if (!this.incomingChunksMap.has(msgId)) {
            this.incomingChunksMap.set(msgId, {
              chunks: new Array(totalChunks),
              total: totalChunks,
              msg: { id: msgId, senderName, text, timestamp, attachmentMeta },
            });
          }
          const item = this.incomingChunksMap.get(msgId)!;
          item.chunks[chunkIndex] = chunkData;

          let received = 0;
          for (let i = 0; i < item.total; i++) {
            if (item.chunks[i] !== undefined) received++;
          }

          if (received === item.total) {
            const fullDataUrl = item.chunks.join('');
            const chatMsg: ChatMessage = {
              id: item.msg.id,
              senderId: peerId,
              senderName: item.msg.senderName || peerEntry.info.nickname || 'Amigo',
              text: item.msg.text || '',
              timestamp: item.msg.timestamp || Date.now(),
              isSelf: false,
              attachment: {
                name: item.msg.attachmentMeta.name,
                type: item.msg.attachmentMeta.type,
                size: item.msg.attachmentMeta.size,
                isImage: item.msg.attachmentMeta.isImage,
                dataUrl: fullDataUrl,
              },
            };
            this.incomingChunksMap.delete(msgId);
            this.callbacks.onChatMessage?.(chatMsg);
          }
        }
      } catch (e) {
        console.error('[WebRTC DataChannel] Erro ao decodificar mensagem de texto:', e);
      }
    };
  }

  public sendChatMessage(
    text: string,
    senderName: string,
    attachment?: ChatAttachment
  ): ChatMessage {
    const trimmed = text.trim();
    if (!trimmed && !attachment) {
      throw new Error('A mensagem ou o arquivo anexado não pode ser vazio.');
    }

    if (this.peers.size === 0) {
      throw new Error(
        'Não há outros participantes na sala no momento. Aguarde alguém entrar com o Código da Sala.'
      );
    }

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 10),
      senderId: this.myPeerId || 'self',
      senderName,
      text: trimmed,
      timestamp: Date.now(),
      isSelf: true,
      attachment,
    };

    let sentCount = 0;
    let failedPeers: string[] = [];

    if (attachment && attachment.dataUrl) {
      const CHUNK_SIZE = 16 * 1024;
      const dataUrl = attachment.dataUrl;
      const totalChunks = Math.ceil(dataUrl.length / CHUNK_SIZE);

      for (const [, peerEntry] of this.peers.entries()) {
        if (peerEntry.dc && peerEntry.dc.readyState === 'open') {
          sentCount++;
          this.sendChunksToChannel(peerEntry.dc, {
            msgId: chatMsg.id,
            senderName: chatMsg.senderName,
            text: chatMsg.text,
            timestamp: chatMsg.timestamp,
            attachmentMeta: {
              name: attachment.name,
              type: attachment.type,
              size: attachment.size,
              isImage: attachment.isImage,
            },
            dataUrl,
            totalChunks,
            chunkSize: CHUNK_SIZE,
          });
        } else {
          failedPeers.push(peerEntry.info.nickname);
        }
      }
    } else {
      const payload = JSON.stringify({
        type: 'chat',
        id: chatMsg.id,
        text: chatMsg.text,
        senderName: chatMsg.senderName,
        timestamp: chatMsg.timestamp,
      });

      for (const [peerId, peerEntry] of this.peers.entries()) {
        if (peerEntry.dc && peerEntry.dc.readyState === 'open') {
          try {
            peerEntry.dc.send(payload);
            sentCount++;
          } catch (e: any) {
            console.error(`[WebRTC DataChannel] Falha ao enviar para ${peerId}:`, e);
            failedPeers.push(peerEntry.info.nickname);
          }
        } else {
          failedPeers.push(peerEntry.info.nickname);
        }
      }
    }

    if (sentCount === 0) {
      throw new Error(
        `Nenhum canal P2P direto está pronto ainda (status: conectando com ${failedPeers.join(', ')}). Aguarde o handshake WebRTC.`
      );
    }

    return chatMsg;
  }

  private async sendChunksToChannel(dc: RTCDataChannel, payload: any) {
    const {
      msgId,
      senderName,
      text,
      timestamp,
      attachmentMeta,
      dataUrl,
      totalChunks,
      chunkSize,
    } = payload;
    for (let i = 0; i < totalChunks; i++) {
      if (dc.readyState !== 'open') break;

      const chunkData = dataUrl.substring(i * chunkSize, (i + 1) * chunkSize);
      const chunkMsg = JSON.stringify({
        type: 'chat_chunk',
        msgId,
        chunkIndex: i,
        totalChunks,
        chunkData,
        senderName,
        text,
        timestamp,
        attachmentMeta,
      });

      while (dc.bufferedAmount > 64 * 1024 && dc.readyState === 'open') {
        await new Promise((r) => setTimeout(r, 20));
      }

      try {
        dc.send(chunkMsg);
      } catch (err) {
        console.error('[WebRTC DataChannel] Erro ao enviar chunk de arquivo:', err);
        break;
      }
    }
  }

  private async handleRemoteSignal(fromPeerId: string, payload: any) {
    if (payload?.reset) {
      console.log(`[WebRTC] Pedido de reset P2P recebido de ${fromPeerId}. Recriando conexão...`);
      this.resetPeerConnection(fromPeerId, false);
      return;
    }

    let peerEntry = this.peers.get(fromPeerId);
    if (!peerEntry) return;

    if (payload?.fresh_join && payload?.sdp?.type === 'offer' && peerEntry.pc.remoteDescription !== null) {
      console.log(
        `[WebRTC] Peer ${fromPeerId} iniciou nova sessão (fresh_join). Recriando RTCPeerConnection local limpa...`
      );
      this.resetPeerConnection(fromPeerId, false);
      peerEntry = this.peers.get(fromPeerId);
      if (!peerEntry) return;
    }

    const { pc } = peerEntry;

    try {
      if (payload.sdp) {
        const sdp = new RTCSessionDescription(payload.sdp);
        const polite = this.myPeerId ? this.myPeerId > fromPeerId : !this.isHost;
        const readyForOffer =
          !peerEntry.makingOffer &&
          (pc.signalingState === 'stable' || peerEntry.isSettingRemoteAnswerPending);
        const offerCollision = sdp.type === 'offer' && !readyForOffer;

        peerEntry.ignoreOffer = !polite && offerCollision;
        if (peerEntry.ignoreOffer) {
          console.warn(`[WebRTC] Colisão de offer ignorada (impolite peer) para ${fromPeerId}`);
          return;
        }

        peerEntry.isSettingRemoteAnswerPending = sdp.type === 'answer';
        if (offerCollision) {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch {}
        }

        await pc.setRemoteDescription(sdp);
        peerEntry.isSettingRemoteAnswerPending = false;

        while (peerEntry.pendingCandidates.length > 0) {
          const cand = peerEntry.pendingCandidates.shift()!;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch {}
        }

        if (sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          const enhancedAnswer: RTCSessionDescriptionInit = {
            type: answer.type,
            sdp: this.enhanceSdpForHighQuality(answer.sdp || ''),
          };
          await pc.setLocalDescription(enhancedAnswer);
          this.applySenderQualityParameters(peerEntry);

          this.sendWsMessage({
            type: 'webrtc_signal',
            to_peer_id: fromPeerId,
            payload: { sdp: pc.localDescription },
          });

          if (!peerEntry.initialHandshakeDone) {
            peerEntry.initialHandshakeDone = true;
            let added = false;
            if (this.isBroadcastingScreen && this.localScreenStream) {
              if (this.addTracksOnly(peerEntry, 'screen')) added = true;
            }
            if (this.isBroadcastingWebcam && this.localWebcamStream) {
              if (this.addTracksOnly(peerEntry, 'webcam')) added = true;
            }
            if (added || peerEntry.pendingNegotiation) {
              peerEntry.pendingNegotiation = false;
              this.renegotiatePeer(fromPeerId);
            }
          }
        } else if (sdp.type === 'answer') {
          peerEntry.initialHandshakeDone = true;
          this.applySenderQualityParameters(peerEntry);
          if (peerEntry.pendingNegotiation) {
            peerEntry.pendingNegotiation = false;
            this.renegotiatePeer(fromPeerId);
          }
        }
      } else if (payload.candidate) {
        if (peerEntry.ignoreOffer) return;
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (err) {
            console.warn('[WebRTC] Aviso ao adicionar ICE Candidate:', err);
          }
        } else {
          peerEntry.pendingCandidates.push(payload.candidate);
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Erro em handleRemoteSignal com ${fromPeerId}:`, err);
      this.resetPeerConnection(fromPeerId, true);
    }
  }

  public requestPeerStream(targetPeerId: string, streamType: 'screen' | 'webcam'): void {
    const peerEntry = this.peers.get(targetPeerId);
    if (peerEntry) {
      if (streamType === 'screen') peerEntry.watchedScreen = true;
      if (streamType === 'webcam') peerEntry.watchedWebcam = true;

      if (
        peerEntry.pc.connectionState === 'failed' ||
        peerEntry.pc.connectionState === 'disconnected' ||
        peerEntry.pc.connectionState === 'closed'
      ) {
        this.resetPeerConnection(targetPeerId, true);
        return;
      }
    }

    console.log(`[WebRTC Engine] Solicitando stream sob demanda do peer ${targetPeerId}`);
    this.sendWsMessage({
      type: 'request_stream',
      target_peer_id: targetPeerId,
      stream_type: streamType,
    });
  }

  /**
   * Atualiza dinamicamente a resolução (720p / 1080p / 1440p), o FPS (30 / 60) e o Bitrate
   * em tempo real sem precisar fechar a transmissão ativa!
   */
  public async updateStreamQuality(
    resolution: '720p' | '1080p' | '1440p',
    fps: 30 | 60
  ): Promise<void> {
    this.currentResolution = resolution;
    this.currentFps = fps;

    if (!this.isBroadcastingScreen || !this.localScreenStream) {
      return;
    }

    const profile = getVideoQualityProfile(resolution, fps);
    const videoTrack = this.localScreenStream.getVideoTracks()[0];

    if (videoTrack) {
      try {
        if ('contentHint' in videoTrack) {
          videoTrack.contentHint = 'motion';
        }
        await videoTrack.applyConstraints({
          width: { ideal: profile.width, max: profile.width },
          height: { ideal: profile.height, max: profile.height },
          frameRate: { ideal: fps, max: fps },
        });
      } catch (err) {
        console.warn('[WebRTC] applyConstraints parcial no vídeo (usando scaleResolutionDownBy):', err);
      }
    }

    for (const [peerId, peerEntry] of this.peers.entries()) {
      this.applySenderQualityParameters(peerEntry);
      if (peerEntry.sendersMap.has('screen_video')) {
        this.renegotiatePeer(peerId);
      }
    }

    this.broadcastStreamStatus();
  }

  /**
   * Inicia o compartilhamento de tela com injeção do áudio isolado WASAPI e codificação High-Bitrate
   */
  public async startScreenShare(
    screenTitle: string,
    fps: 30 | 60 = 60,
    resolution: '720p' | '1080p' | '1440p' = '1080p',
    useWasapiAudio = true,
    explicitAudioPids?: number[]
  ): Promise<MediaStream> {
    this.stopScreenShare();
    wasapiAudioBridge.resetClock();
    this.screenTitle = screenTitle;
    this.currentResolution = resolution;
    this.currentFps = fps;

    const profile = getVideoQualityProfile(resolution, fps);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('API navigator.mediaDevices.getDisplayMedia não suportada pelo navegador.');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: profile.width, max: profile.width },
        height: { ideal: profile.height, max: profile.height },
        frameRate: { ideal: fps, max: fps },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000,
      } as any,
    });

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        if ('contentHint' in videoTrack) {
          videoTrack.contentHint = 'motion';
        }
      } catch {}
    }

    const settings = (videoTrack?.getSettings?.() || {}) as any;
    this.nativeCaptureHeight = settings.height || profile.height;
    const displaySurface = settings.displaySurface;
    const label = videoTrack?.label || '';

    const isWindowChosen =
      displaySurface === 'window' || label.toLowerCase().startsWith('window:');

    if (isTauriEnvironment() && useWasapiAudio) {
      if (explicitAudioPids && explicitAudioPids.length > 0 && !(explicitAudioPids.length === 1 && explicitAudioPids[0] === 0 && isWindowChosen)) {
        try {
          await startNativeMultiProcessAudio(explicitAudioPids);
        } catch {
          await startNativeProcessAudio(0);
        }
      } else if (isWindowChosen) {
        try {
          const matchedPid = await findWindowPid(label);
          if (matchedPid && matchedPid > 0) {
            console.log(
              `[WASAPI] MODO JANELA: Processo alvo vinculado com sucesso (PID: ${matchedPid})`
            );
            await startNativeProcessAudio(matchedPid);
          } else {
            await startNativeProcessAudio(0);
          }
        } catch {
          await startNativeProcessAudio(0);
        }
      } else {
        try {
          await startNativeProcessAudio(0);
        } catch (e) {
          console.warn('[WASAPI] Erro ao iniciar captura global sem Discord:', e);
        }
      }

      stream.getAudioTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

      const wasapiAudioTrack = wasapiAudioBridge.getAudioTrack();
      if (wasapiAudioTrack) {
        wasapiAudioTrack.enabled = true;
        stream.addTrack(wasapiAudioTrack);
      }
    } else {
      // Caso utilize o áudio do navegador, desativa supressão de ruído e marca como música
      stream.getAudioTracks().forEach((track) => {
        try {
          if ('contentHint' in track) track.contentHint = 'music';
          track.applyConstraints({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as any).catch(() => {});
        } catch {}
      });
    }

    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    videoTrack.onended = () => {
      this.stopScreenShare();
    };

    this.localScreenStream = stream;
    this.isBroadcastingScreen = true;

    for (const [peerId] of this.peers.entries()) {
      this.attachTracksForPeer(peerId, 'screen');
    }

    this.broadcastStreamStatus();
    return stream;
  }

  public stopScreenShare(): void {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.nativeCaptureHeight = 0;
    wasapiAudioBridge.resetClock();
    if (isTauriEnvironment()) {
      stopNativeProcessAudio().catch(() => {});
    }
    this.isBroadcastingScreen = false;

    for (const [peerId, peerEntry] of this.peers.entries()) {
      let changed = false;
      const vSender = peerEntry.sendersMap.get('screen_video');
      if (vSender) {
        try {
          peerEntry.pc.removeTrack(vSender);
        } catch (_) {}
        peerEntry.sendersMap.delete('screen_video');
        changed = true;
      }
      const aSender = peerEntry.sendersMap.get('screen_audio');
      if (aSender) {
        try {
          peerEntry.pc.removeTrack(aSender);
        } catch (_) {}
        peerEntry.sendersMap.delete('screen_audio');
        changed = true;
      }
      if (changed) {
        this.renegotiatePeer(peerId);
      }
    }

    this.broadcastStreamStatus();
  }

  public async startWebcam(): Promise<MediaStream> {
    this.stopWebcam();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,
    });

    this.localWebcamStream = stream;
    this.isBroadcastingWebcam = true;

    for (const [peerId] of this.peers.entries()) {
      this.attachTracksForPeer(peerId, 'webcam');
    }

    this.broadcastStreamStatus();
    return stream;
  }

  public stopWebcam(): void {
    if (this.localWebcamStream) {
      this.localWebcamStream.getTracks().forEach((t) => t.stop());
      this.localWebcamStream = null;
    }
    this.isBroadcastingWebcam = false;

    for (const [peerId, peerEntry] of this.peers.entries()) {
      let changed = false;
      const vSender = peerEntry.sendersMap.get('webcam_video');
      if (vSender) {
        try {
          peerEntry.pc.removeTrack(vSender);
        } catch (_) {}
        peerEntry.sendersMap.delete('webcam_video');
        changed = true;
      }
      const aSender = peerEntry.sendersMap.get('webcam_audio');
      if (aSender) {
        try {
          peerEntry.pc.removeTrack(aSender);
        } catch (_) {}
        peerEntry.sendersMap.delete('webcam_audio');
        changed = true;
      }
      if (changed) {
        this.renegotiatePeer(peerId);
      }
    }

    this.broadcastStreamStatus();
  }

  private renegotiatePeer(peerId: string) {
    const peerEntry = this.peers.get(peerId);
    if (!peerEntry) return;
    const { pc } = peerEntry;

    if (pc.signalingState !== 'stable' || peerEntry.makingOffer) {
      peerEntry.pendingNegotiation = true;
      return;
    }

    peerEntry.makingOffer = true;
    const isFresh = peerEntry.isFreshJoinOffer;
    peerEntry.isFreshJoinOffer = false;

    this.applySenderQualityParameters(peerEntry);

    pc.createOffer()
      .then((offer) => {
        const enhancedOffer: RTCSessionDescriptionInit = {
          type: offer.type,
          sdp: this.enhanceSdpForHighQuality(offer.sdp || ''),
        };
        return pc.setLocalDescription(enhancedOffer);
      })
      .then(() => {
        this.sendWsMessage({
          type: 'webrtc_signal',
          to_peer_id: peerId,
          payload: {
            sdp: pc.localDescription,
            ...(isFresh ? { fresh_join: true } : {}),
          },
        });
      })
      .catch((err) => console.error('[WebRTC] Erro ao renegociar:', err))
      .finally(() => {
        peerEntry.makingOffer = false;
      });
  }

  private attachTracksForPeer(peerId: string, streamType: string) {
    const peerEntry = this.peers.get(peerId);
    if (!peerEntry) return;

    const type = streamType === 'webcam' ? 'webcam' : 'screen';
    this.addTracksOnly(peerEntry, type);

    if (peerEntry.initialHandshakeDone || peerEntry.pc.remoteDescription !== null) {
      this.renegotiatePeer(peerId);
    } else {
      peerEntry.pendingNegotiation = true;
    }
  }

  private broadcastStreamStatus() {
    if (!this.myPeerId) return;
    this.sendWsMessage({
      type: 'stream_status',
      peer_id: this.myPeerId,
      has_screen: this.isBroadcastingScreen,
      screen_title: this.isBroadcastingScreen ? this.screenTitle : null,
      screen_resolution: this.currentResolution,
      screen_fps: this.currentFps,
      screen_track_id: this.localScreenStream?.getVideoTracks()[0]?.id,
      has_webcam: this.isBroadcastingWebcam,
      webcam_track_id: this.localWebcamStream?.getVideoTracks()[0]?.id,
      has_isolated_audio: this.isBroadcastingScreen,
    });
  }

  private sendWsMessage(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private removePeer(peerId: string) {
    const entry = this.peers.get(peerId);
    if (entry) {
      if (entry.resetTimer) clearTimeout(entry.resetTimer);
      try {
        entry.pc.close();
      } catch {}
      this.peers.delete(peerId);
      this.emitPeersChange();
    }
  }

  private emitPeersChange() {
    const list: RemotePeer[] = Array.from(this.peers.values()).map((p) => ({ ...p.info }));
    this.callbacks.onPeersChange?.(list);
  }

  private statsInterval: any = null;
  private prevStatsMap: Map<
    string,
    { packetsLost: number; packetsReceived: number; framesDropped: number }
  > = new Map();

  public startPerformanceMonitoring() {
    if (this.statsInterval) return;
    this.statsInterval = setInterval(async () => {
      for (const [peerId, peerEntry] of this.peers.entries()) {
        try {
          if (peerEntry.pc.connectionState !== 'connected') continue;
          const stats = await peerEntry.pc.getStats();
          let rttMs = 0;
          let packetLossPct = 0;
          let fps = 0;
          let framesDroppedDelta = 0;

          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              report.state === 'succeeded' &&
              typeof report.currentRoundTripTime === 'number'
            ) {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              fps = report.framesPerSecond || 0;
              const prev = this.prevStatsMap.get(peerId);
              const lost = report.packetsLost || 0;
              const received = report.packetsReceived || 0;
              const dropped = report.framesDropped || 0;

              if (prev) {
                const deltaLost = Math.max(0, lost - prev.packetsLost);
                const deltaRecv = Math.max(0, received - prev.packetsReceived);
                const total = deltaLost + deltaRecv;
                if (total > 0) {
                  packetLossPct = Math.round((deltaLost / total) * 1000) / 10;
                }
                framesDroppedDelta = Math.max(0, dropped - prev.framesDropped);
              }

              this.prevStatsMap.set(peerId, {
                packetsLost: lost,
                packetsReceived: received,
                framesDropped: dropped,
              });
            }
          });

          if (packetLossPct > 5) {
            this.callbacks.onPerformanceLog?.({
              id: Math.random().toString(36).substring(2, 9),
              timestamp: Date.now(),
              peerId,
              userName: peerEntry.info.nickname || 'Amigo',
              type: 'warning',
              message: `Perda de pacotes elevada (${packetLossPct}%)`,
              metric: { packetLossPct, rttMs, fps },
            });
          } else if (rttMs > 180) {
            this.callbacks.onPerformanceLog?.({
              id: Math.random().toString(36).substring(2, 9),
              timestamp: Date.now(),
              peerId,
              userName: peerEntry.info.nickname || 'Amigo',
              type: 'warning',
              message: `Latência de rede elevada (${rttMs}ms ping)`,
              metric: { rttMs, packetLossPct, fps },
            });
          } else if (framesDroppedDelta > 15) {
            this.callbacks.onPerformanceLog?.({
              id: Math.random().toString(36).substring(2, 9),
              timestamp: Date.now(),
              peerId,
              userName: peerEntry.info.nickname || 'Amigo',
              type: 'warning',
              message: `Queda de quadros de vídeo detectada (${framesDroppedDelta} frames descartados)`,
              metric: { rttMs, packetLossPct, fps },
            });
          }
        } catch {
          // ignore
        }
      }
    }, 3500);
  }

  private closeWsOnly() {
    this.stopPingHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private cleanupPeersOnly() {
    this.prevStatsMap.clear();
    this.peers.forEach((p) => {
      if (p.resetTimer) clearTimeout(p.resetTimer);
      try {
        p.pc.close();
      } catch {}
    });
    this.peers.clear();
    this.emitPeersChange();
  }

  private cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.cleanupPeersOnly();
    this.stopScreenShare();
    this.stopWebcam();
    this.myPeerId = null;
    this.emitPeersChange();
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.lastWsUrl = null;
    this.lastToken = null;
    this.lastNickname = null;
    this.callbacks.onReconnectingChange?.(false, 0);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeWsOnly();
    this.cleanup();
  }
}
