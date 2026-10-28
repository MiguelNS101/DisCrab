import React, { useState, useEffect, useCallback } from 'react';
import {
  Minus,
  Square,
  Copy,
  X,
  Pin,
  Palette,
  ArrowUpCircle,
  ShieldCheck,
  Cpu,
  Terminal,
} from 'lucide-react';
import {
  isAndroidEnvironment,
  isTauriEnvironment,
  minimizeAppWindow,
  toggleMaximizeAppWindow,
  isAppWindowMaximized,
  startDraggingAppWindow,
  setAppWindowAlwaysOnTop,
  closeCurrentAppWindow,
} from '../services/tauriBridge';
import { useTheme, THEME_PRESETS } from '../context/ThemeContext';
import { AppIcon } from './AppIcon';

interface WindowTitleBarProps {
  currentVersion?: string;
  isInRoom?: boolean;
  activeProcessName?: string;
  activePid?: number | null;
  memoryMb?: number;
  hasUpdateAvailable?: boolean;
  latestTag?: string;
  onOpenUpdater?: () => void;
  onOpenCodeViewer?: () => void;
  windowTitleOverride?: string;
  isPopupWindow?: boolean;
  onCustomClose?: () => void;
}

export const WindowTitleBar: React.FC<WindowTitleBarProps> = ({
  currentVersion = '1.1.6',
  isInRoom = false,
  activeProcessName,
  activePid,
  memoryMb = 38.4,
  hasUpdateAvailable = false,
  latestTag = '',
  onOpenUpdater,
  onOpenCodeViewer,
  windowTitleOverride,
  isPopupWindow = false,
  onCustomClose,
}) => {
  const isAndroid = isAndroidEnvironment();
  const isNative = isTauriEnvironment();
  const { theme, applyPreset, setIsCustomizerOpen } = useTheme();
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState<boolean>(false);

  const syncMaximizedState = useCallback(async () => {
    const max = await isAppWindowMaximized();
    setIsMaximized(max);
  }, []);

  useEffect(() => {
    if (isAndroid) return;
    syncMaximizedState();

    const handleResize = () => {
      syncMaximizedState();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isAndroid, syncMaximizedState]);

  const activePreset =
    THEME_PRESETS.find((p) => p.id === theme.presetId) || THEME_PRESETS[0];

  const handleCyclePresetRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentIndex = THEME_PRESETS.findIndex((p) => p.id === theme.presetId);
    const nextIndex = (currentIndex + 1) % THEME_PRESETS.length;
    applyPreset(THEME_PRESETS[nextIndex].id);
  };

  const handleDragMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isAndroid || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, [data-no-drag="true"]')) {
      return;
    }
    if (e.detail >= 2) return;
    e.preventDefault();
    startDraggingAppWindow();
  };

  const handleDoubleClickBar = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (isAndroid) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, [data-no-drag="true"]')) {
      return;
    }
    const nextMax = await toggleMaximizeAppWindow();
    setIsMaximized(nextMax);
  };

  const handleToggleMaximize = async () => {
    const nextMax = await toggleMaximizeAppWindow();
    setIsMaximized(nextMax);
  };

  const handleTogglePin = async () => {
    const next = !isAlwaysOnTop;
    const applied = await setAppWindowAlwaysOnTop(next);
    setIsAlwaysOnTop(applied);
  };

  const handleClose = async () => {
    if (onCustomClose) {
      onCustomClose();
      return;
    }
    await closeCurrentAppWindow();
  };

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={handleDoubleClickBar}
      className="sc-titlebar sc-header w-full h-9 select-none shrink-0 sticky top-0 z-50 flex items-center justify-between border-b backdrop-blur-md transition-colors duration-200"
      style={{
        backgroundColor: 'var(--sc-bg-elevated, #09090b)',
        borderColor: 'var(--sc-border-color, #27272a)',
      }}
    >
      {/* Linha luminosa superior com as cores do tema ativo */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none opacity-90"
        style={{
          background:
            'linear-gradient(90deg, var(--sc-accent, #06b6d4) 0%, var(--sc-accent-secondary, #6366f1) 50%, var(--sc-accent, #06b6d4) 100%)',
        }}
      />

      {/* Área Esquerda + Central (100% Arrastável: clicar em qualquer parte fora dos botões move a janela) */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center gap-2.5 pl-3 pr-2 h-full overflow-hidden cursor-default"
      >
        <div className="pointer-events-none flex items-center gap-2 shrink-0">
          <AppIcon size={20} showLiveDot={true} animated={isInRoom} />
          <div className="flex items-center gap-1.5">
            <span className="text-xs sm:text-sm font-black tracking-wider font-mono text-white">
              Dis<span className="text-rose-400">Crab</span>
            </span>
            {windowTitleOverride ? (
              <span className="text-[11px] text-neutral-400 font-mono truncate max-w-[200px] sm:max-w-[320px]">
                · {windowTitleOverride}
              </span>
            ) : (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-mono tracking-wider"
                style={{
                  backgroundColor: 'rgba(var(--sc-accent-rgb, 6, 182, 212), 0.12)',
                  color: 'var(--sc-accent, #06b6d4)',
                  border: '1px solid rgba(var(--sc-accent-rgb, 6, 182, 212), 0.28)',
                }}
              >
                v{currentVersion}
              </span>
            )}
          </div>
        </div>

        {/* Telemetria Compacta na Barra de Moldura (quando em Sala) */}
        {!isPopupWindow && isInRoom && (
          <div className="hidden md:flex items-center gap-1.5 ml-1 pointer-events-none">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px]"
              style={{
                backgroundColor: 'rgba(var(--sc-bg-surface-rgb, 18, 19, 24), 0.9)',
                border: '1px solid var(--sc-border-color, #27272a)',
              }}
            >
              <ShieldCheck
                className={`w-3 h-3 shrink-0 ${
                  activePid !== null && activePid !== undefined
                    ? 'text-emerald-400'
                    : 'text-neutral-500'
                }`}
              />
              <span className="text-neutral-300 truncate max-w-[160px]">
                {activePid === 0
                  ? 'Áudio PC (Sem Discord)'
                  : activePid !== null && activePid !== undefined
                  ? `${activeProcessName || 'App'} [${activePid}]`
                  : 'WASAPI Pronto'}
              </span>
            </div>

            <div
              className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px]"
              style={{
                backgroundColor: 'rgba(var(--sc-bg-surface-rgb, 18, 19, 24), 0.9)',
                border: '1px solid var(--sc-border-color, #27272a)',
              }}
              title={isNative ? 'Motor Nativo Rust + Tauri v2' : 'Motor Web Chromium'}
            >
              <Cpu
                className="w-3 h-3 shrink-0"
                style={{ color: 'var(--sc-accent, #06b6d4)' }}
              />
              <span className="text-neutral-300">{memoryMb.toFixed(0)} MB</span>
            </div>
          </div>
        )}
      </div>

      {/* Lado Direito: Funções do App (Tema & CSS, Atualizador) + Controles de Moldura da Janela */}
      <div data-no-drag="true" className="flex items-center h-full shrink-0 gap-1 pr-0">
        {!isPopupWindow && (
          <div className="flex items-center gap-1.5 pr-1.5">
            {/* Botão Estúdio de Tema & CSS (Clique abre modal, botão direito alterna preset) */}
            <button
              type="button"
              onClick={() => setIsCustomizerOpen(true)}
              onContextMenu={handleCyclePresetRightClick}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono transition-all cursor-pointer hover:brightness-125"
              style={{
                backgroundColor: 'rgba(var(--sc-bg-surface-rgb, 18, 19, 24), 0.95)',
                border: '1px solid var(--sc-border-color, #27272a)',
                color: 'var(--sc-text-primary, #f4f4f5)',
              }}
              title={`Tema atual: ${activePreset.name} — Clique para personalizar Tema & CSS | Botão direito alterna o preset`}
            >
              <Palette
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: 'var(--sc-accent, #06b6d4)' }}
              />
              <span className="hidden sm:inline">Tema & CSS</span>
            </button>

            {/* Botão do Atualizador Embutido & Cloudflared */}
            {onOpenUpdater && (
              <button
                type="button"
                onClick={onOpenUpdater}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[11px] transition-all cursor-pointer ${
                  hasUpdateAvailable
                    ? 'bg-emerald-950/90 hover:bg-emerald-900/90 border-emerald-500 text-emerald-200 shadow-sm shadow-emerald-950/50 animate-pulse'
                    : 'hover:brightness-125'
                }`}
                style={
                  hasUpdateAvailable
                    ? undefined
                    : {
                        backgroundColor: 'rgba(var(--sc-bg-surface-rgb, 18, 19, 24), 0.95)',
                        borderColor: 'var(--sc-border-color, #27272a)',
                        color: 'var(--sc-accent, #06b6d4)',
                      }
                }
                title="Verificar atualizações do aplicativo e gerenciar o Cloudflared"
              >
                <ArrowUpCircle
                  className={`w-3.5 h-3.5 shrink-0 ${
                    hasUpdateAvailable ? 'text-emerald-400' : ''
                  }`}
                  style={
                    hasUpdateAvailable ? undefined : { color: 'var(--sc-accent, #06b6d4)' }
                  }
                />
                <span className="font-semibold hidden sm:inline">
                  {hasUpdateAvailable ? `Atualizar (${latestTag})` : 'Atualizar'}
                </span>
              </button>
            )}

            {onOpenCodeViewer && (
              <button
                type="button"
                onClick={onOpenCodeViewer}
                className="hidden items-center gap-1.5 px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono transition-all text-[11px] cursor-pointer"
                title="Ver arquivos do Backend Rust"
              >
                <Terminal className="w-3 h-3" />
                <span>Código</span>
              </button>
            )}
          </div>
        )}

        {/* Controles Nativos da Janela (Exibidos no Desktop/Web; ocultos em celulares Android) */}
        {!isAndroid && (
          <div className="flex items-center h-full">
            <div
              className="h-4 w-[1px] mx-0.5 opacity-60"
              style={{ backgroundColor: 'var(--sc-border-color, #27272a)' }}
            />

            {/* Botão Fixar Sempre no Topo (Always on Top) */}
            <button
              type="button"
              onClick={handleTogglePin}
              className="sc-win-btn h-full w-9 flex items-center justify-center transition-colors cursor-pointer"
              style={{
                color: isAlwaysOnTop
                  ? 'var(--sc-accent, #06b6d4)'
                  : 'var(--sc-text-muted, #a1a1aa)',
                backgroundColor: isAlwaysOnTop
                  ? 'rgba(var(--sc-accent-rgb, 6, 182, 212), 0.16)'
                  : 'transparent',
                borderRadius: 0,
              }}
              title={
                isAlwaysOnTop
                  ? 'Janela fixada Sempre no Topo (clique para desafixar)'
                  : 'Fixar janela Sempre no Topo sobre outros aplicativos'
              }
            >
              <Pin
                className={`w-3.5 h-3.5 ${isAlwaysOnTop ? 'rotate-45' : ''} transition-transform`}
              />
            </button>

            {/* Minimizar */}
            <button
              type="button"
              onClick={minimizeAppWindow}
              className="sc-win-btn h-full w-10 flex items-center justify-center transition-colors cursor-pointer"
              style={{
                color: 'var(--sc-text-muted, #a1a1aa)',
                borderRadius: 0,
              }}
              title="Minimizar janela"
              aria-label="Minimizar janela"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            {/* Maximizar / Restaurar */}
            <button
              type="button"
              onClick={handleToggleMaximize}
              className="sc-win-btn h-full w-10 flex items-center justify-center transition-colors cursor-pointer"
              style={{
                color: 'var(--sc-text-muted, #a1a1aa)',
                borderRadius: 0,
              }}
              title={isMaximized ? 'Restaurar tamanho' : 'Maximizar janela'}
              aria-label={isMaximized ? 'Restaurar tamanho' : 'Maximizar janela'}
            >
              {isMaximized ? (
                <Copy className="w-3 h-3 rotate-180" />
              ) : (
                <Square className="w-3 h-3" />
              )}
            </button>

            {/* Fechar */}
            <button
              type="button"
              onClick={handleClose}
              className="sc-win-btn-close h-full w-11 flex items-center justify-center transition-all cursor-pointer text-neutral-400 hover:bg-rose-600 hover:text-white"
              style={{ borderRadius: 0 }}
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
