import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Gauge, Trash2, User, Wifi } from 'lucide-react';
import { PerformanceLogEntry, RemotePeer } from '../services/webrtc/WebRtcEngine';

interface PerformanceDrawerProps {
  logs: PerformanceLogEntry[];
  peers: RemotePeer[];
  onClearLogs: () => void;
  myNickname: string;
}

export const PerformanceDrawer: React.FC<PerformanceDrawerProps> = ({
  logs,
  peers,
  onClearLogs,
  myNickname,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterUser, setFilterUser] = useState<string>('all');

  // Determina status de saúde geral
  const hasErrors = logs.some((l) => l.type === 'error');
  const hasWarnings = logs.some((l) => l.type === 'warning');
  const recentIssuesCount = logs.filter((l) => Date.now() - l.timestamp < 30000).length;

  const filteredLogs = filterUser === 'all'
    ? logs
    : logs.filter((l) => l.userName.toLowerCase() === filterUser.toLowerCase());

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
        title="Monitor Discreto de Desempenho e Telemetria WebRTC"
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
        <span className="font-semibold">Diagnóstico P2P</span>
        {logs.length > 0 && (
          <span className="px-1.5 py-0.2 bg-black/40 rounded text-[10px]">
            {logs.length}
          </span>
        )}
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {/* Painel Expansível de Diagnóstico */}
      {isOpen && (
        <div className="absolute bottom-10 right-0 w-80 sm:w-96 max-h-[28rem] bg-neutral-950/95 border border-neutral-800 rounded-xl shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-200">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>Painel de Desempenho & Rede</span>
            </div>
            <div className="flex items-center gap-2">
              {logs.length > 0 && (
                <button
                  onClick={onClearLogs}
                  className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-red-400 rounded transition-colors cursor-pointer"
                  title="Limpar histórico de diagnósticos"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Status dos Participantes Conectados */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold">
              Participantes ({peers.length + 1})
            </span>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {/* Você */}
              <div className="flex items-center justify-between bg-neutral-900/60 border border-neutral-800/80 rounded px-2.5 py-1 text-[11px]">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <User className="w-3 h-3 text-cyan-400" />
                  {myNickname} (Você)
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.2 rounded">
                  Local
                </span>
              </div>

              {/* Peers */}
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

          {/* Histórico Discreto de Eventos e Problemas */}
          <div className="flex-1 flex flex-col space-y-1.5 min-h-[120px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-neutral-500 tracking-wider font-semibold">
                Registro de Alertas
              </span>
              {peers.length > 1 && (
                <select
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 text-[10px] text-neutral-300 rounded px-1.5 py-0.5 outline-none cursor-pointer"
                >
                  <option value="all">Todos os Usuários</option>
                  {peers.map((p) => (
                    <option key={p.id} value={p.nickname}>
                      {p.nickname}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1 max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {filteredLogs.length === 0 ? (
                <div className="text-center py-6 text-neutral-500 text-xs">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-500/50" />
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
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                      <span>{log.message}</span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
