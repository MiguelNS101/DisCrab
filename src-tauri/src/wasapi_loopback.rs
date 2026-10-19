//! Módulo de Captura de Áudio Isolado por Processo (WASAPI Process Loopback)
//! Utiliza a API nativa do Windows 10 (Build 20348+) e Windows 11:
//! ActivateAudioInterfaceAsync com VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK (VAD\Process_Loopback)
//! Modos:
//! - PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE (0): captura SOMENTE a janela/jogo alvo
//! - PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE (1): captura todo o PC EXCLUINDO o Discord
//! Garante áudio contínuo a 48kHz Estéreo sem cortes, sem engasgos e com zero eco!

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

// Constantes da API de Process Loopback do Windows 10 20348+ / Windows 11
pub const AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK: u32 = 1;
pub const PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE: u32 = 0;
pub const PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE: u32 = 1;

// Flags do mixer WASAPI para reamostragem automática no kernel para 48kHz Estéreo
#[cfg(windows)]
const STREAMFLAGS_AUTOCONVERTPCM: u32 = 0x8000_0000;
#[cfg(windows)]
const STREAMFLAGS_SRC_DEFAULT_QUALITY: u32 = 0x0800_0000;

/// Representa um pacote de áudio PCM capturado do processo (normalizado em 16-bit Estéreo)
#[derive(Debug, Clone)]
pub struct PcmAudioPacket {
    pub pid: u32,
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub pcm_data: Vec<u8>,
}

/// Estado global da sessão de captura de áudio
pub struct ProcessAudioCapturer {
    active_flag: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    target_pid: Arc<Mutex<Option<u32>>>,
    active_pids: Arc<Mutex<Vec<u32>>>,
    audio_sender: broadcast::Sender<PcmAudioPacket>,
}

impl ProcessAudioCapturer {
    pub fn new() -> (Self, broadcast::Receiver<PcmAudioPacket>) {
        let (tx, rx) = broadcast::channel(256);
        (
            Self {
                active_flag: Arc::new(Mutex::new(None)),
                target_pid: Arc::new(Mutex::new(None)),
                active_pids: Arc::new(Mutex::new(Vec::new())),
                audio_sender: tx,
            },
            rx,
        )
    }

    pub fn get_sender(&self) -> broadcast::Sender<PcmAudioPacket> {
        self.audio_sender.clone()
    }

