/**
 * Ponte de Áudio PCM de Ultra Baixa Latência (WASAPI Process Loopback -> WebRTC)
 * Utiliza AudioWorklet com Ring Buffer Circular contínuo para eliminar vazamento
 * de memória, eliminar drift de relógio e garantir transmissão ininterrupta.
 */

// Código inlined do AudioWorkletProcessor para criar via Blob URL
const WORKLET_PROCESSOR_CODE = `
class PcmRingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer circular de 2 segundos a 48kHz estéreo = 192.000 floats
    this.capacity = 192000;
    this.bufferL = new Float32Array(this.capacity);
    this.bufferR = new Float32Array(this.capacity);
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'reset') {
        this.writePos = 0;
        this.readPos = 0;
        this.available = 0;
        return;
      }

      const { left, right, length } = msg;
      if (!left || length === 0) return;

      for (let i = 0; i < length; i++) {
        const destIdx = (this.writePos + i) % this.capacity;
        this.bufferL[destIdx] = left[i];
        this.bufferR[destIdx] = right ? right[i] : left[i];
      }

      this.writePos = (this.writePos + length) % this.capacity;
      this.available = Math.min(this.capacity, this.available + length);

      // Proteção contra buffer excessivo (>100ms de acúmulo = 4800 frames a 48kHz)
      // Mantém latência próxima do tempo real (máximo 40ms de atraso)
      const maxAllowed = 4800; // ~100ms
      if (this.available > maxAllowed) {
        const skip = this.available - 1920; // Reancora em ~40ms
        this.readPos = (this.readPos + skip) % this.capacity;
        this.available = 1920;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] || outL;
    const frames = outL.length; // normalmente 128 frames

    // Se o buffer estiver vazio ou em underrun, preenche com silêncio
    if (this.available < frames) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    for (let i = 0; i < frames; i++) {
      outL[i] = this.bufferL[this.readPos];
      outR[i] = this.bufferR[this.readPos];
      this.readPos = (this.readPos + 1) % this.capacity;
    }
    this.available -= frames;

    return true;
  }
}

registerProcessor('pcm-ring-buffer-processor', PcmRingBufferProcessor);
`;

export class WasapiAudioBridge {
  private audioCtx: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private workletReady = false;
  private pendingChunks: { pcmData: Float32Array | Int16Array; channels: number; sampleRate: number }[] = [];

  constructor() {
    // AudioContext será inicializado no primeiro uso ou gesto do usuário
  }

  public async init(sampleRate = 48000): Promise<void> {
    if (this.isInitialized && this.audioCtx && this.audioCtx.state !== 'closed') {
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass({
        sampleRate,
        latencyHint: 'interactive',
      });

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      this.destinationNode = this.audioCtx.createMediaStreamDestination();
      this.gainNode.connect(this.destinationNode);

      // Tenta registrar o AudioWorklet para renderização em thread de áudio dedicada
      if (this.audioCtx.audioWorklet) {
        const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await this.audioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-ring-buffer-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        this.workletNode.connect(this.gainNode);
        this.workletReady = true;
        console.log('[AudioBridge] AudioWorklet Ring Buffer ativado com sucesso a', sampleRate, 'Hz');

        // Despeja qualquer chunk recebido durante a inicialização assíncrona
        if (this.pendingChunks.length > 0) {
          for (const pending of this.pendingChunks) {
            this.feedPcmChunk(pending.pcmData, pending.channels, pending.sampleRate);
          }
          this.pendingChunks = [];
        }
      }

      this.isInitialized = true;
    } catch (err) {
      console.warn('[AudioBridge] Falha ao registrar AudioWorklet, usando fallback padrão:', err);
      this.workletReady = false;
      this.isInitialized = true;
    }
  }

