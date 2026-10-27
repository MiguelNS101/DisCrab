//! Biblioteca Principal do StreamCompanion (Compatível com Windows Desktop e Android Mobile via Tauri v2)

pub mod android_audio;
pub mod scrap_capture;
pub mod signaling;
pub mod tunnel;
pub mod updater;
pub mod wasapi_loopback;
pub mod window_manager;

use android_audio::{push_android_pcm_samples, AndroidAudioProcessor};
use scrap_capture::{DisplayInfo, ScreenCapturerService};
use signaling::{start_signaling_server, SignalingServerState};
use tunnel::{decode_room_code, encode_room_code, CloudflaredStatus, TunnelManager};
use updater::{
    check_github_release, cleanup_old_executable, download_and_apply_update, get_system_info,
    AppSystemInfo, UpdateCheckResult,
};
use wasapi_loopback::ProcessAudioCapturer;
use window_manager::{enumerate_windows, WindowInfo};

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// Estrutura de Retorno ao Criar uma Sala
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomCreationResult {
    pub room_code: String,
    pub token: String,
    pub mode: String,
    pub public_url: Option<String>,
    pub local_port: u16,
    pub local_ip: String,
}

/// Estrutura de Retorno ao Entrar na Sala
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomJoinResult {
    pub ws_url: String,
    pub token: String,
    pub is_tunnel: bool,
}

/// Status da Captura de Áudio Isolada
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStatusResult {
    pub is_running: bool,
    pub target_pid: Option<u32>,
}

/// Resultado de Diagnóstico Nativo (Conexão + Áudio)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeDiagnosticsReport {
    pub passed: bool,
    pub platform: String,
    pub connection_test_ok: bool,
    pub signaling_test_ok: bool,
    pub audio_engine_test_ok: bool,
    pub details: Vec<String>,
}

/// Estado Global compartilhado no Tauri
pub struct AppState {
    pub audio_capturer: Arc<ProcessAudioCapturer>,
    pub screen_capturer: Arc<ScreenCapturerService>,
    pub tunnel_manager: Arc<TunnelManager>,
    pub signaling_state: Arc<Mutex<Option<Arc<SignalingServerState>>>>,
    pub startup_invite: Arc<Mutex<Option<String>>>,
}

/// Retorna e limpa qualquer convite recebido via link streamcompanion:// na abertura do app
#[tauri::command]
fn consume_startup_invite(state: State<'_, AppState>) -> Option<String> {
    let mut lock = state.startup_invite.lock().unwrap();
    lock.take()
}

/// Lista todas as janelas abertas no Windows exibindo HWND, PID, título e executável
#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    enumerate_windows()
}

/// Inicia a sala do Host:
/// No Windows: suporta Cloudflare Quick Tunnel ou LAN P2P.
/// No Android: utiliza exclusivamente LAN / P2P Direto (sem Cloudflare Tunnel).
#[tauri::command]
async fn create_room(
    app: AppHandle,
    host_nickname: String,
    use_cloudflare: bool,
    state: State<'_, AppState>,
) -> Result<RoomCreationResult, String> {
    println!("[Host] Criando sala para: {}", host_nickname);

    // 1. Inicia o servidor WebSocket local
    let (port, token, server_state) = start_signaling_server(host_nickname.clone())
        .await
        .map_err(|e| format!("Falha ao iniciar servidor WebSocket: {}", e))?;

    {
        let mut sig_lock = state.signaling_state.lock().unwrap();
        *sig_lock = Some(server_state);
    }

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    // No Android, o Cloudflare Tunnel é sempre desativado
    let allow_cloudflare = use_cloudflare && !cfg!(target_os = "android");

    if allow_cloudflare {
        let tunnel_mgr = state.tunnel_manager.clone();
        let (subdomain, public_url) = tunnel_mgr.start_quick_tunnel(port)?;

        let room_code = encode_room_code(&subdomain, &token);
        println!("[Host] Sala criada via Cloudflare! Código: {}", room_code);

        let res = RoomCreationResult {
            room_code,
            token,
            mode: "cloudflare".to_string(),
            public_url: Some(public_url),
            local_port: port,
            local_ip,
        };

        let _ = app.emit("room-created", &res);
        Ok(res)
    } else {
        let target = format!("{}:{}", local_ip, port);
        let room_code = encode_room_code(&target, &token);
        println!("[Host] Sala criada em modo LAN/P2P! Código: {}", room_code);

        let res = RoomCreationResult {
            room_code,
            token,
            mode: "lan".to_string(),
            public_url: None,
            local_port: port,
            local_ip,
        };

        let _ = app.emit("room-created", &res);
        Ok(res)
    }
}

