//! Servidor WebSocket Embutido para Sinalização WebRTC P2P
//! Roda em localhost via Tokio + Tungstenite com autenticação por Token de 6 caracteres,
//! ID persistente por cliente (evita sessões fantasmas em quedas rápidas),
//! estado de transmissão preservado no servidor e Keep-Alive ativo (Ping/Pong).

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// Mensagens trocadas no WebSocket de Sinalização
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    // Autenticação inicial com o token da sala e identificador único de cliente
    #[serde(rename = "auth")]
    Auth {
        token: String,
        nickname: String,
        #[serde(default)]
        client_id: Option<String>,
    },

    #[serde(rename = "auth_ok")]
    AuthOk {
        peer_id: String,
        is_host: bool,
        peers: Vec<PeerSummary>,
    },

    #[serde(rename = "auth_failed")]
    AuthFailed { reason: String },

    #[serde(rename = "peer_joined")]
    PeerJoined { peer: PeerSummary },

    #[serde(rename = "peer_left")]
    PeerLeft { peer_id: String },

    // Relay WebRTC (Offer, Answer, ICE Candidate, Reset)
    #[serde(rename = "webrtc_signal")]
    WebRtcSignal {
        to_peer_id: String,
        from_peer_id: Option<String>,
        payload: serde_json::Value,
    },

    // Notificação de estado de live / webcam (preservando IDs das tracks no servidor)
    #[serde(rename = "stream_status")]
    StreamStatus {
        peer_id: String,
        has_screen: bool,
        screen_title: Option<String>,
        #[serde(default)]
        screen_track_id: Option<String>,
        has_webcam: bool,
        #[serde(default)]
        webcam_track_id: Option<String>,
        has_isolated_audio: bool,
    },

    // Pedido de live on-demand (economia de banda)
    #[serde(rename = "request_stream")]
    RequestStream {
        target_peer_id: String,
        from_peer_id: Option<String>,
        stream_type: String, // "screen" ou "webcam"
    },

    // Mensagens de Keep-Alive para evitar queda em túneis Cloudflare / NAT
    #[serde(rename = "ping")]
    Ping,

    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerSummary {
    pub id: String,
    pub nickname: String,
    pub is_host: bool,
    #[serde(default)]
    pub has_screen: bool,
    #[serde(default)]
    pub screen_title: Option<String>,
    #[serde(default)]
    pub screen_track_id: Option<String>,
    #[serde(default)]
    pub has_webcam: bool,
    #[serde(default)]
    pub webcam_track_id: Option<String>,
    #[serde(default)]
    pub has_isolated_audio: bool,
}

pub struct PeerSession {
    pub id: String,
    pub nickname: String,
    pub client_id: Option<String>,
    pub is_host: bool,
    pub has_screen: bool,
    pub screen_title: Option<String>,
    pub screen_track_id: Option<String>,
    pub has_webcam: bool,
    pub webcam_track_id: Option<String>,
    pub has_isolated_audio: bool,
    pub connection_seq: u64,
    pub tx: mpsc::UnboundedSender<Message>,
}

pub struct SignalingServerState {
    pub token: String,
    pub host_nickname: String,
    pub peers: Arc<Mutex<HashMap<String, PeerSession>>>,
    pub running: Arc<AtomicBool>,
    pub seq_counter: Arc<Mutex<u64>>,
}

impl SignalingServerState {
    pub fn new(host_nickname: String, token: String) -> Self {
        Self {
            token,
            host_nickname,
            peers: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(AtomicBool::new(true)),
            seq_counter: Arc::new(Mutex::new(0)),
        }
    }
}

fn sanitize_client_id(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(24)
        .collect();
    if cleaned.is_empty() {
        nanoid_simple()
    } else {
        cleaned
    }
}

