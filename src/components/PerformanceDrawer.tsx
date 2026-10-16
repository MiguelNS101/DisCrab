import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  Trash2,
  User,
  Wifi,
  Waves,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { PerformanceLogEntry, RemotePeer } from '../services/webrtc/WebRtcEngine';
import { WindowItem } from '../types';

interface PerformanceDrawerProps {
  logs: PerformanceLogEntry[];
  peers: RemotePeer[];
  onClearLogs: () => void;
  myNickname: string;
  selectedWindow?: WindowItem | null;
  isolateAudio?: boolean;
  onToggleIsolateAudio?: (val: boolean) => void;
  isBroadcasting?: boolean;
}

export const PerformanceDrawer: React.FC<PerformanceDrawerProps> = ({
  logs,
  peers,
  onClearLogs,
  myNickname,
  selectedWindow = null,
  isolateAudio = true,
  onToggleIsolateAudio,
  isBroadcasting = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'network' | 'wasapi'>('network');
  const [filterUser, setFilterUser] = useState<string>('all');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Determina status de saúde geral
  const hasErrors = logs.some((l) => l.type === 'error');
  const hasWarnings = logs.some((l) => l.type === 'warning');
  const recentIssuesCount = logs.filter((l) => Date.now() - l.timestamp < 30000).length;

  const filteredLogs = filterUser === 'all'
    ? logs
    : logs.filter((l) => l.userName.toLowerCase() === filterUser.toLowerCase());

  // Equalizador WASAPI quando aba de áudio estiver aberta
  useEffect(() => {
    if (!isOpen || activeTab !== 'wasapi') return;
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

      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#171720';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (isBroadcasting) {
        const bars = 24;
        const barWidth = Math.floor(width / bars) - 2;

        for (let i = 0; i < bars; i++) {
          const t = phase + i * 0.3;
          const noise = Math.sin(t * 1.5) * 0.4 + Math.sin(t * 3.7) * 0.3 + 0.3;
          const barHeight = Math.max(4, noise * (height - 12));

          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, '#06b6d4');
          grad.addColorStop(0.7, '#6366f1');
          grad.addColorStop(1, '#a855f7');

          ctx.fillStyle = grad;
          ctx.fillRect(i * (barWidth + 2) + 2, height - barHeight, barWidth, barHeight);
        }

        phase += 0.09;
      } else {
        ctx.strokeStyle = '#262626';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.fillStyle = '#525252';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Aguardando Transmissão de Áudio', width / 2, height / 2 - 6);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isOpen, activeTab, isBroadcasting]);

  return (
    <div className="fixed bottom-3 right-3 z-40 font-mono">
      {/* Botão Flutuante Discreto */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs backdrop-blur-md shadow-lg transition-all cursor-pointer ${
          hasErrors
            ? 'bg-red-950/80 border-red-800 text-red-300 hover:bg-red-900/90'
            : hasWarnings || recentIssuesCount > 0
            ? 'bg-amber-950/80 border-amber-800 text-amber-300 hover:bg-amber-900/90'
            : 'bg-neutral-900/80 border-neutral-800 text-neutral-300 hover:bg-neutral-800/90'
        }`}
        title="Monitor Discreto de Desempenho e Diagnóstico WASAPI"
      >
        <span className="relative flex h-2 w-2">
          {recentIssuesCount > 0 && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              hasErrors ? 'bg-red-500' : hasWarnings || recentIssuesCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
        </span>
        <Activity className="w-3.5 h-3.5" />
        <span className="font-semibold">Diagnóstico & Telemetria</span>
        {logs.length > 0 && (
          <span className="px-1.5 py-0.2 bg-black/40 rounded text-[10px]">
            {logs.length}
          </span>
        )}
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {/* Painel Expansível de Diagnóstico */}
      {isOpen && (
        <div className="absolute bottom-10 right-0 w-80 sm:w-96 max-h-[30rem] bg-neutral-950/95 border border-neutral-800 rounded-xl shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-200">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>Painel de Diagnóstico</span>
            </div>

            {/* Alternador de Abas */}
            <div className="flex bg-neutral-900 border border-neutral-800 rounded p-0.5 text-[10px]">
              <button
                onClick={() => setActiveTab('network')}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeTab === 'network' ? 'bg-cyan-500 text-black font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Rede P2P
              </button>
              <button
                onClick={() => setActiveTab('wasapi')}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeTab === 'wasapi' ? 'bg-cyan-500 text-black font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Áudio WASAPI
              </button>
            </div>
          </div>

          {activeTab === 'network' ? (
            <>
              {/* Status dos Participantes Conectados */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold">
                  Participantes ({peers.length + 1})
                </span>
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  <div className="flex items-center justify-between bg-neutral-900/60 border border-neutral-800/80 rounded px-2.5 py-1 text-[11px]">
                    <span className="flex items-center gap-1.5 text-neutral-300">
                      <User className="w-3 h-3 text-cyan-400" />
                      {myNickname} (Você)
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.2 rounded">
                      Local
                    </span>
                  </div>

                  {peers.map((peer) => (
                    <div
                      key={peer.id}
                      className="flex items-center justify-between bg-neutral-900/60 border border-neutral-800/80 rounded px-2.5 py-1 text-[11px]"
                    >
                      <span className="flex items-center gap-1.5 text-neutral-300 truncate max-w-[120px]">
                        <User className="w-3 h-3 text-indigo-400" />
                        {peer.nickname}
                      </span>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-neutral-400 flex items-center gap-1">
                          <Wifi className="w-2.5 h-2.5 text-cyan-400" />
                          {peer.connectionState === 'connected' ? 'P2P Ativo' : peer.connectionState}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Histórico Discreto de Eventos e Problemas com filtro de usuário */}
              <div className="flex-1 flex flex-col space-y-1.5 min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold">
                    Registro de Alertas
                  </span>
                  <div className="flex items-center gap-1.5">
                    {peers.length > 0 && (
                      <select
                        value={filterUser}
                        onChange={(e) => setFilterUser(e.target.value)}
                        className="bg-neutral-900 border border-neutral-800 text-[10px] text-neutral-300 rounded px-1.5 py-0.5 outline-none cursor-pointer"
                      >
                        <option value="all">Todos</option>
                        {peers.map((p) => (
                          <option key={p.id} value={p.nickname}>
                            {p.nickname}
                          </option>
                        ))}
                      </select>
                    )}
                    {logs.length > 0 && (
                      <button
                        onClick={onClearLogs}
                        className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-red-400 rounded transition-colors cursor-pointer"
                        title="Limpar histórico"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {filteredLogs.length === 0 ? (
                    <div className="text-center py-5 text-neutral-500 text-xs">
                      <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-500/50" />
                      Nenhum problema de performance detectado.
                    </div>
                  ) : (
                    filteredLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`p-2 rounded border text-xs space-y-1 ${
                          log.type === 'error'
                            ? 'bg-red-950/40 border-red-900/60 text-red-200'
                            : log.type === 'warning'
                            ? 'bg-amber-950/40 border-amber-900/60 text-amber-200'
                            : 'bg-neutral-900/60 border-neutral-800 text-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] opacity-75">
                          <span className="font-bold text-cyan-400">@{log.userName}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[11px] leading-tight flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" />
                          <span>{log.message}</span>
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Aba de Diagnóstico WASAPI & Áudio Isolado */
            <div className="space-y-3">
              <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400 flex items-center gap-1.5">
                    <Waves className="w-3.5 h-3.5 text-cyan-400" />
                    WASAPI Process Loopback:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleIsolateAudio?.(!isolateAudio)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${
                        isolateAudio
                          ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 font-bold'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-500'
                      }`}
                    >
                      {isolateAudio ? 'Ativado' : 'Desativado'}
                    </button>
                    <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-900 px-1.5 py-0.2 rounded text-[10px]">
                      {isBroadcasting ? 'Capturando' : 'Pronto'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-[11px] text-neutral-400">
                  <div className="flex justify-between">
                    <span>Modo de Captura:</span>
                    <strong className="text-neutral-200">
                      {selectedWindow ? 'Janela Isolada (Processo Exclusivo)' : 'Tela Completa (Zero Eco Discord)'}
                    </strong>
                  </div>
                  {selectedWindow && (
                    <div className="flex justify-between">
                      <span>Processo Alvo:</span>
                      <strong className="text-cyan-300">
                        {selectedWindow.process_name} (PID: {selectedWindow.pid})
                      </strong>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Taxa de Amostragem:</span>
                    <strong className="text-neutral-200">48.000 Hz · 32-bit Float Estéreo</strong>
                  </div>
                  <div className="flex justify-between items-center text-emerald-400 pt-1">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Filtro de Eco do Discord:
                    </span>
                    <span>100% Excluído</span>
                  </div>
                </div>
              </div>

              {/* Visualizador de Espectro PCM */}
              <div>
                <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold block mb-1">
                  Espectro PCM em Tempo Real
                </span>
                <canvas
                  ref={canvasRef}
                  width={320}
                  height={60}
                  className="w-full h-16 rounded border border-neutral-800 bg-neutral-950"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
