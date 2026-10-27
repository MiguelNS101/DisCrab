import React, { useState, useEffect } from 'react';
import {
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Cloud,
  FolderCheck,
  Sparkles,
  X,
  HardDriveDownload,
  ArrowUpCircle,
} from 'lucide-react';
import {
  isTauriEnvironment,
  getAppSystemInfo,
  ensureCloudflaredBinary,
  checkGithubUpdate,
  installGithubUpdate,
  AppSystemInfo,
  UpdateCheckResult,
  UpdateProgressPayload,
} from '../services/tauriBridge';

interface AppUpdaterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateDetected?: (hasUpdate: boolean, latestVersion?: string) => void;
}

const DEFAULT_GITHUB_REPO = 'NTDarkzZ/StreamCompanion';

export const AppUpdaterModal: React.FC<AppUpdaterModalProps> = ({
  isOpen,
  onClose,
  onUpdateDetected,
}) => {
  const isNative = isTauriEnvironment();

  const [githubRepo, setGithubRepo] = useState<string>(() => {
    try {
      return localStorage.getItem('sc_github_repo') || DEFAULT_GITHUB_REPO;
    } catch {
      return DEFAULT_GITHUB_REPO;
    }
  });

  const [systemInfo, setSystemInfo] = useState<AppSystemInfo | null>(null);
  const [isCheckingCloudflared, setIsCheckingCloudflared] = useState(false);
  const [cloudflaredMsg, setCloudflaredMsg] = useState<string | null>(null);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgressPayload | null>(null);
  const [customExeUrl, setCustomExeUrl] = useState<string>('');
  const [showCustomUrl, setShowCustomUrl] = useState<boolean>(false);

  const loadSystemInfo = async () => {
    try {
      const info = await getAppSystemInfo();
      setSystemInfo(info);
    } catch (err) {
      console.warn('[UpdaterModal] Erro ao carregar info do sistema:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSystemInfo();
    }
  }, [isOpen]);

  // Escuta eventos de progresso de download do Rust (update-progress)
  useEffect(() => {
    if (!isNative) return;
    let unlistenFn: (() => void) | null = null;

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        return listen<UpdateProgressPayload>('update-progress', (event) => {
          setProgress(event.payload);
        });
      })
      .then((unlisten) => {
        unlistenFn = unlisten;
      })
      .catch(() => {});

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [isNative]);

  const handleSaveRepo = (val: string) => {
    setGithubRepo(val);
    try {
      localStorage.setItem('sc_github_repo', val.trim());
    } catch {}
  };

  const handleEnsureCloudflared = async () => {
    setIsCheckingCloudflared(true);
    setCloudflaredMsg(null);
    try {
      const status = await ensureCloudflaredBinary();
      setSystemInfo((prev) =>
        prev ? { ...prev, cloudflared: status } : prev
      );
      setCloudflaredMsg(
        `Pronto! cloudflared.exe (${status.size_mb} MB) instalado em ${status.path}`
      );
    } catch (err: any) {
      setCloudflaredMsg(`Erro: ${err?.message || err}`);
    } finally {
      setIsCheckingCloudflared(false);
    }
  };

  const handleCheckUpdate = async () => {
    if (!githubRepo.trim()) return;
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await checkGithubUpdate(githubRepo.trim());
      setUpdateResult(res);
      onUpdateDetected?.(res.has_update, res.latest_version);
    } catch (err: any) {
      setUpdateError(err?.message || String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async (targetUrl?: string | null) => {
    const urlToDownload = (targetUrl || customExeUrl).trim();
    if (!urlToDownload) {
      setUpdateError(
        'Nenhum arquivo .exe encontrado nesta Release do GitHub. Certifique-se de anexar o StreamCompanion.exe nos Assets da Release.'
      );
      return;
    }

    setIsInstalling(true);
    setUpdateError(null);
    setProgress({
      stage: 'starting',
      downloaded_mb: 0,
      total_mb: updateResult?.asset_size_mb || 0,
      percent: 1,
      message: 'Iniciando download do novo executável...',
    });

    try {
      await installGithubUpdate(urlToDownload);
    } catch (err: any) {
      setIsInstalling(false);
      setProgress(null);
      setUpdateError(err?.message || String(err));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-neutral-900 border border-cyan-500/40 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden font-mono text-neutral-100">
        {/* Cabeçalho */}
        <div className="px-5 py-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Atualizador Embutido & Gerenciador Cloudflared
              </h2>
              <p className="text-[11px] text-neutral-400">
                Atualize o app com 1 clique pelo GitHub e gerencie o cloudflared fora da pasta portable
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isInstalling}
            className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* SEÇÃO 1: CLOUDFLARED AUTOMÁTICO EM %LOCALAPPDATA% */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  1. Túnel Cloudflare Automático (Sem .exe na pasta Portable)
                </h3>
              </div>

              {systemInfo?.cloudflared.installed ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-700 text-emerald-300 font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  Instalado ({systemInfo.cloudflared.size_mb} MB)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-950/90 border border-amber-700 text-amber-300">
                  Será baixado automaticamente ao criar sala
                </span>
              )}
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Você <strong className="text-white">não precisa mais manter o cloudflared.exe na pasta do app</strong>. O StreamCompanion salva e executa o <code className="text-cyan-300">cloudflared.exe</code> automaticamente na pasta oculta do sistema (<code className="text-neutral-300">%LOCALAPPDATA%\StreamCompanion\bin</code>).
            </p>

            <div className="flex items-center justify-between gap-2 bg-neutral-900/90 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <FolderCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-neutral-300 truncate" title={systemInfo?.cloudflared.path}>
                  {systemInfo?.cloudflared.path || '%LOCALAPPDATA%\\StreamCompanion\\bin\\cloudflared.exe'}
                </span>
              </div>

              {isNative && (
                <button
                  type="button"
                  disabled={isCheckingCloudflared}
                  onClick={handleEnsureCloudflared}
                  className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-black font-bold text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                >
                  <HardDriveDownload className={`w-3.5 h-3.5 ${isCheckingCloudflared ? 'animate-bounce' : ''}`} />
                  <span>
                    {isCheckingCloudflared
                      ? 'Baixando para AppData...'
                      : systemInfo?.cloudflared.installed
                      ? 'Verificar / Reparar'
                      : 'Baixar p/ AppData Agora'}
                  </span>
                </button>
              )}
            </div>

            {cloudflaredMsg && (
              <p className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-3 py-1.5">
                {cloudflaredMsg}
              </p>
            )}
          </div>

          {/* SEÇÃO 2: ATUALIZADOR EMBUTIDO VIA GITHUB RELEASES */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                  2. Atualizador Embutido (GitHub Releases 1-Clique)
                </h3>
              </div>

              <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-neutral-300">
                Versão Atual: <strong className="text-white">v{systemInfo?.current_version || '1.0.0'}</strong>
              </span>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Informe o seu repositório do GitHub (<code className="text-cyan-300">usuario/repositorio</code>). Quando você publicar uma nova Release com o <code className="text-white">StreamCompanion.exe</code> anexado, basta clicar em <strong className="text-white">Atualizar Agora</strong> que o app baixa, substitui o próprio <code className="text-white">.exe</code> e reinicia sozinho!
            </p>

            {/* Input do Repositório GitHub + Botão Buscar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={githubRepo}
                onChange={(e) => handleSaveRepo(e.target.value)}
                placeholder="Ex: NTDarkzZ/StreamCompanion"
                disabled={isInstalling}
                className="flex-1 bg-neutral-900 border border-neutral-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
              />
              <button
                type="button"
                disabled={isCheckingUpdate || isInstalling || !githubRepo.trim()}
                onClick={handleCheckUpdate}
                className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                <span>{isCheckingUpdate ? 'Consultando GitHub...' : 'Verificar Atualizações'}</span>
              </button>
            </div>

            {/* Erro ao consultar ou instalar */}
            {updateError && (
              <div className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{updateError}</span>
              </div>
            )}

            {/* Resultado da Consulta ao GitHub */}
            {updateResult && (
              <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">
                        {updateResult.release_title}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold">
                        {updateResult.latest_version}
                      </span>
                    </div>
                    {updateResult.asset_name && (
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        Executável na Release: <strong className="text-neutral-200">{updateResult.asset_name}</strong> ({updateResult.asset_size_mb} MB)
                      </p>
                    )}
                  </div>

                  {updateResult.has_update ? (
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500 text-emerald-300 font-bold animate-pulse">
                      Nova Atualização Disponível!
                    </span>
                  ) : (
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300">
                      Você já está na versão mais recente
                    </span>
                  )}
                </div>

                {updateResult.release_notes && (
                  <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {updateResult.release_notes}
                  </div>
                )}

                {updateResult.download_url ? (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isInstalling}
                      onClick={() => handleInstallUpdate(updateResult.download_url)}
                      className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 cursor-pointer transition-all ${
                        updateResult.has_update
                          ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black shadow-lg'
                          : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
                      }`}
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {updateResult.has_update
                          ? `Baixar ${updateResult.latest_version}, Substituir .EXE e Reiniciar`
                          : 'Reinstalar / Forçar Atualização desta Release'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-300">
                    Aviso: Esta Release não possui um arquivo <code>.exe</code> anexado nos Assets.
                  </p>
                )}
              </div>
            )}

            {/* Barra de Progresso em Tempo Real durante Download e Auto-Swap */}
            {isInstalling && progress && (
              <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-cyan-200 font-bold flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    {progress.message}
                  </span>
                  <span className="text-cyan-300 font-bold">{progress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-cyan-900">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-200"
                    style={{ width: `${Math.max(4, progress.percent)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Opção Avançada: Atualizar via Link Direto de .exe */}
            <div className="pt-1 border-t border-neutral-900">
              <button
                type="button"
                onClick={() => setShowCustomUrl(!showCustomUrl)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 underline cursor-pointer"
              >
                {showCustomUrl
                  ? 'Ocultar atualização por URL direta'
                  : 'Ou colar link direto de um arquivo .exe para atualizar'}
              </button>

              {showCustomUrl && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customExeUrl}
                    onChange={(e) => setCustomExeUrl(e.target.value)}
                    placeholder="https://github.com/.../releases/download/v1.1.0/StreamCompanion.exe"
                    disabled={isInstalling}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                  />
                  <button
                    type="button"
                    disabled={isInstalling || !customExeUrl.trim()}
                    onClick={() => handleInstallUpdate(customExeUrl)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
                  >
                    Baixar e Substituir .EXE
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
