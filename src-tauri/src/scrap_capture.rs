//! Módulo de Captura de Tela Nativa com aceleração DXGI via Crate Scrap
//! Captura frames limpos do monitor a 30fps/60fps com baixo consumo de CPU e latência zero.

use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: usize,
    pub width: usize,
    pub height: usize,
    pub is_primary: bool,
}

#[derive(Clone)]
pub struct CapturedVideoFrame {
    pub width: usize,
    pub height: usize,
    pub stride: usize,
    /// Pixels em formato BGRA ou RGBA
    pub bgra_bytes: Vec<u8>,
    pub timestamp_ms: u128,
}

pub struct ScreenCapturerService {
    running: Arc<AtomicBool>,
    current_fps: Arc<Mutex<u32>>,
    latest_frame: Arc<Mutex<Option<CapturedVideoFrame>>>,
}

impl ScreenCapturerService {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            current_fps: Arc::new(Mutex::new(60)),
            latest_frame: Arc::new(Mutex::new(None)),
        }
    }

    pub fn list_displays() -> Vec<DisplayInfo> {
        match scrap::Display::all() {
            Ok(displays) => displays
                .into_iter()
                .enumerate()
                .map(|(idx, d)| DisplayInfo {
                    id: idx,
                    width: d.width(),
                    height: d.height(),
                    is_primary: idx == 0,
                })
                .collect(),
            Err(e) => {
                eprintln!("[Scrap] Erro ao listar monitores: {}", e);
                // Fallback de resolução padrão
                vec![DisplayInfo {
                    id: 0,
                    width: 1920,
                    height: 1080,
                    is_primary: true,
                }]
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn get_latest_frame(&self) -> Option<CapturedVideoFrame> {
        self.latest_frame.lock().unwrap().clone()
    }

    pub fn start(&self, display_index: usize, target_fps: u32) -> Result<(), String> {
        self.stop();
        self.running.store(true, Ordering::SeqCst);
        *self.current_fps.lock().unwrap() = target_fps;

        let running_flag = self.running.clone();
        let frame_slot = self.latest_frame.clone();

        std::thread::Builder::new()
            .name("scrap-screen-capturer".to_string())
            .spawn(move || {
                let displays = match scrap::Display::all() {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[Scrap] Falha ao listar displays: {}", e);
                        return;
                    }
                };

                let display = if display_index < displays.len() {
                    displays.into_iter().nth(display_index).unwrap()
                } else {
                    displays.into_iter().next().unwrap()
                };

                let width = display.width();
                let height = display.height();

                let mut capturer = match scrap::Capturer::new(display) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[Scrap] Erro ao inicializar Capturer DXGI: {}", e);
                        return;
                    }
                };

                let frame_duration = Duration::from_micros(1_000_000 / (target_fps.max(15) as u64));
                println!("[Scrap] Captura iniciada no monitor {} ({}x{}) a {} FPS", display_index, width, height, target_fps);

                while running_flag.load(Ordering::SeqCst) {
                    let start = Instant::now();

                    match capturer.frame() {
                        Ok(frame) => {
                            let stride = frame.len() / height;
                            let timestamp_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis();

                            let captured = CapturedVideoFrame {
                                width,
                                height,
                                stride,
                                bgra_bytes: frame.to_vec(),
                                timestamp_ms,
                            };

                            let mut slot = frame_slot.lock().unwrap();
                            *slot = Some(captured);
                        }
                        Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                            // Frame ainda não atualizado pelo compositor do Windows; espera curta
                            std::thread::sleep(Duration::from_millis(2));
                            continue;
                        }
                        Err(e) => {
                            eprintln!("[Scrap] Erro de captura de frame: {}", e);
                            std::thread::sleep(Duration::from_millis(16));
                        }
                    }

                    let elapsed = start.elapsed();
                    if elapsed < frame_duration {
                        std::thread::sleep(frame_duration - elapsed);
                    }
                }

                println!("[Scrap] Captura de tela encerrada.");
            })
            .map_err(|e| format!("Falha ao iniciar thread de captura Scrap: {}", e))?;

        Ok(())
    }
}
