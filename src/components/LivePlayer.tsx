import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Gamepad2,
  User,
  Sparkles,
  ExternalLink,
  BookmarkCheck,
  RefreshCw,
  FlipHorizontal,
  Tv,
  PowerOff,
  Activity,
} from 'lucide-react';

interface AudioWaveformVisualizerProps {
  stream?: MediaStream | null;
  isWatched: boolean;
  isMuted: boolean;
  isSelf?: boolean;
  tracksKey: string;
}

/**
 * Pequeno visualizador de forma de onda (waveform / espectro) em tempo real para cada stream.
 * Fornece feedback visual imediato de que o áudio está sendo capturado e transmitido/recebido.
 */
const AudioWaveformVisualizer: React.FC<AudioWaveformVisualizerProps> = ({
  stream,
  isWatched,
  isMuted,
  isSelf = false,
  tracksKey,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isSignalActive, setIsSignalActive] = useState(false);

  const hasLiveAudioTrack = Boolean(
    stream &&
      isWatched &&
      stream.getAudioTracks().some((t) => t.readyState === 'live' && t.enabled)
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const drawIdleBars = (mutedStyle: boolean) => {
      const width = canvas.width;
      const height = canvas.height;
      ctx2d.clearRect(0, 0, width, height);
      const barCount = 14;
      const gap = 2;
      const barWidth = Math.max(2, Math.floor((width - gap * (barCount - 1)) / barCount));
      ctx2d.fillStyle = mutedStyle ? 'rgba(239, 68, 68, 0.35)' : 'rgba(82, 82, 91, 0.55)';
      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + gap);
        const barH = 3;
        const y = Math.round((height - barH) / 2);
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barWidth, barH, 1.5);
        ctx2d.fill();
      }
    };

    if (!stream || !isWatched || !hasLiveAudioTrack) {
      setIsSignalActive(false);
      drawIdleBars(false);
      return;
    }

    const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live');
    if (audioTracks.length === 0) {
      setIsSignalActive(false);
      drawIdleBars(false);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId = 0;
    let lastActiveState = false;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AudioCtx({ latencyHint: 'interactive' });
      const audioOnlyStream = new MediaStream(audioTracks);
      sourceNode = audioCtx.createMediaStreamSource(audioOnlyStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.74;
      // Conecta apenas ao AnalyserNode (NÃO conecta ao destination para jamais duplicar áudio ou causar eco)
      sourceNode.connect(analyser);
    } catch {
      drawIdleBars(false);
      return;
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    const renderFrame = () => {
      if (!analyser || !canvas) return;

      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // Calcula energia RMS do sinal no domínio do tempo para saber se há som real sendo capturado/transmitido
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const centered = (timeData[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      const activeNow = rms > 0.012;
      if (activeNow !== lastActiveState) {
        lastActiveState = activeNow;
        setIsSignalActive(activeNow);
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx2d.clearRect(0, 0, width, height);

      const barCount = 14;
      const gap = 2;
      const barWidth = Math.max(2, Math.floor((width - gap * (barCount - 1)) / barCount));
      const effectivelyMuted = !isSelf && isMuted;

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.min(freqData.length - 1, Math.floor((i * (freqData.length * 0.75)) / barCount));
        const freqVal = freqData[binIndex] / 255;
        const timeIdx = Math.min(timeData.length - 1, Math.floor((i * timeData.length) / barCount));
        const waveDeviation = Math.abs(timeData[timeIdx] - 128) / 128;

        const combined = Math.min(1, freqVal * 0.75 + waveDeviation * 0.85);
        const minBarH = 3;
        const maxBarH = height - 2;
        const barH = Math.max(
          minBarH,
          Math.round(minBarH + combined * (maxBarH - minBarH))
        );
        const x = i * (barWidth + gap);
        const y = Math.round((height - barH) / 2);

        if (effectivelyMuted) {
          ctx2d.fillStyle = combined > 0.08 ? 'rgba(248, 113, 113, 0.7)' : 'rgba(239, 68, 68, 0.3)';
        } else if (isSelf) {
          ctx2d.fillStyle =
            combined > 0.35
              ? '#34d399'
              : combined > 0.08
              ? '#06b6d4'
              : 'rgba(6, 182, 212, 0.35)';
        } else {
          ctx2d.fillStyle =
            combined > 0.45
              ? '#22d3ee'
              : combined > 0.08
              ? '#06b6d4'
              : 'rgba(113, 113, 122, 0.45)';
        }

        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barWidth, barH, 1.5);
        ctx2d.fill();
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      try {
        sourceNode?.disconnect();
        analyser?.disconnect();
        audioCtx?.close();
      } catch {}
    };
  }, [stream, isWatched, isMuted, isSelf, hasLiveAudioTrack, tracksKey]);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
        !hasLiveAudioTrack
          ? 'bg-neutral-900/60 border-neutral-800 text-neutral-500'
          : !isSelf && isMuted
          ? 'bg-red-950/30 border-red-900/50 text-red-300'
          : isSignalActive
          ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300'
          : 'bg-neutral-900/80 border-neutral-800 text-neutral-400'
      }`}
      title={
        !hasLiveAudioTrack
          ? 'Sem sinal de áudio ativo nesta transmissão'
          : isSelf
          ? isSignalActive
            ? 'Áudio sendo capturado e transmitido em tempo real'
            : 'Canal de áudio ativo (aguardando som)'
          : isMuted
          ? 'Áudio recebido em tempo real (mutado localmente para você)'
          : isSignalActive
          ? 'Recebendo áudio em tempo real nesta transmissão'
          : 'Canal de áudio conectado (silêncio no momento)'
      }
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${
          !hasLiveAudioTrack
            ? 'bg-neutral-600'
            : !isSelf && isMuted
            ? 'bg-red-400'
            : isSignalActive
            ? 'bg-emerald-400 shadow-[0_0_6px_#34d399] animate-pulse'
            : 'bg-cyan-500/60'
        }`}
      />
      <canvas
        ref={canvasRef}
        width={68}
        height={18}
        className="w-[68px] h-[18px] block shrink-0"
      />
      {isSelf && hasLiveAudioTrack && (
        <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-300 hidden sm:inline">
          TX
        </span>
      )}
    </div>
  );
};

