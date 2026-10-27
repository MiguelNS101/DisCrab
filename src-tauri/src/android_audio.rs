//! Motor de Áudio Dedicado para Android (DSP Mobile 48kHz Estéreo)
//! Substitui o WASAPI Process Loopback do Windows quando compilado para Android,
//! oferecendo filtro High-Pass (remoção de DC offset / ruído grave), Soft-Clipping Limiter,
//! controle de ganho digital e empacotamento PCM em quadros de 20ms (960 frames @ 48kHz).

use crate::wasapi_loopback::PcmAudioPacket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

/// Modos de captura/processamento de áudio no Android
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AndroidAudioMode {
    /// Áudio interno do sistema/jogo via MediaProjection / WebAudio Loopback (PID 0 / 1)
    InternalSystem = 0,
    /// Microfone HD com filtro de voz e limiter (PID 2)
    MicrophoneEnhanced = 2,
    /// Mixagem de Áudio Interno + Voz (PID 3)
    MixedLive = 3,
}

impl From<u32> for AndroidAudioMode {
    fn from(pid: u32) -> Self {
        match pid {
            2 => AndroidAudioMode::MicrophoneEnhanced,
            3 => AndroidAudioMode::MixedLive,
            _ => AndroidAudioMode::InternalSystem,
        }
    }
}

/// Processador DSP leve em ponto flutuante (32-bit IEEE Float) para o áudio do Android
pub struct AndroidAudioProcessor {
    pub sample_rate: u32,
    pub channels: u16,
    pub gain: f32,
    prev_in_l: f32,
    prev_out_l: f32,
    prev_in_r: f32,
    prev_out_r: f32,
}

impl AndroidAudioProcessor {
    pub fn new(sample_rate: u32, channels: u16, gain: f32) -> Self {
        Self {
            sample_rate: sample_rate.max(8000),
            channels: channels.clamp(1, 2),
            gain: gain.clamp(0.0, 3.0),
            prev_in_l: 0.0,
            prev_out_l: 0.0,
            prev_in_r: 0.0,
            prev_out_r: 0.0,
        }
    }

    /// Aplica Soft-Limiter hiperbólico rápido para evitar distorção digital (clipping) no celular
    #[inline]
    pub fn soft_limit(sample: f32) -> f32 {
        if !sample.is_finite() {
            return 0.0;
        }
        if sample.abs() <= 0.85 {
            sample
        } else {
            sample. tanh()
        }
    }

    /// Processa um buffer intercalado (interleaved) de amostras f32 aplicando:
    /// 1. Filtro High-Pass DC Blocker (~20Hz)
    /// 2. Ganho configurável
    /// 3. Soft-Clipping Limiter
    pub fn process_interleaved_f32(&mut self, samples: &mut [f32]) {
        let alpha = 0.995f32;
        if self.channels == 2 {
            for frame in samples.chunks_exact_mut(2) {
                let in_l = if frame[0].is_finite() { frame[0] } else { 0.0 };
                let in_r = if frame[1].is_finite() { frame[1] } else { 0.0 };

                let hp_l = alpha * (self.prev_out_l + in_l - self.prev_in_l);
                self.prev_in_l = in_l;
                self.prev_out_l = hp_l;

                let hp_r = alpha * (self.prev_out_r + in_r - self.prev_in_r);
                self.prev_in_r = in_r;
                self.prev_out_r = hp_r;

                frame[0] = Self::soft_limit(hp_l * self.gain);
                frame[1] = Self::soft_limit(hp_r * self.gain);
            }
        } else {
            for s in samples.iter_mut() {
                let input = if s.is_finite() { *s } else { 0.0 };
                let hp = alpha * (self.prev_out_l + input - self.prev_in_l);
                self.prev_in_l = input;
                self.prev_out_l = hp;
                *s = Self::soft_limit(hp * self.gain);
            }
        }
    }

    /// Converte amostras f32 processadas em pacote PcmAudioPacket de 32-bit float little-endian
    pub fn encode_packet(&mut self, pid: u32, mut samples: Vec<f32>) -> PcmAudioPacket {
        self.process_interleaved_f32(&mut samples);
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        PcmAudioPacket {
            pid,
            sample_rate: self.sample_rate,
            channels: self.channels,
            bits_per_sample: 32,
            pcm_data: bytes,
        }
    }
}

