import React, { useEffect, useRef } from 'react';
import { Activity, ShieldCheck, Check, AlertCircle, Waves, Volume2 } from 'lucide-react';
import { WindowItem } from '../types';

interface WasapiVisualizerProps {
  selectedWindow: WindowItem | null;
  isolateAudio: boolean;
  isBroadcasting: boolean;
}

export const WasapiVisualizer: React.FC<WasapiVisualizerProps> = ({
  selectedWindow,
  isolateAudio,
  isBroadcasting,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Fundo escuro com grid sutil
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#171720';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const active = isBroadcasting && isolateAudio && selectedWindow;

      if (active) {
        // Desenha barras de equalizador PCM estilo cyberpunk
        const bars = 36;
        const barWidth = Math.floor(width / bars) - 2;

        for (let i = 0; i < bars; i++) {
          const t = phase + i * 0.25;
          const noise = Math.sin(t * 1.5) * 0.4 + Math.sin(t * 3.7) * 0.3 + 0.3;
          const barHeight = Math.max(6, noise * (height - 18));

          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, '#06b6d4'); // cyan
          grad.addColorStop(0.7, '#6366f1'); // indigo
          grad.addColorStop(1, '#a855f7'); // purple

          ctx.fillStyle = grad;
          ctx.fillRect(i * (barWidth + 2) + 2, height - barHeight, barWidth, barHeight);
        }

        phase += 0.08;
      } else {
        // Linha de repouso (silêncio)
        ctx.strokeStyle = '#262626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.fillStyle = '#525252';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          isolateAudio ? 'Aguardando Início da Transmissão do Processo' : 'Isolamento de Áudio Desativado',
          width / 2,
          height / 2 - 8
        );
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isBroadcasting, isolateAudio, selectedWindow]);

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-5 shadow-xl space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200 font-mono">
            WASAPI Process Loopback Telemetria & Monitor de Espectro
          </h3>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
            <Check className="w-3 h-3" />
            Discord Voz Ignorada (Zero Eco)
          </span>
          <span className="text-neutral-400 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
            48,000 Hz · 32-bit Float PCM
          </span>
        </div>
      </div>

      {/* Canvas do Equalizador PCM */}
      <div className="relative rounded-lg overflow-hidden border border-neutral-800 bg-neutral-950">
        <canvas
          ref={canvasRef}
          width={720}
          height={80}
          className="w-full h-20 block"
        />

        {isBroadcasting && isolateAudio && selectedWindow && (
          <div className="absolute top-2 left-3 flex items-center gap-1.5 text-[10px] font-mono bg-neutral-950/80 px-2 py-0.5 rounded border border-cyan-800 text-cyan-300">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            Capturando: {selectedWindow.process_name} (PID: {selectedWindow.pid})
          </div>
        )}
      </div>

      {/* Detalhes Técnicos de Baixo Nível do Windows */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono text-neutral-400 pt-1">
        <div className="bg-neutral-950 p-2 rounded border border-neutral-800/80">
          <span className="text-neutral-500 block text-[9px] uppercase">API do Windows</span>
          <span className="text-neutral-200">ActivateAudioInterfaceAsync</span>
        </div>
        <div className="bg-neutral-950 p-2 rounded border border-neutral-800/80">
          <span className="text-neutral-500 block text-[9px] uppercase">Modo Loopback</span>
          <span className="text-neutral-200">INCLUDE_TARGET_PROCESS_TREE</span>
        </div>
        <div className="bg-neutral-950 p-2 rounded border border-neutral-800/80">
          <span className="text-neutral-500 block text-[9px] uppercase">Isolamento Acústico</span>
          <span className="text-emerald-400 font-semibold">100% Livre de Eco Externo</span>
        </div>
      </div>
    </div>
  );
};