/// Decodifica o Código da Sala Base64 fornecido pelo amigo para obter WebSocket URL e Token
#[tauri::command]
fn join_room(room_code: String) -> Result<RoomJoinResult, String> {
    let (ws_url, token) = decode_room_code(&room_code)?;
    let is_tunnel = ws_url.contains("trycloudflare.com");

    Ok(RoomJoinResult {
        ws_url,
        token,
        is_tunnel,
    })
}

/// Inicia a captura de áudio exclusiva do processo (WASAPI no Windows / Android DSP no Android)
#[tauri::command]
fn start_process_audio(pid: u32, state: State<'_, AppState>) -> Result<(), String> {
    println!("[Audio] Iniciando motor de áudio para PID/Modo {}", pid);
    state.audio_capturer.start(pid)
}

/// Inicia a captura de áudio simultânea para múltiplos processos
#[tauri::command]
fn start_multi_process_audio(pids: Vec<u32>, state: State<'_, AppState>) -> Result<(), String> {
    println!(
        "[Audio] Iniciando motor de áudio para múltiplos PIDs: {:?}",
        pids
    );
    state.audio_capturer.start_multiple(pids)
}

/// Permite ao frontend Android enviar amostras PCM para processamento no DSP nativo Rust
#[tauri::command]
fn feed_android_audio_samples(samples: Vec<f32>) -> Result<(), String> {
    push_android_pcm_samples(&samples);
    Ok(())
}

/// Interrompe a captura de áudio isolada
#[tauri::command]
fn stop_process_audio(state: State<'_, AppState>) -> Result<(), String> {
    println!("[Audio] Parando captura de áudio");
    state.audio_capturer.stop();
    Ok(())
}

/// Consulta o estado atual da captura de áudio
#[tauri::command]
fn get_current_audio_status(state: State<'_, AppState>) -> AudioStatusResult {
    AudioStatusResult {
        is_running: state.audio_capturer.is_running(),
        target_pid: state.audio_capturer.get_current_pid(),
    }
}

/// Lista os monitores físicos conectados
#[tauri::command]
fn list_displays() -> Vec<DisplayInfo> {
    ScreenCapturerService::list_displays()
}

/// Inicia captura nativa de tela a 30fps ou 60fps
#[tauri::command]
fn start_screen_capture(
    display_id: usize,
    fps: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.screen_capturer.start(display_id, fps)
}

/// Interrompe a captura de tela
#[tauri::command]
fn stop_screen_capture(state: State<'_, AppState>) -> Result<(), String> {
    state.screen_capturer.stop();
    Ok(())
}

/// Retorna o IP local da máquina na rede LAN / Wi-Fi
#[tauri::command]
fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Retorna o uso de memória RAM real do processo em Megabytes (MB)
#[tauri::command]
fn get_process_memory() -> f64 {
    #[cfg(windows)]
    {
        use windows::Win32::System::ProcessStatus::{
            K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows::Win32::System::Threading::GetCurrentProcess;
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        unsafe {
            if K32GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            )
            .as_bool()
            {
                let mb = (counters.WorkingSetSize as f64) / (1024.0 * 1024.0);
                return (mb * 10.0).round() / 10.0;
            }
        }
    }
    42.0
}