  /**
   * Reseta os marcadores de tempo e o buffer circular para nova transmissão
   */
  public resetClock(): void {
    if (this.workletNode && this.workletReady) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /**
   * Retorna SEMPRE uma faixa de áudio WebRTC nova e 'live'.
   * Recria o destinationNode para garantir que nunca retorne uma faixa 'ended'.
   */
  public getAudioTrack(): MediaStreamTrack | null {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.init();
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    // Se já havia um destinationNode anterior (cujo track pode ter sido parado), desconecta
    if (this.destinationNode && this.gainNode) {
      try {
        this.gainNode.disconnect(this.destinationNode);
      } catch (_) {}
    }

    // Cria SEMPRE um novo MediaStreamDestinationNode para garantir um MediaStreamTrack fresco no estado 'live'
    if (this.audioCtx) {
      this.destinationNode = this.audioCtx.createMediaStreamDestination();
      if (this.gainNode) {
        this.gainNode.connect(this.destinationNode);
      }
    }

    const tracks = this.destinationNode?.stream.getAudioTracks();
    if (tracks && tracks.length > 0) {
      const track = tracks[0];
      track.enabled = true;
      console.log('[AudioBridge] Novo MediaStreamTrack criado no estado:', track.readyState, 'id:', track.id);
      return track;
    }
    return null;
  }

  /**
   * Injeta um bloco PCM de 32-bit Float ou 16-bit Int recebido do Rust (via Tauri event ou WS)
   */
  public feedPcmChunk(pcmData: Float32Array | Int16Array, channels = 2, sampleRate = 48000): void {
    if (!this.audioCtx || !this.gainNode) {
      this.init(sampleRate);
    }

    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx?.resume().catch(() => {});
    }

    const frameCount = Math.floor(pcmData.length / channels);
    if (frameCount === 0) return;

    // Se o AudioWorklet estiver pronto, envia os canais separados sem criar nós de áudio
    if (this.workletNode && this.workletReady) {
      const left = new Float32Array(frameCount);
      const right = channels > 1 ? new Float32Array(frameCount) : left;

      if (pcmData instanceof Float32Array) {
        for (let i = 0; i < frameCount; i++) {
          left[i] = pcmData[i * channels];
          if (channels > 1) {
            right[i] = pcmData[i * channels + 1];
          }
        }
      } else {
        // Int16
        for (let i = 0; i < frameCount; i++) {
          left[i] = pcmData[i * channels] / 32768.0;
          if (channels > 1) {
            right[i] = pcmData[i * channels + 1] / 32768.0;
          }
        }
      }

      this.workletNode.port.postMessage(
        {
          type: 'data',
          left,
          right: channels > 1 ? right : null,
          length: frameCount,
        },
        channels > 1 ? [left.buffer, right.buffer] : [left.buffer]
      );
      return;
    }

    // Se ainda está carregando o worklet, enfileira
    if (!this.isInitialized) {
      if (this.pendingChunks.length < 20) {
        this.pendingChunks.push({ pcmData, channels, sampleRate });
      }
      return;
    }

    // Fallback: BufferSource com auto-desconexão
    try {
      const ctx = this.audioCtx!;
      const audioBuffer = ctx.createBuffer(channels, frameCount, sampleRate);
      if (pcmData instanceof Float32Array) {
        for (let ch = 0; ch < channels; ch++) {
          const chData = audioBuffer.getChannelData(ch);
          for (let i = 0; i < frameCount; i++) {
            chData[i] = pcmData[i * channels + ch];
          }
        }
      } else {
        for (let ch = 0; ch < channels; ch++) {
          const chData = audioBuffer.getChannelData(ch);
          for (let i = 0; i < frameCount; i++) {
            chData[i] = pcmData[i * channels + ch] / 32768.0;
          }
        }
      }

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.gainNode!);
      sourceNode.start();
      sourceNode.onended = () => {
        try {
          sourceNode.disconnect();
        } catch (_) {}
      };
    } catch (_) {}
  }

  /**
   * Processa pacote vindo em Base64 do evento Tauri ("isolated-audio-chunk")
   */
  public feedBase64Chunk(base64Data: string, bitsPerSample = 32, channels = 2, sampleRate = 48000): void {
    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      if (len === 0) return;

      const alignedLength = bitsPerSample === 32 ? Math.floor(len / 4) * 4 : Math.floor(len / 2) * 2;
      if (alignedLength === 0) return;

      const buffer = new ArrayBuffer(alignedLength);
      const u8View = new Uint8Array(buffer);
      for (let i = 0; i < alignedLength; i++) {
        u8View[i] = binaryStr.charCodeAt(i);
      }

      if (bitsPerSample === 32) {
        const floatView = new Float32Array(buffer);
        this.feedPcmChunk(floatView, channels, sampleRate);
      } else {
        const int16View = new Int16Array(buffer);
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
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.destinationNode = null;
    this.gainNode = null;
    this.workletNode = null;
    this.workletReady = false;
    this.isInitialized = false;
  }
}

// Instância singleton para uso em todo o frontend
export const wasapiAudioBridge = new WasapiAudioBridge();
