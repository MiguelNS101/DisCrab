/**
 * Ponte Nativa de Captura de Tela + Áudio para Android APK e Meta Quest 3 (Horizon OS)
 *
 * Resolve duas limitações críticas do Android / VR:
 * 1. Na WebView nativa do Android (APK Tauri), `navigator.mediaDevices.getDisplayMedia` não existe.
 *    Esta ponte aciona a API nativa `MediaProjection` + `AudioPlaybackCapture` (Android 10-15)
 *    via `window.DisCrabAndroidBridge` (injetado pelo `MainActivity.kt` + `ScreenCaptureService.kt`),
 *    desenhando os quadros em um `<canvas>` com `captureStream(fps)` e injetando o áudio estéreo
 *    48kHz (interno do sistema/jogo + microfone fallback) direto no `wasapiAudioBridge`.
 * 2. No Meta Quest 3 / 3S / Pro (Horizon OS), permite capturar:
 *    - A Visão Completa do Headset (Jogos VR + Interface + Áudio Interno) via MediaProjection ou getDisplayMedia ("Compartilhar sua visão").
 *    - A Câmera Passthrough POV em 1ª pessoa (`horizonos.permission.HEADSET_CAMERA` / RGB frontal) com áudio estéreo.
 */

import { wasapiAudioBridge } from './AudioBridge';
import { androidAudioEngine } from './AndroidAudioEngine';

declare global {
  interface Window {
    DisCrabAndroidBridge?: {
      startScreenCapture: (width: number, height: number, fps: number, includeAudio: boolean) => void;
      stopScreenCapture: () => void;
      ackFrame: () => void;
      requestCameraAndMicPermissions?: () => void;
      isQuestDevice?: () => boolean;
      getDeviceModel?: () => string;
    };
    __DISCRAB_ANDROID_BRIDGE_READY__?: boolean;
    __IS_META_QUEST__?: boolean;
    __onAndroidScreenCaptureStarted?: (width: number, height: number, fps: number) => void;
    __onAndroidScreenCaptureStopped?: () => void;
    __onAndroidScreenCaptureError?: (errMsg: string) => void;
    __onAndroidScreenFrame?: (base64Jpeg: string, width: number, height: number) => void;
    __onAndroidNativeAudioChunk?: (
      base64Pcm: string,
      bitsPerSample: number,
      channels: number,
      sampleRate: number
    ) => void;
  }
}

export interface AndroidBridgeCaptureSession {
  stream: MediaStream;
  isNativeProjection: boolean;
  stop: () => void;
}

let activeCanvas: HTMLCanvasElement | null = null;
let activeCtx: CanvasRenderingContext2D | null = null;
let activeKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let activeStream: MediaStream | null = null;
let frameImage: HTMLImageElement | null = null;
let isDecodingFrame = false;

const FORCE_QUEST_KEY = 'sc_force_quest_mode_v1';

/**
 * Retorna se o usuário forçou manualmente o modo Quest 3 / VR
 */
export function getManualQuestMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FORCE_QUEST_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Ativa ou desativa manualmente o modo Meta Quest 3 / VR
 */
export function setManualQuestMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FORCE_QUEST_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent('discrab-quest-mode-change', { detail: { enabled } }));
  } catch {
    // ignore
  }
}

/**
 * Verifica se o APK Android possui a ponte nativa Kotlin `DisCrabAndroidBridge` injetada na WebView
 */
export function hasNativeAndroidScreenBridge(): boolean {
  return (
    typeof window !== 'undefined' &&
    ((typeof window.DisCrabAndroidBridge !== 'undefined' &&
      typeof window.DisCrabAndroidBridge.startScreenCapture === 'function') ||
      Boolean(window.__DISCRAB_ANDROID_BRIDGE_READY__))
  );
}

let cachedWebXrVrSupported: boolean | null = null;

/**
 * Detecta se o dispositivo atual é um headset Meta Quest (Quest 2, Quest 3, Quest 3S, Quest Pro / Horizon OS)
 * ou outro dispositivo/navegador VR compatível.
 */
