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
  client_id?: string;
  is_host: boolean;
  has_screen: boolean;
  screen_title?: string | null;
  screen_track_id?: string;
  has_webcam: boolean;
  webcam_track_id?: string;
  has_isolated_audio: boolean;
  connection_seq: number;
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
let globalConnectionSeq = 0;

function generateId(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

function sanitizeClientId(raw?: string): string {
  if (!raw) return Math.random().toString(36).substring(2, 10);
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return cleaned || Math.random().toString(36).substring(2, 10);
}

function generateToken(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function encodeBase64UrlSafe(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

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

wss.on('connection', (ws: WebSocket) => {
  let authenticatedPeerId: string | null = null;
  let activeToken: string | null = null;
  let myConnSeq = 0;

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch {}
    }
  }, 15000);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'ping': {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          break;
        }

        case 'auth': {
          const token = (msg.token || '').trim();
          const nickname = (msg.nickname || 'Anônimo').trim();
          const clientId = msg.client_id ? String(msg.client_id) : undefined;

          globalConnectionSeq += 1;
          myConnSeq = globalConnectionSeq;

          let room = rooms.get(token);
          let isHost = false;

          if (!room) {
            isHost = true;
            room = {
              code: encodeBase64UrlSafe(`web:${token}`),
              token,
              hostNickname: nickname,
              peers: new Map(),
              createdAt: Date.now(),
            };
            rooms.set(token, room);
            console.log(`[Signaling Server] Sala iniciada para o token ${token} por ${nickname}`);
          }

          const peerId = clientId ? `peer-${sanitizeClientId(clientId)}` : generateId('peer');
          let preservedScreen = false;
          let preservedTitle: string | null | undefined = undefined;
          let preservedScreenTrackId: string | undefined = undefined;
          let preservedWebcam = false;
          let preservedWebcamTrackId: string | undefined = undefined;
          let preservedMediaSources: any = undefined;
          let preservedIsolatedAudio = false;
          let wasHost = false;

          // Verifica sessão anterior do mesmo cliente/peer e preserva seu estado de live
          for (const [oldId, oldPeer] of Array.from(room.peers.entries())) {
            const sameClient = (clientId && oldPeer.client_id === clientId) || oldId === peerId;
            if (sameClient) {
              preservedScreen = oldPeer.has_screen;
              preservedTitle = oldPeer.screen_title;
              preservedScreenTrackId = oldPeer.screen_track_id;
              preservedWebcam = oldPeer.has_webcam;
              preservedWebcamTrackId = oldPeer.webcam_track_id;
              preservedMediaSources = (oldPeer as any).media_sources;
              preservedIsolatedAudio = oldPeer.has_isolated_audio;
              wasHost = oldPeer.is_host;
              room.peers.delete(oldId);
              if (oldPeer.ws !== ws) {
                try {
                  oldPeer.ws.close();
                } catch {}
              }
              if (oldId !== peerId) {
                const leaveMsg = JSON.stringify({
                  type: 'peer_left',
                  peer_id: oldId,
                });
                for (const [, otherPeer] of room.peers) {
                  if (otherPeer.ws.readyState === WebSocket.OPEN) {
                    otherPeer.ws.send(leaveMsg);
                  }
                }
              }
            }
          }

          if (room.peers.size === 0 || wasHost) {
            isHost = true;
          }

          authenticatedPeerId = peerId;
          activeToken = token;

          const existingPeersSummary = Array.from(room.peers.values())
            .filter((p) => p.id !== peerId)
            .map((p) => ({
              id: p.id,
              nickname: p.nickname,
              is_host: p.is_host,
              has_screen: p.has_screen,
              screen_title: p.screen_title,
              screen_track_id: p.screen_track_id,
              has_webcam: p.has_webcam,
              webcam_track_id: p.webcam_track_id,
              media_sources: (p as any).media_sources,
              has_isolated_audio: p.has_isolated_audio,
            }));

          const newSession: PeerSession = {
            id: peerId,
            nickname,
            client_id: clientId,
            is_host: isHost,
            has_screen: preservedScreen,
            screen_title: preservedTitle,
            screen_track_id: preservedScreenTrackId,
            has_webcam: preservedWebcam,
            webcam_track_id: preservedWebcamTrackId,
            has_isolated_audio: preservedIsolatedAudio,
            connection_seq: myConnSeq,
            ws,
          };
          (newSession as any).media_sources = preservedMediaSources;

          room.peers.set(peerId, newSession);

          ws.send(
            JSON.stringify({
              type: 'auth_ok',
              peer_id: peerId,
              is_host: isHost,
              peers: existingPeersSummary,
            })
          );

          const joinedMsg = JSON.stringify({
            type: 'peer_joined',
            peer: {
              id: peerId,
              nickname,
              is_host: isHost,
              has_screen: preservedScreen,
              screen_title: preservedTitle,
              screen_track_id: preservedScreenTrackId,
              has_webcam: preservedWebcam,
              webcam_track_id: preservedWebcamTrackId,
              media_sources: preservedMediaSources,
              has_isolated_audio: preservedIsolatedAudio,
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
          if (!activeToken || !authenticatedPeerId) return;
          const room = rooms.get(activeToken);
          if (!room) return;

          const mySession = room.peers.get(authenticatedPeerId);
          if (mySession) {
            mySession.has_screen = !!msg.has_screen;
            mySession.screen_title = msg.screen_title;
            (mySession as any).screen_resolution = msg.screen_resolution;
            (mySession as any).screen_fps = msg.screen_fps;
            mySession.screen_track_id = msg.screen_track_id;
            mySession.has_webcam = !!msg.has_webcam;
            mySession.webcam_track_id = msg.webcam_track_id;
            (mySession as any).media_sources = msg.media_sources;
            mySession.has_isolated_audio = !!msg.has_isolated_audio;
          }

          const broadcastMsg = JSON.stringify({
            type: 'stream_status',
            peer_id: authenticatedPeerId,
            has_screen: !!msg.has_screen,
            screen_title: msg.screen_title,
            screen_resolution: msg.screen_resolution,
            screen_fps: msg.screen_fps,
            screen_track_id: msg.screen_track_id,
            has_webcam: !!msg.has_webcam,
            webcam_track_id: msg.webcam_track_id,
            media_sources: msg.media_sources,
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
    clearInterval(pingTimer);
    if (activeToken && authenticatedPeerId) {
      const room = rooms.get(activeToken);
      if (room) {
        const existing = room.peers.get(authenticatedPeerId);
        // Só remove se este socket ainda for a conexão mais recente daquele peerId
        if (existing && existing.connection_seq === myConnSeq) {
          room.peers.delete(authenticatedPeerId);
          console.log(`[Signaling Server] Peer ${authenticatedPeerId} saiu da sala ${activeToken}`);

          const leaveMsg = JSON.stringify({
            type: 'peer_left',
            peer_id: authenticatedPeerId,
          });

          for (const [, otherPeer] of room.peers) {
            if (otherPeer.ws.readyState === WebSocket.OPEN) {
              otherPeer.ws.send(leaveMsg);
            }
          }
        }
      }
    }
  });
});

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
