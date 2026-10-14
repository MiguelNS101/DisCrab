//! Módulo de Captura de Áudio Isolado por Processo (WASAPI Process Loopback)
//! Utiliza a API nativa do Windows 10 (Build 20348+) e Windows 11:
//! ActivateAudioInterfaceAsync com AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
//! Modo: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
//! Garante que APENAS o jogo ou janela alvo seja gravado, eliminando 100% do eco do Discord!

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

// Constantes da API de Process Loopback do Windows 10 20348+ / Windows 11
pub const AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK: u32 = 1;
pub const PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE: u32 = 0;
pub const PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE: u32 = 1;

// GUID especial do dispositivo virtual de loopback por processo:
// VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK: {2eef81be-33fa-4800-9670-1cd474972c3f}
pub const VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK: &str =
    "{2eef81be-33fa-4800-9670-1cd474972c3f}";

/// Representa um pacote de áudio PCM capturado do processo
#[derive(Debug, Clone)]
pub struct PcmAudioPacket {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub pcm_data: Vec<u8>,
}

/// Estado global da sessão de captura de áudio
pub struct ProcessAudioCapturer {
    running: Arc<AtomicBool>,
    target_pid: Arc<Mutex<Option<u32>>>,
    audio_sender: broadcast::Sender<PcmAudioPacket>,
}

impl ProcessAudioCapturer {
    pub fn new() -> (Self, broadcast::Receiver<PcmAudioPacket>) {
        let (tx, rx) = broadcast::channel(128);
        (
            Self {
                running: Arc::new(AtomicBool::new(false)),
                target_pid: Arc::new(Mutex::new(None)),
                audio_sender: tx,
            },
            rx,
        )
    }