export function isMetaQuestDevice(): boolean {
  // 1. Preferência manual do usuário
  if (getManualQuestMode()) {
    return true;
  }

  // 2. Injetado diretamente pela MainActivity Kotlin na WebView do APK
  if (typeof window !== 'undefined') {
    if (window.__IS_META_QUEST__ === true) {
      return true;
    }
    if (window.DisCrabAndroidBridge?.isQuestDevice) {
      try {
        if (window.DisCrabAndroidBridge.isQuestDevice()) return true;
      } catch {
        // ignore
      }
    }
    if (window.DisCrabAndroidBridge?.getDeviceModel) {
      try {
        const model = (window.DisCrabAndroidBridge.getDeviceModel() || '').toLowerCase();
        if (/quest|meta|oculus|eureka|panther|seacliff|hollywood|pacific/i.test(model)) {
          return true;
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. User-Agent (Meta Quest Browser ou WebViews que preservam modelo)
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (
      /Quest|OculusBrowser|Oculus|Eureka|Panther|Seacliff|Hollywood|Pacific|HorizonOS|Wolvic|Pico|Vive\s+Focus/i.test(
        ua
      )
    ) {
      return true;
    }
  }

  // 4. Cache prévio de WebXR
  if (cachedWebXrVrSupported === true) {
    return true;
  }

  return false;
}

/**
 * Consulta de forma assíncrona e monitora ativamente a ponte nativa Android e a API WebXR (`navigator.xr`)
 * para detectar com precisão headsets VR mesmo se a injeção Kotlin levar algumas centenas de milissegundos.
 */
export async function detectQuestOrVrEnvironment(): Promise<boolean> {
  if (isMetaQuestDevice()) {
    cachedWebXrVrSupported = true;
    return true;
  }

  // Se a ponte nativa estiver prestes a ser injetada pelo Android, aguarda até 1 segundo
  if (typeof window !== 'undefined') {
    for (let i = 0; i < 10; i++) {
      if (isMetaQuestDevice() || window.__IS_META_QUEST__ === true) {
        cachedWebXrVrSupported = true;
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    'xr' in navigator &&
    (navigator as unknown as { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }).xr
      ?.isSessionSupported
  ) {
    try {
      const xr = (navigator as unknown as { xr: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr;
      const [vrSupported, arSupported] = await Promise.all([
        xr.isSessionSupported('immersive-vr').catch(() => false),
        xr.isSessionSupported('immersive-ar').catch(() => false),
      ]);
      if (vrSupported || arSupported) {
        cachedWebXrVrSupported = true;
        return true;
      }
    } catch {
      // ignore
    }
  }

  return isMetaQuestDevice();
}

export interface DeviceBroadcastCapabilities {
  isQuestOrVr: boolean;
  canShareScreen: boolean;
  canUseQuestVrScreen: boolean;
  canUseQuestPassthrough: boolean;
  canUseStandardCamera: boolean;
  canUseWindowAudioSelector: boolean;
  canUseAntiBlackScreen: boolean;
}

/**
 * Retorna quais recursos e botões de transmissão são compatíveis com o dispositivo/ambiente atual,
 * permitindo desabilitar automaticamente os botões incompatíveis.
 */
export function getDeviceBroadcastCapabilities(
  isAndroidEnv: boolean,
  isTauriDesktopEnv: boolean
): DeviceBroadcastCapabilities {
  const isQuestOrVr = isMetaQuestDevice();
  const hasNativeBridge = hasNativeAndroidScreenBridge();
  const hasDisplayMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const hasUserMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  // No Quest/VR ou APK Android, os modos do Quest 3 estão plenamente disponíveis
  const canUseQuestVrScreen = (isQuestOrVr || isAndroidEnv) && (hasNativeBridge || hasDisplayMedia || true);
  const canUseQuestPassthrough = (isQuestOrVr || isAndroidEnv) && (hasUserMedia || true);

  // No Android e PC, a captura de tela pode ser acionada via ponte nativa MediaProjection ou getDisplayMedia
  const canShareScreen = hasNativeBridge || hasDisplayMedia || isAndroidEnv;

  // No Quest/VR, desabilita o seletor de Webcam/Placa de Captura USB comum externa (pois a visão é gerada pelo headset)
  const canUseStandardCamera = !isQuestOrVr && hasUserMedia;

  // Isolamento de áudio por janela (WASAPI) e Anti-Tela Preta (DWM) são exclusivos de Desktop Windows (Tauri)
  const canUseWindowAudioSelector = !isAndroidEnv && !isQuestOrVr && isTauriDesktopEnv;
  const canUseAntiBlackScreen = !isAndroidEnv && !isQuestOrVr && isTauriDesktopEnv;

  return {
    isQuestOrVr,
    canShareScreen,
    canUseQuestVrScreen,
    canUseQuestPassthrough,
    canUseStandardCamera,
    canUseWindowAudioSelector,
    canUseAntiBlackScreen,
  };
}

/**
 * Encerra qualquer sessão ativa da ponte nativa `MediaProjection` do Android
 */
export function stopNativeAndroidScreenCapture(): void {
  if (activeKeepAliveTimer) {
    clearInterval(activeKeepAliveTimer);
    activeKeepAliveTimer = null;
  }

  isDecodingFrame = false;
  frameImage = null;

  if (typeof window !== 'undefined') {
    window.__onAndroidScreenFrame = undefined;
    window.__onAndroidNativeAudioChunk = undefined;
    window.__onAndroidScreenCaptureStopped = undefined;
    try {
      window.DisCrabAndroidBridge?.stopScreenCapture();
    } catch {
      // ignore
    }
  }

  if (activeStream) {
    activeStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    activeStream = null;
  }

  activeCanvas = null;
  activeCtx = null;
}

/**
 * Inicia a gravação/transmissão de tela + áudio nativo no Android APK via `MediaProjection` + `AudioPlaybackCapture`
 */
export async function startNativeAndroidScreenCapture(
  targetWidth: number,
  targetHeight: number,
  fps: number,
  onEndedCallback?: () => void
): Promise<MediaStream> {
  stopNativeAndroidScreenCapture();
  wasapiAudioBridge.resetClock();

  return new Promise<MediaStream>((resolve, reject) => {
    if (!hasNativeAndroidScreenBridge()) {
      reject(new Error('Ponte nativa DisCrabAndroidBridge não encontrada.'));
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        stopNativeAndroidScreenCapture();
        reject(
          new Error(
            'Tempo limite excedido aguardando permissão de gravação de tela do Android.'
          )
        );
      }
    }, 45000);

    // Prepara o canvas offscreen que gerará a MediaStreamTrack de vídeo para o WebRTC
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(320, targetWidth || 1280);
    canvas.height = Math.max(240, targetHeight || 720);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      clearTimeout(timeoutId);
      reject(new Error('Não foi possível inicializar o contexto 2D para captura de tela Android.'));
      return;
    }

    // Preenche o quadro inicial para garantir que o stream já tenha dados válidos imediatamente
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    activeCanvas = canvas;
    activeCtx = ctx;
    const reusableImg = new Image();
    frameImage = reusableImg;

    // Recebe quadros JPEG da VirtualDisplay nativa do Android e desenha no canvas
    window.__onAndroidScreenFrame = (base64Jpeg: string, width: number, height: number) => {
      if (!activeCanvas || !activeCtx || !frameImage) {
        try {
          window.DisCrabAndroidBridge?.ackFrame();
        } catch {}
        return;
      }

      if (isDecodingFrame) {
        try {
          window.DisCrabAndroidBridge?.ackFrame();
        } catch {}
        return;
      }

      isDecodingFrame = true;
      if (width > 0 && height > 0) {
        if (activeCanvas.width !== width || activeCanvas.height !== height) {
          activeCanvas.width = width;
          activeCanvas.height = height;
        }
      }

      frameImage.onload = () => {
        try {
          if (activeCtx && activeCanvas && frameImage) {
            activeCtx.drawImage(frameImage, 0, 0, activeCanvas.width, activeCanvas.height);
          }
        } catch {
          // ignore draw errors
        } finally {
          isDecodingFrame = false;
          try {
            window.DisCrabAndroidBridge?.ackFrame();
          } catch {}
        }
      };

      frameImage.onerror = () => {
        isDecodingFrame = false;
        try {
          window.DisCrabAndroidBridge?.ackFrame();
        } catch {}
      };

      frameImage.src = `data:image/jpeg;base64,${base64Jpeg}`;
    };

    // Recebe blocos PCM de 20ms do áudio interno do Android (AudioPlaybackCapture) + fallback de microfone
    window.__onAndroidNativeAudioChunk = (
      base64Pcm: string,
      bitsPerSample = 16,
      channels = 2,
      sampleRate = 48000
    ) => {
      wasapiAudioBridge.feedBase64Chunk(base64Pcm, bitsPerSample, channels, sampleRate, 0);
    };

    window.__onAndroidScreenCaptureStopped = () => {
      stopNativeAndroidScreenCapture();
      onEndedCallback?.();
    };

    window.__onAndroidScreenCaptureError = (errMsg: string) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        stopNativeAndroidScreenCapture();
        reject(new Error(errMsg || 'Permissão de gravação de tela negada no Android.'));
      }
    };

    window.__onAndroidScreenCaptureStarted = (realWidth: number, realHeight: number, realFps: number) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;

      if (activeCanvas && realWidth > 0 && realHeight > 0) {
        activeCanvas.width = realWidth;
        activeCanvas.height = realHeight;
      }

      try {
        const captureStreamFn =
          (canvas as any).captureStream || (canvas as any).mozCaptureStream;
        if (typeof captureStreamFn !== 'function') {
          reject(new Error('canvas.captureStream não suportado nesta WebView Android.'));
          return;
        }

        const effectiveFps = Math.min(60, Math.max(15, realFps || fps || 30));
        const canvasStream: MediaStream = captureStreamFn.call(canvas, effectiveFps);
        const videoTrack = canvasStream.getVideoTracks()[0];
        if (!videoTrack) {
          reject(new Error('Falha ao criar trilha de vídeo da tela Android.'));
          return;
        }

        videoTrack.enabled = true;
        try {
          if ('contentHint' in videoTrack) {
            videoTrack.contentHint = 'motion';
          }
        } catch {}

        const combinedTracks: MediaStreamTrack[] = [videoTrack];

        // Conecta a trilha de áudio estéreo 48kHz alimentada pelo AudioPlaybackCapture nativo
        const nativeAudioTrack = wasapiAudioBridge.getAudioTrack();
        if (nativeAudioTrack) {
          nativeAudioTrack.enabled = true;
          combinedTracks.push(nativeAudioTrack);
        }

        const finalStream = new MediaStream(combinedTracks);
        (finalStream as any).__isNativeAndroidProjection = true;
        activeStream = finalStream;

        // Keep-alive leve para garantir que o codificador WebRTC continue enviando quadros
        // mesmo quando a imagem da tela do celular/Quest estiver parada
        activeKeepAliveTimer = setInterval(() => {
          if (activeCtx && activeCanvas && !isDecodingFrame && frameImage && frameImage.complete && frameImage.naturalWidth > 0) {
            try {
              activeCtx.drawImage(frameImage, 0, 0, activeCanvas.width, activeCanvas.height);
            } catch {}
          }
        }, 120);

        resolve(finalStream);
      } catch (err: any) {
        stopNativeAndroidScreenCapture();
        reject(new Error(`Erro ao iniciar stream de tela Android: ${err?.message || err}`));
      }
    };

    try {
      window.DisCrabAndroidBridge!.startScreenCapture(
        targetWidth || 1280,
        targetHeight || 720,
        fps || 30,
        true
      );
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        reject(new Error(`Falha ao chamar DisCrabAndroidBridge: ${err?.message || err}`));
      }
    }
  });
}