/// Inicia o servidor WebSocket em uma porta TCP livre e retorna (porta, token)
pub async fn start_signaling_server(
    host_nickname: String,
) -> Result<(u16, String, Arc<SignalingServerState>), String> {
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Falha ao associar porta local: {}", e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Falha ao obter porta local: {}", e))?;
    let port = local_addr.port();

    // Gera token alfanumérico seguro de 6 caracteres maiúsculos (ex: "8K3M9P")
    let token: String = {
        let mut rng = rand::thread_rng();
        const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        (0..6)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    };

    let state = Arc::new(SignalingServerState::new(host_nickname, token.clone()));
    let state_clone = state.clone();

    tokio::spawn(async move {
        println!("[Signaling] Servidor escutando na porta {}", port);
        while state_clone.running.load(Ordering::SeqCst) {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let state_peer = state_clone.clone();
                    tokio::spawn(async move {
                        handle_connection(stream, addr, state_peer).await;
                    });
                }
                Err(e) => {
                    eprintln!("[Signaling] Erro ao aceitar conexão: {}", e);
                    break;
                }
            }
        }
    });

    Ok((port, token, state))
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    state: Arc<SignalingServerState>,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[Signaling] Handshake WebSocket falhou para {}: {}", addr, e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Forwarder de mensagens do canal interno para o socket real
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Keep-Alive ativo do servidor a cada 15s para manter túneis Cloudflare e NAT abertos
    let tx_ping = tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if tx_ping.send(Message::Ping(vec![1, 2, 3, 4])).is_err() {
                break;
            }
        }
    });

    // 1. O primeiro frame DEVE ser uma mensagem de autenticação
    let mut authenticated_peer_id: Option<String> = None;
    let mut my_conn_seq: u64 = 0;

    if let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        if let Ok(SignalingMessage::Auth {
            token,
            nickname,
            client_id,
        }) = serde_json::from_str::<SignalingMessage>(&text)
        {
            if token.trim() == state.token {
                my_conn_seq = {
                    let mut seq = state.seq_counter.lock().await;
                    *seq += 1;
                    *seq
                };

                let peer_id = match &client_id {
                    Some(cid) if !cid.trim().is_empty() => format!("peer-{}", sanitize_client_id(cid)),
                    _ => format!("peer-{}", nanoid_simple()),
                };

                // Verifica se já havia uma sessão anterior deste mesmo peer ou cliente e preserva estado se aplicável
                let (stale_other_ids, preserved_stream_state, was_host) = {
                    let mut peers_map = state.peers.lock().await;
                    let mut to_remove = Vec::new();
                    let mut prev_state = (false, None, None, false, None, false);
                    let mut prev_is_host = false;

                    for (existing_id, session) in peers_map.iter() {
                        let same_client = match (&client_id, &session.client_id) {
                            (Some(c1), Some(c2)) => c1 == c2,
                            _ => false,
                        };
                        if *existing_id == peer_id || same_client {
                            prev_state = (
                                session.has_screen,
                                session.screen_title.clone(),
                                session.screen_track_id.clone(),
                                session.has_webcam,
                                session.webcam_track_id.clone(),
                                session.has_isolated_audio,
                            );
                            prev_is_host = session.is_host;
                            if *existing_id != peer_id {
                                to_remove.push(existing_id.clone());
                            }
                        }
                    }

                    for old_id in &to_remove {
                        peers_map.remove(old_id);
                    }
                    (to_remove, prev_state, prev_is_host)
                };

                for old_id in stale_other_ids {
                    broadcast_to_others(
                        &state,
                        &old_id,
                        SignalingMessage::PeerLeft { peer_id: old_id },
                    )
                    .await;
                }

                let is_host = {
                    let peers_map = state.peers.lock().await;
                    was_host
                        || peers_map.is_empty()
                        || (addr.ip().is_loopback() && !peers_map.values().any(|p| p.is_host && p.id != peer_id))
                };

                // Coleta lista atual de peers (com estado de live atual!) para enviar ao recém-chegado
                let existing_peers: Vec<PeerSummary> = {
                    let peers_map = state.peers.lock().await;
                    peers_map
                        .values()
                        .filter(|p| p.id != peer_id)
                        .map(|p| PeerSummary {
                            id: p.id.clone(),
                            nickname: p.nickname.clone(),
                            is_host: p.is_host,
                            has_screen: p.has_screen,
                            screen_title: p.screen_title.clone(),
                            screen_track_id: p.screen_track_id.clone(),
                            has_webcam: p.has_webcam,
                            webcam_track_id: p.webcam_track_id.clone(),
                            has_isolated_audio: p.has_isolated_audio,
                        })
                        .collect()
                };

                let auth_ok = SignalingMessage::AuthOk {
                    peer_id: peer_id.clone(),
                    is_host,
                    peers: existing_peers,
                };

                let _ = tx.send(Message::Text(serde_json::to_string(&auth_ok).unwrap()));

                let summary_for_others = PeerSummary {
                    id: peer_id.clone(),
                    nickname: nickname.clone(),
                    is_host,
                    has_screen: preserved_stream_state.0,
                    screen_title: preserved_stream_state.1.clone(),
                    screen_track_id: preserved_stream_state.2.clone(),
                    has_webcam: preserved_stream_state.3,
                    webcam_track_id: preserved_stream_state.4.clone(),
                    has_isolated_audio: preserved_stream_state.5,
                };

                // Registra ou atualiza a sessão
                {
                    let mut peers_map = state.peers.lock().await;
                    peers_map.insert(
                        peer_id.clone(),
                        PeerSession {
                            id: peer_id.clone(),
                            nickname: nickname.clone(),
                            client_id,
                            is_host,
                            has_screen: preserved_stream_state.0,
                            screen_title: preserved_stream_state.1,
                            screen_track_id: preserved_stream_state.2,
                            has_webcam: preserved_stream_state.3,
                            webcam_track_id: preserved_stream_state.4,
                            has_isolated_audio: preserved_stream_state.5,
                            connection_seq: my_conn_seq,
                            tx: tx.clone(),
                        },
                    );
                }

                // Notifica os demais peers que este participante entrou/reconectou
                broadcast_to_others(
                    &state,
                    &peer_id,
                    SignalingMessage::PeerJoined {
                        peer: summary_for_others,
                    },
                )
                .await;

                authenticated_peer_id = Some(peer_id);
            } else {
                let fail = SignalingMessage::AuthFailed {
                    reason: "Token da Sala inválido ou expirado.".to_string(),
                };
                let _ = tx.send(Message::Text(serde_json::to_string(&fail).unwrap()));
                ping_task.abort();
                return;
            }
        }
    }

    let my_id = match authenticated_peer_id {
        Some(id) => id,
        None => {
            let fail = SignalingMessage::AuthFailed {
                reason: "Não autenticado.".to_string(),
            };
            let _ = tx.send(Message::Text(serde_json::to_string(&fail).unwrap()));
            ping_task.abort();
            return;
        }
    };

    // 2. Loop de processamento de mensagens
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(msg) = serde_json::from_str::<SignalingMessage>(&text) {
                    match msg {
                        SignalingMessage::Ping => {
                            let pong = SignalingMessage::Pong;
                            if let Ok(txt) = serde_json::to_string(&pong) {
                                let _ = tx.send(Message::Text(txt));
                            }
                        }
                        SignalingMessage::WebRtcSignal {
                            to_peer_id,
                            payload,
                            ..
                        } => {
                            let forward = SignalingMessage::WebRtcSignal {
                                to_peer_id: to_peer_id.clone(),
                                from_peer_id: Some(my_id.clone()),
                                payload,
                            };
                            send_to_peer(&state, &to_peer_id, forward).await;
                        }
                        SignalingMessage::RequestStream {
                            target_peer_id,
                            stream_type,
                            ..
                        } => {
                            let req = SignalingMessage::RequestStream {
                                target_peer_id: target_peer_id.clone(),
                                from_peer_id: Some(my_id.clone()),
                                stream_type,
                            };
                            send_to_peer(&state, &target_peer_id, req).await;
                        }
                        SignalingMessage::StreamStatus {
                            has_screen,
                            screen_title,
                            screen_track_id,
                            has_webcam,
                            webcam_track_id,
                            has_isolated_audio,
                            ..
                        } => {
                            // Salva o estado da transmissão no servidor para futuros peers ou reconexões
                            {
                                let mut peers_map = state.peers.lock().await;
                                if let Some(session) = peers_map.get_mut(&my_id) {
                                    session.has_screen = has_screen;
                                    session.screen_title = screen_title.clone();
                                    session.screen_track_id = screen_track_id.clone();
                                    session.has_webcam = has_webcam;
                                    session.webcam_track_id = webcam_track_id.clone();
                                    session.has_isolated_audio = has_isolated_audio;
                                }
                            }

                            let status = SignalingMessage::StreamStatus {
                                peer_id: my_id.clone(),
                                has_screen,
                                screen_title,
                                screen_track_id,
                                has_webcam,
                                webcam_track_id,
                                has_isolated_audio,
                            };
                            broadcast_to_others(&state, &my_id, status).await;
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Ping(data)) => {
                let _ = tx.send(Message::Pong(data));
            }
            Ok(Message::Close(_)) | Err(_) => {
                break;
            }
            _ => {}
        }
    }

    ping_task.abort();

    // 3. Limpeza ao desconectar: só remove se esta ainda for a conexão mais recente daquele peer_id!
    // (Se o cliente já reconectou em um novo socket com connection_seq maior, não apaga a nova sessão!)
    let was_removed = {
        let mut peers_map = state.peers.lock().await;
        if let Some(existing) = peers_map.get(&my_id) {
            if existing.connection_seq == my_conn_seq {
                peers_map.remove(&my_id);
                true
            } else {
                false
            }
        } else {
            false
        }
    };

    if was_removed {
        broadcast_to_others(
            &state,
            &my_id,
            SignalingMessage::PeerLeft {
                peer_id: my_id.clone(),
            },
        )
        .await;
    }
}

async fn send_to_peer(
    state: &Arc<SignalingServerState>,
    target_id: &str,
    msg: SignalingMessage,
) {
    let peers_map = state.peers.lock().await;
    if let Some(session) = peers_map.get(target_id) {
        if let Ok(txt) = serde_json::to_string(&msg) {
            let _ = session.tx.send(Message::Text(txt));
        }
    }
}

async fn broadcast_to_others(
    state: &Arc<SignalingServerState>,
    sender_id: &str,
    msg: SignalingMessage,
) {
    let peers_map = state.peers.lock().await;
    if let Ok(txt) = serde_json::to_string(&msg) {
        for (id, session) in peers_map.iter() {
            if id != sender_id {
                let _ = session.tx.send(Message::Text(txt.clone()));
            }
        }
    }
}

fn nanoid_simple() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + (idx - 10)) as char
            }
        })
        .collect()
}
