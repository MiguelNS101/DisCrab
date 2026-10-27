/**
 * Motor de Sinalização P2P Mesh Criptografado (Salas Fixas por Nome + Senha)
 *
 * Permite que múltiplos amigos entrem na mesma sala usando apenas um Nome de Sala e Senha fixos,
 * sem precisar gerar ou trocar códigos novos a cada sessão e sem depender de quem criou a sala.
 *
 * - Criptografia Ponta-a-Ponta (AES-256-GCM via Web Crypto API) derivada de (Nome da Sala + Senha).
 * - Multi-transporte redundante em paralelo:
 *   1. Brokers públicos MQTT-over-WSS (EMQX, HiveMQ, Mosquitto) em binário nativo zero-dependência
 *   2. Relay WebSocket do próprio servidor (/ws) quando disponível
 *   3. BroadcastChannel local para descoberta instantânea na mesma máquina
 * - Todo o tráfego de vídeo, áudio WASAPI e chat continua fluindo 100% P2P direto via WebRTC.
 */

const PUBLIC_MQTT_WSS_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

interface EncryptedMeshEnvelope {
  v: 1;
  id: string;
  topic: string;
  from: string;
  to?: string;
  iv: string;
  ct: string;
}

interface DecryptedMeshPacket {
  magic: 'SC_MESH_V1';
  ts: number;
  sessionEpoch: string;
  fromPeerId: string;
  fromNickname: string;
  inner: any;
}

interface KnownMeshPeer {
  peerId: string;
  nickname: string;
  sessionEpoch: string;
  lastSeen: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Codifica tamanho variável no padrão MQTT v3.1.1
 */
function encodeMqttRemainingLength(len: number): number[] {
  const out: number[] = [];
  let x = len;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) {
      encodedByte = encodedByte | 128;
    }
    out.push(encodedByte);
  } while (x > 0);
  return out;
}

function encodeMqttUtf8(str: string): Uint8Array {
  const utf8 = new TextEncoder().encode(str);
  const res = new Uint8Array(2 + utf8.length);
  res[0] = (utf8.length >> 8) & 0xff;
  res[1] = utf8.length & 0xff;
  res.set(utf8, 2);
  return res;
}

function buildMqttConnectPacket(clientId: string): Uint8Array {
  const protoName = encodeMqttUtf8('MQTT');
  const clientIdBytes = encodeMqttUtf8(clientId);
  // Variable header: Protocol Name (6) + Protocol Level 4 (1) + Connect Flags CleanSession=0x02 (1) + KeepAlive=45s (2)
  const varHeaderLen = protoName.length + 1 + 1 + 2;
  const remainingLen = varHeaderLen + clientIdBytes.length;
  const remBytes = encodeMqttRemainingLength(remainingLen);

  const pkt = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  pkt[offset++] = 0x10; // CONNECT
  for (const b of remBytes) pkt[offset++] = b;
  pkt.set(protoName, offset);
  offset += protoName.length;
  pkt[offset++] = 0x04; // MQTT v3.1.1
  pkt[offset++] = 0x02; // Clean Session
  pkt[offset++] = 0x00;
  pkt[offset++] = 45; // Keep Alive 45s
  pkt.set(clientIdBytes, offset);
  return pkt;
}

function buildMqttSubscribePacket(topic: string, packetId = 1): Uint8Array {
  const topicBytes = encodeMqttUtf8(topic);
  const remainingLen = 2 + topicBytes.length + 1; // Packet ID (2) + Topic + QoS 0 (1)
  const remBytes = encodeMqttRemainingLength(remainingLen);

  const pkt = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  pkt[offset++] = 0x82; // SUBSCRIBE
  for (const b of remBytes) pkt[offset++] = b;
  pkt[offset++] = (packetId >> 8) & 0xff;
  pkt[offset++] = packetId & 0xff;
  pkt.set(topicBytes, offset);
  offset += topicBytes.length;
  pkt[offset++] = 0x00; // QoS 0
  return pkt;
}

function buildMqttPublishPacket(topic: string, payloadStr: string): Uint8Array {
  const topicBytes = encodeMqttUtf8(topic);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const remainingLen = topicBytes.length + payloadBytes.length;
  const remBytes = encodeMqttRemainingLength(remainingLen);

  const pkt = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  pkt[offset++] = 0x30; // PUBLISH QoS 0
  for (const b of remBytes) pkt[offset++] = b;
  pkt.set(topicBytes, offset);
  offset += topicBytes.length;
  pkt.set(payloadBytes, offset);
  return pkt;
}