    pub fn is_running(&self) -> bool {
        let flag_guard = self.active_flag.lock().unwrap();
        flag_guard
            .as_ref()
            .map(|f| f.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    pub fn get_current_pid(&self) -> Option<u32> {
        *self.target_pid.lock().unwrap()
    }

    pub fn stop(&self) {
        let mut flag_guard = self.active_flag.lock().unwrap();
        if let Some(flag) = flag_guard.take() {
            flag.store(false, Ordering::SeqCst);
        }
        let mut pid_lock = self.target_pid.lock().unwrap();
        *pid_lock = None;
        let mut active_pids_lock = self.active_pids.lock().unwrap();
        active_pids_lock.clear();
    }

    /// Inicia a captura WASAPI para múltiplos PIDs mixados simultaneamente
    pub fn start_multiple(&self, pids: Vec<u32>) -> Result<(), String> {
        let mut effective_pids: Vec<u32> = Vec::new();
        for p in pids {
            if !effective_pids.contains(&p) {
                effective_pids.push(p);
            }
        }
        if effective_pids.is_empty() {
            effective_pids.push(0);
        }

        // Evita reiniciar a captura WASAPI se os mesmos PIDs já estiverem rodando ativamente
        if self.is_running() {
            let current_pids = self.active_pids.lock().unwrap().clone();
            if current_pids == effective_pids {
                return Ok(());
            }
        }

        self.stop(); // Interrompe qualquer captura anterior

        // Breve pausa para que as threads WASAPI anteriores finalizem e liberem os endpoints
        std::thread::sleep(Duration::from_millis(25));

        let new_flag = Arc::new(AtomicBool::new(true));
        let primary_pid = effective_pids.first().copied().unwrap_or(0);
        {
            let mut flag_guard = self.active_flag.lock().unwrap();
            *flag_guard = Some(new_flag.clone());
            let mut pid_lock = self.target_pid.lock().unwrap();
            *pid_lock = Some(primary_pid);
            let mut active_pids_lock = self.active_pids.lock().unwrap();
            *active_pids_lock = effective_pids.clone();
        }

        for target_pid in effective_pids {
            let running_flag = new_flag.clone();
            let sender = self.audio_sender.clone();

            #[cfg(windows)]
            {
                std::thread::Builder::new()
                    .name(format!("wasapi-loopback-pid-{}", target_pid))
                    .spawn(move || {
                        if let Err(e) = run_wasapi_capture_loop(target_pid, running_flag, sender) {
                            eprintln!("[WASAPI Error] Falha na captura do PID {}: {}", target_pid, e);
                        }
                    })
                    .map_err(|e| {
                        format!(
                            "Falha ao criar thread de captura de áudio para PID {}: {}",
                            target_pid, e
                        )
                    })?;
            }

            #[cfg(not(windows))]
            {
                // Simulação de áudio suave para testes de desenvolvimento fora do Windows
                std::thread::Builder::new()
                    .name(format!("mock-audio-loopback-pid-{}", target_pid))
                    .spawn(move || {
                        let mut sample_index: f32 = 0.0;
                        while running_flag.load(Ordering::SeqCst) {
                            let sample_rate = 48000u32;
                            let chunk_size = 720; // 15ms a 48kHz
                            let mut byte_data = Vec::with_capacity(chunk_size * 4);

                            for _ in 0..chunk_size {
                                let freq = 440.0 + (target_pid as f32 % 5.0) * 80.0;
                                let val = (sample_index * 2.0 * std::f32::consts::PI * freq / 48000.0).sin() * 0.15;
                                let s16 = (val.clamp(-1.0, 1.0) * 32767.0) as i16;
                                byte_data.extend_from_slice(&s16.to_le_bytes());
                                byte_data.extend_from_slice(&s16.to_le_bytes());
                                sample_index += 1.0;
                            }

                            let packet = PcmAudioPacket {
                                pid: target_pid,
                                sample_rate,
                                channels: 2,
                                bits_per_sample: 16,
                                pcm_data: byte_data,
                            };

                            let _ = sender.send(packet);
                            std::thread::sleep(Duration::from_millis(15));
                        }
                    })
                    .map_err(|e| format!("Falha ao criar mock de áudio: {}", e))?;
            }
        }

        Ok(())
    }

    /// Inicia a captura WASAPI para um único PID
    pub fn start(&self, pid: u32) -> Result<(), String> {
        self.start_multiple(vec![pid])
    }
}

// -------------------------------------------------------------------------------------------------
// IMPLEMENTAÇÃO WASAPI REAL NO WINDOWS COM ActivateAudioInterfaceAsync
// -------------------------------------------------------------------------------------------------

#[cfg(windows)]
#[repr(C)]
struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
    target_process_id: u32,
    process_loopback_mode: u32,
}

#[cfg(windows)]
#[repr(C)]
struct AUDIOCLIENT_ACTIVATION_PARAMS {
    activation_type: u32,
    process_loopback_params: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
}

#[cfg(windows)]
#[repr(C)]
struct CustomPropVariantBlob {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    cb_size: u32,
    _pad: u32,
    p_blob_data: *mut u8,
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct CompletionHandlerVtbl {
    QueryInterface: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *const windows::core::GUID,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    AddRef: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    Release: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    ActivateCompleted: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct AsyncOperationVtbl {
    QueryInterface: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *const windows::core::GUID,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    AddRef: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    Release: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    GetActivateResult: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::core::HRESULT,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[allow(dead_code)]
struct CompletionHandlerData {
    vtbl: &'static CompletionHandlerVtbl,
    ref_count: std::sync::atomic::AtomicU32,
    event: windows::Win32::Foundation::HANDLE,
    result: std::sync::Mutex<Option<windows::Win32::Media::Audio::IAudioClient>>,
}

#[cfg(windows)]
static COMPLETION_VTBL: CompletionHandlerVtbl = CompletionHandlerVtbl {
    QueryInterface: query_interface,
    AddRef: add_ref,
    Release: release,
    ActivateCompleted: activate_completed,
};

#[cfg(windows)]
unsafe extern "system" fn query_interface(
    this: *mut std::ffi::c_void,
    _riid: *const windows::core::GUID,
    ppv: *mut *mut std::ffi::c_void,
) -> windows::core::HRESULT {
    if ppv.is_null() {
        return windows::Win32::Foundation::E_INVALIDARG;
    }
    *ppv = this;
    add_ref(this);
    windows::core::HRESULT(0)
}

#[cfg(windows)]
unsafe extern "system" fn add_ref(this: *mut std::ffi::c_void) -> u32 {
    let data = &*(this as *mut CompletionHandlerData);
    data.ref_count.fetch_add(1, Ordering::SeqCst) + 1
}

#[cfg(windows)]
unsafe extern "system" fn release(this: *mut std::ffi::c_void) -> u32 {
    let data = &*(this as *mut CompletionHandlerData);
    data.ref_count.fetch_sub(1, Ordering::SeqCst) - 1
}

#[cfg(windows)]
unsafe extern "system" fn activate_completed(
    this: *mut std::ffi::c_void,
    operation: *mut std::ffi::c_void,
) -> windows::core::HRESULT {
    let data = &*(this as *mut CompletionHandlerData);
    if !operation.is_null() {
        let op_vtable = *(operation as *mut *const AsyncOperationVtbl);
        let mut hr = windows::core::HRESULT(0);
        let mut punk: *mut std::ffi::c_void = std::ptr::null_mut();
        let res = ((*op_vtable).GetActivateResult)(operation, &mut hr, &mut punk);
        if res.0 == 0 && hr.0 == 0 && !punk.is_null() {
            let client: windows::Win32::Media::Audio::IAudioClient = std::mem::transmute(punk);
            *data.result.lock().unwrap() = Some(client);
        } else {
            eprintln!(
                "[WASAPI Async] GetActivateResult retornou hr: 0x{:08X}, res: 0x{:08X}",
                hr.0, res.0
            );
        }
    }
    let _ = windows::Win32::System::Threading::SetEvent(data.event);
    windows::core::HRESULT(0)
}

#[cfg(windows)]
#[allow(non_snake_case)]
type ActivateAudioInterfaceAsyncFn = unsafe extern "system" fn(
    deviceInterfacePath: windows::core::PCWSTR,
    riid: *const windows::core::GUID,
    activationParams: *const std::ffi::c_void,
    completionHandler: *mut std::ffi::c_void,
    activationOperation: *mut *mut std::ffi::c_void,
) -> windows::core::HRESULT;

#[cfg(windows)]
unsafe fn activate_process_loopback_client(
    target_pid: u32,
    loopback_mode: u32,
) -> Result<windows::Win32::Media::Audio::IAudioClient, String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::IAudioClient;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    let mmdevapi = LoadLibraryW(windows::core::w!("mmdevapi.dll"))
        .map_err(|e| format!("Falha ao carregar mmdevapi.dll: {}", e))?;

    let proc = GetProcAddress(mmdevapi, windows::core::s!("ActivateAudioInterfaceAsync"))
        .ok_or_else(|| "ActivateAudioInterfaceAsync não suportado nesta versão do Windows".to_string())?;

    let activate_fn: ActivateAudioInterfaceAsyncFn = std::mem::transmute(proc);

    let event =
        CreateEventW(None, false, false, None).map_err(|e| format!("CreateEventW falhou: {}", e))?;

    let handler_data = std::sync::Arc::new(CompletionHandlerData {
        vtbl: &COMPLETION_VTBL,
        ref_count: std::sync::atomic::AtomicU32::new(1),
        event,
        result: std::sync::Mutex::new(None),
    });

    let mut activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
        activation_type: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        process_loopback_params: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
            target_process_id: target_pid,
            process_loopback_mode: loopback_mode,
        },
    };

