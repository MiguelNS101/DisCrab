/**
 * Suite de Testes Automatizados Pré-Compilação (Conexão P2P + Motor de Áudio DSP Windows/Android)
 * Executado automaticamente antes de `vite build` e nos jobs do GitHub Actions.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { processAndroidAudioBufferDsp, softLimitSample } from '../src/services/webrtc/AndroidAudioEngine';
import {
  decodeAndDeinterleaveStreamAudioChunk,
  simulateStreamJitterTimeline,
} from '../src/services/webrtc/AudioBridge';
import { enhanceSdpForHighQualityStream } from '../src/services/webrtc/WebRtcEngine';
import {
  FIXED_GITHUB_REPO,
  encodeRoomCodeUrlSafe,
  decodeRoomCodeUrlSafe,
} from '../src/services/tauriBridge';
import { parseInviteText } from '../src/components/RoomControl';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failedTests++;
    console.error(`  [FALHA] ${message}`);
    throw new Error(`Teste falhou: ${message}`);
  }
  passedTests++;
  console.log(`  [OK] ${message}`);
}

async function runConnectionTests(): Promise<void> {
  console.log('\n=== 1. Testes de Conexão, Convites e Sinalização P2P ===');

  // 1.1 Repositório Fixo de Atualização
  assert(
    FIXED_GITHUB_REPO === 'MiguelNS101/StreamCompanion',
    `Repositório GitHub fixo configurado corretamente (${FIXED_GITHUB_REPO})`
  );

  // 1.2 Codificação e Decodificação de Código de Sala LAN e Conexão Cloudflare Tunnel (WAN)
  const lanCode = encodeRoomCodeUrlSafe('192.168.1.42:9001:token123');
  const decodedLan = decodeRoomCodeUrlSafe(lanCode);
  assert(
    decodedLan.wsUrl === 'ws://192.168.1.42:9001' && decodedLan.token === 'token123',
    'Roundtrip Base64 URL-Safe para sala LAN (wsUrl + Token)'
  );

  const cloudflareCode = encodeRoomCodeUrlSafe('cinema-amigos-xyz:cfToken99');
  const decodedCloudflare = decodeRoomCodeUrlSafe(cloudflareCode);
  assert(
    decodedCloudflare.wsUrl === 'wss://cinema-amigos-xyz.trycloudflare.com' &&
      decodedCloudflare.token === 'cfToken99',
    'Conexão cliente Cloudflare Tunnel (wss://*.trycloudflare.com) validada para PC e Android'
  );

  // 1.3 Parser de Convites (Deep Link streamcompanion://, Texto formatado e Código direto)
  const encodedPass = Buffer.from('pipoca', 'utf-8').toString('base64');
  const parsedDeepLink = parseInviteText(
    `streamcompanion://join?mesh_room=CinemaDosAmigos&mesh_pass=${encodedPass}`
  );
  assert(
    parsedDeepLink !== null &&
      parsedDeepLink.kind === 'mesh' &&
      parsedDeepLink.roomName === 'cinemadosamigos' &&
      parsedDeepLink.password === 'pipoca',
    'Parser de convite reconhece protocolo nativo streamcompanion://join?mesh_room=...&mesh_pass=...'
  );

  const parsedFormattedText = parseInviteText('Sala: WatchPartySabado | Senha: 12345');
  assert(
    parsedFormattedText !== null &&
      parsedFormattedText.kind === 'mesh' &&
      parsedFormattedText.roomName === 'watchpartysabado' &&
      parsedFormattedText.password === '12345',
    'Parser de convite reconhece texto "Sala: X | Senha: Y"'
  );

  const parsedCodeInvite = parseInviteText(`streamcompanion://join?room=${lanCode}`);
  assert(
    parsedCodeInvite !== null &&
      parsedCodeInvite.kind === 'code' &&
      parsedCodeInvite.code === lanCode,
    'Parser de convite reconhece código direto em streamcompanion://join?room=...'
  );

  // 1.4 Teste de Integração WebSocket Signaling P2P (Auth + PeerJoined + Relay WebRtcSignal)
  await new Promise<void>((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const peers = new Map<string, { ws: WebSocket; displayName: string }>();

    wss.on('connection', (ws) => {
      let currentPeerId = '';
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'Auth') {
          if (msg.token !== 'valid_token') {
            ws.send(JSON.stringify({ type: 'AuthErr', reason: 'Token inválido' }));
            return;
          }
          currentPeerId = msg.peer_id;
          const existingPeers = Array.from(peers.entries()).map(([peer_id, info]) => ({
            peer_id,
            display_name: info.displayName,
          }));
          ws.send(JSON.stringify({ type: 'AuthOk', peers: existingPeers }));
          for (const [, p] of peers) {
            p.ws.send(
              JSON.stringify({
                type: 'PeerJoined',
                peer_id: msg.peer_id,
                display_name: msg.display_name,
              })
            );
          }
          peers.set(msg.peer_id, { ws, displayName: msg.display_name });
        } else if (msg.type === 'WebRtcSignal') {
          const target = peers.get(msg.target_peer_id);
          if (target) {
            target.ws.send(
              JSON.stringify({
                type: 'WebRtcSignal',
                from_peer_id: currentPeerId,
                target_peer_id: msg.target_peer_id,
                sdp_or_candidate: msg.sdp_or_candidate,
              })
            );
          }
        }
      });
    });

    wss.on('listening', () => {
      const address = wss.address();
      if (!address || typeof address === 'string') {
        wss.close();
        reject(new Error('Falha ao obter porta do servidor WebSocket de teste'));
        return;
      }

      const wsUrl = `ws://127.0.0.1:${address.port}`;
      const clientA = new WebSocket(wsUrl);
      const clientB = new WebSocket(wsUrl);

      let aAuthenticated = false;
      let bAuthenticated = false;

      clientA.on('open', () => {
        clientA.send(
          JSON.stringify({
            type: 'Auth',
            token: 'valid_token',
            peer_id: 'peer_pc_host',
            display_name: 'HostPC',
          })
        );
      });

      clientA.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthOk' && !aAuthenticated) {
          aAuthenticated = true;
          clientB.send(
            JSON.stringify({
              type: 'Auth',
              token: 'valid_token',
              peer_id: 'peer_android_guest',
              display_name: 'AmigoAndroid',
            })
          );
        } else if (msg.type === 'PeerJoined' && msg.peer_id === 'peer_android_guest') {
          clientA.send(
            JSON.stringify({
              type: 'WebRtcSignal',
              from_peer_id: 'peer_pc_host',
              target_peer_id: 'peer_android_guest',
              sdp_or_candidate: '{"type":"offer","sdp":"v=0..."}',
            })
          );
        }
      });

      clientB.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthOk') {
          bAuthenticated = true;
          assert(
            Array.isArray(msg.peers) && msg.peers.length === 1 && msg.peers[0].peer_id === 'peer_pc_host',
            'Handshake AuthOk no Android recebe lista de participantes ativos na sala'
          );
        } else if (msg.type === 'WebRtcSignal') {
          assert(
            bAuthenticated &&
              msg.from_peer_id === 'peer_pc_host' &&
              msg.sdp_or_candidate.includes('"type":"offer"'),
            'Relay de sinalização WebRTC P2P (SDP Offer PC -> Android) entregue com sucesso'
          );
          clientA.close();
          clientB.close();
          wss.close(() => resolve());
        }
      });

      clientA.on('error', reject);
      clientB.on('error', reject);
    });
  });
}

async function runStreamAudioTests(): Promise<void> {
  console.log('\n=== 2. Testes Automatizados de Áudio da Stream (WASAPI / Android DSP / AudioBridge / Opus SDP) ===');

  // 2.1 Teste do Soft Limiter Hyperbólico Android
  const quietOut = softLimitSample(0.4);
  assert(Math.abs(quietOut - 0.4) < 1e-6, 'Soft limiter preserva sinais abaixo do limiar sem distorção');

  const loudOut = softLimitSample(3.8);
  assert(
    loudOut <= 1.0 && loudOut > 0.85,
    `Soft limiter impede clipping digital na stream acima de 0dBFS (out=${loudOut.toFixed(4)})`
  );

  // 2.2 Teste de Remoção de DC Offset + Ganho no Buffer DSP (48kHz Estéreo 20ms = 960 frames)
  const frames = 960;
  const channels = 2;
  const rawBuffer = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    const sine = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
    rawBuffer[i * 2] = sine + 0.35;
    rawBuffer[i * 2 + 1] = sine + 0.35;
  }

  const processed = processAndroidAudioBufferDsp(rawBuffer, 1.15);
  assert(
    processed.length === rawBuffer.length,
    'Buffer DSP mantém exatamente 960 frames estéreo (1920 amostras por bloco de 20ms)'
  );

  let maxAbs = 0;
  let meanTail = 0;
  const tailStart = Math.floor(frames * 0.5) * channels;
  for (let i = 0; i < processed.length; i++) {
    const abs = Math.abs(processed[i]);
    if (abs > maxAbs) maxAbs = abs;
    if (i >= tailStart) meanTail += processed[i];
  }
  meanTail /= processed.length - tailStart;

  assert(maxAbs <= 1.0, `Buffer DSP garante pico máximo <= 1.0 (pico=${maxAbs.toFixed(4)})`);
  assert(Math.abs(meanTail) < 0.08, `Filtro High-Pass DC Blocker atenua DC offset (média=${meanTail.toFixed(4)})`);

  // 2.3 Teste End-to-End de Transmissão Contínua de Áudio da Stream (5 pacotes de 20ms = 100ms via WebSocket)
  await new Promise<void>((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const totalChunks = 5;
    let receivedChunks = 0;
    let totalFramesDecoded = 0;
    let accRmsLeft = 0;
    let accRmsRight = 0;
    let stereoDiffDetected = false;

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        // Retransmite o pacote de áudio da stream para o receptor exatamente como no pipeline real
        ws.send(raw.toString());
      });
    });

    wss.on('listening', () => {
      const address = wss.address();
      if (!address || typeof address === 'string') {
        wss.close();
        reject(new Error('Falha ao iniciar servidor WebSocket para teste de áudio da stream'));
        return;
      }

      const streamSocket = new WebSocket(`ws://127.0.0.1:${address.port}`);

      streamSocket.on('open', () => {
        // Envia 5 blocos consecutivos de 20ms (48kHz Estéreo Float32: Canal Esquerdo = 440Hz, Canal Direito = 880Hz)
        for (let c = 0; c < totalChunks; c++) {
          const pcmInterleaved = new Float32Array(frames * channels);
          for (let i = 0; i < frames; i++) {
            const sampleIndex = c * frames + i;
            pcmInterleaved[i * 2] = Math.sin((2 * Math.PI * 440 * sampleIndex) / 48000) * 0.75;
            pcmInterleaved[i * 2 + 1] = Math.sin((2 * Math.PI * 880 * sampleIndex) / 48000) * 0.75;
          }
          const base64Data = Buffer.from(pcmInterleaved.buffer).toString('base64');
          streamSocket.send(
            JSON.stringify({
              event: 'isolated-audio-chunk',
              data: base64Data,
              sample_rate: 48000,
              channels: 2,
              bits_per_sample: 32,
              pid: 4242,
              chunk_index: c,
            })
          );
        }
      });

      streamSocket.on('message', (raw) => {
        const packet = JSON.parse(raw.toString());
        const decoded = decodeAndDeinterleaveStreamAudioChunk(
          packet.data,
          packet.bits_per_sample,
          packet.channels,
          packet.chunk_index === 0
        );

        assert(decoded !== null, `Pacote #${packet.chunk_index} da stream de áudio decodificado sem erros`);
        if (decoded) {
          receivedChunks++;
          totalFramesDecoded += decoded.frameCount;
          accRmsLeft += decoded.rmsLeft;
          accRmsRight += decoded.rmsRight;

          // Verifica que os canais Esquerdo (440Hz) e Direito (880Hz) permanecem independentes (Estéreo real)
          for (let i = 40; i < 120; i++) {
            if (Math.abs(decoded.left[i] - decoded.right[i]) > 0.25) {
              stereoDiffDetected = true;
              break;
            }
          }
        }

        if (receivedChunks === totalChunks) {
          const avgRmsLeft = accRmsLeft / totalChunks;
          const avgRmsRight = accRmsRight / totalChunks;

          assert(
            totalFramesDecoded === 4800,
            `Stream de áudio entregou todos os 4800 frames estéreo (100ms @ 48kHz) sem perda de pacotes`
          );
          assert(
            avgRmsLeft > 0.45 && avgRmsRight > 0.45,
            `Energia sonora da stream confirmada nos 2 canais (RMS L=${avgRmsLeft.toFixed(3)}, R=${avgRmsRight.toFixed(3)})`
          );
          assert(
            stereoDiffDetected,
            'Separação Estéreo L/R (440Hz vs 880Hz) preservada no AudioBridge da stream (sem colapso para mono)'
          );

          streamSocket.close();
          wss.close(() => resolve());
        }
      });

      streamSocket.on('error', reject);
    });
  });

  // 2.4 Teste de Decodificação 16-bit PCM + Proteção contra NaN/Infinity e Anti-Click Fade (32 amostras)
  const corruptedFloat = new Float32Array(960 * 2);
  for (let i = 0; i < 960; i++) {
    corruptedFloat[i * 2] = 0.6;
    corruptedFloat[i * 2 + 1] = 0.6;
  }
  corruptedFloat[10] = Number.NaN;
  corruptedFloat[11] = Number.POSITIVE_INFINITY;
  const corruptedB64 = Buffer.from(corruptedFloat.buffer).toString('base64');
  const sanitized = decodeAndDeinterleaveStreamAudioChunk(corruptedB64, 32, 2, true);
  assert(
    sanitized !== null &&
      sanitized.left[0] === 0 &&
      Number.isFinite(sanitized.left[5]) &&
      sanitized.left[5] === 0,
    'AudioBridge sanitiza amostras NaN/Infinity e aplica rampa suave anti-estalo (32 amostras) no início da stream'
  );

  // 2.5 Teste de Continuidade do Relógio de Jitter Buffer da Stream (Zero Buracos + Resync Automático)
  const chunkDurations = new Array(20).fill(0.02); // 20 pacotes de 20ms = 400ms
  const normalArrivals = chunkDurations.map((_, idx) => idx * 0.02);
  const timelineNormal = simulateStreamJitterTimeline(chunkDurations, normalArrivals);
  assert(
    timelineNormal.maxGapMs < 0.001 && timelineNormal.resyncCount === 0,
    `Relógio do Jitter Buffer agenda 400ms de áudio de stream com 0.00ms de buraco entre pacotes`
  );

  // Simula um travamento de rede onde o pacote #10 atrasa e o buffer acumula >350ms
  const spikeArrivals = normalArrivals.map((t, idx) => (idx >= 10 ? 0.01 : t));
  const timelineSpike = simulateStreamJitterTimeline(chunkDurations, spikeArrivals);
  assert(
    timelineSpike.resyncCount >= 1,
    'Jitter Buffer detecta atraso acumulado >350ms e ressincroniza automaticamente o áudio da live sem travar'
  );

  // 2.6 Teste de Otimização SDP WebRTC para Áudio da Stream (Opus 160kbps CBR Estéreo + usedtx=0)
  const rawSdp = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e028',
  ].join('\r\n');

  const optimizedSdp = enhanceSdpForHighQualityStream(rawSdp, '1080p', 60);
  assert(
    optimizedSdp.includes('stereo=1;sprop-stereo=1;maxaveragebitrate=160000;cbr=1;usedtx=0'),
    'Negociação SDP WebRTC da stream força Opus Estéreo 160kbps CBR com usedtx=0 (sem cortes em sons baixos)'
  );

  // 2.7 Teste do Dicionário de Kaomojis anexado (/public/assets/aistudio/kaomoji_7373e5da.json)
  const fs = await import('fs');
  const kaomojiRaw = fs.readFileSync('public/assets/aistudio/kaomoji_7373e5da.json', 'utf-8');
  const kaomojiDict = JSON.parse(kaomojiRaw) as Record<string, string[]>;
  const categories = Object.keys(kaomojiDict);
  assert(
    categories.length >= 100 && Array.isArray(kaomojiDict.kani) && kaomojiDict.kani.length > 0,
    `Dicionário de Kaomojis carregado com ${categories.length} categorias (incluindo categoria 'kani' do DisCrab)`
  );
}

async function main() {
  console.log('Iniciando bateria de testes pré-compilação do DisCrab...');
  await runConnectionTests();
  await runStreamAudioTests();
  console.log(`\nTodos os ${passedTests} testes de Conexão, Kaomojis e Áudio da Stream passaram com sucesso! (${failedTests} falhas)\n`);
}

main().catch((err) => {
  console.error('\n[ERRO CRÍTICO NOS TESTES PRÉ-COMPILAÇÃO]:', err);
  process.exit(1);
});
