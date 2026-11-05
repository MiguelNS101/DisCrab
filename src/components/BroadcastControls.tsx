import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Video,
  Flame,
  ChevronDown,
  ChevronUp,
  PowerOff,
  AppWindow,
  ShieldCheck,
  Glasses,
  Eye,
  Sparkles,
  ExternalLink,
  Tv,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { WindowItem, AudioSourceMode, LocalMediaSource } from '../types';
import {
  isAndroidEnvironment,
  isTauriEnvironment,
  getAntiBlackScreenPreference,
  setNativeAntiBlackScreen,
  launchStreamingBrowser,
} from '../services/tauriBridge';
import {
  isMetaQuestDevice,
  detectQuestOrVrEnvironment,
  getDeviceBroadcastCapabilities,
  getManualQuestMode,
  setManualQuestMode,
} from '../services/webrtc/AndroidScreenCaptureBridge';

interface BroadcastControlsProps {
  isScreenSharing: boolean;
  isWebcamActive: boolean;
  localMediaSources?: LocalMediaSource[];
  showSourceManager?: boolean;
  onToggleSourceManager?: () => void;
  showWindowSelector?: boolean;
  onToggleWindowSelector?: () => void;
  onStopAllSources?: () => void;
  selectedWindow: WindowItem | null;
  isolateAudio: boolean;
  audioSourceMode: AudioSourceMode;
  onChangeAudioSourceMode: (mode: AudioSourceMode) => void;
  fps: 30 | 60;
  resolution: '720p' | '1080p' | '1440p';
  onToggleScreenShare: () => void;
  onStartQuestPov?: (mode: 'vr_screen' | 'passthrough_camera') => void;
  onToggleWebcam: (facingMode?: 'user' | 'environment') => void;
  cameraFacingMode?: 'user' | 'environment';
  onSwitchCameraFacingMode?: (mode?: 'user' | 'environment') => void;
  onToggleIsolateAudio: (val: boolean) => void;
  onChangeFps: (val: 30 | 60) => void;
  onChangeResolution: (res: '720p' | '1080p' | '1440p') => void;
  activeAudioLabel?: string;
}