interface LivePlayerProps {
  id: string;
  userName: string;
  title: string;
  type: 'screen' | 'webcam';
  sourceKind?: 'screen' | 'webcam' | 'capture_card';
  stream?: MediaStream | null;
  resolution: string;
  fps: number;
  isSelf?: boolean;
  hasIsolatedAudio?: boolean;
  processName?: string;
  volume: number;
  isMuted: boolean;
  isWatched: boolean;
  isPoppedOut?: boolean;
  isMirrored?: boolean;
  connectionState?: RTCPeerConnectionState;
  onOpenPopup?: () => void;
  onClosePopup?: () => void;
  onToggleWatch: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleMirror?: () => void;
  onStopLocalSource?: () => void;
  onResetConnection?: () => void;
}

export const LivePlayer: React.FC<LivePlayerProps> = ({
  userName,
  title,
  type,
  sourceKind,
  stream,
  resolution,
  fps,
  isSelf,
  hasIsolatedAudio,
  processName,
  volume,
  isMuted,
  isWatched,
  isPoppedOut = false,
  isMirrored = false,
  connectionState,
  onOpenPopup,
  onClosePopup,
  onToggleWatch,
  onChangeVolume,
  onToggleMute,
  onToggleMirror,
  onStopLocalSource,
  onResetConnection,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedVolumeFlash, setSavedVolumeFlash] = useState(false);
  const flashTimerRef = useRef<any>(null);

  const effectiveKind = sourceKind || (type === 'screen' ? 'screen' : 'webcam');

  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Assinatura reativa das faixas (vídeo + áudio) para re-vincular imediatamente caso a faixa de áudio chegue alguns ms depois do vídeo
  const streamTracksKey = stream
    ? stream
        .getTracks()
        .map((t) => `${t.kind}:${t.id}:${t.readyState}:${t.enabled}`)
        .join('|')
    : '';

  // Web Audio API para amplificação limpa acima de 100% (101% até 150% boost) sem duplicação de fase
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const boostSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostStreamKeyRef = useRef<string>('');

  // Vincula o MediaStream nativo da RTCPeerConnection ao elemento <video> sempre que o stream ou suas faixas mudam
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && isWatched && !isPoppedOut) {
      stream.getTracks().forEach((t) => {
        t.enabled = true;
      });

      if (el.srcObject !== stream) {
        el.srcObject = stream;
      } else {
        // Força o elemento <video> do Chromium a reconhecer novas faixas de áudio adicionadas ao MediaStream
        el.srcObject = stream;
      }

      const targetMuted = isSelf ? true : isMuted;
      el.muted = targetMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));

      el.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch(() => {
          // Se o navegador bloqueou autoplay com áudio antes de clique do usuário, inicia o vídeo e desbloqueia no 1º clique
          if (!targetMuted) {
            setAutoplayBlocked(true);
            el.muted = true;
            el.play().catch(() => {});
          }
        });
    } else {
      if (el) {
        try {
          el.pause();
          el.srcObject = null;
        } catch {}
      }
      setAutoplayBlocked(false);
    }
  }, [stream, streamTracksKey, isWatched, isPoppedOut, isSelf]);

  // Desbloqueia automaticamente o áudio assim que o usuário clicar em qualquer lugar da janela
  useEffect(() => {
    if (!autoplayBlocked) return;
    const unlockAudio = () => {
      const el = videoRef.current;
      if (el && !isSelf && !isMuted) {
        el.muted = false;
        el.volume = Math.max(0, Math.min(1.0, volume / 100));
        el.play()
          .then(() => setAutoplayBlocked(false))
          .catch(() => {});
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    return () => window.removeEventListener('pointerdown', unlockAudio);
  }, [autoplayBlocked, isSelf, isMuted, volume]);

  // Aplica o volume salvo sem reiniciar o elemento <video> e sem silenciar a faixa WebRTC no Chromium
  useEffect(() => {
    const el = videoRef.current;
    if (el && !autoplayBlocked) {
      el.muted = isSelf ? true : isMuted;
      el.volume = isSelf ? 0 : Math.max(0, Math.min(1.0, isMuted ? 0 : volume / 100));
    }

    const hasAudioTracks = !!stream && stream.getAudioTracks().length > 0;
    const useBoost =
      !isSelf && !isMuted && volume > 100 && hasAudioTracks && isWatched && !isPoppedOut;

    if (useBoost && stream) {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new AudioCtx({ latencyHint: 'interactive' });
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (boostStreamKeyRef.current !== streamTracksKey) {
          try {
            boostSourceRef.current?.disconnect();
            boostGainRef.current?.disconnect();
          } catch {}
          boostSourceRef.current = ctx.createMediaStreamSource(stream);
          boostGainRef.current = ctx.createGain();
          boostSourceRef.current.connect(boostGainRef.current);
          boostGainRef.current.connect(ctx.destination);
          boostStreamKeyRef.current = streamTracksKey;
        }
        if (boostGainRef.current) {
          boostGainRef.current.gain.value = (volume - 100) / 100;
        }
        return;
      } catch {
        // fallback para áudio nativo do elemento <video>
      }
    }

    if (boostSourceRef.current || boostGainRef.current) {
      try {
        boostSourceRef.current?.disconnect();
        boostGainRef.current?.disconnect();
      } catch {}
      boostSourceRef.current = null;
      boostGainRef.current = null;
      boostStreamKeyRef.current = '';
    }
  }, [volume, isMuted, isSelf, stream, streamTracksKey, isWatched, isPoppedOut, autoplayBlocked]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      try {
        boostSourceRef.current?.disconnect();
        boostGainRef.current?.disconnect();
        audioCtxRef.current?.close();
      } catch {}
    };
  }, []);

  const handleVolumeUpdate = (newVol: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(newVol)));
    onChangeVolume(clamped);
    setSavedVolumeFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSavedVolumeFlash(false), 1400);
  };

  // Permite ajustar a altura do áudio girando a roda do mouse sobre o controle de volume
  const handleVolumeWheel = (e: React.WheelEvent) => {
    if (isSelf) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 5 : -5;
    const base = isMuted ? 0 : volume;
    handleVolumeUpdate(base + step);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  const getKindLabel = () => {
    if (effectiveKind === 'capture_card') return 'PLACA DE CAPTURA';
    if (effectiveKind === 'webcam') return 'WEBCAM';
    return 'TELA';
  };

  const hasAudioInStream = Boolean(stream && stream.getAudioTracks().length > 0);

  return (
    <div
      ref={containerRef}
      className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl flex flex-col transition-all hover:border-neutral-700 relative group"
    >
      {/* Viewport Principal de Vídeo */}
      <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden">
        {isPoppedOut ? (
          <div className="w-full h-full bg-neutral-950/95 flex flex-col items-center justify-center text-center p-6 space-y-3 border-2 border-dashed border-cyan-500/30">
            <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-500/50 flex items-center justify-center mx-auto text-cyan-400">
              <ExternalLink className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-cyan-300">
                Aberta em Nova Janela Externa
              </h4>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5 max-w-xs">
                Você pode arrastar a nova janela livremente para outro monitor ou deixá-la em tela cheia.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              {onOpenPopup && (
                <button
                  onClick={onOpenPopup}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/60 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all"
                >
                  Focar Nova Janela
                </button>
              )}
              {onClosePopup && (
                <button
                  onClick={onClosePopup}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-mono rounded cursor-pointer transition-all"
                >
                  Voltar p/ Grade
                </button>
              )}
            </div>
          </div>
        ) : isWatched ? (
          <>
            {stream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isSelf ? true : isMuted}
                className={`w-full h-full object-contain bg-black transition-transform duration-150 ${
                  isMirrored ? 'scale-x-[-1]' : ''
                }`}
              />
            ) : (
              /* Estado aguardando stream ou reconectando */
              <div className="w-full h-full relative bg-gradient-to-br from-neutral-950 via-neutral-900 to-cyan-950/40 flex items-center justify-center">
                <div className="text-center space-y-2.5 p-4">
                  {effectiveKind === 'screen' ? (
                    <Gamepad2 className="w-12 h-12 text-cyan-400 mx-auto animate-pulse" />
                  ) : effectiveKind === 'capture_card' ? (
                    <Tv className="w-12 h-12 text-emerald-400 mx-auto animate-pulse" />
                  ) : (
                    <User className="w-12 h-12 text-indigo-400 mx-auto animate-pulse" />
                  )}
                  <h4 className="text-xs font-mono font-bold text-neutral-200">{title}</h4>
                  <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-neutral-400">
                    <span className="text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded">
                      {getKindLabel()}
                    </span>
                    <span>{resolution}</span>
                    <span>{fps} FPS</span>
                  </div>
                  {onResetConnection && !isSelf && (
                    <button
                      onClick={onResetConnection}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-cyan-300 text-[11px] font-mono rounded cursor-pointer transition-colors mt-1"
                      title="Forçar ressincronização da transmissão P2P"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Ressincronizar Stream
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Overlays Superior */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10 flex-wrap">
              <span className="text-[10px] font-mono font-bold bg-neutral-950/80 backdrop-blur border border-neutral-800 px-2 py-0.5 rounded text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {userName} {isSelf && '(Você)'}
              </span>

              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur border ${
                  effectiveKind === 'capture_card'
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                    : effectiveKind === 'webcam'
                    ? 'bg-indigo-950/80 border-indigo-700 text-indigo-300'
                    : 'bg-neutral-950/80 border-neutral-700 text-neutral-300'
                }`}
              >
                {title} ({resolution}·{fps}fps)
              </span>

              {hasIsolatedAudio && (
                <span className="text-[10px] font-mono bg-cyan-950/80 border border-cyan-800 text-cyan-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                  WASAPI {processName ? `[${processName}]` : 'Isolado'}
                </span>
              )}

              {effectiveKind === 'capture_card' && hasAudioInStream && (
                <span className="text-[10px] font-mono bg-emerald-950/85 border border-emerald-700 text-emerald-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                  <Volume2 className="w-2.5 h-2.5 text-emerald-400" />
                  Áudio Captura Estéreo
                </span>
              )}

              {isMirrored && (
                <span className="text-[10px] font-mono bg-indigo-950/80 border border-indigo-700 text-indigo-200 px-1.5 py-0.5 rounded backdrop-blur">
                  Espelhado
                </span>
              )}

              {!isSelf && connectionState && connectionState !== 'connected' && (
                <span className="text-[10px] font-mono bg-amber-950/90 border border-amber-700 text-amber-300 px-2 py-0.5 rounded backdrop-blur flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  Reconectando P2P...
                </span>
              )}
            </div>

            {autoplayBlocked && !isSelf && !isMuted && (
              <button
                type="button"
                onClick={() => {
                  const el = videoRef.current;
                  if (el) {
                    el.muted = false;
                    el.volume = Math.max(0, Math.min(1.0, volume / 100));
                    el.play()
                      .then(() => setAutoplayBlocked(false))
                      .catch(() => {});
                  }
                }}
                className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-mono font-bold text-xs shadow-lg cursor-pointer animate-bounce"
              >
                <Volume2 className="w-4 h-4" />
                Clique para Ativar o Áudio
              </button>
            )}

            {/* Botões de Ação Superior Direito (Inverter + Reset P2P + Popup + Tela Cheia + Encerrar Fonte) */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              {onToggleMirror && (
                <button
                  onClick={onToggleMirror}
                  className={`p-1.5 rounded border cursor-pointer backdrop-blur transition-colors ${
                    isMirrored
                      ? 'bg-indigo-600/90 border-indigo-400 text-white'
                      : 'bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 border-neutral-800'
                  }`}
                  title={isMirrored ? 'Desativar inversão horizontal (Normal)' : 'Inverter / Espelhar horizontalmente'}
                >
                  <FlipHorizontal className="w-4 h-4" />
                </button>
              )}
              {!isSelf && onResetConnection && (
                <button
                  onClick={onResetConnection}
                  className="p-1.5 bg-neutral-950/80 hover:bg-amber-950 text-neutral-300 hover:text-amber-300 rounded border border-neutral-800 hover:border-amber-700 cursor-pointer backdrop-blur"
                  title="Resetar e Reconectar este Stream P2P"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              {onOpenPopup && (
                <button
                  onClick={onOpenPopup}
                  className="p-1.5 bg-neutral-950/80 hover:bg-cyan-950 text-neutral-300 hover:text-cyan-300 rounded border border-neutral-800 hover:border-cyan-700 cursor-pointer backdrop-blur"
                  title="Abrir em Janela Popup Flutuante"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 rounded border border-neutral-800 cursor-pointer backdrop-blur"
                title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              {isSelf && onStopLocalSource && (
                <button
                  onClick={onStopLocalSource}
                  className="p-1.5 bg-red-950/85 hover:bg-red-800 text-red-200 rounded border border-red-700 cursor-pointer backdrop-blur"
                  title="Desligar esta fonte de vídeo"
                >
                  <PowerOff className="w-4 h-4" />
                </button>
              )}
            </div>
          </>
        ) : (
          /* Estado Pausado / On-Demand Desativado (Economia de Banda e CPU) */
          <div className="text-center p-6 space-y-3">
            <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
              <EyeOff className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-neutral-300">
                {stream ? 'Transmissão Pausada Localmente' : `${userName} está transmitindo`}{' '}
                {!stream &&
                  (effectiveKind === 'screen'
                    ? 'a Tela'
                    : effectiveKind === 'capture_card'
                    ? 'Placa de Captura'
                    : 'Câmera')}
              </h4>
              <p className="text-[11px] text-neutral-500 font-mono">
                {userName} · {title} ({resolution} · {fps} FPS)
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onToggleWatch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/50 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                {stream ? 'Retomar Transmissão' : 'Assistir Live (On-Demand)'}
              </button>
              {onResetConnection && !isSelf && (
                <button
                  type="button"
                  onClick={onResetConnection}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-cyan-300 text-xs font-mono rounded cursor-pointer transition-all"
                  title="Resetar conexão P2P com este participante"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controles de Áudio, Visualizador de Forma de Onda em Tempo Real & Volume Individual */}
      <div
        onWheel={handleVolumeWheel}
        className="p-3 bg-neutral-950/80 border-t border-neutral-800 flex items-center justify-between gap-2 flex-wrap"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {effectiveKind === 'webcam' && !hasAudioInStream ? (
            <span className="text-[11px] font-mono text-neutral-500 bg-neutral-900/70 border border-neutral-800 px-2.5 py-1 rounded flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-neutral-600" />
              Câmera (Apenas Vídeo · Sem Áudio)
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={onToggleMute}
                disabled={isSelf}
                className={`p-1.5 rounded border cursor-pointer transition-colors ${
                  isSelf
                    ? 'bg-neutral-900/50 border-neutral-800 text-neutral-600 cursor-not-allowed'
                    : isMuted
                    ? 'bg-red-950/60 border-red-800 text-red-400'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
                }`}
                title={
                  isSelf
                    ? 'Sua própria transmissão fica mutada localmente para evitar eco'
                    : isMuted
                    ? 'Desmutar (restaurar volume salvo)'
                    : 'Mutar áudio'
                }
              >
                {isMuted || isSelf ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                )}
              </button>

              {/* Visualizador de Forma de Onda (Waveform) em Tempo Real para confirmar captura e transmissão de áudio */}
              <AudioWaveformVisualizer
                stream={stream}
                isWatched={isWatched}
                isMuted={isMuted}
                isSelf={isSelf}
                tracksKey={streamTracksKey}
              />

              {/* Slider de Volume Individual (0% até 200% boost) com salvamento automático */}
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={isSelf ? 0 : isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeUpdate(Number(e.target.value))}
                  onDoubleClick={() => !isSelf && handleVolumeUpdate(100)}
                  disabled={isSelf}
                  title="Arraste ou use a roda do mouse para ajustar a altura do áudio até 200% (duplo clique volta para 100%). Salvo automaticamente."
                  className="w-20 sm:w-24 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                />
                <span
                  onClick={() => !isSelf && handleVolumeUpdate(100)}
                  title="Volume salvo automaticamente para esta transmissão (clique para resetar em 100%)"
                  className={`text-[10px] font-mono w-10 cursor-pointer select-none transition-colors ${
                    !isSelf && volume > 100
                      ? 'text-amber-400 font-bold'
                      : 'text-neutral-300 hover:text-cyan-300'
                  }`}
                >
                  {isSelf ? 'Local' : isMuted ? '0%' : `${volume}%`}
                </span>

                {!isSelf && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all ${
                      savedVolumeFlash
                        ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                        : 'bg-neutral-900/70 border-neutral-800 text-neutral-500'
                    }`}
                    title={`Altura do áudio (${isMuted ? '0%' : `${volume}%`}) guardada para ${userName}`}
                  >
                    <BookmarkCheck className="w-3 h-3 text-cyan-400" />
                    <span className="hidden sm:inline">{savedVolumeFlash ? 'Salvo!' : 'Salvo'}</span>
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Botão explícito para Inverter / Espelhar qualquer fonte */}
          {isWatched && onToggleMirror && (
            <button
              type="button"
              onClick={onToggleMirror}
              className={`text-[11px] font-mono flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border transition-colors ${
                isMirrored
                  ? 'bg-indigo-950/80 border-indigo-600 text-indigo-200'
                  : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300'
              }`}
              title="Inverter / Espelhar horizontalmente esta imagem"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>{isMirrored ? 'Invertido' : 'Inverter'}</span>
            </button>
          )}

          {/* Botão de Destacar em Popup */}
          {isWatched && onOpenPopup && !isPoppedOut && (
            <button
              type="button"
              onClick={onOpenPopup}
              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer bg-cyan-950/40 hover:bg-cyan-950/80 border border-cyan-800/60 px-2 py-1 rounded transition-colors"
              title="Abrir esta live em janela popup com tamanho e qualidade ajustáveis"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Popup</span>
            </button>
          )}

          {/* Botão de Pausar Visualização */}
          {isWatched && !isSelf && (
            <button
              type="button"
              onClick={onToggleWatch}
              className="text-[11px] font-mono text-neutral-300 hover:text-amber-300 bg-neutral-900 hover:bg-amber-950/40 border border-neutral-800 hover:border-amber-700/60 px-2 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors"
              title="Pausar reprodução deste stream para economizar CPU/GPU e áudio"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Pausar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
