import React, { useState, useEffect } from 'react';
import { Cpu, ShieldCheck, Terminal, ArrowUpCircle, Palette } from 'lucide-react';
import {
  isTauriEnvironment,
  getProcessMemory,
  checkGithubUpdate,
  getAppSystemInfo,
} from '../services/tauriBridge';
import { AppUpdaterModal } from './AppUpdaterModal';
import { AppIcon } from './AppIcon';
import { useTheme } from '../context/ThemeContext';

interface HeaderProps {
  onOpenCodeViewer?: () => void;
  activePid?: number | null;
  activeProcessName?: string;
  isInRoom?: boolean;
  externalUpdaterOpen?: boolean;
  onExternalUpdaterClose?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCodeViewer,
  activePid,
  activeProcessName,
  isInRoom = false,
  externalUpdaterOpen,
  onExternalUpdaterClose,
}) => {
  const isNative = isTauriEnvironment();
  const { setIsCustomizerOpen } = useTheme();
  const [memoryMb, setMemoryMb] = useState<number>(38.4);
  const [internalUpdaterOpen, setInternalUpdaterOpen] = useState<boolean>(false);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const [latestTag, setLatestTag] = useState<string>('');
  const [currentVersion, setCurrentVersion] = useState<string>('1.0.0');

  const isUpdaterOpen = Boolean(internalUpdaterOpen || externalUpdaterOpen);

  const handleCloseUpdater = () => {
    setInternalUpdaterOpen(false);
    if (onExternalUpdaterClose) {
      onExternalUpdaterClose();
    }
  };

  // Monitoramento em tempo real da memória do processo
  useEffect(() => {
    let isMounted = true;
    const fetchMemory = async () => {
      try {
        const mem = await getProcessMemory();
        if (isMounted && mem > 0) {
          setMemoryMb(mem);
        }
      } catch (_) {}
    };

    fetchMemory();
    const interval = setInterval(fetchMemory, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Carrega a versão atual e verifica silenciosamente no GitHub se há atualização disponível
  useEffect(() => {
    let mounted = true;
    getAppSystemInfo()
      .then((info) => {
        if (mounted && info.current_version) {
          setCurrentVersion(info.current_version);
        }
      })
      .catch(() => {});

    try {
      const savedRepo = localStorage.getItem('sc_github_repo');
      if (savedRepo && savedRepo.includes('/')) {
        checkGithubUpdate(savedRepo)
          .then((res) => {
            if (mounted && res.has_update) {
              setHasUpdateAvailable(true);
              setLatestTag(res.latest_version);
            }
          })
          .catch(() => {});
      }
    } catch {}

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <header className="sc-header border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md sticky top-0 z-40 px-4 py-2.5">
        <div className="sc-container-width max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand + Novo Ícone */}
          <div className="flex items-center gap-3">
            <AppIcon size={38} showLiveDot={true} animated={isInRoom} />

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-wider text-white font-mono uppercase">
                  Stream<span className="text-cyan-400">Companion</span>
                </h1>
                <span className="text-[10px] font-mono tracking-widest px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-cyan-300">
                  v{currentVersion}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 hidden sm:block">
                Streaming P2P de Baixa Latência · Isolamento WASAPI
              </p>
            </div>
          </div>

          {/* Ações Rápidas & Status Discreto */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {/* Mostrar telemetria compacta somente quando estiver dentro da sala */}
            {isInRoom && (
              <>
                <div
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 font-mono text-[11px]"
                  title="Status do isolamento de áudio WASAPI por processo"
                >
                  <ShieldCheck
                    className={`w-3.5 h-3.5 ${
                      activePid !== null && activePid !== undefined
                        ? 'text-emerald-400'
                        : 'text-neutral-500'
                    }`}
                  />
                  <span className="text-neutral-300 truncate max-w-[180px]">
                    {activePid === 0
                      ? 'Áudio PC (Sem Discord)'
                      : activePid !== null && activePid !== undefined
                      ? `${activeProcessName || 'App'} [${activePid}]`
                      : 'WASAPI Pronto'}
                  </span>
                </div>

                <div
                  className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 font-mono text-[11px]"
                  title={isNative ? 'Motor Nativo Rust + Tauri v2' : 'Motor Web Chromium'}
                >
                  <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-neutral-300">{memoryMb.toFixed(0)} MB</span>
                </div>
              </>
            )}

            {/* Botão Estúdio de Tema & CSS Personalizado */}
            <button
              type="button"
              onClick={() => setIsCustomizerOpen(true)}
              className="sc-btn sc-btn-sized flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 font-mono text-xs transition-all cursor-pointer"
              title="Personalizar Cores, Botões, Tamanhos e CSS da Interface"
            >
              <Palette className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tema & CSS</span>
            </button>

            {/* Botão do Atualizador Embutido & Cloudflared */}
            <button
              type="button"
              onClick={() => setInternalUpdaterOpen(true)}
              className={`sc-btn sc-btn-sized flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs transition-all cursor-pointer ${
                hasUpdateAvailable
                  ? 'bg-emerald-950/80 hover:bg-emerald-900/80 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-950/50 animate-pulse'
                  : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-cyan-300'
              }`}
              title="Verificar atualizações do aplicativo e gerenciar o Cloudflared"
            >
              <ArrowUpCircle
                className={`w-3.5 h-3.5 ${
                  hasUpdateAvailable ? 'text-emerald-400' : 'text-cyan-400'
                }`}
              />
              <span className="font-semibold">
                {hasUpdateAvailable ? `Atualizar (${latestTag})` : 'Atualizar App'}
              </span>
            </button>

            {onOpenCodeViewer && (
              <button
                onClick={onOpenCodeViewer}
                className="hidden items-center gap-2 px-3 py-1.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono transition-all text-xs cursor-pointer"
                title="Ver arquivos do Backend Rust"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Código</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <AppUpdaterModal
        isOpen={isUpdaterOpen}
        onClose={handleCloseUpdater}
        onUpdateDetected={(hasUpdate, tag) => {
          setHasUpdateAvailable(hasUpdate);
          if (tag) setLatestTag(tag);
        }}
      />
    </>
  );
};