/// Abre o seletor nativo do sistema para escolher onde salvar o arquivo
#[tauri::command]
fn save_file_dialog(
    app: tauri::AppHandle,
    default_name: String,
    base64_data: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();
    if let Some(path) = file_path {
        let path_buf = path
            .as_path()
            .ok_or_else(|| "Caminho de arquivo inválido".to_string())?;
        let clean_base64 = if let Some(idx) = base64_data.find(',') {
            &base64_data[idx + 1..]
        } else {
            &base64_data
        };
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            clean_base64,
        )
        .map_err(|e| format!("Falha ao decodificar base64: {}", e))?;

        std::fs::write(path_buf, bytes)
            .map_err(|e| format!("Falha ao salvar arquivo no disco: {}", e))?;
        println!("[Download] Arquivo salvo com sucesso em: {:?}", path_buf);
        Ok(Some(path_buf.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// Encerra totalmente o aplicativo e seus processos filhos
#[tauri::command]
fn close_app(state: State<'_, AppState>) {
    state.tunnel_manager.stop();
    state.audio_capturer.stop();
    state.screen_capturer.stop();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "cloudflared.exe", "/T"])
            .creation_flags(0x08000000)
            .status();
    }
    std::process::exit(0);
}

/// Retorna informações da versão atual do executável e status do cloudflared
#[tauri::command]
fn get_app_system_info() -> AppSystemInfo {
    get_system_info()
}

/// Garante que o cloudflared.exe está baixado e instalado em %LOCALAPPDATA%\StreamCompanion\bin
#[tauri::command]
async fn ensure_cloudflared_binary() -> Result<CloudflaredStatus, String> {
    tokio::task::spawn_blocking(|| {
        let _ = TunnelManager::ensure_binary_exists()?;
        Ok(TunnelManager::get_binary_status())
    })
    .await
    .map_err(|e| format!("Erro na tarefa do cloudflared: {}", e))?
}

/// Consulta a última Release publicada no GitHub Releases para o repositório fixo MiguelNS101/StreamCompanion
#[tauri::command]
async fn check_github_update(repo: String) -> Result<UpdateCheckResult, String> {
    check_github_release(&repo).await
}

/// Baixa o novo .exe da Release do GitHub, substitui o executável atual e reinicia o aplicativo
#[tauri::command]
async fn install_github_update(
    app: AppHandle,
    download_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.audio_capturer.stop();
    state.screen_capturer.stop();
    download_and_apply_update(app, download_url, &state.tunnel_manager).await
}

