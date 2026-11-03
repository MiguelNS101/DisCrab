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
} from 'lucide-react';
import { WindowItem, AudioSourceMode, LocalMediaSource } from '../types';
import {
  isAndroidEnvironment,
  isTauriEnvironment,
  getAntiBlackScreenPreference,
  setNativeAntiBlackScreen,
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
  onToggleWebcam: () => void;
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Controles Compactos de Captura: Desabilita automaticamente botões incompatíveis com o dispositivo atual */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 1. Transmitir Tela (Desabilitado no Quest/VR enquanto não estiver em live para usar o botão Quest 3 POV, ou se o navegador não suportar) */}
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
                ? 'Gravar e transmitir a tela inteira com áudio diretamente'
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
                <span>{isAndroid ? 'Tela + Áudio' : 'Tela'}</span>
              </>
            )}
          </button>

          {/* 2. Seletor de Janela WASAPI (Compatível apenas com Windows Desktop; desabilitado em dispositivos incompatíveis) */}
          {onToggleWindowSelector && (
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

          {/* 3. Botão Dedicado Meta Quest 3 / VR — Disponível no Quest, Headsets VR e no APK Android */}
          {(effectiveIsQuestOrVr || isAndroid) && onStartQuestPov && (
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

          {/* 4. Botão Compacto: Câmera / Placa de Captura (Desabilitado no Quest/VR pois a câmera POV fica no botão Quest 3) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isCameraBtnDisabled}
              onClick={() => {
                if (isCameraBtnDisabled) return;
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
                  ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-bold cursor-pointer'
                  : showSourceManager
                  ? 'bg-neutral-800 border-indigo-500/60 text-white cursor-pointer'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 cursor-pointer'
              }`}
              title={
                effectiveIsQuestOrVr
                  ? 'No Meta Quest / VR, use a opção "Câmera Passthrough POV" dentro do botão Quest 3 POV'
                  : isCameraBtnDisabled
                  ? 'Nenhuma câmera ou placa de captura compatível disponível neste dispositivo'
                  : 'Gerenciar Webcams e Placas de Captura USB'
              }
            >
              <Video
                className={`w-3.5 h-3.5 shrink-0 ${
                  isCameraBtnDisabled ? 'text-neutral-600' : 'text-indigo-400'
                }`}
              />
              <span>{activeCount > 0 ? `Câmera (${activeCount})` : 'Câmera'}</span>
              {showSourceManager && !isCameraBtnDisabled ? (
                <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
              )}
            </button>

            {activeCount > 0 && onStopAllSources && (
              <button
                type="button"
                onClick={onStopAllSources}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-300 cursor-pointer transition-colors shrink-0"
                title="Desligar todas as webcams e placas de captura ativas"
              >
                <PowerOff className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 5. Botão Anti-Tela Preta (Compatível apenas com Windows DWM; desabilitado em dispositivos incompatíveis) */}
          <button
            type="button"
            disabled={isAntiBlackBtnDisabled}
            onClick={handleToggleAntiBlackScreen}
            className={`sc-btn h-8 flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all border ${
              isAntiBlackBtnDisabled
                ? 'bg-neutral-950 border-neutral-900 text-neutral-600 opacity-45 cursor-not-allowed'
                : antiBlackScreen
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:border-emerald-400 cursor-pointer'
                : 'bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300 cursor-pointer'
            }`}
            title={
              isAntiBlackBtnDisabled
                ? 'Modo Anti-Tela Preta (DWM) disponível apenas no aplicativo Desktop Windows'
                : antiBlackScreen
                ? 'Modo Anti-Tela Preta ATIVO: impede que sites como Disney+ e navegadores deixem o vídeo preto quando você para de mexer o mouse (força composição DWM + keep-alive de vídeo)'
                : 'Modo Anti-Tela Preta DESATIVADO (clique para ativar proteção contra vídeo preto no Disney+ / Navegador)'
            }
          >
            <ShieldCheck
              className={`w-3.5 h-3.5 shrink-0 ${
                isAntiBlackBtnDisabled
                  ? 'text-neutral-600'
                  : antiBlackScreen
                  ? 'text-emerald-400'
                  : 'text-neutral-600'
              }`}
            />
            <span className="hidden sm:inline">Anti-Tela Preta</span>
          </button>
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

      {/* Painel Rápido do Meta Quest 3 — Abre no Meta Quest, Headsets VR e APK Android */}
      {(effectiveIsQuestOrVr || isAndroid) && showQuestMenu && onStartQuestPov && (
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

