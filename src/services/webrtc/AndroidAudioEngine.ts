/**
 * Motor de Áudio Dedicado para Android (Android DSP Audio Engine - 48kHz Estéreo)
 * Substitui o WASAPI Process Loopback do Windows quando o app roda em dispositivos Android (APK / WebView Mobile).
 * Inclui:
 * - Filtro High-Pass (25Hz) para eliminação de DC Offset e ruído grave de manuseio do celular
 * - DynamicsCompressor / Soft-Limiter para evitar estourar o áudio em transmissões mobile
 * - Controle de Ganho Digital (Boost até 200%)
 * - Mixagem de Áudio do Sistema/Jogo (MediaProjection) e/ou Microfone HD Mobile
 */

export type AndroidAudioCaptureMode = 'internal_system' | 'voice_crystal' | 'mixed_live';

/**
 * Função pura de Soft-Limiter hiperbólico usada tanto no pipeline DSP quanto na suíte de testes pré-compilação
 */
export function softLimitSample(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  if (Math.abs(sample) <= 0.85) return sample;
  return Math.tanh(sample);
}

/**
 * Processa um bloco de amostras PCM (Float32Array) aplicando High-Pass DC Blocker (20Hz),
 * ganho digital e Soft-Limiter para garantir zero clipping no Android.
 */
export function processAndroidAudioBufferDsp(
  input: Float32Array,
  gain = 1.15
): Float32Array {
  const out = new Float32Array(input.length);
  const clampedGain = Math.max(0, Math.min(3.0, gain));
  const alpha = 0.995;
  let prevIn = 0;
  let prevOut = 0;

  for (let i = 0; i < input.length; i++) {
    const raw = Number.isFinite(input[i]) ? input[i] : 0;
    const hp = alpha * (prevOut + raw - prevIn);
    prevIn = raw;
    prevOut = hp;
    out[i] = softLimitSample(hp * clampedGain);
  }

  return out;
}

export class AndroidAudioEngine {
  private audioCtx: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private masterGainNode: GainNode | null = null;
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private activeSourceNodes: MediaStreamAudioSourceNode[] = [];
  private activeMicStream: MediaStream | null = null;
  private mode: AndroidAudioCaptureMode = 'internal_system';
  private gainValue = 1.15;

  private ensureContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });

      // 1. Filtro High-Pass (25Hz) para remover DC offset e ruído mecânico do celular
      this.highPassFilter = this.audioCtx.createBiquadFilter();
      this.highPassFilter.type = 'highpass';
      this.highPassFilter.frequency.value = 25;
      this.highPassFilter.Q.value = 0.707;

      // 2. Compressor / Limiter suave para proteger contra picos de volume em jogos mobile
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -6;
      this.compressorNode.knee.value = 12;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.15;

      // 3. Ganho Master Mobile
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = this.gainValue;

      // 4. Destino WebRTC MediaStream
      this.destinationNode = this.audioCtx.createMediaStreamDestination();

      this.highPassFilter.connect(this.compressorNode);
      this.compressorNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.destinationNode);

      // 5. Keep-Alive inaudível (-120 dB) para manter o clock RTP ativo no Android WebView
      try {
        this.keepAliveOsc = this.audioCtx.createOscillator();
        this.keepAliveGain = this.audioCtx.createGain();
        this.keepAliveGain.gain.value = 0.000001;
        this.keepAliveOsc.connect(this.keepAliveGain);
        this.keepAliveGain.connect(this.masterGainNode);
        this.keepAliveOsc.start();
      } catch {
        // ignora
      }
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  public setMode(newMode: AndroidAudioCaptureMode): void {
    this.mode = newMode;
  }

  public getMode(): AndroidAudioCaptureMode {
    return this.mode;
  }

  public setGain(multiplier: number): void {
    this.gainValue = Math.max(0, Math.min(2.5, multiplier));
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.gainValue;
    }
  }

  public getGain(): number {
    return this.gainValue;
  }

  /**
   * Conecta o áudio capturado da tela do Android (MediaProjection) e/ou microfone do aparelho
   * no pipeline DSP de 48kHz e retorna a trilha pronta para o WebRTC.
   */
  public async attachAndroidStreams(
    displayStream?: MediaStream | null,
    overrideMode?: AndroidAudioCaptureMode
  ): Promise<MediaStreamTrack | null> {
    this.cleanupSources();
    const ctx = this.ensureContext();
    if (!this.highPassFilter || !this.destinationNode) return null;

    const activeMode = overrideMode || this.mode;

    // 1. Conecta o áudio interno vindo do compartilhamento de tela (se disponível)
    if (
      displayStream &&
      (activeMode === 'internal_system' || activeMode === 'mixed_live')
    ) {
      const sysAudioTracks = displayStream.getAudioTracks();
      if (sysAudioTracks.length > 0) {
        try {
          const sysSource = ctx.createMediaStreamSource(new MediaStream([sysAudioTracks[0]]));
          sysSource.connect(this.highPassFilter);
          this.activeSourceNodes.push(sysSource);
        } catch (err) {
          console.warn('[AndroidAudioEngine] Aviso ao conectar áudio interno:', err);
        }
      }
    }

    // 2. Se o modo for Voz Cristalina ou Mixado (ou se o Android bloqueou áudio interno por DRM e o usuário pediu voz)
    if (activeMode === 'voice_crystal' || activeMode === 'mixed_live') {
      try {
        this.activeMicStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 2,
          } as any,
          video: false,
        });
        const micSource = ctx.createMediaStreamSource(this.activeMicStream);
        micSource.connect(this.highPassFilter);
        this.activeSourceNodes.push(micSource);
      } catch (err) {
        console.warn('[AndroidAudioEngine] Não foi possível abrir microfone Android:', err);
      }
    }

    const outTracks = this.destinationNode.stream.getAudioTracks();
    if (outTracks.length > 0) {
      const track = outTracks[0];
      track.enabled = true;
      try {
        if ('contentHint' in track) {
          track.contentHint = activeMode === 'voice_crystal' ? 'speech' : 'music';
        }
      } catch {
        // ignora
      }
      return track;
    }

    return null;
  }

  public cleanupSources(): void {
    for (const node of this.activeSourceNodes) {
      try {
        node.disconnect();
      } catch {
        // ignora
      }
    }
    this.activeSourceNodes = [];

    if (this.activeMicStream) {
      this.activeMicStream.getTracks().forEach((t) => t.stop());
      this.activeMicStream = null;
    }
  }

  public stop(): void {
    this.cleanupSources();
  }
}

export const androidAudioEngine = new AndroidAudioEngine();