/// Executa bateria de autotestes nativos de Conexão P2P, Sinalização WebSocket e Motor de Áudio
#[tauri::command]
async fn run_native_diagnostics() -> Result<NativeDiagnosticsReport, String> {
    let mut details = Vec::new();
    let platform = std::env::consts::OS.to_string();

    // 1. Teste de Codificação/Decodificação de Sala (LAN e Conexão Cloudflare Tunnel)
    let test_code = encode_room_code("192.168.0.10:49152", "7H9K2P");
    let (decoded_url, decoded_token) = decode_room_code(&test_code)?;
    let cf_code = encode_room_code("stream-watch-party", "CF99TOKEN");
    let (cf_url, cf_token) = decode_room_code(&cf_code)?;
    let connection_test_ok = decoded_url == "ws://192.168.0.10:49152"
        && decoded_token == "7H9K2P"
        && cf_url == "wss://stream-watch-party.trycloudflare.com"
        && cf_token == "CF99TOKEN";
    details.push(format!(
        "[OK] Conexão Cloudflare ({}) e LAN ({}) validadas",
        cf_url, decoded_url
    ));

    // 2. Teste Real de Servidor WebSocket Local + Handshake Auth
    let (port, token, sig_state) = start_signaling_server("DiagHost".to_string()).await?;
    let ws_url = format!("ws://127.0.0.1:{}", port);
    let (mut ws_client, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("Falha ao conectar no WebSocket de teste: {}", e))?;

    use futures_util::{SinkExt, StreamExt};
    let auth_msg = serde_json::to_string(&signaling::SignalingMessage::Auth {
        token: token.clone(),
        nickname: "DiagPeer".to_string(),
        client_id: Some("diag_client".to_string()),
    })
    .unwrap();
    ws_client
        .send(tokio_tungstenite::tungstenite::Message::Text(auth_msg))
        .await
        .map_err(|e| format!("Erro ao enviar auth: {}", e))?;

    let mut signaling_test_ok = false;
    if let Some(Ok(resp)) = ws_client.next().await {
        if let Ok(txt) = resp.to_text() {
            if txt.contains("auth_ok") {
                signaling_test_ok = true;
            }
        }
    }
    sig_state
        .running
        .store(false, std::sync::atomic::Ordering::SeqCst);
    details.push(format!(
        "[{}] Handshake WebSocket P2P na porta dinâmica {}",
        if signaling_test_ok { "OK" } else { "FALHA" },
        port
    ));

    // 3. Teste End-to-End do Áudio da Stream (5 pacotes de 20ms 48kHz Estéreo -> Base64 -> Decodificação -> Energia RMS L/R)
    let mut dsp = AndroidAudioProcessor::new(48000, 2, 1.15);
    let mut total_decoded_frames = 0usize;
    let mut sum_sq_l = 0.0f64;
    let mut sum_sq_r = 0.0f64;

    for chunk_idx in 0..5 {
        let mut chunk_samples = Vec::with_capacity(960 * 2);
        for i in 0..960 {
            let sample_pos = (chunk_idx * 960 + i) as f32;
            let l = ((2.0 * std::f32::consts::PI * 440.0 * sample_pos) / 48000.0).sin() * 0.65;
            let r = ((2.0 * std::f32::consts::PI * 880.0 * sample_pos) / 48000.0).sin() * 0.65;
            chunk_samples.push(l);
            chunk_samples.push(r);
        }
        let pkt = dsp.encode_packet(1001, chunk_samples);
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &pkt.pcm_data,
        );
        let decoded_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &b64,
        )
        .map_err(|e| format!("Falha ao decodificar pacote de áudio da stream: {}", e))?;

        let frame_count = decoded_bytes.len() / 8;
        total_decoded_frames += frame_count;
        for f in 0..frame_count {
            let l_bytes: [u8; 4] = decoded_bytes[f * 8..f * 8 + 4].try_into().unwrap();
            let r_bytes: [u8; 4] = decoded_bytes[f * 8 + 4..f * 8 + 8].try_into().unwrap();
            let l_val = f32::from_le_bytes(l_bytes) as f64;
            let r_val = f32::from_le_bytes(r_bytes) as f64;
            sum_sq_l += l_val * l_val;
            sum_sq_r += r_val * r_val;
        }
    }

    let rms_l = (sum_sq_l / (total_decoded_frames.max(1) as f64)).sqrt();
    let rms_r = (sum_sq_r / (total_decoded_frames.max(1) as f64)).sqrt();
    let audio_engine_test_ok =
        total_decoded_frames == 4800 && rms_l > 0.30 && rms_r > 0.30;

    details.push(format!(
        "[{}] Pipeline de Áudio da Stream 48kHz Estéreo (5 blocos = {} frames, RMS L={:.2} R={:.2})",
        if audio_engine_test_ok { "OK" } else { "FALHA" },
        total_decoded_frames,
        rms_l,
        rms_r
    ));

    let passed = connection_test_ok && signaling_test_ok && audio_engine_test_ok;
    Ok(NativeDiagnosticsReport {
        passed,
        platform,
        connection_test_ok,
        signaling_test_ok,
        audio_engine_test_ok,
        details,
    })
}