    let pv = CustomPropVariantBlob {
        vt: 65, // VT_BLOB
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        _pad: 0,
        p_blob_data: &mut activation_params as *mut _ as *mut u8,
    };

    let mut async_op: *mut std::ffi::c_void = std::ptr::null_mut();
    let handler_ptr = std::sync::Arc::as_ptr(&handler_data) as *mut std::ffi::c_void;

    // VAD\Process_Loopback é a constante oficial do Windows SDK (audioclientactivationparams.h)
    let hr = activate_fn(
        windows::core::w!("VAD\\Process_Loopback"),
        &IAudioClient::IID,
        &pv as *const _ as *const std::ffi::c_void,
        handler_ptr,
        &mut async_op,
    );

    if hr.0 != 0 {
        let _ = CloseHandle(event);
        return Err(format!(
            "ActivateAudioInterfaceAsync falhou com HRESULT 0x{:08X}",
            hr.0
        ));
    }

    // Aguarda conclusão assíncrona da ativação (timeout de 3.5 segundos)
    let wait_res = WaitForSingleObject(event, 3500);
    let _ = CloseHandle(event);

    if wait_res == windows::Win32::Foundation::WAIT_OBJECT_0 {
        let mut lock = handler_data.result.lock().unwrap();
        if let Some(client) = lock.take() {
            println!(
                "[WASAPI Native] IAudioClient ativado com sucesso para PID: {}, Modo: {}",
                target_pid, loopback_mode
            );
            return Ok(client);
        }
    }

