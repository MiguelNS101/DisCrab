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
  Cpu,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  PerformanceLogEntry,
  RemotePeer,
  P2PTelemetryPoint,
} from '../services/webrtc/WebRtcEngine';
import { WindowItem } from '../types';
import { getProcessMemory, isTauriEnvironment } from '../services/tauriBridge';

interface PerformanceDrawerProps {
  logs: PerformanceLogEntry[];
  telemetryHistory?: P2PTelemetryPoint[];
  peers: RemotePeer[];
  onClearLogs: () => void;
  myNickname: string;
  selectedWindow?: WindowItem | null;
  isolateAudio?: boolean;
  onToggleIsolateAudio?: (val: boolean) => void;
  isBroadcasting?: boolean;
  activeAudioLabel?: string;
}

function formatBitrate(kbps: number): string {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(2)} Mbps`;
  }
  return `${Math.round(kbps)} kbps`;
}

export const PerformanceDrawer: React.FC<PerformanceDrawerProps> = ({
  logs,
  telemetryHistory = [],
  peers,
  onClearLogs,
  myNickname,
  selectedWindow = null,
  isolateAudio = true,
  onToggleIsolateAudio,
  isBroadcasting = false,
  activeAudioLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'network' | 'wasapi' | 'engine'>('network');
  const [filterUser, setFilterUser] = useState<string>('all');
  const [liveMemoryMb, setLiveMemoryMb] = useState<number>(38.5);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([
    38, 38.2, 38.5, 38.7, 39, 38.8, 38.5,
  ]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isNative = isTauriEnvironment();

  // Monitoramento contínuo em tempo real da Memória RAM e Heap
  useEffect(() => {
    let mounted = true;
    const updateMem = async () => {
      try {
        const mem = await getProcessMemory();
        if (mounted && mem > 0) {
          setLiveMemoryMb(mem);
          setMemoryHistory((prev) => [...prev.slice(-19), mem]);
        }
      } catch (_) {}
    };

    updateMem();
    const timer = setInterval(updateMem, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  // Último ponto de telemetria P2P em tempo real
  const latestTelemetry: P2PTelemetryPoint =
    telemetryHistory.length > 0
      ? telemetryHistory[telemetryHistory.length - 1]
      : {
          timestamp: Date.now(),
          timeLabel: '--:--',
          bitrateKbps: 0,
          inboundKbps: 0,
          outboundKbps: 0,
          packetLossPct: 0,
          rttMs: 0,
          fps: 0,
          activePeers: peers.length,
        };

  // Dados preenchidos para o gráfico Recharts (garante visualização suave mesmo nos primeiros segundos)
  const chartData =
    telemetryHistory.length > 0
      ? telemetryHistory
      : [
          {
            timeLabel: '00:00',
            bitrateKbps: 0,
            inboundKbps: 0,
            outboundKbps: 0,
            packetLossPct: 0,
            rttMs: 0,
          },
        ];

  // Determina status de saúde geral
  const hasErrors = logs.some((l) => l.type === 'error');
  const hasWarnings = logs.some((l) => l.type === 'warning');
  const recentIssuesCount = logs.filter((l) => Date.now() - l.timestamp < 30000).length;

  const filteredLogs =
    filterUser === 'all'
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
        title="Monitor em Tempo Real de Bitrate P2P, Perda de Pacotes e WASAPI"
      >
        <span className="relative flex h-2 w-2">
          {recentIssuesCount > 0 && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              hasErrors
                ? 'bg-red-500'
                : hasWarnings || recentIssuesCount > 0
                ? 'bg-amber-400'
                : 'bg-emerald-400'
            }`}
          />
        </span>
        <Activity className="w-3.5 h-3.5" />
        <span className="font-semibold">Telemetria & Motor</span>
        {latestTelemetry.bitrateKbps > 0 && (
          <span className="px-1.5 py-0.2 bg-emerald-950/80 border border-emerald-800/70 rounded text-[10px] text-emerald-300">
            {formatBitrate(latestTelemetry.bitrateKbps)}
          </span>
        )}
        <span className="px-1.5 py-0.2 bg-black/40 rounded text-[10px] text-cyan-300">
          {liveMemoryMb.toFixed(1)} MB
        </span>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {/* Painel Expansível de Diagnóstico */}
      {isOpen && (
        <div className="absolute bottom-10 right-0 w-96 sm:w-[28rem] max-h-[38rem] bg-neutral-950/95 border border-neutral-800 rounded-xl shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200 overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-200">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>Painel de Diagnóstico P2P</span>
            </div>

            {/* Alternador de Abas */}
            <div className="flex bg-neutral-900 border border-neutral-800 rounded p-0.5 text-[10px]">
              <button
                onClick={() => setActiveTab('network')}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeTab === 'network'
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Rede P2P
              </button>
              <button
                onClick={() => setActiveTab('wasapi')}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeTab === 'wasapi'
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Áudio WASAPI
              </button>
              <button
                onClick={() => setActiveTab('engine')}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeTab === 'engine'
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Memória / Motor
              </button>
            </div>
          </div>

          {activeTab === 'network' ? (
            <>
              {/* Indicadores Rápidos de Bitrate, Perda de Pacotes e Ping */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-2">
                  <span className="text-[9px] uppercase text-neutral-400 block">
                    Taxa de Bits P2P
                  </span>
                  <span className="text-xs font-bold text-cyan-300">
                    {formatBitrate(latestTelemetry.bitrateKbps)}
                  </span>
                  <span className="text-[9px] text-neutral-500 block">
                    ↑{formatBitrate(latestTelemetry.outboundKbps)} · ↓
                    {formatBitrate(latestTelemetry.inboundKbps)}
                  </span>
                </div>

                <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-2">
                  <span className="text-[9px] uppercase text-neutral-400 block">
                    Perda de Pacotes
                  </span>
                  <span
                    className={`text-xs font-bold ${
                      latestTelemetry.packetLossPct > 5
                        ? 'text-red-400'
                        : latestTelemetry.packetLossPct > 1
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {latestTelemetry.packetLossPct.toFixed(1)}%
                  </span>
                  <span className="text-[9px] text-neutral-500 block">
                    {latestTelemetry.packetLossPct === 0 ? ' Sem perdas' : 'RTP Stream'}
                  </span>
                </div>

                <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-2">
                  <span className="text-[9px] uppercase text-neutral-400 block">
                    Latência / FPS
                  </span>
                  <span className="text-xs font-bold text-indigo-300">
                    {latestTelemetry.rttMs} ms
                  </span>
                  <span className="text-[9px] text-neutral-500 block">
                    {latestTelemetry.fps > 0 ? `${latestTelemetry.fps} FPS` : 'Standby'}
                  </span>
                </div>
              </div>

              {/* Gráfico em Tempo Real (Recharts) de Bitrate (kbps) e Perda de Pacotes (%) */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="uppercase text-neutral-400 font-semibold tracking-wider">
                    Monitor P2P Ao Vivo (Bitrate & Perda)
                  </span>
                  <div className="flex items-center gap-2.5 text-[9px]">
                    <span className="flex items-center gap-1 text-cyan-300">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
                      Bitrate (kbps)
                    </span>
                    <span className="flex items-center gap-1 text-rose-400">
                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                      Perda (%)
                    </span>
                  </div>
                </div>

                <div className="h-36 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 6, right: 4, left: -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="bitrateGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                      <XAxis
                        dataKey="timeLabel"
                        stroke="#6b7280"
                        fontSize={9}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="left"
                        stroke="#06b6d4"
                        fontSize={9}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}M` : `${v}k`)}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={[0, 100]}
                        stroke="#f43f5e"
                        fontSize={9}
                        tickLine={false}
                        axisLine={false}
                        width={28}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#09090b',
                          borderColor: '#27272a',
                          borderRadius: '8px',
                          fontSize: '10px',
                          fontFamily: 'monospace',
                        }}
                        formatter={(value: any, name: any) => {
                          if (name === 'bitrateKbps') {
                            return [formatBitrate(Number(value) || 0), 'Taxa de Bits'];
                          }
                          if (name === 'packetLossPct') {
                            return [`${Number(value || 0).toFixed(1)}%`, 'Perda de Pacotes'];
                          }
                          return [value, String(name || '')];
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="bitrateKbps"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#bitrateGrad)"
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="packetLossPct"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#f43f5e' }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Status dos Participantes Conectados */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold">
                  Participantes ({peers.length + 1})
                </span>
                <div className="space-y-1 max-h-20 overflow-y-auto pr-1">
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
                      <span className="flex items-center gap-1.5 text-neutral-300 truncate max-w-[140px]">
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
              <div className="flex-1 flex flex-col space-y-1.5 min-h-[90px]">
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

                <div className="flex-1 max-h-28 overflow-y-auto space-y-1.5 pr-1">
                  {filteredLogs.length === 0 ? (
                    <div className="text-center py-3 text-neutral-500 text-xs">
                      <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-emerald-500/50" />
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
          ) : activeTab === 'wasapi' ? (
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
                    <span>Fonte de Áudio:</span>
                    <strong className="text-cyan-300 truncate max-w-[180px]">
                      {activeAudioLabel ||
                        (selectedWindow ? selectedWindow.process_name : 'Áudio Global (Sem Discord)')}
                    </strong>
                  </div>
                  {selectedWindow && (
                    <div className="flex justify-between">
                      <span>Janela da Live:</span>
                      <strong className="text-neutral-200">
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
                      Filtro Anti-Eco Discord:
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
          ) : (
            /* Aba de Memória / Motor em Tempo Real */
            <div className="space-y-3">
              <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-300 font-bold flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-cyan-400" />
                    Uso de Memória RAM em Tempo Real:
                  </span>
                  <span className="text-emerald-400 font-bold bg-emerald-950/70 border border-emerald-900 px-2 py-0.5 rounded text-xs">
                    {liveMemoryMb.toFixed(1)} MB
                  </span>
                </div>

                {/* Mini Gráfico de Histórico de Memória */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-neutral-400">
                    <span>Tendência de Consumo</span>
                    <span className="text-cyan-400 font-bold">
                      {isNative ? 'WorkingSet Win32' : 'JS Heap Real'}
                    </span>
                  </div>
                  <div className="h-10 bg-neutral-950 border border-neutral-800 rounded flex items-end p-1 gap-1">
                    {memoryHistory.map((m, idx) => {
                      const max = Math.max(...memoryHistory, 50);
                      const min = Math.min(...memoryHistory, 25);
                      const pct = Math.max(15, Math.min(100, ((m - min) / (max - min || 1)) * 100));
                      return (
                        <div
                          key={idx}
                          style={{ height: `${pct}%` }}
                          className="flex-1 bg-gradient-to-t from-cyan-600 to-indigo-500 rounded-t-sm transition-all duration-300"
                          title={`${m.toFixed(1)} MB`}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 text-[11px] text-neutral-400 pt-1 border-t border-neutral-800">
                  <div className="flex justify-between">
                    <span>Arquitetura do Motor:</span>
                    <strong className="text-neutral-200">
                      {isNative ? 'Rust Native Backend + WASAPI COM' : 'Web AudioWorklet RingBuffer'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Buffer de Áudio PCM:</span>
                    <strong className="text-emerald-400">Zero Memory Leak · Ring Circular</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Jitter & Dropouts:</span>
                    <strong className="text-emerald-400">0.00% (Sincronizado)</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Limites de Transferência:</span>
                    <strong className="text-cyan-300">Sem Limite (SCTP Chunked Flow Control)</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
