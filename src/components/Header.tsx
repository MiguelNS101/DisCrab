import React, { useState, useEffect, useCallback } from 'react';
import {
  getProcessMemory,
  checkGithubUpdate,
  getAppSystemInfo,
  isStrictlyNewerVersion,
  FIXED_GITHUB_REPO,
  UpdateCheckResult,
} from '../services/tauriBridge';
import { AppUpdaterModal } from './AppUpdaterModal';
import { WindowTitleBar } from './WindowTitleBar';

// Garante que a verificação automática de atualização ocorra APENAS UMA VEZ ao abrir o app pela primeira vez
let startupUpdateChecked = false;
let startupUpdatePromise: Promise<UpdateCheckResult | null> | null = null;
let startupCachedResult: UpdateCheckResult | null = null;
let startupUpdateError: string | null = null;

export function getStartupUpdateState(): {
  checked: boolean;
  result: UpdateCheckResult | null;
  error: string | null;
  promise: Promise<UpdateCheckResult | null> | null;
} {
  return {
    checked: startupUpdateChecked,
    result: startupCachedResult,
    error: startupUpdateError,
    promise: startupUpdatePromise,
  };
}

interface HeaderProps {
  onOpenCodeViewer?: () => void;
  activePid?: number | null;
  activeProcessName?: string;
  isInRoom?: boolean;
  hideTitleBar?: boolean;
  externalUpdaterOpen?: boolean;
  onExternalUpdaterClose?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCodeViewer,
  activePid,
  activeProcessName,
  isInRoom = false,
  hideTitleBar = false,
  externalUpdaterOpen,
  onExternalUpdaterClose,
}) => {
  const [memoryMb, setMemoryMb] = useState<number>(38.4);
  const [internalUpdaterOpen, setInternalUpdaterOpen] = useState<boolean>(false);
  const [currentVersion, setCurrentVersion] = useState<string>('1.1.6');
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(() =>
    Boolean(
      startupCachedResult?.has_update &&
        isStrictlyNewerVersion(
          startupCachedResult.current_version || '1.1.6',
          startupCachedResult.latest_version
        )
    )
  );
  const [latestTag, setLatestTag] = useState<string>(
    startupCachedResult?.latest_version || ''
  );
  const [cachedUpdateResult, setCachedUpdateResult] = useState<UpdateCheckResult | null>(
    startupCachedResult
  );

  const isUpdaterOpen = Boolean(internalUpdaterOpen || externalUpdaterOpen);

  const handleCloseUpdater = useCallback(() => {
    setInternalUpdaterOpen(false);
    if (onExternalUpdaterClose) {
      onExternalUpdaterClose();
    }
  }, [onExternalUpdaterClose]);

  const handleUpdateDetected = useCallback(
    (hasUpdate: boolean, tag?: string, result?: UpdateCheckResult) => {
      const effectiveCur = result?.current_version || currentVersion || '1.1.6';
      const effectiveLat = tag || result?.latest_version || '';
      const verifiedNewer = Boolean(
        hasUpdate && effectiveLat && isStrictlyNewerVersion(effectiveCur, effectiveLat)
      );
      setHasUpdateAvailable(verifiedNewer);
      if (tag) setLatestTag(tag);
      if (result) {
        result.has_update = verifiedNewer;
        startupCachedResult = result;
        startupUpdateError = null;
        setCachedUpdateResult(result);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('sc-update-status', {
            detail: { hasUpdate: verifiedNewer, latestTag: effectiveLat },
          })
        );
      }
    },
    [currentVersion]
  );

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
    const interval = setInterval(fetchMemory, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Carrega a versão atual e verifica automaticamente APENAS NA PRIMEIRA VEZ que o app é aberto
  useEffect(() => {
    let mounted = true;
    try {
      localStorage.removeItem('sc_github_repo');
    } catch {}

    getAppSystemInfo()
      .then((info) => {
        if (mounted && info.current_version) {
          setCurrentVersion(info.current_version);
        }
      })
      .catch(() => {});

    if (!startupUpdateChecked && !startupUpdatePromise) {
      startupUpdateChecked = true;
      startupUpdatePromise = checkGithubUpdate(FIXED_GITHUB_REPO)
        .then((res) => {
          const verifiedNewer = Boolean(
            res.has_update &&
              isStrictlyNewerVersion(res.current_version || '1.1.6', res.latest_version)
          );
          res.has_update = verifiedNewer;
          startupCachedResult = res;
          startupUpdateError = null;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('sc-update-status', {
                detail: {
                  hasUpdate: verifiedNewer,
                  latestTag: res.latest_version || '',
                },
              })
            );
          }
          if (mounted) {
            setCachedUpdateResult(res);
            setHasUpdateAvailable(verifiedNewer);
            if (res.latest_version) {
              setLatestTag(res.latest_version);
            }
            // No Android, quando há atualização de APK disponível na primeira entrada, abre o modal automaticamente
            if (
              verifiedNewer &&
              typeof navigator !== 'undefined' &&
              /android/i.test(navigator.userAgent || '') &&
              (res.apk_download_url || res.download_url)
            ) {
              setInternalUpdaterOpen(true);
            }
          }
          return res;
        })
        .catch((err: any) => {
          startupUpdateError = err?.message || String(err);
          return null;
        })
        .finally(() => {
          startupUpdatePromise = null;
        });
    } else if (startupCachedResult && mounted) {
      const verifiedNewer = Boolean(
        startupCachedResult.has_update &&
          isStrictlyNewerVersion(
            startupCachedResult.current_version || '1.1.6',
            startupCachedResult.latest_version
          )
      );
      startupCachedResult.has_update = verifiedNewer;
      setCachedUpdateResult(startupCachedResult);
      setHasUpdateAvailable(verifiedNewer);
      if (startupCachedResult.latest_version) {
        setLatestTag(startupCachedResult.latest_version);
      }
    }

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      {!hideTitleBar && (
        <WindowTitleBar
          currentVersion={currentVersion}
          isInRoom={isInRoom}
          activeProcessName={activeProcessName}
          activePid={activePid}
          memoryMb={memoryMb}
          hasUpdateAvailable={hasUpdateAvailable}
          latestTag={latestTag}
          onOpenUpdater={() => setInternalUpdaterOpen(true)}
          onOpenCodeViewer={onOpenCodeViewer}
        />
      )}

      <AppUpdaterModal
        isOpen={isUpdaterOpen}
        onClose={handleCloseUpdater}
        initialUpdateResult={cachedUpdateResult}
        onUpdateDetected={handleUpdateDetected}
      />
    </>
  );
};
