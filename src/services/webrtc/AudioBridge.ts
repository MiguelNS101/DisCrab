/**
 * Ponte de Áudio PCM: Converte blocos PCM brutos do WASAPI Process Loopback
 * em uma MediaStreamTrack nativa do navegador para envio via WebRTC.
 * 
 * Garante que o áudio do jogo (PID específico) seja transmitido sem eco e sincronizado.
 */

export class WasapiAudioBridge {
  private audioCtx: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private isInitialized = false;

  constructor() {
    // AudioContext será inicializado após gesto do usuário
  }

  public init(sampleRate = 48000): void {
    if (this.isInitialized && this.audioCtx) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass({
      sampleRate,
      latencyHint: 'interactive',
    });

    this.destinationNode = this.audioCtx.createMediaStreamDestination();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 1.0;
    this.gainNode.connect(this.destinationNode);

    this.isInitialized = true;
    console.log('[AudioBridge] WASAPI AudioBridge inicializado a', sampleRate, 'Hz');
  }

  /**
   * Retorna a faixa de áudio WebRTC pronta para ser adicionada à RTCPeerConnection
   */
  public getAudioTrack(): MediaStreamTrack | null {
    if (!this.destinationNode) {
      this.init();
    }
    const tracks = this.destinationNode?.stream.getAudioTracks();
    return tracks && tracks.length > 0 ? tracks[0] : null;
  }

  /**
   * Injeta um bloco PCM de 32-bit Float ou 16-bit Int recebido do Rust (via Tauri event ou WS)
   */
  public feedPcmChunk(pcmData: Float32Array | Int16Array, channels = 2, sampleRate = 48000): void {
    if (!this.audioCtx || !this.gainNode) {
      this.init(sampleRate);
    }

    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }

    const ctx = this.audioCtx!;
    const frameCount = pcmData.length / channels;
    const audioBuffer = ctx.createBuffer(channels, frameCount, sampleRate);

    if (pcmData instanceof Float32Array) {
      // Formato padrão do WASAPI IEEE Float32
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
          channelData[i] = pcmData[i * channels + ch];
        }
      }
    } else {
      // Formato Int16 (converte para float entre -1.0 e 1.0)
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
          channelData[i] = pcmData[i * channels + ch] / 32768.0;
        }
      }
    }

    // Toca o buffer na saída do MediaStreamDestination
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(this.gainNode!);
    sourceNode.start();
  }

  /**
   * Processa pacote vindo em Base64 do evento Tauri ("isolated-audio-chunk")
   */
  public feedBase64Chunk(base64Data: string, bitsPerSample = 32, channels = 2, sampleRate = 48000): void {
    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      if (bitsPerSample === 32) {
        const floatView = new Float32Array(bytes.buffer);
        this.feedPcmChunk(floatView, channels, sampleRate);
      } else {
        const int16View = new Int16Array(bytes.buffer);
        this.feedPcmChunk(int16View, channels, sampleRate);
      }
    } catch (err) {
      console.error('[AudioBridge] Erro ao decodificar pacote PCM base64:', err);
    }
  }

  public setGain(value: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2.0, value));
    }
  }

  public close(): void {
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.destinationNode = null;
    this.gainNode = null;
    this.isInitialized = false;
  }
}

// Instância singleton para uso em todo o frontend
export const wasapiAudioBridge = new WasapiAudioBridge();