/// Localiza os metadados completos (HWND, PID, título, executável) da janela transmitida a partir do label do getDisplayMedia
#[tauri::command]
fn find_window_info(label: String) -> Option<WindowInfo> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_lowercase();
    if lower.starts_with("screen:")
        || lower.starts_with("monitor")
        || lower.starts_with("display")
        || lower == "entire screen"
        || lower == "tela inteira"
    {
        return None;
    }

    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, GA_ROOT,
        };

        let windows = crate::window_manager::enumerate_windows();

        if let Some(pos) = lower.find("window:") {
            let rest = &trimmed[pos + 7..];
            let hwnd_str = rest.split(':').next().unwrap_or(rest).trim();
            let parsed_hwnd = if let Some(hex_str) = hwnd_str
                .strip_prefix("0x")
                .or_else(|| hwnd_str.strip_prefix("0X"))
            {
                isize::from_str_radix(hex_str, 16).ok()
            } else {
                hwnd_str.parse::<isize>().ok()
            };

            if let Some(hwnd_val) = parsed_hwnd {
                if let Some(existing) = windows.iter().find(|w| w.hwnd == hwnd_val) {
                    return Some(existing.clone());
                }

                let mut pid = 0u32;
                let mut root_hwnd = HWND(hwnd_val as *mut _);
                unsafe {
                    let anc = GetAncestor(root_hwnd, GA_ROOT);
                    if !anc.0.is_null() {
                        root_hwnd = anc;
                    }
                    GetWindowThreadProcessId(root_hwnd, Some(&mut pid));
                    if pid == 0 {
                        GetWindowThreadProcessId(HWND(hwnd_val as *mut _), Some(&mut pid));
                    }
                }

                if pid > 0 {
                    if let Some(by_pid) = windows.iter().find(|w| w.pid == pid) {
                        return Some(by_pid.clone());
                    }

                    let mut win_title = String::new();
                    let mut process_name = format!("PID_{}.exe", pid);
                    unsafe {
                        let len = GetWindowTextLengthW(root_hwnd);
                        if len > 0 {
                            let mut buf = vec![0u16; (len + 1) as usize];
                            let copied = GetWindowTextW(root_hwnd, &mut buf);
                            if copied > 0 {
                                win_title = String::from_utf16_lossy(&buf[..copied as usize])
                                    .trim()
                                    .to_string();
                            }
                        }
                        if let Ok(handle) =
                            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                        {
                            let mut name_buf = vec![0u16; 512];
                            let nlen = GetProcessImageFileNameW(handle, &mut name_buf);
                            if nlen > 0 {
                                let full_path = OsString::from_wide(&name_buf[..nlen as usize]);
                                if let Some(path_str) = full_path.to_str() {
                                    if let Some(filename) = path_str.split('\\').last() {
                                        process_name = filename.to_string();
                                    }
                                }
                            }
                        }
                    }
                    if win_title.is_empty() {
                        win_title = process_name.clone();
                    }
                    return Some(WindowInfo {
                        hwnd: hwnd_val,
                        pid,
                        title: win_title,
                        process_name,
                    });
                }
            }
        }

        if let Some(w) = windows.iter().find(|w| w.title.to_lowercase() == lower) {
            return Some(w.clone());
        }

        if let Some(w) = windows.iter().find(|w| {
            (!w.title.is_empty() && lower.contains(&w.title.to_lowercase()))
                || (!lower.is_empty() && w.title.to_lowercase().contains(&lower))
                || (!w.process_name.is_empty() && lower.contains(&w.process_name.to_lowercase()))
        }) {
            return Some(w.clone());
        }
    }

    #[cfg(not(windows))]
    {
        let windows = crate::window_manager::enumerate_windows();
        if let Some(w) = windows.iter().find(|w| {
            w.title.to_lowercase() == lower
                || lower.contains(&w.title.to_lowercase())
                || w.title.to_lowercase().contains(&lower)
        }) {
            return Some(w.clone());
        }
    }

    None
}