export const BroadcastControls: React.FC<BroadcastControlsProps> = ({
  isScreenSharing,
  isWebcamActive,
  localMediaSources = [],
  showSourceManager = false,
  onToggleSourceManager,
  showWindowSelector = false,
  onToggleWindowSelector,
  onStopAllSources,
  selectedWindow,
  fps,
  resolution,
  onToggleScreenShare,
  onStartQuestPov,
  onToggleWebcam,
  cameraFacingMode = 'user',
  onSwitchCameraFacingMode,
  onChangeFps,
  onChangeResolution,
}) => {
  const activeCount = localMediaSources.length;
  const isAndroid = isAndroidEnvironment();
  const isTauriDesktop = isTauriEnvironment() && !isAndroid;
  const [isQuestOrVr, setIsQuestOrVr] = useState<boolean>(
    () => isMetaQuestDevice() || getManualQuestMode()
  );
  const [showQuestMenu, setShowQuestMenu] = useState<boolean>(() => isMetaQuestDevice());
  const [antiBlackScreen, setAntiBlackScreen] = useState<boolean>(() =>
    getAntiBlackScreenPreference()
  );
  const [showAntiBlackMenu, setShowAntiBlackMenu] = useState<boolean>(false);
  const [browserLaunchStatus, setBrowserLaunchStatus] = useState<string | null>(null);

  // Escuta detecção inicial e eventos de prontidão da ponte Android nativa (APK do Quest 3)
  useEffect(() => {
    let mounted = true;

    const checkQuest = () => {
      if (!mounted) return;
      if (isMetaQuestDevice() || getManualQuestMode()) {
        setIsQuestOrVr(true);
      }
    };

    checkQuest();
    detectQuestOrVrEnvironment().then((detected) => {
      if (mounted && detected) {
        setIsQuestOrVr(true);
      }
    });

    // Polling rápido nos primeiros 4 segundos para capturar a injeção da MainActivity Kotlin
    const interval = setInterval(checkQuest, 250);
    const stopTimer = setTimeout(() => clearInterval(interval), 4000);

    const onBridgeReady = (e: any) => {
      if (mounted) {
        const isQuest = e?.detail?.isQuest || isMetaQuestDevice();
        if (isQuest) {
          setIsQuestOrVr(true);
          setShowQuestMenu(true);
        }
      }
    };

    const onQuestModeChange = (e: any) => {
      if (mounted) {
        setIsQuestOrVr(Boolean(e?.detail?.enabled));
      }
    };

    window.addEventListener('discrab-android-bridge-ready', onBridgeReady);
    window.addEventListener('discrab-quest-mode-change', onQuestModeChange);

    return () => {
      mounted = false;
      clearInterval(interval);
      clearTimeout(stopTimer);
      window.removeEventListener('discrab-android-bridge-ready', onBridgeReady);
      window.removeEventListener('discrab-quest-mode-change', onQuestModeChange);
    };
  }, []);

  const capabilities = getDeviceBroadcastCapabilities(isAndroid, isTauriDesktop);
  const effectiveIsQuestOrVr = isQuestOrVr || capabilities.isQuestOrVr;
  const isPlainAndroid = isAndroid && !effectiveIsQuestOrVr;

  // Quando não está transmitindo, desabilita o botão "Tela" comum se for Quest/VR (que usa o Quest 3 POV) ou se o dispositivo não suportar captura de tela
  const isScreenBtnDisabled = !isScreenSharing && !capabilities.canShareScreen && !isAndroid;
  const isAudioWindowBtnDisabled = !capabilities.canUseWindowAudioSelector;
  const isCameraBtnDisabled = !capabilities.canUseStandardCamera;
  const isAntiBlackBtnDisabled = !capabilities.canUseAntiBlackScreen;

  const handleToggleQuestModeManual = () => {
    const next = !effectiveIsQuestOrVr;
    setManualQuestMode(next);
    setIsQuestOrVr(next);
    if (next) setShowQuestMenu(true);
  };

  const handleToggleAntiBlackScreen = async () => {
    if (isAntiBlackBtnDisabled) return;
    const nextVal = !antiBlackScreen;
    setAntiBlackScreen(nextVal);
    if (isScreenSharing) {
      await setNativeAntiBlackScreen(nextVal, selectedWindow?.hwnd || 0);
    } else {
      try {
        localStorage.setItem('sc_anti_black_screen', String(nextVal));
      } catch {}
    }
  };

  const handleLaunchStreamingSite = async (url: string, label: string) => {
    try {
      setBrowserLaunchStatus(`Abrindo ${label} sem overlay de tela preta...`);
      if (!antiBlackScreen) {
        setAntiBlackScreen(true);
        await setNativeAntiBlackScreen(true, selectedWindow?.hwnd || 0);
      }
      const browserName = await launchStreamingBrowser(url);
      setBrowserLaunchStatus(
        `${label} aberto no ${browserName} (Modo Captura Direta Ativo)! Agora clique em "Tela" e selecione a janela ou tela.`
      );
      setTimeout(() => {
        setBrowserLaunchStatus(null);
      }, 6000);
    } catch (err: any) {
      setBrowserLaunchStatus(err?.message || 'Erro ao abrir navegador de streaming.');
      setTimeout(() => {
        setBrowserLaunchStatus(null);
      }, 5000);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Controles Compactos de Captura: No Android comum (não-Quest), exibe apenas Compartilhar Tela e Câmera */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 1. Transmitir Tela */}
          <button
            type="button"
            disabled={isScreenBtnDisabled}
            onClick={() => {
              if (!isScreenBtnDisabled) onToggleScreenShare();
            }}
            className={`sc-btn sc-btn-sized h-8 flex items-center gap-1.5 px-3 rounded-lg font-mono font-bold text-xs whitespace-nowrap transition-all ${
              isScreenBtnDisabled
                ? 'bg-neutral-900 border border-neutral-800 text-neutral-600 opacity-45 cursor-not-allowed'
                : isScreenSharing
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-950/60 cursor-pointer'
                : 'sc-btn-primary bg-cyan-500 hover:bg-cyan-400 text-black cursor-pointer'
            }`}
            title={
              isScreenSharing
                ? 'Parar transmissão ativa'
                : effectiveIsQuestOrVr
                ? 'No Meta Quest / VR, use o botão "Quest 3 POV" ao lado para transmitir sua visão VR ou Passthrough'
                : isScreenBtnDisabled
                ? 'Captura de tela não compatível neste navegador (use o APK Android ou aplicativo Desktop)'
                : isAndroid
                ? 'Gravar e transmitir a tela do celular com áudio diretamente'
                : 'Iniciar transmissão de tela'
            }
          >
            {isScreenSharing ? (
              <>
                <Flame className="w-3.5 h-3.5 text-white animate-pulse shrink-0" />
                <span>Parar Tela</span>
              </>
            ) : (
              <>
                <Monitor className="w-3.5 h-3.5 shrink-0" />
                <span>{isAndroid ? 'Compartilhar Tela' : 'Tela'}</span>
              </>
            )}
          </button>

          {/* 2. Seletor de Janela WASAPI (Oculto no Android comum; disponível no Desktop) */}
          {!isPlainAndroid && onToggleWindowSelector && (
            <button
              type="button"
              disabled={isAudioWindowBtnDisabled}
              onClick={() => {
                if (!isAudioWindowBtnDisabled) onToggleWindowSelector();
              }}
              className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all border ${
                isAudioWindowBtnDisabled
                  ? 'bg-neutral-950 border-neutral-900 text-neutral-600 opacity-45 cursor-not-allowed'
                  : showWindowSelector
                  ? 'bg-neutral-800 border-cyan-500 text-white font-bold cursor-pointer'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 cursor-pointer'
              }`}
              title={
                isAudioWindowBtnDisabled
                  ? 'Separação de áudio por janela (WASAPI) disponível apenas no aplicativo Desktop Windows'
                  : 'Selecionar janela e roteamento de áudio WASAPI'
              }
            >
              <AppWindow
                className={`w-3.5 h-3.5 shrink-0 ${
                  isAudioWindowBtnDisabled ? 'text-neutral-600' : 'text-cyan-400'
                }`}
              />
              <span className="truncate max-w-[95px]">
                {selectedWindow ? selectedWindow.process_name.replace(/\.exe$/i, '') : 'Áudio'}
              </span>
              {showWindowSelector && !isAudioWindowBtnDisabled ? (
                <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
              )}
            </button>
          )}

          {/* 3. Botão Dedicado Meta Quest 3 / VR — Abre apenas no Quest ou VR */}
          {effectiveIsQuestOrVr && onStartQuestPov && (
            <button
              type="button"
              onClick={() => setShowQuestMenu((prev) => !prev)}
              className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all cursor-pointer border ${
                showQuestMenu
                  ? 'bg-purple-950/80 border-purple-500/70 text-purple-200 font-bold'
                  : 'bg-neutral-950 border-purple-500/50 text-purple-200 hover:text-white hover:border-purple-400'
              }`}
              title="Meta Quest 3 / VR: Transmitir a visão em 1ª pessoa (Jogos VR com Áudio ou Câmera Passthrough do Mundo Real)"
            >
              <Glasses className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span>Quest 3 POV</span>
              {showQuestMenu ? (
                <ChevronUp className="w-3 h-3 text-purple-300 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-purple-300 shrink-0" />
              )}
            </button>
          )}

          {/* 4. Botão Compacto: Câmera (No Android comum liga/desliga direto a câmera do celular e permite alternar Frontal / Traseira) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isCameraBtnDisabled}
              onClick={() => {
                if (isCameraBtnDisabled) return;
                if (isPlainAndroid) {
                  if (activeCount > 0 || isWebcamActive) {
                    if (onStopAllSources) onStopAllSources();
                    else onToggleWebcam();
                  } else {
                    onToggleWebcam(cameraFacingMode);
                  }
                  return;
                }
                if (onToggleSourceManager) {
                  onToggleSourceManager();
                } else {
                  onToggleWebcam();
                }
              }}
              className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all border ${
                isCameraBtnDisabled
                  ? 'bg-neutral-950 border-neutral-900 text-neutral-600 opacity-45 cursor-not-allowed'
                  : activeCount > 0 || isWebcamActive
                  ? isPlainAndroid
                    ? 'bg-red-600 hover:bg-red-500 border-red-500 text-white font-bold cursor-pointer'
                    : 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-bold cursor-pointer'
                  : showSourceManager
                  ? 'bg-neutral-800 border-indigo-500/60 text-white cursor-pointer'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 cursor-pointer'
              }`}
              title={
                effectiveIsQuestOrVr
                  ? 'No Meta Quest / VR, use a opção "Câmera Passthrough POV" dentro do botão Quest 3 POV'
                  : isCameraBtnDisabled
                  ? 'Nenhuma câmera ou placa de captura compatível disponível neste dispositivo'
                  : isPlainAndroid
                  ? activeCount > 0 || isWebcamActive
                    ? 'Parar câmera do celular'
                    : `Compartilhar câmera ${cameraFacingMode === 'environment' ? 'Traseira' : 'Frontal'} do celular`
                  : 'Gerenciar Webcams e Placas de Captura USB'
              }
            >
              <Video
                className={`w-3.5 h-3.5 shrink-0 ${
                  isCameraBtnDisabled
                    ? 'text-neutral-600'
                    : isPlainAndroid && (activeCount > 0 || isWebcamActive)
                    ? 'text-white'
                    : 'text-indigo-400'
                }`}
              />
              <span>
                {isPlainAndroid
                  ? activeCount > 0 || isWebcamActive
                    ? 'Parar Câmera'
                    : `Câmera (${cameraFacingMode === 'environment' ? 'Traseira' : 'Frontal'})`
                  : activeCount > 0
                  ? `Câmera (${activeCount})`
                  : 'Câmera'}
              </span>
              {!isPlainAndroid &&
                (showSourceManager && !isCameraBtnDisabled ? (
                  <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
                ))}
            </button>

            {/* Botão Rápido para Alternar entre Câmera Frontal e Traseira no Android */}
            {isPlainAndroid && !isCameraBtnDisabled && onSwitchCameraFacingMode && (
              <button
                type="button"
                onClick={() => onSwitchCameraFacingMode()}
                className="sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-200 hover:text-white font-mono text-xs cursor-pointer transition-colors shrink-0"
                title={
                  cameraFacingMode === 'environment'
                    ? 'Mudar para a Câmera Frontal'
                    : 'Mudar para a Câmera Traseira'
                }
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>{cameraFacingMode === 'environment' ? 'Usar Frontal' : 'Usar Traseira'}</span>
              </button>
            )}

            {activeCount > 0 && onStopAllSources && (
              <button
                type="button"
                onClick={onStopAllSources}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-300 cursor-pointer transition-colors shrink-0"
                title="Desligar câmera ativa"
              >
                <PowerOff className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 5. Botão Anti-Tela Preta (Oculto no Android comum; disponível no Desktop) */}
          {!isPlainAndroid && (
            <button
              type="button"
              disabled={isAntiBlackBtnDisabled}
              onClick={() => {
                if (!isAntiBlackBtnDisabled) {
                  setShowAntiBlackMenu((prev) => !prev);
                }
              }}
              className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all border ${
                isAntiBlackBtnDisabled
                  ? 'bg-neutral-950 border-neutral-900 text-neutral-600 opacity-45 cursor-not-allowed'
                  : showAntiBlackMenu
                  ? 'bg-emerald-950 border-emerald-400 text-emerald-200 font-bold cursor-pointer'
                  : antiBlackScreen
                  ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:border-emerald-400 cursor-pointer'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer'
              }`}
              title={
                isAntiBlackBtnDisabled
                  ? 'Modo Anti-Tela Preta (DWM) disponível apenas no aplicativo Desktop Windows'
                  : 'Configurar Anti-Tela Preta para Crunchyroll, Disney+, Netflix e vídeos em Tela Cheia (sem mexer no mouse e sem queda de FPS)'
              }
            >
              <ShieldCheck
                className={`w-3.5 h-3.5 shrink-0 ${
                  isAntiBlackBtnDisabled
                    ? 'text-neutral-600'
                    : antiBlackScreen
                    ? 'text-emerald-400'
                    : 'text-neutral-500'
                }`}
              />
              <span className="hidden sm:inline">Anti-Tela Preta</span>
              {!isAntiBlackBtnDisabled &&
                (showAntiBlackMenu ? (
                  <ChevronUp className="w-3 h-3 text-emerald-300 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-emerald-400/70 shrink-0" />
                ))}
            </button>
          )}
        </div>

        {/* Seletores Alinhados de Resolução e FPS */}
        <div className="flex items-center gap-1.5">
          <div className="h-8 flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
            {(['720p', '1080p', '1440p'] as const).map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => onChangeResolution(res)}
                className={`h-full px-2 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  resolution === res
                    ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {res}
              </button>
            ))}
          </div>

          <div className="h-8 flex items-center gap-0.5 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
            {([30, 60] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onChangeFps(f)}
                className={`h-full px-2 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  fps === f
                    ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {f}fps
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Painel Anti-Tela Preta (Crunchyroll, Disney+, Netflix & 60 FPS Tela Cheia) */}
      {!isAntiBlackBtnDisabled && showAntiBlackMenu && (
        <div className="p-3 rounded-xl bg-emerald-950/25 border border-emerald-500/40 font-mono text-xs space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-emerald-200 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Motor Anti-Tela Preta DWM & Navegador de Streaming (60 FPS)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleAntiBlackScreen}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                  antiBlackScreen
                    ? 'bg-emerald-500 text-black border-emerald-400'
                    : 'bg-neutral-900 text-neutral-300 border-neutral-700 hover:border-neutral-500'
                }`}
              >
                {antiBlackScreen ? 'Bloqueador DWM: ATIVO' : 'Bloqueador DWM: INATIVO'}
              </button>
              <button
                type="button"
                onClick={() => setShowAntiBlackMenu(false)}
                className="text-[11px] text-neutral-400 hover:text-white cursor-pointer px-1"
              >
                Fechar
              </button>
            </div>
          </div>

          <p className="text-[11px] text-neutral-300 leading-relaxed">
            O bloqueador DWM evita tela preta em tela cheia <strong className="text-emerald-300">sem mexer no seu mouse</strong> e <strong className="text-emerald-300">sem derrubar o FPS</strong>. Se um site como <strong className="text-orange-300">Crunchyroll</strong> ou <strong className="text-cyan-300">Disney+</strong> ficar com vídeo preto (devido ao overlay DirectComposition do Chrome/Edge), abra-o pelos botões abaixo:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() =>
                handleLaunchStreamingSite('https://www.crunchyroll.com', 'Crunchyroll')
              }
              className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg bg-neutral-950/90 hover:bg-orange-950/50 border border-orange-500/40 hover:border-orange-400 text-orange-200 text-[11px] font-bold cursor-pointer transition-all"
              title="Abre o navegador com DirectComposition Video Overlays desativado para transmitir Crunchyroll sem tela preta"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Tv className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="truncate">Crunchyroll</span>
              </span>
              <ExternalLink className="w-3 h-3 text-orange-400/80 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => handleLaunchStreamingSite('https://www.disneyplus.com', 'Disney+')}
              className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg bg-neutral-950/90 hover:bg-cyan-950/50 border border-cyan-500/40 hover:border-cyan-400 text-cyan-200 text-[11px] font-bold cursor-pointer transition-all"
              title="Abre o navegador com DirectComposition Video Overlays desativado para transmitir Disney+ sem tela preta"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Tv className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">Disney+</span>
              </span>
              <ExternalLink className="w-3 h-3 text-cyan-400/80 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => handleLaunchStreamingSite('https://www.netflix.com', 'Netflix')}
              className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg bg-neutral-950/90 hover:bg-red-950/50 border border-red-500/40 hover:border-red-400 text-red-200 text-[11px] font-bold cursor-pointer transition-all"
              title="Abre o navegador com DirectComposition Video Overlays desativado para transmitir Netflix sem tela preta"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Tv className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="truncate">Netflix</span>
              </span>
              <ExternalLink className="w-3 h-3 text-red-400/80 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() =>
                handleLaunchStreamingSite('https://www.primevideo.com', 'Prime Video')
              }
              className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg bg-neutral-950/90 hover:bg-sky-950/50 border border-sky-500/40 hover:border-sky-400 text-sky-200 text-[11px] font-bold cursor-pointer transition-all"
              title="Abre o navegador com DirectComposition Video Overlays desativado para transmitir Prime Video sem tela preta"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Tv className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">Prime Video</span>
              </span>
              <ExternalLink className="w-3 h-3 text-sky-400/80 shrink-0" />
            </button>
          </div>

          {browserLaunchStatus && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{browserLaunchStatus}</span>
            </div>
          )}
        </div>
      )}

      {/* Painel Rápido do Meta Quest 3 — Abre apenas no Meta Quest e Headsets VR */}
      {effectiveIsQuestOrVr && showQuestMenu && onStartQuestPov && (
        <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/40 font-mono text-xs space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-purple-200 font-bold">
              <Glasses className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Modo Meta Quest 3 / VR — Gravar Visão da Pessoa (POV + Áudio)</span>
              <button
                type="button"
                onClick={handleToggleQuestModeManual}
                className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 border border-emerald-600 text-emerald-300 hover:bg-emerald-900 cursor-pointer transition-colors"
                title="Clique para alternar forçar/desforçar o modo Quest 3"
              >
                {effectiveIsQuestOrVr ? 'Quest Detectado / Ativo' : 'Ativar Modo Quest 3'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowQuestMenu(false)}
              className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
            >
              Minimizar
            </button>
          </div>

          <p className="text-[11px] text-neutral-300 leading-relaxed">
            Escolha como deseja transmitir sua visão em 1ª pessoa no Quest 3 (funciona direto no APK Android do Quest ou pelo Meta Quest Browser):
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!capabilities.canUseQuestVrScreen}
              onClick={() => {
                if (!capabilities.canUseQuestVrScreen) return;
                setShowQuestMenu(false);
                onStartQuestPov('vr_screen');
              }}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-all ${
                !capabilities.canUseQuestVrScreen
                  ? 'bg-neutral-950/50 border-neutral-800 text-neutral-600 opacity-45 cursor-not-allowed'
                  : 'bg-neutral-950/90 hover:bg-purple-950/60 border-purple-500/40 hover:border-purple-400 cursor-pointer'
              }`}
            >
              <Sparkles
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  !capabilities.canUseQuestVrScreen ? 'text-neutral-600' : 'text-purple-400'
                }`}
              />
              <div>
                <div className="font-bold text-white text-xs">
                  1. Visão VR Completa + Áudio do Jogo
                </div>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  Captura exatamente o que você vê dentro do Quest 3 (Jogos VR, Interface Horizon OS e Realidade Mista) com o som interno.
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={!capabilities.canUseQuestPassthrough}
              onClick={() => {
                if (!capabilities.canUseQuestPassthrough) return;
                setShowQuestMenu(false);
                onStartQuestPov('passthrough_camera');
              }}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-all ${
                !capabilities.canUseQuestPassthrough
                  ? 'bg-neutral-950/50 border-neutral-800 text-neutral-600 opacity-45 cursor-not-allowed'
                  : 'bg-neutral-950/90 hover:bg-cyan-950/60 border-cyan-500/40 hover:border-cyan-400 cursor-pointer'
              }`}
            >
              <Eye
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  !capabilities.canUseQuestPassthrough ? 'text-neutral-600' : 'text-cyan-400'
                }`}
              />
              <div>
                <div className="font-bold text-white text-xs">
                  2. Câmera Passthrough POV (Mundo Real + Voz)
                </div>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  Usa as câmeras frontais RGB do Quest 3 (HEADSET_CAMERA) + microfone para transmitir sua visão real em 1ª pessoa.
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


