// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scrap_capture;
mod signaling;
mod tunnel;
mod wasapi_loopback;
mod window_manager;

use scrap_capture::{DisplayInfo, ScreenCapturerService};
use signaling::{start_signaling_server, SignalingServerState};
use tunnel::{decode_room_code, encode_room_code, TunnelManager};
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

/// Estado Global compartilhado no Tauri
pub struct AppState {
    pub audio_capturer: Arc<ProcessAudioCapturer>,
    pub screen_capturer: Arc<ScreenCapturerService>,
    pub tunnel_manager: Arc<TunnelManager>,
    pub signaling_state: Arc<Mutex<Option<Arc<SignalingServerState>>>>,
}

// ---------------------------------------------------------
// COMANDOS TAURI EXPOSTOS PARA O FRONTEND REACT
// ---------------------------------------------------------

/// Lista todas as janelas abertas no Windows exibindo HWND, PID, título e executável
#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    enumerate_windows()
}

/// Inicia a sala do Host:
/// 1. Sobe o servidor WebSocket local em porta dinâmica
/// 2. Gera Token de 6 caracteres
/// 3. Inicia o Cloudflare Quick Tunnel em background
/// 4. Empacota e codifica o Código da Sala em Base64 URL-Safe
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

    // Salva o estado do servidor na memória da aplicação
    {
        let mut sig_lock = state.signaling_state.lock().unwrap();
        *sig_lock = Some(server_state);
    }

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    if use_cloudflare {
        // 2. Modo WAN com Cloudflare Quick Tunnel
        let tunnel_mgr = state.tunnel_manager.clone();
        let (subdomain, public_url) = tunnel_mgr.start_quick_tunnel(port)?;

        // 3. Empacota "subdominio:token" e gera o Código da Sala Base64 URL-Safe
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
        // Modo LAN / Roteador Direto: "ip:porta:token" -> Base64
        let target = format!("{}:{}", local_ip, port);
        let room_code = encode_room_code(&target, &token);
        println!("[Host] Sala criada em modo LAN! Código: {}", room_code);

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

/// Inicia a captura de áudio exclusiva do processo (WASAPI Process Loopback)
/// Elimina totalmente o áudio do Discord e sons de outras abas/jogos
#[tauri::command]
fn start_process_audio(pid: u32, state: State<'_, AppState>) -> Result<(), String> {
    println!("[Audio] Iniciando WASAPI Process Loopback para PID {}", pid);
    state.audio_capturer.start(pid)
}

/// Inicia a captura de áudio simultânea para múltiplos processos (Mixagem WASAPI de múltiplas fontes)
#[tauri::command]
fn start_multi_process_audio(pids: Vec<u32>, state: State<'_, AppState>) -> Result<(), String> {
    println!("[Audio] Iniciando WASAPI Process Loopback para múltiplos PIDs: {:?}", pids);
    state.audio_capturer.start_multiple(pids)
}

/// Interrompe a captura de áudio isolada
#[tauri::command]
fn stop_process_audio(state: State<'_, AppState>) -> Result<(), String> {
    println!("[Audio] Parando captura WASAPI de processo");
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

/// Lista os monitores físicos conectados via DirectX/Scrap
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

/// Retorna o IP local da máquina na rede LAN
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
        use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use windows::Win32::System::Threading::GetCurrentProcess;
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        unsafe {
            if K32GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            ).as_bool() {
                let mb = (counters.WorkingSetSize as f64) / (1024.0 * 1024.0);
                return (mb * 10.0).round() / 10.0;
            }
        }
    }
    0.0
}

/// Abre o seletor nativo do sistema para escolher onde salvar o arquivo
#[tauri::command]
fn save_file_dialog(app: tauri::AppHandle, default_name: String, base64_data: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app.dialog().file().set_file_name(&default_name).blocking_save_file();
    if let Some(path) = file_path {
        let path_buf = path.as_path().ok_or_else(|| "Caminho de arquivo inválido".to_string())?;
        let clean_base64 = if let Some(idx) = base64_data.find(',') {
            &base64_data[idx + 1..]
        } else {
            &base64_data
        };
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            clean_base64,
        ).map_err(|e| format!("Falha ao decodificar base64: {}", e))?;

        std::fs::write(path_buf, bytes).map_err(|e| format!("Falha ao salvar arquivo no disco: {}", e))?;
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

/// Localiza o PID de uma janela baseado no label retornado pelo seletor nativo do navegador (ex: "window:12345:0") ou título
#[tauri::command]
fn find_window_pid(label: String) -> Option<u32> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

        let lower = label.to_lowercase();
        // 1. Tenta extrair HWND se o label estiver no formato "window:123456:0"
        if let Some(pos) = lower.find("window:") {
            let rest = &label[pos + 7..];
            let hwnd_str = rest.split(':').next().unwrap_or(rest).trim();
            if let Ok(hwnd_val) = hwnd_str.parse::<isize>() {
                let mut pid = 0u32;
                unsafe {
                    GetWindowThreadProcessId(HWND(hwnd_val as *mut _), Some(&mut pid));
                }
                if pid > 0 {
                    println!("[Window] PID identificado via HWND {}: PID {}", hwnd_val, pid);
                    return Some(pid);
                }
            }
        }

        // 2. Procura nas janelas ativas por título ou processo
        let windows = crate::window_manager::enumerate_windows();

        // Correspondência exata
        if let Some(w) = windows.iter().find(|w| w.title.to_lowercase() == lower) {
            println!("[Window] PID identificado por título exato: PID {} ({})", w.pid, w.process_name);
            return Some(w.pid);
        }

        // Correspondência parcial
        if let Some(w) = windows.iter().find(|w| {
            (!w.title.is_empty() && lower.contains(&w.title.to_lowercase()))
                || (!lower.is_empty() && w.title.to_lowercase().contains(&lower))
                || (!w.process_name.is_empty() && lower.contains(&w.process_name.to_lowercase()))
        }) {
            println!("[Window] PID identificado por correspondência: PID {} ({})", w.pid, w.process_name);
            return Some(w.pid);
        }
    }
    None
}

#[cfg(windows)]
fn assign_to_job_object() {
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, SetInformationJobObject, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        AssignProcessToJobObject,
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

fn main() {
    #[cfg(windows)]
    assign_to_job_object();

    let (audio_capturer, mut audio_rx) = ProcessAudioCapturer::new();
    let audio_capturer_arc = Arc::new(audio_capturer);
    let screen_capturer_arc = Arc::new(ScreenCapturerService::new());
    let tunnel_manager_arc = Arc::new(TunnelManager::new());

    let app_state = AppState {
        audio_capturer: audio_capturer_arc.clone(),
        screen_capturer: screen_capturer_arc,
        tunnel_manager: tunnel_manager_arc,
        signaling_state: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            let handle = app.handle().clone();

            // Thread em background que transmite os pacotes PCM isolados para a WebView do Tauri
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
                            // Continua normalmente se houver descarte por lag
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
                    // Garante que o cloudflared.exe seja totalmente encerrado para não travar a pasta
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
            stop_process_audio,
            get_current_audio_status,
            list_displays,
            start_screen_capture,
            stop_screen_capture,
            get_local_ip,
            close_app,
            find_window_pid,
            get_process_memory,
            save_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao executar StreamCompanion");
}