/**
 * Garante que uma MediaStream capturada no Android ou Meta Quest 3 possua faixa de áudio ativa.
 * Se o sistema operacional / navegador entregou apenas o vídeo da tela, acopla automaticamente
 * o áudio capturado via `getUserMedia` / `androidAudioEngine` sem exigir configuração manual.
 */
export async function ensureAndroidStreamHasAudio(stream: MediaStream): Promise<MediaStream> {
  if ((stream as any).__isNativeAndroidProjection) {
    return stream;
  }

  // Se o getDisplayMedia já trouxe áudio nativo da tela, passa pelo filtro de proteção ou mantém ativo
  if (stream.getAudioTracks().length > 0) {
    stream.getAudioTracks().forEach((t) => {
      t.enabled = true;
      try {
        if ('contentHint' in t) t.contentHint = 'music';
      } catch {}
    });
    return stream;
  }

  // Caso não tenha vindo faixa de áudio na gravação de tela, captura automaticamente o áudio do dispositivo
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 2,
        sampleRate: 48000,
      } as any,
      video: false,
    });
    const dspTrack = await androidAudioEngine.attachAndroidStreams(micStream, 'internal_system');
    if (dspTrack) {
      stream.addTrack(dspTrack);
      return stream;
    }
    micStream.getAudioTracks().forEach((t) => {
      t.enabled = true;
      stream.addTrack(t);
    });
  } catch {
    try {
      const basicAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      basicAudio.getAudioTracks().forEach((t) => {
        t.enabled = true;
        stream.addTrack(t);
      });
    } catch (err) {
      console.warn('[AndroidCapture] Aviso: não foi possível anexar áudio complementar:', err);
    }
  }

  return stream;
}

