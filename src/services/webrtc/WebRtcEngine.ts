/**
 * Motor WebRTC P2P com Suporte a Modo On-Demand e Túnel Cloudflare
 * Estabelece conexões ponto a ponto utilizando STUN público (Google / Cloudflare)
 * e o Servidor WebSocket de Sinalização embutido no Rust.
 */

import { wasapiAudioBridge } from './AudioBridge';
import {
  isTauriEnvironment,
  fetchSystemWindows,
  startNativeProcessAudio,
  stopNativeProcessAudio,
  findWindowPid,
} from '../tauriBridge';

import { ChatMessage, ChatAttachment } from '../../types';

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
  onError?: (err: string) => void;
  onRemoteStream?: (peerId: string, type: 'screen' | 'webcam', stream: MediaStream) => void;
  onStatsUpdate?: (stats: { rttMs: number; bytesReceived: number; bytesSent: number }) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onPerformanceLog?: (entry: PerformanceLogEntry) => void;
};

export class WebRtcEngine {
  private ws: WebSocket | null = null;
  private myPeerId: string | null = null;
  private isHost = false;
  private peers: Map<
    string,
    {
      pc: RTCPeerConnection;
      info: RemotePeer;
      dc?: RTCDataChannel;
      sendersMap: Map<string, RTCRtpSender>;
    }
  > = new Map();
  private incomingChunksMap = new Map<
    string,
    {
      chunks: string[];
      total: number;
      msg: { id: string; senderName: string; text: string; timestamp: number; attachmentMeta: any };
    }
  >();
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
  public connect(wsUrl: string, token: string, nickname: string, retryCount = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();

      console.log(`[WebRTC Engine] Conectando a: ${wsUrl} (tentativa ${retryCount + 1})`);
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e: any) {
        return reject(`Falha ao abrir WebSocket: ${e.message}`);
      }

      let connected = false;

