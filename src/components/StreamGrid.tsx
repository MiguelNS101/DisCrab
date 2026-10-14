import React from 'react';
import {
  Monitor,
  Video,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Maximize2,
  Radio,
  Gamepad2,
  User,
} from 'lucide-react';
import { StreamItem } from '../types';

interface StreamGridProps {
  streams: StreamItem[];
  onToggleWatch: (id: string) => void;
  onChangeVolume: (id: string, vol: number) => void;
  onToggleMute: (id: string) => void;
}

export const StreamGrid: React.FC<StreamGridProps> = ({
  streams,
  onToggleWatch,
  onChangeVolume,
  onToggleMute,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono">
            Transmissões & Webcams na Sala ({streams.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-neutral-400">
          Modo On-Demand: ative apenas os streams que deseja assistir
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
        {streams.map((stream) => (
          <div
            key={stream.id}
            className="bg-neutral-900/90 border border-neutral-800 rounded-xl overflow-hidden shadow-xl flex flex-col transition-all hover:border-neutral-700"
          >
            {/* Viewport de Vídeo / Placeholder On-Demand */}
            <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden group">
              {stream.is_watched ? (
                <div className="w-full h-full relative bg-gradient-to-br from-neutral-950 to-neutral-900 flex items-center justify-center">
                  {/* Mock gráfico de frame de jogo / webcam */}
                  <div className="text-center space-y-2 p-4">
                    {stream.type === 'screen' ? (
                      <div className="relative inline-block">
                        <Monitor className="w-12 h-12 text-cyan-400 mx-auto opacity-70" />
                        <span className="absolute -bottom-1 -right-1 p-1 bg-neutral-900 rounded-full border border-cyan-800 text-cyan-400">
                          <Gamepad2 className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    ) : (
                      <User className="w-12 h-12 text-indigo-400 mx-auto opacity-70" />
                    )}
                    <p className="text-xs font-mono font-bold text-neutral-200">
                      {stream.title}
                    </p>
                    <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-neutral-400">
                      <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-1.5 py-0.5 rounded">
                        AO VIVO P2P
                      </span>
                      <span>{stream.resolution}</span>
                      <span>{stream.fps} FPS</span>
                    </div>
                  </div>

                  {/* Badges Overlay */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold bg-neutral-950/80 backdrop-blur border border-neutral-800 px-2 py-0.5 rounded text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {stream.user_name}
                    </span>
                    {stream.isolated_audio && (
                      <span className="text-[10px] font-mono bg-cyan-950/80 border border-cyan-800 text-cyan-300 px-2 py-0.5 rounded">
                        WASAPI {stream.process_name ? `(${stream.process_name})` : 'Isolado'}
                      </span>
                    )}
                  </div>

                  <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1.5 bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 rounded border border-neutral-800 cursor-pointer"
                      title="Tela Cheia"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Estado Economia de Banda / Desligado */
                <div className="text-center p-6 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
                    <EyeOff className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-neutral-300">
                      {stream.user_name} está transmitindo {stream.type === 'screen' ? 'a Tela' : 'a Câmera'}
                    </h4>
                    <p className="text-[11px] text-neutral-500 font-mono">
                      {stream.title} ({stream.resolution} · {stream.fps} FPS)
                    </p>
                  </div>
                  <button
                    onClick={() => onToggleWatch(stream.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-semibold rounded cursor-pointer transition-all shadow-sm"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Assistir Live (On-Demand)
                  </button>
                </div>
              )}
            </div>

            {/* Controles de Áudio e Volume Individual */}
            <div className="p-3 bg-neutral-950/60 border-t border-neutral-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onToggleMute(stream.id)}
                  className={`p-1.5 rounded border cursor-pointer transition-colors ${
                    stream.is_muted
                      ? 'bg-red-950/60 border-red-800 text-red-400'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
                  }`}
                  title={stream.is_muted ? 'Desmutar' : 'Mutar'}
                >
                  {stream.is_muted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  )}
                </button>

                {/* Slider de volume com suporte a boost de 0 a 150% */}
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={150}
                    value={stream.is_muted ? 0 : stream.volume}
                    onChange={(e) => onChangeVolume(stream.id, Number(e.target.value))}
                    disabled={stream.is_muted}
                    className="w-24 sm:w-32 accent-cyan-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-neutral-400 w-9">
                    {stream.is_muted ? '0%' : `${stream.volume}%`}
                  </span>
                </div>
              </div>

              {/* Botão de Fechar / Pausar Visualização */}
              {stream.is_watched && (
                <button
                  onClick={() => onToggleWatch(stream.id)}
                  className="text-[11px] font-mono text-neutral-400 hover:text-neutral-200 flex items-center gap-1 cursor-pointer"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Pausar</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