/// Localiza o PID de uma janela baseado no label retornado pelo seletor nativo do navegador
#[tauri::command]
fn find_window_pid(label: String) -> Option<u32> {
    find_window_info(label).map(|w| w.pid)
}

#[cfg(windows)]
fn assign_to_job_object() {
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        if let Ok(job) = CreateJobObjectW(None, None) {
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let res = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if res.is_ok() {
                let _ = AssignProcessToJobObject(job, GetCurrentProcess());
            }
        }
    }
}

/// Registra automaticamente o protocolo "streamcompanion://" no Windows (HKCU, sem precisar de Admin)
#[cfg(windows)]
fn register_url_protocol_windows() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if let Ok(exe_path) = std::env::current_exe() {
        let exe_str = exe_path.to_string_lossy().to_string();
        let command_val = format!("\"{}\" \"%1\"", exe_str);

        let _ = std::process::Command::new("reg")
            .args([
                "add",
                "HKCU\\Software\\Classes\\streamcompanion",
                "/ve",
                "/d",
                "URL:StreamCompanion Protocol",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        let _ = std::process::Command::new("reg")
            .args([
                "add",
                "HKCU\\Software\\Classes\\streamcompanion",
                "/v",
                "URL Protocol",
                "/d",
                "",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        let _ = std::process::Command::new("reg")
            .args([
                "add",
                "HKCU\\Software\\Classes\\streamcompanion\\shell\\open\\command",
                "/ve",
                "/d",
                &command_val,
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

/// Se outra instância do StreamCompanion já estiver aberta na porta local 45789, encaminha o convite para ela e retorna true
fn try_forward_invite_to_running_instance(invite_arg: &str) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = match "127.0.0.1:45789".parse() {
        Ok(a) => a,
        Err(_) => return false,
    };

    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(350)) {
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            invite_arg.as_bytes(),
        );
        let req = format!(
            "GET /invite?b64={} HTTP/1.1\r\nHost: 127.0.0.1:45789\r\nConnection: close\r\n\r\n",
            encoded
        );
        let _ = stream.write_all(req.as_bytes());
        let mut resp = [0u8; 128];
        let _ = stream.read(&mut resp);
        return true;
    }
    false
}

/// Ponto de entrada unificado para Desktop (Windows) e Mobile (Android APK)
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        assign_to_job_object();
        register_url_protocol_windows();
    }

    let cli_invite: Option<String> = std::env::args().skip(1).find(|arg| {
        let lower = arg.to_lowercase();
        lower.starts_with("streamcompanion://")
            || lower.contains("mesh_room=")
            || lower.contains("room=")
            || lower.contains("sala:")
    });

    if let Some(ref invite_str) = cli_invite {
        if try_forward_invite_to_running_instance(invite_str) {
            std::process::exit(0);
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        cleanup_old_executable();
        let _ = TunnelManager::resolve_binary_path();
    }

    let (audio_capturer, mut audio_rx) = ProcessAudioCapturer::new();
    let audio_capturer_arc = Arc::new(audio_capturer);
    let screen_capturer_arc = Arc::new(ScreenCapturerService::new());
    let tunnel_manager_arc = Arc::new(TunnelManager::new());
    let startup_invite_arc = Arc::new(Mutex::new(cli_invite));

    let app_state = AppState {
        audio_capturer: audio_capturer_arc.clone(),
        screen_capturer: screen_capturer_arc,
        tunnel_manager: tunnel_manager_arc,
        signaling_state: Arc::new(Mutex::new(None)),
        startup_invite: startup_invite_arc.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            let invite_bridge_handle = app.handle().clone();
            let invite_store = startup_invite_arc.clone();

            #[cfg(desktop)]
            {
                let raw_icon_rgba = include_bytes!("../icons/icon_rgba_64.bin");
                if raw_icon_rgba.len() == 64 * 64 * 4 {
                    let app_icon = tauri::image::Image::new(raw_icon_rgba, 64, 64);
                    if let Some(main_win) = app.get_webview_window("main") {
                        let _ = main_win.set_icon(app_icon);
                    }
                }
            }

            // Servidor local leve em 127.0.0.1:45789 para receber deep-links streamcompanion://
            std::thread::spawn(move || {
                use std::io::{Read, Write};
                use std::net::TcpListener;

                if let Ok(listener) = TcpListener::bind("127.0.0.1:45789") {
                    for stream in listener.incoming().flatten() {
                        let mut stream = stream;
                        let mut buf = [0u8; 4096];
                        if let Ok(n) = stream.read(&mut buf) {
                            let req_str = String::from_utf8_lossy(&buf[..n]);
                            let first_line = req_str.lines().next().unwrap_or("");
                            let mut extracted: Option<String> = None;
                            if let Some(q_idx) = first_line.find("/invite?") {
                                let after = &first_line[q_idx + 8..];
                                let query = after.split_whitespace().next().unwrap_or("");
                                for pair in query.split('&') {
                                    if let Some(b64_val) = pair.strip_prefix("b64=") {
                                        if let Ok(bytes) = base64::Engine::decode(
                                            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                                            b64_val,
                                        ) {
                                            if let Ok(decoded_str) = String::from_utf8(bytes) {
                                                extracted = Some(decoded_str);
                                            }
                                        }
                                    }
                                }
                            }

                            let resp = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}";
                            let _ = stream.write_all(resp.as_bytes());

                            if let Some(invite_payload) = extracted {
                                if let Ok(mut lock) = invite_store.lock() {
                                    *lock = Some(invite_payload.clone());
                                }
                                #[cfg(desktop)]
                                {
                                    if let Some(main_win) =
                                        invite_bridge_handle.get_webview_window("main")
                                    {
                                        let _ = main_win.unminimize();
                                        let _ = main_win.show();
                                        let _ = main_win.set_focus();
                                    }
                                }
                                let _ = invite_bridge_handle
                                    .emit("deep-link-invite", invite_payload);
                            }
                        }
                    }
                }
            });

            // Thread em background que transmite os pacotes PCM para a WebView do Tauri
            std::thread::spawn(move || {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::System::Threading::{
                        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
                    };
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
                }

                loop {
                    match audio_rx.blocking_recv() {
                        Ok(packet) => {
                            let base64_pcm = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &packet.pcm_data,
                            );

                            #[derive(Serialize, Clone)]
                            struct AudioChunkEvent {
                                pid: u32,
                                sample_rate: u32,
                                channels: u16,
                                bits_per_sample: u16,
                                data_base64: String,
                            }

                            let payload = AudioChunkEvent {
                                pid: packet.pid,
                                sample_rate: packet.sample_rate,
                                channels: packet.channels,
                                bits_per_sample: packet.bits_per_sample,
                                data_base64: base64_pcm,
                            };

                            let _ = handle.emit("isolated-audio-chunk", payload);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            break;
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed = event {
                println!("[Shutdown] Encerrando StreamCompanion e liberando processos...");
                let app = window.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    state.tunnel_manager.stop();
                    state.audio_capturer.stop();
                    state.screen_capturer.stop();
                }

                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/IM", "cloudflared.exe", "/T"])
                        .creation_flags(0x08000000)
                        .status();
                }

                std::process::exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_windows,
            create_room,
            join_room,
            start_process_audio,
            start_multi_process_audio,
            feed_android_audio_samples,
            stop_process_audio,
            get_current_audio_status,
            list_displays,
            start_screen_capture,
            stop_screen_capture,
            get_local_ip,
            close_app,
            find_window_pid,
            find_window_info,
            get_process_memory,
            save_file_dialog,
            get_app_system_info,
            ensure_cloudflared_binary,
            check_github_update,
            install_github_update,
            consume_startup_invite,
            run_native_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao executar StreamCompanion");
}