const MQTT_PINGREQ_PACKET = new Uint8Array([0xc0, 0x00]);

/**
 * Cliente leve MQTT v3.1.1 sobre WebSocket para um broker individual
 */
class LightMqttWsClient {
  private ws: WebSocket | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private pingTimer: any = null;
  private reconnectTimer: any = null;
  private closedManually = false;
  private isMqttConnected = false;

  constructor(
    private brokerUrl: string,
    private topic: string,
    private clientId: string,
    private onPayload: (text: string) => void,
    private onReady: () => void
  ) {
    this.connect();
  }

  private connect() {
    if (this.closedManually) return;
    this.cleanupSocket();

    try {
      this.ws = new WebSocket(this.brokerUrl, 'mqtt');
      this.ws.binaryType = 'arraybuffer';
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(buildMqttConnectPacket(this.clientId) as unknown as BufferSource);
      } catch {}
    };

    this.ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const incoming = new Uint8Array(ev.data);
      const merged = new Uint8Array(this.buffer.length + incoming.length);
      merged.set(this.buffer, 0);
      merged.set(incoming, this.buffer.length);
      this.buffer = merged;
      this.parsePackets();
    };

    this.ws.onerror = () => {
      // Silencioso: temos múltiplos brokers em paralelo
    };

    this.ws.onclose = () => {
      this.isMqttConnected = false;
      if (!this.closedManually) {
        this.scheduleReconnect();
      }
    };
  }

  private parsePackets() {
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const pktType = byte0 & 0xf0;

      // Decodifica Remaining Length
      let multiplier = 1;
      let value = 0;
      let idx = 1;
      let encodedByte = 0;
      let completeLength = false;

      do {
        if (idx >= this.buffer.length) {
          return; // aguarda mais bytes do frame TCP/WS
        }
        encodedByte = this.buffer[idx++];
        value += (encodedByte & 127) * multiplier;
        multiplier *= 128;
        if (multiplier > 128 * 128 * 128) {
          // Buffer corrompido
          this.buffer = new Uint8Array(0);
          return;
        }
        if ((encodedByte & 128) === 0) {
          completeLength = true;
        }
      } while (!completeLength);

      const totalPktLen = idx + value;
      if (this.buffer.length < totalPktLen) {
        return; // pacote incompleto, aguarda próximo chunk
      }

      const pktBody = this.buffer.slice(idx, totalPktLen);
      this.buffer = this.buffer.slice(totalPktLen);

      if (pktType === 0x20) {
        // CONNACK
        this.isMqttConnected = true;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(buildMqttSubscribePacket(this.topic, 1) as unknown as BufferSource);
          } catch {}
        }
        this.startPing();
        this.onReady();
      } else if (pktType === 0x30) {
        // PUBLISH
        if (pktBody.length < 2) continue;
        const topicLen = (pktBody[0] << 8) | pktBody[1];
        const qos = (byte0 & 0x06) >> 1;
        const headerOffset = 2 + topicLen + (qos > 0 ? 2 : 0);
        if (pktBody.length >= headerOffset) {
          const payloadBytes = pktBody.slice(headerOffset);
          try {
            const str = new TextDecoder().decode(payloadBytes);
            this.onPayload(str);
          } catch {}
        }
      }
    }
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isMqttConnected) {
        try {
          this.ws.send(MQTT_PINGREQ_PACKET);
        } catch {}
      }
    }, 22000);
  }

  private scheduleReconnect() {
    if (this.closedManually || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  public publish(payloadStr: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isMqttConnected) {
      return false;
    }
    try {
      this.ws.send(buildMqttPublishPacket(this.topic, payloadStr) as unknown as BufferSource);
      return true;
    } catch {
      return false;
    }
  }

  private cleanupSocket() {
    this.isMqttConnected = false;
    this.buffer = new Uint8Array(0);
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  public close() {
    this.closedManually = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
  }
}

export class MeshRoomSignaling {
  private myPeerId: string;
  private sessionEpoch: string;
  private roomName: string = '';
  private password: string = '';
  private nickname: string = '';
  private topicHash: string = '';
  private mqttTopic: string = '';
  private aesKey: CryptoKey | null = null;

  private mqttClients: LightMqttWsClient[] = [];
  private localServerWs: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  private seenPacketIds: Set<string> = new Set();
  private knownPeers: Map<string, KnownMeshPeer> = new Map();
  private cachedStreamStatus: any = null;

  private heartbeatTimer: any = null;
  private fastHelloTimers: any[] = [];
  private closed = false;
  private lastWrongPasswordAlertAt = 0;

  constructor(
    clientId: string,
    private onSignalingMessage: (msg: any) => void,
    private onError?: (err: string) => void
  ) {
    const cleanId = clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    this.myPeerId = `peer-${cleanId || Math.random().toString(36).substring(2, 10)}`;
    this.sessionEpoch = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  }

  public async connect(roomName: string, password: string, nickname: string): Promise<void> {
    this.closed = false;
    this.roomName = roomName.trim().toLowerCase();
    this.password = password.trim();
    this.nickname = nickname.trim() || 'Jogador';

    // 1. Deriva o identificador público do tópico (baseado no nome da sala) e a chave AES-256-GCM (baseada em nome + senha)
    const enc = new TextEncoder();
    const topicDigest = await crypto.subtle.digest(
      'SHA-256',
      enc.encode(`streamcompanion-mesh-topic-v1:${this.roomName}`)
    );
    this.topicHash = bytesToHex(new Uint8Array(topicDigest)).slice(0, 32);
    this.mqttTopic = `sc-mesh-v1/${this.topicHash}`;

    const keyMaterialDigest = await crypto.subtle.digest(
      'SHA-256',
      enc.encode(`streamcompanion-mesh-key-v1:${this.roomName}:${this.password}`)
    );
    this.aesKey = await crypto.subtle.importKey(
      'raw',
      keyMaterialDigest,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    // 2. Canal instantâneo entre abas/janelas na mesma máquina
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`sc_mesh_${this.topicHash}`);
        this.broadcastChannel.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            this.handleRawEnvelope(ev.data);
          }
        };
      }
    } catch {}

    // 3. Relay WebSocket local/servidor web quando aplicável
    this.setupOptionalServerRelay();

    // 4. Conecta simultaneamente aos brokers MQTT sobre WSS públicos para alcance global sem cloudflared
    let resolved = false;
    await new Promise<void>((resolve) => {
      const completeOnce = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      PUBLIC_MQTT_WSS_BROKERS.forEach((brokerUrl, index) => {
        const mqttClientId = `sc_${this.myPeerId.slice(-10)}_${index}_${Math.random()
          .toString(36)
          .substring(2, 6)}`;
        const client = new LightMqttWsClient(
          brokerUrl,
          this.mqttTopic,
          mqttClientId,
          (rawText) => this.handleRawEnvelope(rawText),
          () => {
            completeOnce();
            // Assim que cada broker conecta, anuncia presença para descobrir amigos imediatamente
            this.sendHello(true);
          }
        );
        this.mqttClients.push(client);
      });

      // Fallback rápido caso a rede esteja em LAN/BroadcastChannel ou brokers demorem > 1.2s
      setTimeout(completeOnce, 1200);
    });

    if (this.closed) return;

    // 5. Notifica o WebRtcEngine que estamos autenticados na Sala Mesh
    this.onSignalingMessage({
      type: 'auth_ok',
      peer_id: this.myPeerId,
      is_host: true,
      peers: [],
    });

    // 6. Dispara anúncios iniciais rápidos e mantém heartbeat leve
    this.sendHello(true);
    this.fastHelloTimers.push(setTimeout(() => this.sendHello(true), 700));
    this.fastHelloTimers.push(setTimeout(() => this.sendHello(true), 2200));

    this.heartbeatTimer = setInterval(() => {
      if (!this.closed) {
        this.sendHello(false);
      }
    }, 5000);
  }

  private setupOptionalServerRelay() {
    if (typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!window.location.host) return;
    const wsUrl = `${proto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      this.localServerWs = ws;
      ws.onopen = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'mesh_sub',
              topic: this.topicHash,
            })
          );
          this.sendHello(true);
        }
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'mesh_pkt' && typeof data.envelope === 'string') {
            this.handleRawEnvelope(data.envelope);
          }
        } catch {}
      };
      ws.onerror = () => {};
    } catch {}
  }

  /**
   * Recebe mensagens geradas pelo WebRtcEngine (webrtc_signal, stream_status, request_stream)
   * e as transmite criptografadas pela malha P2P
   */
  public async sendFromEngine(msg: any): Promise<void> {
    if (this.closed || !msg) return;

    if (msg.type === 'ping') return;

    if (msg.type === 'stream_status') {
      this.cachedStreamStatus = msg;
      await this.publishEncrypted(msg, undefined);
      return;
    }

    if (msg.type === 'webrtc_signal') {
      await this.publishEncrypted(
        {
          type: 'webrtc_signal',
          from_peer_id: this.myPeerId,
          payload: msg.payload,
        },
        msg.to_peer_id
      );
      return;
    }

    if (msg.type === 'request_stream') {
      await this.publishEncrypted(
        {
          type: 'request_stream',
          from_peer_id: this.myPeerId,
          stream_type: msg.stream_type,
        },
        msg.target_peer_id
      );
      return;
    }
  }

  private buildMyPeerSummary() {
    const st = this.cachedStreamStatus || {};
    return {
      id: this.myPeerId,
      nickname: this.nickname,
      is_host: false,
      has_screen: !!st.has_screen,
      screen_title: st.screen_title ?? null,
      screen_resolution: st.screen_resolution || '1080p',
      screen_fps: st.screen_fps || 60,
      screen_track_id: st.screen_track_id,
      screen_audio_track_id: st.screen_audio_track_id,
      screen_stream_id: st.screen_stream_id,
      has_webcam: !!st.has_webcam,
      webcam_track_id: st.webcam_track_id,
      media_sources: Array.isArray(st.media_sources) ? st.media_sources : [],
      has_isolated_audio: !!st.has_isolated_audio,
    };
  }

  private async sendHello(replyNeeded: boolean, targetPeerId?: string) {
    if (this.closed) return;
    await this.publishEncrypted(
      {
        type: 'mesh_hello',
        reply_needed: replyNeeded,
        peer: this.buildMyPeerSummary(),
      },
      targetPeerId
    );
  }

  private async publishEncrypted(inner: any, targetPeerId?: string): Promise<void> {
    if (this.closed || !this.aesKey) return;

    const clearPacket: DecryptedMeshPacket = {
      magic: 'SC_MESH_V1',
      ts: Date.now(),
      sessionEpoch: this.sessionEpoch,
      fromPeerId: this.myPeerId,
      fromNickname: this.nickname,
      inner,
    };

    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedClear = new TextEncoder().encode(JSON.stringify(clearPacket));
      const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.aesKey,
        encodedClear
      );

      const envelope: EncryptedMeshEnvelope = {
        v: 1,
        id: `${this.myPeerId}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
        topic: this.topicHash,
        from: this.myPeerId,
        to: targetPeerId,
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(cipherBuffer)),
      };

      this.rememberPacketId(envelope.id);
      const rawEnvelope = JSON.stringify(envelope);

      // Envia em todos os transportes ativos em paralelo
      for (const client of this.mqttClients) {
        client.publish(rawEnvelope);
      }

      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(rawEnvelope);
        } catch {}
      }

      if (this.localServerWs && this.localServerWs.readyState === WebSocket.OPEN) {
        try {
          this.localServerWs.send(
            JSON.stringify({
              type: 'mesh_pub',
              topic: this.topicHash,
              envelope: rawEnvelope,
            })
          );
        } catch {}
      }
    } catch (err) {
      console.warn('[MeshSignaling] Erro ao criptografar/publicar pacote:', err);
    }
  }

  private rememberPacketId(id: string): boolean {
    if (this.seenPacketIds.has(id)) return false;
    this.seenPacketIds.add(id);
    if (this.seenPacketIds.size > 600) {
      const first = this.seenPacketIds.values().next().value;
      if (first) this.seenPacketIds.delete(first);
    }
    return true;
  }

  private async handleRawEnvelope(rawText: string) {
    if (this.closed || !this.aesKey) return;

    let env: EncryptedMeshEnvelope;
    try {
      env = JSON.parse(rawText);
    } catch {
      return;
    }

    if (!env || env.v !== 1 || env.topic !== this.topicHash || !env.id || !env.from) {
      return;
    }

    // Ignora pacotes enviados por nós mesmos
    if (env.from === this.myPeerId) return;

    // Se o pacote é direcionado a outro peer específico, ignora
    if (env.to && env.to !== this.myPeerId) return;

    // Deduplica pacotes recebidos por múltiplos brokers simultâneos
    if (!this.rememberPacketId(env.id)) return;

    // Descriptografa com AES-256-GCM
    let pkt: DecryptedMeshPacket;
    try {
      const ivBytes = base64ToBytes(env.iv);
      const ctBytes = base64ToBytes(env.ct);
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes as unknown as BufferSource },
        this.aesKey,
        ctBytes as unknown as BufferSource
      );
      const plainText = new TextDecoder().decode(plainBuffer);
      pkt = JSON.parse(plainText);
    } catch {
      // Falha na descriptografia AES-GCM no mesmo topicHash significa que há alguém na sala com outra senha!
      const now = Date.now();
      if (now - this.lastWrongPasswordAlertAt > 8000 && this.knownPeers.size === 0) {
        this.lastWrongPasswordAlertAt = now;
        this.onError?.(
          `Atividade detectada na sala "${this.roomName}", mas a Senha digitada não confere com a senha dos participantes.`
        );
      }
      return;
    }

    if (!pkt || pkt.magic !== 'SC_MESH_V1' || !pkt.fromPeerId || !pkt.inner) {
      return;
    }

    const remotePeerId = pkt.fromPeerId;
    const remoteNickname = pkt.fromNickname || 'Amigo';
    const remoteEpoch = pkt.sessionEpoch || '';
    const inner = pkt.inner;

    if (inner.type === 'mesh_bye') {
      if (this.knownPeers.has(remotePeerId)) {
        this.knownPeers.delete(remotePeerId);
        this.onSignalingMessage({
          type: 'peer_left',
          peer_id: remotePeerId,
        });
      }
      return;
    }

    const existingPeer = this.knownPeers.get(remotePeerId);
    const isRestartedSession =
      existingPeer && existingPeer.sessionEpoch && remoteEpoch && existingPeer.sessionEpoch !== remoteEpoch;

    if (isRestartedSession) {
      // O amigo fechou e reabriu o app: limpa a conexão antiga antes de recriar
      this.knownPeers.delete(remotePeerId);
      this.onSignalingMessage({
        type: 'peer_left',
        peer_id: remotePeerId,
      });
    }

    const isNewPeer = !this.knownPeers.has(remotePeerId);
    this.knownPeers.set(remotePeerId, {
      peerId: remotePeerId,
      nickname: remoteNickname,
      sessionEpoch: remoteEpoch,
      lastSeen: Date.now(),
    });

    if (inner.type === 'mesh_hello') {
      const peerSummary = inner.peer || {
        id: remotePeerId,
        nickname: remoteNickname,
        is_host: false,
      };

      // Regra determinística de iniciador WebRTC: exatamente 1 dos 2 cria a oferta inicial
      const shouldInitiate = this.myPeerId > remotePeerId;

      if (isNewPeer) {
        if (!shouldInitiate) {
          // Criamos nossa RTCPeerConnection passiva primeiro e já avisamos o iniciador
          this.onSignalingMessage({
            type: 'peer_joined',
            initiator: false,
            peer: peerSummary,
          });
          if (inner.reply_needed) {
            this.sendHello(false, remotePeerId);
          }
        } else {
          // Respondemos para garantir que o par crie a RTCPeerConnection passiva e iniciamos a oferta
          if (inner.reply_needed) {
            await this.sendHello(false, remotePeerId);
          }
          setTimeout(() => {
            if (!this.closed) {
              this.onSignalingMessage({
                type: 'peer_joined',
                initiator: true,
                peer: peerSummary,
              });
            }
          }, 50);
        }
      } else {
        // Atualiza metadados do peer já conhecido e responde se ele pediu confirmação
        this.onSignalingMessage({
          type: 'peer_joined',
          initiator: false,
          peer: peerSummary,
        });
        if (inner.reply_needed) {
          this.sendHello(false, remotePeerId);
        }
      }
      return;
    }

    // Se qualquer sinal WebRTC chegar antes do mesh_hello, registra o peer passivamente na hora
    if (isNewPeer) {
      this.onSignalingMessage({
        type: 'peer_joined',
        initiator: false,
        peer: {
          id: remotePeerId,
          nickname: remoteNickname,
          is_host: false,
        },
      });
    }

    if (inner.type === 'webrtc_signal') {
      this.onSignalingMessage({
        type: 'webrtc_signal',
        from_peer_id: remotePeerId,
        payload: inner.payload,
      });
    } else if (inner.type === 'stream_status') {
      this.onSignalingMessage(inner);
    } else if (inner.type === 'request_stream') {
      this.onSignalingMessage({
        type: 'request_stream',
        from_peer_id: remotePeerId,
        stream_type: inner.stream_type,
      });
    }
  }

  public close() {
    if (this.closed) return;
    // Envia aviso de saída para os colegas da sala removerem o card imediatamente
    try {
      this.publishEncrypted({
        type: 'mesh_bye',
        peer_id: this.myPeerId,
      });
    } catch {}

    this.closed = true;
    for (const t of this.fastHelloTimers) clearTimeout(t);
    this.fastHelloTimers = [];

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    setTimeout(() => {
      for (const c of this.mqttClients) {
        c.close();
      }
      this.mqttClients = [];

      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.close();
        } catch {}
        this.broadcastChannel = null;
      }

      if (this.localServerWs) {
        try {
          this.localServerWs.close();
        } catch {}
        this.localServerWs = null;
      }
    }, 120);
  }
}