    Err("Timeout ou falha ao receber interface IAudioClient ativada do Windows".to_string())
}

/// Localiza o processo raiz do Discord no sistema varrendo todos os processos em execução via Win32 ToolHelp.
#[cfg(windows)]
pub fn find_discord_root_pid() -> Option<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut discord_processes: Vec<(u32, u32)> = Vec::new();

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let null_pos = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let exe_name =
                    String::from_utf16_lossy(&entry.szExeFile[..null_pos]).to_lowercase();

                if exe_name == "discord.exe"
                    || exe_name == "discordcanary.exe"
                    || exe_name == "discordptb.exe"
                    || exe_name == "discorddevelopment.exe"
                {
                    discord_processes.push((entry.th32ProcessID, entry.th32ParentProcessID));
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);

        if discord_processes.is_empty() {
            return None;
        }

        let pids: std::collections::HashSet<u32> =
            discord_processes.iter().map(|&(p, _)| p).collect();
        let root = discord_processes
            .iter()
            .find(|(_, parent)| !pids.contains(parent))
            .map(|&(pid, _)| pid)
            .unwrap_or(discord_processes[0].0);

        println!(
            "[WASAPI] Processo raiz do Discord localizado com sucesso: PID {} (total de {} processos do Discord)",
            root,
            discord_processes.len()
        );
        Some(root)
    }
}

/// Converte qualquer buffer capturado (Float32 ou Int16, 1..8 canais) para Estéreo 16-bit Signed PCM (4 bytes/frame)
#[cfg(windows)]
fn append_converted_stereo_s16(
    dst: &mut Vec<u8>,
    raw_bytes: &[u8],
    num_frames: usize,
    channels: usize,
    bits_per_sample: u16,
    is_float: bool,
) {
    if num_frames == 0 || channels == 0 {
        return;
    }
    let bytes_per_sample = (bits_per_sample as usize) / 8;
    let frame_stride = channels * bytes_per_sample;
    if raw_bytes.len() < num_frames * frame_stride {
        return;
    }

    dst.reserve(num_frames * 4);

    if is_float && bits_per_sample == 32 {
        for f in 0..num_frames {
            let base = f * frame_stride;
            let l = f32::from_le_bytes([
                raw_bytes[base],
                raw_bytes[base + 1],
                raw_bytes[base + 2],
                raw_bytes[base + 3],
            ]);
            let r = if channels > 1 {
                f32::from_le_bytes([
                    raw_bytes[base + 4],
                    raw_bytes[base + 5],
                    raw_bytes[base + 6],
                    raw_bytes[base + 7],
                ])
            } else {
                l
            };
            let l_s16 = (l.clamp(-1.0, 1.0) * 32767.0) as i16;
            let r_s16 = (r.clamp(-1.0, 1.0) * 32767.0) as i16;
            dst.extend_from_slice(&l_s16.to_le_bytes());
            dst.extend_from_slice(&r_s16.to_le_bytes());
        }
    } else if bits_per_sample == 16 {
        for f in 0..num_frames {
            let base = f * frame_stride;
            let l_s16 = i16::from_le_bytes([raw_bytes[base], raw_bytes[base + 1]]);
            let r_s16 = if channels > 1 {
                i16::from_le_bytes([raw_bytes[base + 2], raw_bytes[base + 3]])
            } else {
                l_s16
            };
            dst.extend_from_slice(&l_s16.to_le_bytes());
            dst.extend_from_slice(&r_s16.to_le_bytes());
        }
    } else if bits_per_sample == 32 {
        // 32-bit Int PCM
        for f in 0..num_frames {
            let base = f * frame_stride;
            let l_i32 = i32::from_le_bytes([
                raw_bytes[base],
                raw_bytes[base + 1],
                raw_bytes[base + 2],
                raw_bytes[base + 3],
            ]);
            let r_i32 = if channels > 1 {
                i32::from_le_bytes([
                    raw_bytes[base + 4],
                    raw_bytes[base + 5],
                    raw_bytes[base + 6],
                    raw_bytes[base + 7],
                ])
            } else {
                l_i32
            };
            let l_s16 = (l_i32 >> 16) as i16;
            let r_s16 = (r_i32 >> 16) as i16;
            dst.extend_from_slice(&l_s16.to_le_bytes());
            dst.extend_from_slice(&r_s16.to_le_bytes());
        }
    }
}

