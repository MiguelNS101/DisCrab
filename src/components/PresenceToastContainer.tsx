import React from 'react';
import { UserPlus, UserMinus, X, Users } from 'lucide-react';

export interface PresenceToastItem {
  id: string;
  type: 'join' | 'leave';
  nickname: string;
  isHost?: boolean;
  participantCount: number;
  createdAt: number;
}

interface PresenceToastContainerProps {
  toasts: PresenceToastItem[];
  onDismiss: (id: string) => void;
}

export function playPresenceSound(type: 'join' | 'leave') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;

    if (type === 'join') {
      // Toque suave ascendente (amigo entrou)
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.14); // E5
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      // Toque suave descendente (amigo saiu)
      osc.frequency.setValueAtTime(493.88, now); // B4
      osc.frequency.exponentialRampToValueAtTime(392.0, now + 0.16); // G4
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // Ignora caso o navegador bloqueie autoplay de áudio
  }
}

export const PresenceToastContainer: React.FC<PresenceToastContainerProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-16 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isJoin = toast.type === 'join';
        const timeStr = new Date(toast.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto relative overflow-hidden rounded-xl border backdrop-blur-md shadow-2xl p-3.5 transition-all duration-300 ${
              isJoin
                ? 'bg-neutral-900/95 border-emerald-500/50 shadow-emerald-950/30'
                : 'bg-neutral-900/95 border-rose-500/50 shadow-rose-950/30'
            }`}
          >
            {/* Barra lateral de destaque */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-1 ${
                isJoin ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />

            <div className="flex items-start justify-between gap-3 pl-1.5">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                    isJoin
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  }`}
                >
                  {isJoin ? (
                    <UserPlus className="w-4 h-4" />
                  ) : (
                    <UserMinus className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 font-mono">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-white truncate max-w-[170px]">
                      {toast.nickname}
                    </span>
                    {toast.isHost && (
                      <span className="px-1.5 py-0.2 text-[9px] font-bold uppercase rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
                        Host
                      </span>
                    )}
                    <span
                      className={`text-[11px] font-semibold ${
                        isJoin ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {isJoin ? 'entrou na sala' : 'saiu da sala'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-400">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300">
                      <Users className="w-3 h-3 text-cyan-400" />
                      <span>
                        Agora na sala: <strong className="text-white">{toast.participantCount}</strong>
                      </span>
                    </span>
                    <span className="text-neutral-500">·</span>
                    <span>{timeStr}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="text-neutral-500 hover:text-white p-1 rounded-lg hover:bg-neutral-800/70 transition-colors cursor-pointer shrink-0"
                title="Fechar notificação"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