/// Fila global de amostras injetadas pela camada Android WebView / MediaProjection
static ANDROID_PCM_QUEUE: std::sync::OnceLock<Mutex<Vec<f32>>> = std::sync::OnceLock::new();

fn get_android_pcm_queue() -> &'static Mutex<Vec<f32>> {
    ANDROID_PCM_QUEUE.get_or_init(|| Mutex::new(Vec::with_capacity(48000 * 2)))
}

/// Permite que o frontend Android injete blocos PCM capturados no celular para passar pelo DSP nativo Rust
pub fn push_android_pcm_samples(samples: &[f32]) {
    if let Ok(mut queue) = get_android_pcm_queue().lock() {
        // Limita o buffer máximo a ~500ms em 48kHz estéreo para nunca acumular latência
        let max_len = 48000;
        if queue.len() + samples.len() > max_len {
            let overflow = (queue.len() + samples.len()) - max_len;
            let drain_count = overflow.min(queue.len());
            queue.drain(0..drain_count);
        }
        queue.extend_from_slice(samples);
    }
}

/// Loop de captura e processamento de áudio para Android e plataformas não-Windows
pub fn run_android_audio_loop(
    target_pid: u32,
    running_flag: Arc<AtomicBool>,
    sender: broadcast::Sender<PcmAudioPacket>,
) {
    let mode = AndroidAudioMode::from(target_pid);
    let default_gain = match mode {
        AndroidAudioMode::InternalSystem => 1.05,
        AndroidAudioMode::MicrophoneEnhanced => 1.25,
        AndroidAudioMode::MixedLive => 1.15,
    };

    let sample_rate = 48000u32;
    let channels = 2u16;
    let frames_per_chunk = 960usize; // 20ms a 48kHz
    let samples_per_chunk = frames_per_chunk * (channels as usize);

    let mut processor = AndroidAudioProcessor::new(sample_rate, channels, default_gain);

    while running_flag.load(Ordering::SeqCst) {
        let mut chunk: Vec<f32> = Vec::with_capacity(samples_per_chunk);

        if let Ok(mut queue) = get_android_pcm_queue().lock() {
            if queue.len() >= samples_per_chunk {
                chunk.extend(queue.drain(0..samples_per_chunk));
            }
        }

        // Se não houver amostras externas na fila neste ciclo de 20ms, mantém o relógio RTP vivo
        // com silêncio digital limpo (-120 dB) para evitar queda da trilha de áudio no Android WebView
        if chunk.is_empty() {
            chunk.resize(samples_per_chunk, 0.000001);
        }

        let packet = processor.encode_packet(target_pid, chunk);
        let _ = sender.send(packet);

        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_android_audio_processor_dc_blocker_and_limiter() {
        let mut proc = AndroidAudioProcessor::new(48000, 2, 1.5);
        // Sinal com pico alto (2.5) que causaria clipping sem o soft_limit
        let mut samples = vec![2.5f32, -2.5f32, 0.5f32, -0.5f32, 0.0f32, 0.0f32];
        proc.process_interleaved_f32(&mut samples);

        for s in &samples {
            assert!(s.is_finite(), "Amostra processada deve ser finita");
            assert!(
                s.abs() <= 1.0,
                "Soft limiter deve manter a amplitude dentro de [-1.0, 1.0], obtido: {}",
                s
            );
        }
    }

    #[test]
    fn test_android_packet_encoding_size() {
        let mut proc = AndroidAudioProcessor::new(48000, 2, 1.0);
        let samples = vec![0.25f32; 960 * 2]; // 20ms estéreo @ 48kHz
        let packet = proc.encode_packet(0, samples);

        assert_eq!(packet.sample_rate, 48000);
        assert_eq!(packet.channels, 2);
        assert_eq!(packet.bits_per_sample, 32);
        assert_eq!(packet.pcm_data.len(), 960 * 2 * 4);
    }
}