      this.ws.onopen = () => {
        connected = true;
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
        if (!connected && retryCount < 3 && wsUrl.includes('trycloudflare')) {
          console.log(`[WebRTC Engine] Aguardando propagação do túnel Cloudflare... Tentativa ${retryCount + 1}/3`);
          setTimeout(() => {
            this.connect(wsUrl, token, nickname, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, 1500);
        } else {
          this.callbacks.onError?.('Falha na conexão de rede com o servidor de sinalização.');
          reject('Erro de conexão WebSocket');
        }
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
          (peer.info as any).webcamTrackId = msg.webcam_track_id;
          (peer.info as any).screenTrackId = msg.screen_track_id;

          if (!msg.has_screen) {
            peer.info.screenStream = undefined;
          }
          if (!msg.has_webcam) {
            peer.info.webcamStream = undefined;
          }
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

    const peerEntry = {
      pc,
      info,
      dc: undefined as RTCDataChannel | undefined,
      sendersMap: new Map<string, RTCRtpSender>(),
    };
    this.peers.set(peerId, peerEntry);

    // Pré-configura transceivers de áudio e vídeo bidirecionais para garantir SDP completo
    try {
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch (e) {
      console.warn('[WebRTC] Transceivers padrão já inicializados:', e);
    }

    // Configuração do RTCDataChannel para Chat de Texto P2P direto
    if (initiator) {
      try {
        const dc = pc.createDataChannel('streamcompanion-chat', { ordered: true });
        this.setupDataChannel(dc, peerId, peerEntry);
      } catch (err) {
        console.error(`[WebRTC] Falha ao criar DataChannel para peer ${peerId}:`, err);
      }
    }

    pc.ondatachannel = (event) => {
      console.log(`[WebRTC] DataChannel recebido do peer ${peerId}:`, event.channel.label);
      this.setupDataChannel(event.channel, peerId, peerEntry);
    };

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

      if (pc.connectionState === 'connected') {
        this.callbacks.onPerformanceLog?.({
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          peerId,
          userName: info.nickname || 'Amigo',
          type: 'info',
          message: 'Túnel P2P direto WebRTC estabelecido.',
        });
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.callbacks.onPerformanceLog?.({
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          peerId,
          userName: info.nickname || 'Amigo',
          type: 'error',
          message: `Conexão P2P com instabilidade (${pc.connectionState}).`,
        });
      }
    };

    // Se já estivermos transmitindo tela ou webcam, anexa faixas via senders dedicados
    if (this.isBroadcastingScreen && this.localScreenStream) {
      this.attachTracksForPeer(peerId, 'screen');
    }
    if (this.isBroadcastingWebcam && this.localWebcamStream) {
      this.attachTracksForPeer(peerId, 'webcam');
    }

    // Recepção de Streams de Vídeo e Áudio com separação de Tela vs Webcam
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Faixa recebida do peer ${peerId}: ${event.track.kind} (${event.track.id})`);

      const streamId = event.streams[0]?.id || '';
      const isWebcam =
        streamId.toLowerCase().includes('webcam') ||
        event.track.id === (info as any).webcamTrackId;

      if (isWebcam) {
        if (!info.webcamStream) {
          info.webcamStream = new MediaStream();
        }
        if (!info.webcamStream.getTracks().some((t) => t.id === event.track.id)) {
          info.webcamStream.addTrack(event.track);
          info.webcamStream = new MediaStream(info.webcamStream.getTracks());
        }
        info.hasWebcam = true;
        this.callbacks.onRemoteStream?.(peerId, 'webcam', info.webcamStream);
      } else {
        if (!info.screenStream) {
          info.screenStream = new MediaStream();
        }
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
        this.callbacks.onRemoteStream?.(peerId, 'screen', info.screenStream);
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

  private setupDataChannel(
    dc: RTCDataChannel,
    peerId: string,
    peerEntry: { pc: RTCPeerConnection; info: RemotePeer; dc?: RTCDataChannel; sendersMap: Map<string, RTCRtpSender> }
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
          const { msgId, chunkIndex, totalChunks, chunkData, senderName, text, timestamp, attachmentMeta } = data;
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

  /**
   * Envia uma mensagem de texto e/ou anexo (imagem/arquivo) via WebRTC P2P DataChannel para todos os peers conectados
   */
  public sendChatMessage(text: string, senderName: string, attachment?: ChatAttachment): ChatMessage {
    const trimmed = text.trim();
    if (!trimmed && !attachment) {
      throw new Error('A mensagem ou o arquivo anexado não pode ser vazio.');
    }

    if (this.peers.size === 0) {
      throw new Error('Não há outros participantes na sala no momento. Aguarde alguém entrar com o Código da Sala.');
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

    // Se houver anexo, faz envio fragmentado (chunks de 16KB) para evitar limites de buffer do RTCDataChannel
    if (attachment && attachment.dataUrl) {
      const CHUNK_SIZE = 16 * 1024;
      const dataUrl = attachment.dataUrl;
      const totalChunks = Math.ceil(dataUrl.length / CHUNK_SIZE);

      for (const [peerId, peerEntry] of this.peers.entries()) {
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
    const { msgId, senderName, text, timestamp, attachmentMeta, dataUrl, totalChunks, chunkSize } = payload;
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

      // Se o buffer do canal estiver cheio (>64KB), aguarda liberar para não estourar SCTP
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
    wasapiAudioBridge.resetClock();
    this.screenTitle = screenTitle;

    const width = resolution === '1440p' ? 2560 : resolution === '1080p' ? 1920 : 1280;
    const height = resolution === '1440p' ? 1440 : resolution === '1080p' ? 1080 : 720;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('API navigator.mediaDevices.getDisplayMedia não suportada pelo navegador.');
    }

    // Solicita o seletor nativo de tela ou janela com captura de áudio habilitada
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: fps, max: fps },
      },
      audio: true, // Habilita áudio de janela e sistema nativo
    });

    const videoTrack = stream.getVideoTracks()[0];
    const settings = (videoTrack?.getSettings?.() || {}) as any;
    const displaySurface = settings.displaySurface; // 'window' ou 'monitor'
    const label = videoTrack?.label || '';

    // Auto-detecta se o usuário selecionou uma JANELA ou TELA INTEIRA
    const isWindowChosen = displaySurface === 'window' || label.toLowerCase().startsWith('window:');

    if (isTauriEnvironment() && useWasapiAudio) {
      if (isWindowChosen) {
        // MODO JANELA: Localiza o PID da janela selecionada para isolar 100% o áudio dela
        try {
          const matchedPid = await findWindowPid(label);
          if (matchedPid && matchedPid > 0) {
            console.log(`[WASAPI] MODO JANELA: Processo alvo vinculado com sucesso (PID: ${matchedPid})`);
            await startNativeProcessAudio(matchedPid);
          } else {
            console.log('[WASAPI] MODO JANELA: PID não resolvido diretamente, usando exclusão do Discord');
            await startNativeProcessAudio(0);
          }
        } catch (e) {
          console.warn('[WASAPI] Erro ao identificar janela:', e);
          await startNativeProcessAudio(0);
        }
      } else {
        // MODO TELA COMPLETA: Envia áudio completo do PC EXCLUINDO o Discord
        console.log('[WASAPI] MODO TELA: Capturando áudio completo do PC com exclusão total do Discord');
        try {
          await startNativeProcessAudio(0);
        } catch (e) {
          console.warn('[WASAPI] Erro ao iniciar captura global sem Discord:', e);
        }
      }

      // CRÍTICO: Remove as faixas de áudio não filtradas do navegador (que capturam áudio bruto de tudo)
      stream.getAudioTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

      // Injeta a faixa de áudio WASAPI filtrada (ou somente da janela ou do PC sem Discord)
      const wasapiAudioTrack = wasapiAudioBridge.getAudioTrack();
      if (wasapiAudioTrack) {
        wasapiAudioTrack.enabled = true;
        stream.addTrack(wasapiAudioTrack);
        console.log('[WebRTC Engine] Trilha de áudio WASAPI isolada/filtrada injetada com sucesso no MediaStream');
      }
    }

    // Habilita e valida todas as faixas de áudio presentes no stream
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      console.log(`[WebRTC Engine] Áudio ativado: [${track.kind}] label='${track.label}', id='${track.id}'`);
    });

    videoTrack.onended = () => {
      this.stopScreenShare();
    };

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
    wasapiAudioBridge.resetClock();
    if (isTauriEnvironment()) {
      stopNativeProcessAudio().catch(() => {});
    }
    this.isBroadcastingScreen = false;

    // Remove os senders de tela dos peers sem afetar a webcam
    for (const [peerId, peerEntry] of this.peers.entries()) {
      let changed = false;
      const vSender = peerEntry.sendersMap.get('screen_video');
      if (vSender) {
        try { peerEntry.pc.removeTrack(vSender); } catch (_) {}
        peerEntry.sendersMap.delete('screen_video');
        changed = true;
      }
      const aSender = peerEntry.sendersMap.get('screen_audio');
      if (aSender) {
        try { peerEntry.pc.removeTrack(aSender); } catch (_) {}
        peerEntry.sendersMap.delete('screen_audio');
        changed = true;
      }
      if (changed) {
        this.renegotiatePeer(peerId);
      }
    }

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

    // Remove os senders de webcam dos peers sem afetar a tela
    for (const [peerId, peerEntry] of this.peers.entries()) {
      let changed = false;
      const vSender = peerEntry.sendersMap.get('webcam_video');
      if (vSender) {
        try { peerEntry.pc.removeTrack(vSender); } catch (_) {}
        peerEntry.sendersMap.delete('webcam_video');
        changed = true;
      }
      const aSender = peerEntry.sendersMap.get('webcam_audio');
      if (aSender) {
        try { peerEntry.pc.removeTrack(aSender); } catch (_) {}
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
    if (pc.signalingState === 'stable') {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          this.sendWsMessage({
            type: 'webrtc_signal',
            to_peer_id: peerId,
            payload: { sdp: pc.localDescription },
          });
        })
        .catch((err) => console.error('[WebRTC] Erro ao renegociar:', err));
    }
  }

  private attachTracksForPeer(peerId: string, streamType: string) {
    const peerEntry = this.peers.get(peerId);
    if (!peerEntry) return;
    const { pc, sendersMap } = peerEntry;

    const stream = streamType === 'webcam' ? this.localWebcamStream : this.localScreenStream;
    if (!stream) return;

    let needsRenegotiation = false;

    stream.getTracks().forEach((track) => {
      track.enabled = true;
      const key = `${streamType}_${track.kind}`;
      const existingSender = sendersMap.get(key);

      if (existingSender) {
        existingSender.replaceTrack(track).catch((err) => {
          console.warn(`[WebRTC] replaceTrack falhou para ${key}:`, err);
        });
      } else {
        try {
          const sender = pc.addTrack(track, stream);
          sendersMap.set(key, sender);
          needsRenegotiation = true;
        } catch (err) {
          console.warn(`[WebRTC] pc.addTrack falhou para ${key}:`, err);
        }
      }
    });

    if (needsRenegotiation || pc.signalingState === 'stable') {
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
  }

  private broadcastStreamStatus() {
    if (!this.myPeerId) return;
    this.sendWsMessage({
      type: 'stream_status',
      peer_id: this.myPeerId,
      has_screen: this.isBroadcastingScreen,
      screen_title: this.isBroadcastingScreen ? this.screenTitle : null,
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
      entry.pc.close();
      this.peers.delete(peerId);
      this.emitPeersChange();
    }
  }

  private emitPeersChange() {
    const list: RemotePeer[] = Array.from(this.peers.values()).map((p) => p.info);
    this.callbacks.onPeersChange?.(list);
  }

  private statsInterval: any = null;
  private prevStatsMap: Map<string, { packetsLost: number; packetsReceived: number; framesDropped: number }> = new Map();

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
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
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

          // Notifica se houver problemas de performance
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

  private cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.prevStatsMap.clear();
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
}