#[cfg(windows)]
fn run_wasapi_capture_loop(
    pid: u32,
    running: Arc<AtomicBool>,
    sender: broadcast::Sender<PcmAudioPacket>,
) -> Result<(), String> {
    use std::ptr;
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        CreateEventW, GetCurrentThread, SetThreadPriority, WaitForSingleObject,
        THREAD_PRIORITY_HIGHEST,
    };

    unsafe {
        // Eleva prioridade da thread de áudio para que codificação de vídeo 1080p/1440p nunca cause cortes no som
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);

        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx falhou: {}", e))?;

        // 1. Determina modo e PID alvo
        let mut audio_client_opt: Option<IAudioClient> = None;

        let (target_pid, loopback_mode) = if pid > 0 {
            println!(
                "[WASAPI] MODO JANELA: Configurando captura exclusiva para processo PID {}",
                pid
            );
            (Some(pid), PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE)
        } else {
            if let Some(d_pid) = find_discord_root_pid() {
                println!(
                    "[WASAPI] MODO TELA: Discord detectado (PID raiz {}). Excluindo 100% dos sons do Discord!",
                    d_pid
                );
                (Some(d_pid), PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE)
            } else {
                println!(
                    "[WASAPI] MODO TELA: Discord não encontrado em execução. Capturando áudio global do sistema."
                );
                (None, 0)
            }
        };

        // 2. Tenta ativação nativa por processo (Windows 10 20348+ e Windows 11)
        if let Some(t_pid) = target_pid {
            match activate_process_loopback_client(t_pid, loopback_mode) {
                Ok(client) => {
                    audio_client_opt = Some(client);
                }
                Err(err) => {
                    eprintln!(
                        "[WASAPI] ActivateAudioInterfaceAsync falhou ({}), usando fallback de dispositivo...",
                        err
                    );
                }
            }
        }

        // 3. Fallback: Se não conseguir isolar por processo, ativa o dispositivo padrão de render
        let audio_client: IAudioClient = match audio_client_opt {
            Some(client) => client,
            None => {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                        .map_err(|e| format!("CoCreateInstance falhou: {}", e))?;
                let device = enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|e| format!("GetDefaultAudioEndpoint falhou: {}", e))?;
                device
                    .Activate::<IAudioClient>(CLSCTX_ALL, None)
                    .map_err(|e| format!("device.Activate falhou: {}", e))?
            }
        };

        // 4. Preferência 1: Inicializa com AUTOCONVERTPCM em 48.000 Hz, 2 Canais (Estéreo), 32-bit IEEE Float.
        // O próprio mixer de kernel do Windows converte qualquer headset 44.1kHz/96kHz ou 5.1/7.1 para 48kHz Estéreo!
        let desired_format = WAVEFORMATEX {
            wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
            nChannels: 2,
            nSamplesPerSec: 48000,
            nAvgBytesPerSec: 48000 * 2 * 4,
            nBlockAlign: 8,
            wBitsPerSample: 32,
            cbSize: 0,
        };

        let autoconvert_flags = AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            | STREAMFLAGS_AUTOCONVERTPCM
            | STREAMFLAGS_SRC_DEFAULT_QUALITY;

        let mut sample_rate = 48000u32;
        let mut channels = 2u16;
        let mut bits_per_sample = 32u16;
        let mut is_float = true;
        let mut fallback_format_ptr: Option<*mut WAVEFORMATEX> = None;

        let init_autoconvert = audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            autoconvert_flags,
            400_000, // 40ms de buffer interno de baixa latência
            0,
            &desired_format,
            None,
        );

        if init_autoconvert.is_err() {
            // Fallback: usa o formato nativo do endpoint caso AUTOCONVERTPCM não seja aceito pelo driver
            let endpoint_format = audio_client.GetMixFormat().ok().or_else(|| {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
                let dev = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
                let client: IAudioClient = dev.Activate(CLSCTX_ALL, None).ok()?;
                client.GetMixFormat().ok()
            });

            if let Some(ptr) = endpoint_format {
                let wf = &*ptr;
                sample_rate = wf.nSamplesPerSec;
                channels = wf.nChannels;
                bits_per_sample = wf.wBitsPerSample;
                // No Windows MixFormat compartilhado, 32-bit é IEEE Float (wFormatTag == 3 ou WAVE_FORMAT_EXTENSIBLE 0xFFFE)
                is_float = bits_per_sample == 32;
                fallback_format_ptr = Some(ptr);

                audio_client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                        1_000_000,
                        0,
                        ptr,
                        None,
                    )
                    .map_err(|e| format!("IAudioClient::Initialize (fallback) falhou: {}", e))?;
            } else {
                audio_client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                        1_000_000,
                        0,
                        &desired_format,
                        None,
                    )
                    .map_err(|e| format!("IAudioClient::Initialize falhou: {}", e))?;
            }
        }

        let event_handle = CreateEventW(None, false, false, None)
            .map_err(|e| format!("CreateEventW falhou: {}", e))?;

        audio_client
            .SetEventHandle(event_handle)
            .map_err(|e| format!("SetEventHandle falhou: {}", e))?;

        let capture_client: IAudioCaptureClient = audio_client
            .GetService()
            .map_err(|e| format!("GetService(IAudioCaptureClient) falhou: {}", e))?;

        audio_client
            .Start()
            .map_err(|e| format!("audio_client.Start falhou: {}", e))?;

        println!(
            "[WASAPI] Captura ativa (PID {}): entrada {} Hz {}ch {}-bit -> saída contínua Estéreo 16-bit",
            pid, sample_rate, channels, bits_per_sample
        );

        let src_bytes_per_frame = (channels as usize) * ((bits_per_sample as usize) / 8);
        // Saída sempre em Estéreo 16-bit (4 bytes por frame). Agrupa a cada ~15ms (~720 frames a 48kHz = 2880 bytes)
        let out_batch_bytes = ((sample_rate as usize) / 66) * 4;
        let mut accumulated_s16_bytes = Vec::with_capacity(out_batch_bytes * 2);
        let mut last_dispatch = Instant::now();

        // 5. Loop de captura de alta precisão (timeout de 10ms para nunca reter amostras no buffer)
        while running.load(Ordering::SeqCst) {
            let wait_res = WaitForSingleObject(event_handle, 10);
            if wait_res == WAIT_OBJECT_0 || wait_res.0 == 0x0000_0102 {
                // 0x102 == WAIT_TIMEOUT: também verifica se há pacotes disponíveis no capture_client
                loop {
                    let mut data_ptr: *mut u8 = ptr::null_mut();
                    let mut num_frames_read: u32 = 0;
                    let mut flags: u32 = 0;

                    let hr = capture_client.GetBuffer(
                        &mut data_ptr,
                        &mut num_frames_read,
                        &mut flags,
                        None::<*mut u64>,
                        None::<*mut u64>,
                    );

                    if hr.is_err() || num_frames_read == 0 {
                        break;
                    }

                    let frames = num_frames_read as usize;
                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data_ptr.is_null() {
                        accumulated_s16_bytes.resize(accumulated_s16_bytes.len() + frames * 4, 0);
                    } else {
                        let raw_slice =
                            std::slice::from_raw_parts(data_ptr, frames * src_bytes_per_frame);
                        append_converted_stereo_s16(
                            &mut accumulated_s16_bytes,
                            raw_slice,
                            frames,
                            channels as usize,
                            bits_per_sample,
                            is_float,
                        );
                    }

                    let _ = capture_client.ReleaseBuffer(num_frames_read);

                    if accumulated_s16_bytes.len() >= out_batch_bytes {
                        let packet = PcmAudioPacket {
                            pid,
                            sample_rate,
                            channels: 2,
                            bits_per_sample: 16,
                            pcm_data: std::mem::replace(
                                &mut accumulated_s16_bytes,
                                Vec::with_capacity(out_batch_bytes * 2),
                            ),
                        };
                        let _ = sender.send(packet);
                        last_dispatch = Instant::now();
                    }
                }
            }

            // Se houver amostras parciais retidas há mais de 15ms, despacha imediatamente para evitar buracos
            if !accumulated_s16_bytes.is_empty() && last_dispatch.elapsed() >= Duration::from_millis(15) {
                let packet = PcmAudioPacket {
                    pid,
                    sample_rate,
                    channels: 2,
                    bits_per_sample: 16,
                    pcm_data: std::mem::replace(
                        &mut accumulated_s16_bytes,
                        Vec::with_capacity(out_batch_bytes * 2),
                    ),
                };
                let _ = sender.send(packet);
                last_dispatch = Instant::now();
            }
        }

        let _ = audio_client.Stop();
        let _ = CloseHandle(event_handle);
        if let Some(ptr) = fallback_format_ptr {
            CoTaskMemFree(Some(ptr as *mut _));
        }
        CoUninitialize();
    }

    Ok(())
}
