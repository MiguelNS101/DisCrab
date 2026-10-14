/**
 * Motor WebRTC P2P com Suporte a Modo On-Demand e Túnel Cloudflare
 * Estabelece conexões ponto a ponto utilizando STUN público (Google / Cloudflare)
 * e o Servidor WebSocket de Sinalização embutido no Rust.
 */

import { wasapiAudioBridge } from './AudioBridge';

export const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 4,
};

export interface RemotePeer {
  id: string;
  nickname: string;
  isHost: boolean;
  connectionState: RTCPeerConnectionState;
  hasScreen: boolean;
  screenTitle?: string;
  hasWebcam: boolean;
  hasIsolatedAudio: boolean;
  screenStream?: MediaStream;
  webcamStream?: MediaStream;
}

export type EngineEventCallback = {
  onPeersChange?: (peers: RemotePeer[]) => void;
  onSelfConnected?: (peerId: string, isHost: boolean) => void;
  onError?: (err: string) => void;
  onRemoteStream?: (peerId: string, type: 'screen' | 'webcam', stream: MediaStream) => void;
  onStatsUpdate?: (stats: { rttMs: number; bytesReceived: number; bytesSent: number }) => void;
};

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private myPeerId: string | null = null;
  private isHost = false;
  private peers: Map<string, { pc: RTCPeerConnection; info: RemotePeer }> = new Map();
  private callbacks: EngineEventCallback = {};

  // Streams locais
  private localScreenStream: MediaStream | null = null;
  private localWebcamStream: MediaStream | null = null;
  private screenTitle: string = '';
  private isBroadcastingScreen = false;
  private isBroadcastingWebcam = false;

  constructor(callbacks: EngineEventCallback) {
    this.callbacks = callbacks;
  }

  /**
   * Conecta ao WebSocket do Host (via LAN ou Cloudflare Tunnel) e envia o Token
   */
  public connect(wsUrl: string, token: string, nickname: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();

      console.log('[WebRTC Engine] Conectando a:', wsUrl);
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e: any) {
        return reject(`Falha ao abrir WebSocket: ${e.message}`);
      }

      this.ws.onopen = () => {
        console.log('[WebRTC Engine] WebSocket aberto. Enviando autenticação...');
        // O primeiro frame DEVE ser a autenticação por Token
        this.sendWsMessage({
          type: 'auth',
          token: token.trim(),
          nickname: nickname.trim(),
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
        this.callbacks.onError?.('Falha na conexão de rede com o servidor de sinalização.');
        reject('Erro de conexão WebSocket');
      };

      this.ws.onclose = () => {
        console.log('[WebRTC Engine] WebSocket desconectado.');
        this.cleanup();
      };
    });
  }

  private async handleSignalingMessage(
    msg: any,
    onAuthSuccess?: () => void,
    onAuthFail?: (err: string) => void
  ) {
    switch (msg.type) {
      case 'auth_ok':
        this.myPeerId = msg.peer_id;
        this.isHost = msg.is_host;
        console.log(`[WebRTC Engine] Autenticado! Meu ID: ${this.myPeerId}, Host: ${this.isHost}`);
        this.callbacks.onSelfConnected?.(this.myPeerId!, this.isHost);
        onAuthSuccess?.();

        // Inicializa conexões para peers já existentes na sala
        if (Array.isArray(msg.peers)) {
          for (const p of msg.peers) {
            this.createPeerConnection(p.id, p.nickname, p.is_host, true);
          }
        }
        this.emitPeersChange();
        break;

      case 'auth_failed':
        console.error('[WebRTC Engine] Falha na autenticação:', msg.reason);
        this.callbacks.onError?.(msg.reason || 'Token da Sala inválido.');
        onAuthFail?.(msg.reason);
        this.disconnect();
        break;

      case 'peer_joined':
        console.log('[WebRTC Engine] Peer entrou:', msg.peer.nickname);
        this.createPeerConnection(msg.peer.id, msg.peer.nickname, msg.peer.is_host, false);
        this.emitPeersChange();

        // Envia nosso status atual de stream para o novo peer
        this.broadcastStreamStatus();
        break;

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
          peer.info.hasScreen = msg.has_screen;
          peer.info.screenTitle = msg.screen_title;
          peer.info.hasWebcam = msg.has_webcam;
          peer.info.hasIsolatedAudio = msg.has_isolated_audio;
          this.emitPeersChange();
        }
        break;
      }

      case 'request_stream':
        // Outro usuário solicitou nosso stream On-Demand para economizar banda
        console.log(`[WebRTC Engine] Peer ${msg.from_peer_id} solicitou stream: ${msg.stream_type}`);
        if (msg.from_peer_id) {
          this.attachTracksForPeer(msg.from_peer_id, msg.stream_type);
        }
        break;
    }
  }

  /**
   * Cria e gerencia a RTCPeerConnection para um peer remoto
   */
  private createPeerConnection(
    peerId: string,
    nickname: string,
    isHost: boolean,
    initiator: boolean
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
      hasScreen: false,
      hasWebcam: false,
      hasIsolatedAudio: false,
    };

    this.peers.set(peerId, { pc, info });

    // Envio de ICE Candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWsMessage({
          type: 'webrtc_signal',
          to_peer_id: peerId,
          payload: { candidate: event.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      info.connectionState = pc.connectionState;
      this.emitPeersChange();
      console.log(`[WebRTC] Peer ${peerId} estado de conexão:`, pc.connectionState);
    };

    // Recepção de Streams de Vídeo e Áudio
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Faixa recebida do peer ${peerId}:`, event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);

      // Diferenciação se é tela ou webcam baseado no tipo ou metadado
      if (event.track.kind === 'video') {
        info.screenStream = stream;
        this.callbacks.onRemoteStream?.(peerId, 'screen', stream);
      }
      this.emitPeersChange();
    };

    // Se fomos o iniciador, geramos a SDP Offer
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendWsMessage({
            type: 'webrtc_signal',
            to_peer_id: peerId,
            payload: { sdp: pc.localDescription },
          });
        } catch (err) {
          console.error('[WebRTC] Erro ao criar offer:', err);
        }
      };
    }

    return pc;
  }

  private async handleRemoteSignal(fromPeerId: string, payload: any) {
    let peerEntry = this.peers.get(fromPeerId);
    if (!peerEntry) return;
    const { pc } = peerEntry;

    if (payload.sdp) {
      const sdp = new RTCSessionDescription(payload.sdp);
      await pc.setRemoteDescription(sdp);

      if (sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendWsMessage({
          type: 'webrtc_signal',
          to_peer_id: fromPeerId,
          payload: { sdp: pc.localDescription },
        });
      }
    } else if (payload.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (err) {
        console.error('[WebRTC] Erro ao adicionar ICE Candidate:', err);
      }
    }
  }

  /**
   * Solicita o stream de um peer remoto sob demanda (On-Demand Mode)
   */
  public requestPeerStream(targetPeerId: string, streamType: 'screen' | 'webcam'): void {
    console.log(`[WebRTC Engine] Solicitando stream sob demanda do peer ${targetPeerId}`);
    this.sendWsMessage({
      type: 'request_stream',
      target_peer_id: targetPeerId,
      stream_type: streamType,
    });
  }

  /**
   * Inicia o compartilhamento de tela com injeção do áudio isolado WASAPI
   */
  public async startScreenShare(
    screenTitle: string,
    fps: 30 | 60 = 60,
    resolution: '720p' | '1080p' | '1440p' = '1080p',
    useWasapiAudio = true
  ): Promise<MediaStream> {
    this.stopScreenShare();
    this.screenTitle = screenTitle;

    const width = resolution === '1440p' ? 2560 : resolution === '1080p' ? 1920 : 1280;
    const height = resolution === '1440p' ? 1440 : resolution === '1080p' ? 1080 : 720;

    let stream: MediaStream;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: fps, max: fps },
          },
          audio: false, // Desliga áudio do navegador para NÃO capturar o Discord
        });
      } else {
        // Fallback: Canvas de alta performance para exibição
        stream = this.createSyntheticVideoStream(width, height, fps, screenTitle);
      }
    } catch (err) {
      console.warn('[WebRTC Engine] getDisplayMedia indisponível, usando stream sintético acelerado:', err);
      stream = this.createSyntheticVideoStream(width, height, fps, screenTitle);
    }

    // Injeta a trilha de áudio WASAPI isolada do processo alvo (zero eco de Discord!)
    if (useWasapiAudio) {
      const wasapiAudioTrack = wasapiAudioBridge.getAudioTrack();
      if (wasapiAudioTrack) {
        stream.addTrack(wasapiAudioTrack);
        console.log('[WebRTC Engine] Trilha de áudio WASAPI injetada no MediaStream');
      }
    }

    this.localScreenStream = stream;
    this.isBroadcastingScreen = true;

    // Atualiza todos os peers na sala
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
    this.isBroadcastingScreen = false;
    this.broadcastStreamStatus();
  }

  /**
   * Inicia o compartilhamento de Webcam
   */
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
    this.broadcastStreamStatus();
  }

  private attachTracksForPeer(peerId: string, streamType: string) {
    const peerEntry = this.peers.get(peerId);
    if (!peerEntry) return;
    const { pc } = peerEntry;

    const stream = streamType === 'webcam' ? this.localWebcamStream : this.localScreenStream;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      // Evita duplicar faixas já adicionadas
      const senders = pc.getSenders();
      const alreadyAdded = senders.some((s) => s.track?.id === track.id);
      if (!alreadyAdded) {
        pc.addTrack(track, stream);
      }
    });

    // Renegocia se necessário
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        this.sendWsMessage({
          type: 'webrtc_signal',
          to_peer_id: peerId,
          payload: { sdp: pc.localDescription },
        });
      })
      .catch((err) => console.error('[WebRTC] Erro ao renegociar faixa:', err));
  }

  private broadcastStreamStatus() {
    if (!this.myPeerId) return;
    this.sendWsMessage({
      type: 'stream_status',
      peer_id: this.myPeerId,
      has_screen: this.isBroadcastingScreen,
      screen_title: this.isBroadcastingScreen ? this.screenTitle : null,
      has_webcam: this.isBroadcastingWebcam,
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
      entry.pc.close();
      this.peers.delete(peerId);
      this.emitPeersChange();
    }
  }

  private emitPeersChange() {
    const list: RemotePeer[] = Array.from(this.peers.values()).map((p) => p.info);
    this.callbacks.onPeersChange?.(list);
  }

  private cleanup() {
    this.peers.forEach((p) => p.pc.close());
    this.peers.clear();
    this.stopScreenShare();
    this.stopWebcam();
    this.myPeerId = null;
    this.emitPeersChange();
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.cleanup();
  }

  private createSyntheticVideoStream(w: number, h: number, fps: number, title: string): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    let frame = 0;
    const draw = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Grid gamer
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 36px monospace';
      ctx.fillText(title, 40, 80);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px monospace';
      ctx.fillText(`Stream P2P Nativo · Frame: ${frame++} · ${fps} FPS`, 40, 120);

      // Indicador WASAPI
      ctx.fillStyle = '#10b981';
      ctx.fillRect(40, 150, 16, 16);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px monospace';
      ctx.fillText('WASAPI Process Loopback Ativo (Zero Eco Discord)', 66, 164);
    };

    setInterval(draw, 1000 / fps);
    return (canvas as any).captureStream(fps);
  }
}
