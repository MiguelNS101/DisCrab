import React from 'react';
import {
  Wifi,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Activity,
  User,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { RemotePeer } from '../services/webrtc/WebRtcEngine';

interface PeerHealthInspectorProps {
  peers: RemotePeer[];
  myNickname: string;
  onResetPeer: (peerId: string) => void;
  compact?: boolean;
}

function formatSpeed(kbps: number): string {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }
  return `${Math.round(kbps)} kbps`;
}

export const PeerHealthInspector: React.FC<PeerHealthInspectorProps> = ({
  peers,
  myNickname,
  onResetPeer,
  compact = false,
}) => {
  // Identifica participantes com perda de pacotes ou ping crítico
  const problematicPeers = peers.filter(
    (p) =>
      p.connectionState === 'connected' &&
      p.networkStats &&
      (p.networkStats.packetLossPct >= 4 || p.networkStats.rttMs >= 220)
  );

  return (
    <div className="space-y-3 font-mono text-xs">
      {/* Diagnóstico em Destaque: Aponta claramente quem está com problemas de conexão */}
      {problematicPeers.length > 0 ? (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/60 space-y-2 text-amber-200 animate-in fade-in">
          <div className="flex items-center gap-2 font-bold text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
            <span>Instabilidade Localizada na Sala:</span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            O problema de conexão foi identificado especificamente com{' '}
            <strong className="text-white">
              {problematicPeers.map((p) => p.nickname).join(', ')}
            </strong>
            . A conexão com os demais participantes continua estável.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {problematicPeers.map((p) => (
              <button
                key={`fix-${p.id}`}
                type="button"
                onClick={() => onResetPeer(p.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 hover:border-amber-400 text-amber-200 rounded-lg cursor-pointer transition-colors text-[11px]"
                title={`Resetar conexão P2P apenas com ${p.nickname}`}
              >
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Resetar Túnel P2P de {p.nickname}</span>
              </button>
            ))}
          </div>
        </div>
      ) : peers.length > 0 ? (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-[11px]">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Todos os participantes conectados com rota P2P saudável e sem perda de pacotes.</span>
        </div>
      ) : null}

      {/* Grid de Participantes com Ping, Perda de Pacotes e Taxa de Transferência */}
      <div className={`grid gap-2.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {/* Card do Próprio Usuário (Local) */}
        <div className="p-2.5 rounded-xl bg-neutral-950 border border-cyan-900/40 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span>{myNickname} (Você)</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 text-[10px]">
              Local
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 flex items-center justify-between">
            <span>Ping Local:</span>
            <span className="font-bold text-emerald-400">0 ms (Host Local)</span>
          </div>
        </div>

        {/* Cards dos Participantes Remotos */}
        {peers.map((peer) => {
          const stats = peer.networkStats;
          const isConnected = peer.connectionState === 'connected';
          const rtt = stats?.rttMs ?? 0;
          const loss = stats?.packetLossPct ?? 0;
          const hasHighLoss = isConnected && loss >= 4;
          const hasHighPing = isConnected && rtt >= 160;

          // Cores dinâmicas para o Ping
          let pingColor = 'text-emerald-400';
          if (rtt >= 220) pingColor = 'text-red-400';
          else if (rtt >= 130) pingColor = 'text-amber-400';
          else if (rtt >= 80) pingColor = 'text-yellow-300';

          // Cores dinâmicas para Perda de Pacotes
          let lossColor = 'text-neutral-400';
          let lossBg = 'bg-neutral-900 border-neutral-800';
          if (loss >= 7) {
            lossColor = 'text-red-300 font-bold';
            lossBg = 'bg-red-950/80 border-red-500/80 animate-pulse';
          } else if (loss >= 3) {
            lossColor = 'text-amber-300 font-bold';
            lossBg = 'bg-amber-950/60 border-amber-500/60';
          } else if (loss > 0) {
            lossColor = 'text-neutral-300';
            lossBg = 'bg-neutral-900 border-neutral-700';
          }

          return (
            <div
              key={peer.id}
              className={`p-2.5 rounded-xl border transition-all ${
                hasHighLoss
                  ? 'bg-red-950/20 border-red-600/70 shadow-sm shadow-red-950'
                  : hasHighPing
                  ? 'bg-amber-950/20 border-amber-600/50'
                  : 'bg-neutral-950/90 border-neutral-800'
              }`}
            >
              {/* Cabeçalho do Card */}
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-neutral-800/80">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      !isConnected
                        ? 'bg-neutral-600'
                        : hasHighLoss
                        ? 'bg-red-500 animate-ping'
                        : hasHighPing
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span className="font-bold text-white truncate">{peer.nickname}</span>
                  {peer.isHost && (
                    <span className="px-1 py-0.2 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 text-[9px]">
                      HOST
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onResetPeer(peer.id)}
                  className="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-cyan-500 text-neutral-300 hover:text-white text-[10px] cursor-pointer transition-colors inline-flex items-center gap-1 shrink-0"
                  title={`Forçar reset de túnel P2P com ${peer.nickname}`}
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Resetar P2P</span>
                </button>
              </div>

              {/* Métricas: Ping & Perda de Pacotes */}
              <div className="grid grid-cols-2 gap-2 pt-2 text-[11px]">
                {/* Ping RTT */}
                <div className="p-1.5 rounded-lg bg-neutral-900/80 border border-neutral-800 flex items-center justify-between">
                  <span className="text-neutral-400 flex items-center gap-1">
                    <Wifi className="w-3 h-3 text-cyan-400" />
                    Ping:
                  </span>
                  <span className={`font-bold ${isConnected ? pingColor : 'text-neutral-500'}`}>
                    {isConnected && stats ? `${rtt} ms` : 'Conectando'}
                  </span>
                </div>

                {/* Perda de Pacotes */}
                <div
                  className={`p-1.5 rounded-lg border flex items-center justify-between ${lossBg}`}
                >
                  <span className="text-neutral-400 flex items-center gap-1">
                    <Activity className="w-3 h-3 text-purple-400" />
                    Perda:
                  </span>
                  <span className={lossColor}>
                    {isConnected && stats ? `${loss}%` : '--'}
                  </span>
                </div>
              </div>

              {/* Taxas de Download e Upload deste Peer */}
              {isConnected && stats && (stats.inboundKbps > 0 || stats.outboundKbps > 0) && (
                <div className="pt-2 flex items-center justify-between text-[10px] text-neutral-400">
                  <span className="flex items-center gap-1">
                    <ArrowDown className="w-3 h-3 text-cyan-400" />
                    Download: <strong className="text-neutral-200">{formatSpeed(stats.inboundKbps)}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowUp className="w-3 h-3 text-indigo-400" />
                    Upload: <strong className="text-neutral-200">{formatSpeed(stats.outboundKbps)}</strong>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