/**
 * Captura a visão em 1ª pessoa (POV) no Meta Quest 3 / 3S / Pro ou Android:
 * - Tenta usar a Câmera Passthrough Frontal RGB (`horizonos.permission.HEADSET_CAMERA` / `facingMode: environment`)
 *   combinada com o áudio estéreo do headset.
 */
export async function captureQuestPassthroughPovStream(
  targetWidth: number,
  targetHeight: number,
  fps: number
): Promise<{ stream: MediaStream; label: string }> {
  if (typeof window !== 'undefined' && window.DisCrabAndroidBridge?.requestCameraAndMicPermissions) {
    try {
      window.DisCrabAndroidBridge.requestCameraAndMicPermissions();
    } catch {}
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Captura de câmera/POV não disponível neste dispositivo.');
  }

  // Solicita permissão inicial para desbloquear os rótulos das câmeras Passthrough do Quest 3
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch {
    try {
      const vProbe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      vProbe.getTracks().forEach((t) => t.stop());
    } catch {}
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const videoInputs = devices.filter((d) => d.kind === 'videoinput');

  // No Meta Quest 3 (Horizon OS v66+), as câmeras Passthrough de olho esquerdo/direito aparecem como
  // camera2 0 (Left), camera2 1 (Right), Passthrough, Headset Camera ou Environment
  const questPassthroughCam =
    videoInputs.find((d) =>
      /passthrough|headset|eye|left|external|environment|back|traseira|camera2 0|camera 0/i.test(
        d.label
      )
    ) || videoInputs[videoInputs.length - 1] || videoInputs[0];

  const videoConstraints: MediaTrackConstraints = {
    ...(questPassthroughCam?.deviceId
      ? { deviceId: { ideal: questPassthroughCam.deviceId } }
      : { facingMode: { ideal: 'environment' } }),
    width: { ideal: targetWidth || 1920 },
    height: { ideal: targetHeight || 1080 },
    frameRate: { ideal: fps || 60 },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 2,
        sampleRate: 48000,
      } as any,
    });
  } catch {
    // Fallback com constraints flexíveis caso o driver de câmera VR exija resolução nativa do sensor
    stream = await navigator.mediaDevices.getUserMedia({
      video: questPassthroughCam?.deviceId
        ? { deviceId: { ideal: questPassthroughCam.deviceId } }
        : { facingMode: { ideal: 'environment' } },
      audio: true,
    });
  }

  await ensureAndroidStreamHasAudio(stream);

  const vTrack = stream.getVideoTracks()[0];
  const detectedLabel =
    vTrack?.label ||
    questPassthroughCam?.label ||
    (isMetaQuestDevice() ? 'Visão POV (Meta Quest 3)' : 'Câmera POV com Áudio');

  return {
    stream,
    label: detectedLabel,
  };
}
