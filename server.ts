import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());

interface PeerSession {
  id: string;
  nickname: string;
  is_host: boolean;
  ws: WebSocket;
}

interface Room {
  code: string;
  token: string;
  hostNickname: string;
  peers: Map<string, PeerSession>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function generateId(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateToken(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

// Codifica em Base64 URL-Safe
function encodeBase64UrlSafe(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// API REST para criação de sala no modo Web / Full-Stack
app.post('/api/create-room', (req, res) => {
  const { hostNickname } = req.body;
  const nickname = (hostNickname || 'Host').trim();
  const token = generateToken();
  const roomCode = encodeBase64UrlSafe(`web:${token}`);

  const room: Room = {
    code: roomCode,
    token,
    hostNickname: nickname,
    peers: new Map(),
    createdAt: Date.now(),
  };

  rooms.set(token, room);
  console.log(`[Signaling Server] Nova sala criada: Token ${token}, Host: ${nickname}`);

  res.json({
    room_code: roomCode,
    token,
    mode: 'web',
    ws_path: '/ws',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeRooms: rooms.size });
});

// Gerenciamento WebSocket de Sinalização WebRTC P2P
wss.on('connection', (ws: WebSocket, req) => {
  let authenticatedPeerId: string | null = null;
  let activeToken: string | null = null;

  console.log('[Signaling Server] Novo cliente conectado via WebSocket');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'auth': {
          const token = (msg.token || '').trim();
          const nickname = (msg.nickname || 'Anônimo').trim();

          let room = rooms.get(token);
          let isHost = false;

          if (!room) {
            // Se a sala ainda não existe com esse token, cria dinamicamente (primeiro a entrar é o Host)
            isHost = true;
            room = {
              code: encodeBase64UrlSafe(`web:${token}`),
              token,
              hostNickname: nickname,
              peers: new Map(),
              createdAt: Date.now(),
            };
            rooms.set(token, room);
            console.log(`[Signaling Server] Sala iniciada automaticamente para o token ${token} por ${nickname}`);
          } else if (room.peers.size === 0) {
            isHost = true;
          }

          const peerId = generateId('peer');
          authenticatedPeerId = peerId;
          activeToken = token;

          const existingPeersSummary = Array.from(room.peers.values()).map((p) => ({
            id: p.id,
            nickname: p.nickname,
            is_host: p.is_host,
          }));

          // Salva sessão do peer
          room.peers.set(peerId, {
            id: peerId,
            nickname,
            is_host: isHost,
            ws,
          });

          // Responde auth_ok para o próprio peer
          ws.send(
            JSON.stringify({
              type: 'auth_ok',
              peer_id: peerId,
              is_host: isHost,
              peers: existingPeersSummary,
            })
          );

          // Notifica os outros membros da sala
          const joinedMsg = JSON.stringify({
            type: 'peer_joined',
            peer: {
              id: peerId,
              nickname,
              is_host: isHost,
            },
          });

          for (const [id, otherPeer] of room.peers) {
            if (id !== peerId && otherPeer.ws.readyState === WebSocket.OPEN) {
              otherPeer.ws.send(joinedMsg);
            }
          }
          break;
        }

        case 'webrtc_signal': {
          if (!activeToken) return;
          const room = rooms.get(activeToken);
          if (!room) return;

          const targetPeer = room.peers.get(msg.to_peer_id);
          if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
            targetPeer.ws.send(
              JSON.stringify({
                type: 'webrtc_signal',
                from_peer_id: authenticatedPeerId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'stream_status': {
          if (!activeToken) return;
          const room = rooms.get(activeToken);
          if (!room) return;

          const broadcastMsg = JSON.stringify({
            type: 'stream_status',
            peer_id: authenticatedPeerId,
            has_screen: !!msg.has_screen,
            screen_title: msg.screen_title,
            has_webcam: !!msg.has_webcam,
            has_isolated_audio: !!msg.has_isolated_audio,
          });

          for (const [id, otherPeer] of room.peers) {
            if (id !== authenticatedPeerId && otherPeer.ws.readyState === WebSocket.OPEN) {
              otherPeer.ws.send(broadcastMsg);
            }
          }
          break;
        }

        case 'request_stream': {
          if (!activeToken) return;
          const room = rooms.get(activeToken);
          if (!room) return;

          const target = room.peers.get(msg.target_peer_id);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(
              JSON.stringify({
                type: 'request_stream',
                from_peer_id: authenticatedPeerId,
                stream_type: msg.stream_type,
              })
            );
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Signaling Server] Erro ao decodificar mensagem WebSocket:', err);
    }
  });

  ws.on('close', () => {
    if (activeToken && authenticatedPeerId) {
      const room = rooms.get(activeToken);
      if (room) {
        room.peers.delete(authenticatedPeerId);
        console.log(`[Signaling Server] Peer ${authenticatedPeerId} saiu da sala ${activeToken}`);

        const leaveMsg = JSON.stringify({
          type: 'peer_left',
          peer_id: authenticatedPeerId,
        });

        for (const [_, otherPeer] of room.peers) {
          if (otherPeer.ws.readyState === WebSocket.OPEN) {
            otherPeer.ws.send(leaveMsg);
          }
        }

        if (room.peers.size === 0) {
          rooms.delete(activeToken);
          console.log(`[Signaling Server] Sala ${activeToken} vazia e encerrada.`);
        }
      }
    }
  });
});

// Integração Vite Middleware no desenvolvimento
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Server] StreamCompanion servidor rodando em http://0.0.0.0:${port}`);
    console.log(`[Server] WebSocket de Sinalização ativo em ws://0.0.0.0:${port}/ws`);
  });
}

startServer();
