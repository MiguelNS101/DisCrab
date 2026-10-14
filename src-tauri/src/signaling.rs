//! Servidor WebSocket Embutido para Sinalização WebRTC P2P
//! Roda em localhost via Tokio + Tungstenite com autenticação por Token de 6 caracteres.

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// Mensagens trocadas no WebSocket de Sinalização
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    // Autenticação inicial com o token da sala
    #[serde(rename = "auth")]
    Auth { token: String, nickname: String },

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

    // Relay WebRTC (Offer, Answer, ICE Candidate)
    #[serde(rename = "webrtc_signal")]
    WebRtcSignal {
        to_peer_id: String,
        from_peer_id: Option<String>,
        payload: serde_json::Value,
    },

    // Notificação de estado de live / webcam
    #[serde(rename = "stream_status")]
    StreamStatus {
        peer_id: String,
        has_screen: bool,
        screen_title: Option<String>,
        has_webcam: bool,
        has_isolated_audio: bool,
    },

    // Pedido de live on-demand (economia de banda)
    #[serde(rename = "request_stream")]
    RequestStream {
        target_peer_id: String,
        from_peer_id: Option<String>,
        stream_type: String, // "screen" ou "webcam"
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerSummary {
    pub id: String,
    pub nickname: String,
    pub is_host: bool,
}

struct PeerSession {
    pub id: String,
    pub nickname: String,
    pub is_host: bool,
    pub tx: mpsc::UnboundedSender<Message>,
}

pub struct SignalingServerState {
    pub token: String,
    pub host_nickname: String,
    pub peers: Arc<Mutex<HashMap<String, PeerSession>>>,
    pub running: Arc<AtomicBool>,
}

impl SignalingServerState {
    pub fn new(host_nickname: String, token: String) -> Self {
        Self {
            token,
            host_nickname,
            peers: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(AtomicBool::new(true)),
        }
    }
}

/// Inicia o servidor WebSocket em uma porta TCP livre e retorna (porta, token)
pub async fn start_signaling_server(
    host_nickname: String,
) -> Result<(u16, String, Arc<SignalingServerState>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Falha ao associar porta local: {}", e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Falha ao obter porta local: {}", e))?;
    let port = local_addr.port();

    // Gera token alfanumérico seguro de 6 caracteres maiúsculos (ex: "8K3M9P")
    let token: String = {
        let mut rng = rand::thread_rng();
        const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem 0, O, 1, I para evitar ambiguidades
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

    // 1. O primeiro frame DEVE ser uma mensagem de autenticação
    let mut authenticated_peer_id: Option<String> = None;

    if let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        if let Ok(SignalingMessage::Auth { token, nickname }) =
            serde_json::from_str::<SignalingMessage>(&text)
        {
            if token.trim() == state.token {
                // Token válido!
                let peer_id = format!("peer-{}", &nanoid_simple());
                let is_host = state.peers.lock().await.is_empty();

                // Coleta lista atual de peers para enviar ao recém-chegado
                let existing_peers: Vec<PeerSummary> = {
                    let peers_map = state.peers.lock().await;
                    peers_map
                        .values()
                        .map(|p| PeerSummary {
                            id: p.id.clone(),
                            nickname: p.nickname.clone(),
                            is_host: p.is_host,
                        })
                        .collect()
                };

                let auth_ok = SignalingMessage::AuthOk {
                    peer_id: peer_id.clone(),
                    is_host,
                    peers: existing_peers,
                };

                let _ = tx.send(Message::Text(serde_json::to_string(&auth_ok).unwrap()));

                // Registra sessão
                {
                    let mut peers_map = state.peers.lock().await;
                    peers_map.insert(
                        peer_id.clone(),
                        PeerSession {
                            id: peer_id.clone(),
                            nickname: nickname.clone(),
                            is_host,
                            tx: tx.clone(),
                        },
                    );
                }

                // Notifica os demais peers que alguém entrou
                broadcast_to_others(
                    &state,
                    &peer_id,
                    SignalingMessage::PeerJoined {
                        peer: PeerSummary {
                            id: peer_id.clone(),
                            nickname: nickname.clone(),
                            is_host,
                        },
                    },
                )
                .await;

                authenticated_peer_id = Some(peer_id);
            } else {
                let fail = SignalingMessage::AuthFailed {
                    reason: "Token da Sala inválido ou expirado.".to_string(),
                };
                let _ = tx.send(Message::Text(serde_json::to_string(&fail).unwrap()));
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
            return;
        }
    };

    // 2. Loop de processamento de mensagens
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(msg) = serde_json::from_str::<SignalingMessage>(&text) {
                    match msg {
                        SignalingMessage::WebRtcSignal {
                            to_peer_id,
                            payload,
                            ..
                        } => {
                            // Encaminha a sinalização diretamente para o peer alvo
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
                            // Encaminha a requisição on-demand para o transmissor
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
                            has_webcam,
                            has_isolated_audio,
                            ..
                        } => {
                            // Transmite o novo status para toda a sala
                            let status = SignalingMessage::StreamStatus {
                                peer_id: my_id.clone(),
                                has_screen,
                                screen_title,
                                has_webcam,
                                has_isolated_audio,
                            };
                            broadcast_to_others(&state, &my_id, status).await;
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => {
                break;
            }
            _ => {}
        }
    }

    // 3. Limpeza ao desconectar
    {
        let mut peers_map = state.peers.lock().await;
        peers_map.remove(&my_id);
    }
    broadcast_to_others(
        &state,
        &my_id,
        SignalingMessage::PeerLeft {
            peer_id: my_id.clone(),
        },
    )
    .await;
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
            let b = rng.gen_range(0..16);
            format!("{:x}", b)
        })
        .collect()
}
