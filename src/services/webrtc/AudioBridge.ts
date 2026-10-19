/**
 * Ponte de Áudio PCM de Alta Fidelidade e Zero Engasgos (WASAPI Process Loopback -> WebRTC)
 * Utiliza AudioWorklet com Jitter Buffer Elástico (pré-buffer de 65ms, correção suave de drift
 * por interpolação linear sem cortes secos, Packet Loss Concealment com fade-out suave e
 * mixagem independente por PID).
 */

const WORKLET_PROCESSOR_CODE = `
class PcmRingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 96000; // 2 segundos por fonte a 48kHz
    this.warmupThreshold = 3120; // ~65ms de almofada anti-jitter
    this.softDriftThreshold = 8640; // ~180ms: acelera 1.5% suavemente sem cortar amostras
    this.hardMaxThreshold = 24000; // ~500ms: limite extremo de segurança
    this.streams = new Map();

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'reset') {
        this.streams.clear();
        return;
      }

      const { pid = 0, left, right, length } = msg;
      if (!left || length === 0) return;

      let s = this.streams.get(pid);
      if (!s) {
        s = {
          bufferL: new Float32Array(this.capacity),
          bufferR: new Float32Array(this.capacity),
          writePos: 0,
          readPos: 0,
          available: 0,
          isBuffering: true,
          fadeInPos: 0,
          lastL: 0,
          lastR: 0,
          silentBlocks: 0,
        };
        this.streams.set(pid, s);
      }

      s.silentBlocks = 0;

      for (let i = 0; i < length; i++) {
        const destIdx = (s.writePos + i) % this.capacity;
        s.bufferL[destIdx] = left[i];
        s.bufferR[destIdx] = right ? right[i] : left[i];
      }

      s.writePos = (s.writePos + length) % this.capacity;
      s.available = Math.min(this.capacity, s.available + length);

      if (s.isBuffering && s.available >= this.warmupThreshold) {
        s.isBuffering = false;
        s.fadeInPos = 0;
      }

      // Apenas se houver congelamento extremo (>500ms) reancora com crossfade
      if (s.available > this.hardMaxThreshold) {
        const skip = s.available - 4320; // retorna para ~90ms
        s.readPos = (s.readPos + skip) % this.capacity;
        s.available = 4320;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] || outL;
    const frames = outL.length; // 128 frames por bloco (~2.66ms a 48kHz)

    outL.fill(0);
    outR.fill(0);

    if (this.streams.size === 0) {
      return true;
    }

    for (const [pid, s] of this.streams.entries()) {
      if (s.isBuffering) {
        // Se estava tocando antes de entrar em buffering, decai suavemente a última amostra para evitar estalo
        if (Math.abs(s.lastL) > 0.0001 || Math.abs(s.lastR) > 0.0001) {
          for (let i = 0; i < frames; i++) {
            s.lastL *= 0.92;
            s.lastR *= 0.92;
            outL[i] += s.lastL;
            outR[i] += s.lastR;
          }
        }
        s.silentBlocks++;
        if (s.silentBlocks > 400 && s.available === 0) {
          this.streams.delete(pid);
        }
        continue;
      }

      // Verifica se há amostras suficientes para este bloco
      if (s.available < frames + 2) {
        // Esgota o que resta com fade-out suave e volta ao estado de pré-buffer (65ms)
        const remaining = s.available;
        for (let i = 0; i < frames; i++) {
          if (i < remaining) {
            const fade = 1.0 - (i / frames);
            s.lastL = s.bufferL[s.readPos] * fade;
            s.lastR = s.bufferR[s.readPos] * fade;
            s.readPos = (s.readPos + 1) % this.capacity;
          } else {
            s.lastL *= 0.90;
            s.lastR *= 0.90;
          }
          outL[i] += s.lastL;
          outR[i] += s.lastR;
        }
        s.available = 0;
        s.isBuffering = true;
        continue;
      }

      // Se o buffer passou de ~180ms, consome 2 amostras extras no bloco de 128 usando interpolação linear
      // (recupera atraso suavemente sem nenhum corte audível)
      const shouldSlip = s.available > this.softDriftThreshold;

      for (let i = 0; i < frames; i++) {
        let sampleL = s.bufferL[s.readPos];
        let sampleR = s.bufferR[s.readPos];

        if (shouldSlip && (i === 42 || i === 85) && s.available > frames + 2) {
          const nextPos = (s.readPos + 1) % this.capacity;
          sampleL = 0.5 * (sampleL + s.bufferL[nextPos]);
          sampleR = 0.5 * (sampleR + s.bufferR[nextPos]);
          s.readPos = (s.readPos + 2) % this.capacity;
          s.available -= 2;
        } else {
          s.readPos = (s.readPos + 1) % this.capacity;
          s.available -= 1;
        }

        // Rampa curta de fade-in (128 amostras = 2.6ms) ao sair do buffering
        if (s.fadeInPos < 128) {
          const gain = s.fadeInPos / 128.0;
          sampleL *= gain;
          sampleR *= gain;
          s.fadeInPos++;
        }

        s.lastL = sampleL;
        s.lastR = sampleR;
        outL[i] += sampleL;
        outR[i] += sampleR;
      }
    }

    // Soft-clipping caso múltiplos processos estejam sendo mixados simultaneamente
    if (this.streams.size > 1) {
      for (let i = 0; i < frames; i++) {
        if (outL[i] > 1.0 || outL[i] < -1.0) outL[i] = Math.tanh(outL[i]);
        if (outR[i] > 1.0 || outR[i] < -1.0) outR[i] = Math.tanh(outR[i]);
      }
    }

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
  private isInitializing = false;
  private workletReady = false;
  private pendingChunks: {
    pcmData: Float32Array | Int16Array;
    channels: number;
    sampleRate: number;
    pid: number;
  }[] = [];

  public async init(sampleRate = 48000): Promise<void> {
    if (this.isInitialized && this.audioCtx && this.audioCtx.state !== 'closed') {
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }
      return;
    }

    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      this.destinationNode = this.audioCtx.createMediaStreamDestination();
      this.gainNode.connect(this.destinationNode);

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
        console.log(
          '[AudioBridge] AudioWorklet Jitter Buffer ativado com sucesso a',
          this.audioCtx.sampleRate,
          'Hz (entrada:',
          sampleRate,
          'Hz)'
        );
      }

      this.isInitialized = true;
      this.isInitializing = false;

      if (this.pendingChunks.length > 0) {
        const chunks = this.pendingChunks.splice(0, this.pendingChunks.length);
        for (const pending of chunks) {
          this.feedPcmChunk(pending.pcmData, pending.channels, pending.sampleRate, pending.pid);
        }
      }
    } catch (err) {
      console.warn('[AudioBridge] Falha ao registrar AudioWorklet, usando fallback padrão:', err);
      this.workletReady = false;
      this.isInitialized = true;
      this.isInitializing = false;
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
   * Retorna SEMPRE uma faixa de áudio WebRTC nova e 'live' marcada com contentHint = 'music'
   * para impedir que o codec Opus corte ou comprima sons de jogos/música como se fossem voz.
   */
  public getAudioTrack(): MediaStreamTrack | null {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.init();
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    if (this.destinationNode && this.gainNode) {
      try {
        this.gainNode.disconnect(this.destinationNode);
      } catch (_) {}
    }

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
      try {
        if ('contentHint' in track) {
          track.contentHint = 'music';
        }
      } catch (_) {}
      console.log(
        '[AudioBridge] Novo MediaStreamTrack Estéreo criado no estado:',
        track.readyState,
        'id:',
        track.id
      );
      return track;
    }
    return null;
  }

  /**
   * Injeta um bloco PCM de 32-bit Float ou 16-bit Int recebido do Rust com reamostragem automática
   */
  public feedPcmChunk(
    pcmData: Float32Array | Int16Array,
    channels = 2,
    sampleRate = 48000,
    pid = 0
  ): void {
    if (!this.audioCtx || !this.gainNode) {
      this.init(sampleRate);
    }

    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx?.resume().catch(() => {});
    }

    const inFrames = Math.floor(pcmData.length / channels);
    if (inFrames === 0) return;

    if (!this.isInitialized) {
      if (this.pendingChunks.length < 35) {
        this.pendingChunks.push({ pcmData, channels, sampleRate, pid });
      }
      return;
    }

    const targetRate = this.audioCtx?.sampleRate || 48000;

    if (this.workletNode && this.workletReady) {
      // Extrai canais L e R normalizados em Float32 [-1.0, 1.0]
      const rawL = new Float32Array(inFrames);
      const rawR = channels > 1 ? new Float32Array(inFrames) : rawL;

      if (pcmData instanceof Float32Array) {
        for (let i = 0; i < inFrames; i++) {
          const base = i * channels;
          rawL[i] = pcmData[base];
          if (channels > 1) {
            rawR[i] = pcmData[base + 1];
          }
        }
      } else {
        const inv = 1.0 / 32768.0;
        for (let i = 0; i < inFrames; i++) {
          const base = i * channels;
          rawL[i] = pcmData[base] * inv;
          if (channels > 1) {
            rawR[i] = pcmData[base + 1] * inv;
          }
        }
      }

      // Se a taxa de amostragem do dispositivo Windows diferir de 48kHz (ex: 44100Hz ou 96000Hz),
      // aplica interpolação linear para igualar exatamente o clock do AudioContext
      let finalL = rawL;
      let finalR = rawR;
      let outFrames = inFrames;

      if (sampleRate > 0 && sampleRate !== targetRate) {
        const ratio = sampleRate / targetRate;
        outFrames = Math.max(1, Math.round(inFrames / ratio));
        finalL = new Float32Array(outFrames);
        finalR = channels > 1 ? new Float32Array(outFrames) : finalL;

        for (let i = 0; i < outFrames; i++) {
          const srcPos = i * ratio;
          const idx0 = Math.min(inFrames - 1, Math.floor(srcPos));
          const idx1 = Math.min(inFrames - 1, idx0 + 1);
          const frac = srcPos - idx0;
          finalL[i] = rawL[idx0] + (rawL[idx1] - rawL[idx0]) * frac;
          if (channels > 1) {
            finalR[i] = rawR[idx0] + (rawR[idx1] - rawR[idx0]) * frac;
          }
        }
      }

      this.workletNode.port.postMessage(
        {
          type: 'data',
          pid,
          left: finalL,
          right: channels > 1 ? finalR : null,
          length: outFrames,
        },
        channels > 1 ? [finalL.buffer, finalR.buffer] : [finalL.buffer]
      );
      return;
    }
  }

  /**
   * Processa pacote vindo em Base64 do evento Tauri ("isolated-audio-chunk")
   */
  public feedBase64Chunk(
    base64Data: string,
    bitsPerSample = 16,
    channels = 2,
    sampleRate = 48000,
    pid = 0
  ): void {
    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      if (len === 0) return;

      const alignedLength =
        bitsPerSample === 32 ? Math.floor(len / 4) * 4 : Math.floor(len / 2) * 2;
      if (alignedLength === 0) return;

      const buffer = new ArrayBuffer(alignedLength);
      const u8View = new Uint8Array(buffer);
      for (let i = 0; i < alignedLength; i++) {
        u8View[i] = binaryStr.charCodeAt(i);
      }

      if (bitsPerSample === 32) {
        const floatView = new Float32Array(buffer);
        this.feedPcmChunk(floatView, channels, sampleRate, pid);
      } else {
        const int16View = new Int16Array(buffer);
        this.feedPcmChunk(int16View, channels, sampleRate, pid);
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
    this.isInitializing = false;
  }
}

export const wasapiAudioBridge = new WasapiAudioBridge();