    pub fn get_sender(&self) -> broadcast::Sender<PcmAudioPacket> {
        self.audio_sender.clone()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn get_current_pid(&self) -> Option<u32> {
        *self.target_pid.lock().unwrap()
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let mut pid_lock = self.target_pid.lock().unwrap();
        *pid_lock = None;
    }

    pub fn start(&self, pid: u32) -> Result<(), String> {
        self.stop(); // Interrompe qualquer captura anterior
        self.running.store(true, Ordering::SeqCst);
        {
            let mut pid_lock = self.target_pid.lock().unwrap();
            *pid_lock = Some(pid);
        }

        let running_flag = self.running.clone();
        let sender = self.audio_sender.clone();

        #[cfg(windows)]
        {
            std::thread::Builder::new()
                .name(format!("wasapi-loopback-pid-{}", pid))
                .spawn(move || {
                    if let Err(e) = run_wasapi_capture_loop(pid, running_flag, sender) {
                        eprintln!("[WASAPI Error] Falha na captura do PID {}: {}", pid, e);
                    }
                })
                .map_err(|e| format!("Falha ao criar thread de captura de áudio: {}", e))?;
        }

        #[cfg(not(windows))]
        {
            // Simulação de geração de áudio estéreo 48kHz em ambiente não-Windows
            std::thread::Builder::new()
                .name(format!("mock-audio-loopback-pid-{}", pid))
                .spawn(move || {
                    let mut sample_index: f32 = 0.0;
                    while running_flag.load(Ordering::SeqCst) {
                        let sample_rate = 48000u32;
                        let chunk_size = 480; // 10ms a 48kHz
                        let mut pcm_floats = Vec::with_capacity(chunk_size * 2);

                        for _ in 0..chunk_size {
                            // Tom senoidal suave de 440Hz para demonstrar captura
                            let val = (sample_index * 2.0 * std::f32::consts::PI * 440.0 / 48000.0).sin() * 0.15;
                            pcm_floats.push(val); // canal esquerdo
                            pcm_floats.push(val); // canal direito
                            sample_index += 1.0;
                        }

                        let mut byte_data = Vec::with_capacity(pcm_floats.len() * 4);
                        for sample in pcm_floats {
                            byte_data.extend_from_slice(&sample.to_le_bytes());
                        }

                        let packet = PcmAudioPacket {
                            sample_rate,
                            channels: 2,
                            bits_per_sample: 32,
                            pcm_data: byte_data,
                        };

                        let _ = sender.send(packet);
                        std::thread::sleep(Duration::from_millis(10));
                    }
                })
                .map_err(|e| format!("Falha ao criar mock de áudio: {}", e))?;
        }

        Ok(())
    }
}

#[cfg(windows)]
fn run_wasapi_capture_loop(
    pid: u32,
    running: Arc<AtomicBool>,
    sender: broadcast::Sender<PcmAudioPacket>,
) -> Result<(), String> {
    use std::ptr;
    use std::sync::mpsc;
    use windows::core::{implement, w, ComInterface, IUnknown, HRESULT};
    use windows::Win32::Foundation::{CloseHandle, CreateEventW, SetEvent, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Threading::WaitForSingleObject;

    #[repr(C)]
    struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
        TargetProcessId: u32,
        ProcessLoopbackMode: u32,
    }

    #[repr(C)]
    struct AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: u32,
        ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    }

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx falhou: {}", e))?;
    }

    let mut loopback_params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
            TargetProcessId: pid,
            ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        },
    };

    let mut prop_var = PROPVARIANT::default();
    prop_var.Anonymous.Anonymous.vt = VT_BLOB.0;
    prop_var.Anonymous.Anonymous.Anonymous.blob.cbSize =
        std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32;
    prop_var.Anonymous.Anonymous.Anonymous.blob.pBlobData =
        &mut loopback_params as *mut _ as *mut u8;

    let (tx_ready, rx_ready) = mpsc::channel::<Result<IAudioClient, String>>();

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct CompletionHandler {
        sender: Mutex<Option<mpsc::Sender<Result<IAudioClient, String>>>>,
    }

    impl IActivateAudioInterfaceCompletionHandler_Impl for CompletionHandler_Impl {
        fn ActivateCompleted(
            &self,
            activate_operation: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            let mut sender_guard = self.sender.lock().unwrap();
            if let Some(tx) = sender_guard.take() {
                if let Some(op) = activate_operation {
                    unsafe {
                        let mut activate_hr = HRESULT(0);
                        let mut unk: Option<IUnknown> = None;
                        if let Err(e) = op.GetActivateResult(&mut activate_hr, &mut unk) {
                            let _ = tx.send(Err(format!("GetActivateResult falhou: {}", e)));
                            return Ok(());
                        }
                        if activate_hr.is_err() {
                            let _ = tx.send(Err(format!("Falha na ativação assíncrona do WASAPI: {:?}", activate_hr)));
                            return Ok(());
                        }
                        if let Some(u) = unk {
                            match u.cast::<IAudioClient>() {
                                Ok(client) => {
                                    let _ = tx.send(Ok(client));
                                }
                                Err(e) => {
                                    let _ = tx.send(Err(format!("Falha ao fazer cast para IAudioClient: {}", e)));
                                }
                            }
                        } else {
                            let _ = tx.send(Err("Objeto ativado nulo".to_string()));
                        }
                    }
                }
            }
            Ok(())
        }
    }

    let handler: IActivateAudioInterfaceCompletionHandler = CompletionHandler {
        sender: Mutex::new(Some(tx_ready)),
    }
    .into();

    let async_op = unsafe {
        ActivateAudioInterfaceAsync(
            w!("{2eef81be-33fa-4800-9670-1cd474972c3f}"), // VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
            &IAudioClient::IID,
            Some(&prop_var),
            &handler,
        )
    }
    .map_err(|e| format!("ActivateAudioInterfaceAsync falhou: {}", e))?;

    let audio_client = rx_ready
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Timeout aguardando ativação do áudio do processo".to_string())??;

    unsafe {
        let wave_format_ptr = audio_client
            .GetMixFormat()
            .map_err(|e| format!("GetMixFormat falhou: {}", e))?;

        let wave_format = &*wave_format_ptr;
        let sample_rate = wave_format.nSamplesPerSec;
        let channels = wave_format.nChannels;
        let bits_per_sample = wave_format.wBitsPerSample;

        // Inicializa o IAudioClient em modo AUDCLNT_STREAMFLAGS_LOOPBACK
        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                10_000_000, // 1 segundo de buffer
                0,
                wave_format_ptr,
                None,
            )
            .map_err(|e| format!("IAudioClient::Initialize falhou: {}", e))?;

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

        let bytes_per_frame = (channels * (bits_per_sample / 8)) as usize;

        while running.load(Ordering::SeqCst) {
            let wait_res = WaitForSingleObject(event_handle, 50);
            if wait_res == WAIT_OBJECT_0 {
                loop {
                    let mut data_ptr: *mut u8 = ptr::null_mut();
                    let mut num_frames_read: u32 = 0;
                    let mut flags: u32 = 0;

                    let hr = capture_client.GetBuffer(
                        &mut data_ptr,
                        &mut num_frames_read,
                        &mut flags,
                        None,
                        None,
                    );

                    if hr.is_err() || num_frames_read == 0 {
                        break;
                    }

                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) == 0 && !data_ptr.is_null() {
                        let total_bytes = (num_frames_read as usize) * bytes_per_frame;
                        let slice = std::slice::from_raw_parts(data_ptr, total_bytes);

                        let packet = PcmAudioPacket {
                            sample_rate,
                            channels,
                            bits_per_sample,
                            pcm_data: slice.to_vec(),
                        };

                        let _ = sender.send(packet);
                    }

                    let _ = capture_client.ReleaseBuffer(num_frames_read);
                }
            }
        }

        let _ = audio_client.Stop();
        let _ = CloseHandle(event_handle);
        CoTaskMemFree(Some(wave_format_ptr as *mut _));
        CoUninitialize();
    }

    Ok(())
}
