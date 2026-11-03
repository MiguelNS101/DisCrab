/**
 * Script de Configuração Nativa Android & Meta Quest 3 (Horizon OS) para Tauri v2
 *
 * Executado automaticamente após `tauri android init` no pipeline de build (.github/workflows/build-exe.yml).
 * Configura:
 * 1. AndroidManifest.xml:
 *    - Permissões de captura de tela e áudio interno (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `RECORD_AUDIO`)
 *    - Permissões de câmera e Meta Quest 3 Passthrough (`CAMERA`, `horizonos.permission.HEADSET_CAMERA`, `oculus.permission.HEADSET_CAMERA`)
 *    - Declaração do serviço `<service android:name=".ScreenCaptureService" android:foregroundServiceType="mediaProjection" />`
 *    - `android:usesCleartextTraffic="true"` para conexões LAN WebSocket P2P
 * 2. ScreenCaptureService.kt:
 *    - Serviço Foreground Android 10–15 + Horizon OS que executa `MediaProjection` (`VirtualDisplay` + `ImageReader`)
 *      e captura o áudio interno do celular/Quest (`AudioPlaybackCaptureConfiguration` 48kHz Estéreo PCM 16-bit + fallback Mic)
 * 3. MainActivity.kt:
 *    - Injeta `window.DisCrabAndroidBridge` na WebView, gerencia o diálogo nativo `MediaProjectionManager.createScreenCaptureIntent()`
 *      e entrega quadros de vídeo + pacotes de áudio PCM de baixa latência para o motor WebRTC.
 */

import fs from 'node:fs';
import path from 'node:path';

const androidRoot = path.resolve(process.cwd(), 'src-tauri/gen/android');
const manifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml');

if (!fs.existsSync(androidRoot)) {
  console.log('[setup-android-native] Diretório src-tauri/gen/android ainda não existe. Pulando etapa.');
  process.exit(0);
}

console.log('[setup-android-native] Configurando suporte nativo a Gravação de Tela + Áudio e Meta Quest 3 no Android...');

// 1. Atualiza o AndroidManifest.xml
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf-8');

  // Garante tráfego LAN WebSocket permitido
  manifest = manifest.replace(
    'android:usesCleartextTraffic="${usesCleartextTraffic}"',
    'android:usesCleartextTraffic="true"'
  );
  if (!manifest.includes('android:usesCleartextTraffic="true"')) {
    manifest = manifest.replace(
      '<application',
      '<application android:usesCleartextTraffic="true"'
    );
  }

  const requiredPermissions = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />',
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<!-- Suporte a Visão Passthrough e Câmera POV no Meta Quest 3 / 3S (Horizon OS) -->',
    '<uses-permission android:name="horizonos.permission.HEADSET_CAMERA" />',
    '<uses-permission android:name="oculus.permission.HEADSET_CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
    '<uses-feature android:name="android.hardware.camera.any" android:required="false" />',
    '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
    '<uses-feature android:name="android.hardware.vr.headtracking" android:required="false" />',
  ];

  const missingPerms = requiredPermissions.filter((perm) => {
    const match = perm.match(/android:name="([^"]+)"/);
    if (!match) return true;
    return !manifest.includes(`android:name="${match[1]}"`);
  });

  if (missingPerms.length > 0) {
    manifest = manifest.replace(
      '<application',
      `${missingPerms.join('\n    ')}\n\n    <application`
    );
  }

  // Registra o ScreenCaptureService com foregroundServiceType="mediaProjection"
  if (!manifest.includes('android:name=".ScreenCaptureService"')) {
    const serviceBlock = `
        <service
            android:name=".ScreenCaptureService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaProjection" />
    </application>`;
    manifest = manifest.replace('</application>', serviceBlock);
  }

  fs.writeFileSync(manifestPath, manifest, 'utf-8');
  console.log('[setup-android-native] AndroidManifest.xml atualizado com sucesso.');
}

// 2. Localiza o diretório onde o MainActivity.kt foi gerado pelo Tauri
function findFileRecursive(dir, targetName) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, targetName);
      if (found) return found;
    } else if (entry.name === targetName) {
      return fullPath;
    }
  }
  return null;
}

const javaSrcRoot = path.join(androidRoot, 'app/src/main/java');
const mainActivityPath = findFileRecursive(javaSrcRoot, 'MainActivity.kt');

if (mainActivityPath) {
  const pkgDir = path.dirname(mainActivityPath);
  const existingMain = fs.readFileSync(mainActivityPath, 'utf-8');
  const pkgMatch = existingMain.match(/^package\s+([a-zA-Z0-9_.]+)/m);
  const packageName = pkgMatch ? pkgMatch[1] : 'com.streamcompanion.desktop';

  const screenCaptureServicePath = path.join(pkgDir, 'ScreenCaptureService.kt');

  const screenCaptureServiceCode = `package ${packageName}

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {

    companion object {
        private const val CHANNEL_ID = "discrab_screen_capture_channel"
        private const val NOTIFICATION_ID = 4201
        val isCapturing = AtomicBoolean(false)
        val frameInFlight = AtomicBoolean(false)
        private var activeInstance: ScreenCaptureService? = null

        fun stopActiveCapture() {
            activeInstance?.stopCaptureInternal()
        }
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var imageThread: HandlerThread? = null
    private var imageHandler: Handler? = null
    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    private val audioRunning = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.getStringExtra("action") ?: "start"
        if (action == "stop") {
            stopCaptureInternal()
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundNotification()
        activeInstance = this

        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra("resultData", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra("resultData")
        }

        val reqWidth = intent?.getIntExtra("width", 1280) ?: 1280
        val reqHeight = intent?.getIntExtra("height", 720) ?: 720
        val reqFps = (intent?.getIntExtra("fps", 30) ?: 30).coerceIn(15, 60)
        val includeAudio = intent?.getBooleanExtra("includeAudio", true) ?: true

        if (resultData == null) {
            MainActivity.notifyCaptureError("Dados de MediaProjection inválidos no Android.")
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = mgr.getMediaProjection(resultCode, resultData)
            if (projection == null) {
                MainActivity.notifyCaptureError("Não foi possível obter MediaProjection do Android.")
                stopSelf()
                return START_NOT_STICKY
            }

            stopCaptureResourcesOnly()
            mediaProjection = projection
            isCapturing.set(true)
            frameInFlight.set(false)

            val thread = HandlerThread("DisCrabScreenCaptureThread")
            thread.start()
            val handler = Handler(thread.looper)
            imageThread = thread
            imageHandler = handler

            // Obrigatório no Android 14+ (API 34): registrar Callback antes de createVirtualDisplay
            projection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stopCaptureInternal()
                }
            }, handler)

            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)

            val screenW = metrics.widthPixels.coerceAtLeast(320)
            val screenH = metrics.heightPixels.coerceAtLeast(240)
            val maxTarget = maxOf(reqWidth, reqHeight).coerceIn(640, 1920)
            val scale = minOf(1.0f, maxTarget.toFloat() / maxOf(screenW, screenH).toFloat())

            // Garante dimensões pares para codificação limpa
            val capWidth = (((screenW * scale).toInt() / 2) * 2).coerceAtLeast(320)
            val capHeight = (((screenH * scale).toInt() / 2) * 2).coerceAtLeast(240)
            val density = metrics.densityDpi.coerceAtLeast(160)

            val reader = ImageReader.newInstance(capWidth, capHeight, PixelFormat.RGBA_8888, 2)
            imageReader = reader

            val minFrameIntervalMs = (1000L / reqFps.toLong()).coerceAtLeast(16L)
            var lastFrameTimeMs = 0L
            var reusableBitmap: Bitmap? = null
            var croppedBitmap: Bitmap? = null
            val jpegOut = ByteArrayOutputStream(96 * 1024)

            reader.setOnImageAvailableListener({ r ->
                val img = try {
                    r.acquireLatestImage()
                } catch (_: Throwable) {
                    null
                } ?: return@setOnImageAvailableListener

                try {
                    val now = System.currentTimeMillis()
                    if (!isCapturing.get() || frameInFlight.get() || (now - lastFrameTimeMs) < minFrameIntervalMs) {
                        return@setOnImageAvailableListener
                    }

                    val planes = img.planes
                    if (planes.isEmpty()) return@setOnImageAvailableListener
                    val buffer = planes[0].buffer ?: return@setOnImageAvailableListener
                    val pixelStride = planes[0].pixelStride
                    val rowStride = planes[0].rowStride
                    val rowPadding = rowStride - pixelStride * capWidth
                    val bitmapStrideWidth = capWidth + (if (pixelStride > 0) rowPadding / pixelStride else 0)

                    if (reusableBitmap == null || reusableBitmap?.width != bitmapStrideWidth || reusableBitmap?.height != capHeight) {
                        reusableBitmap?.recycle()
                        reusableBitmap = Bitmap.createBitmap(bitmapStrideWidth, capHeight, Bitmap.Config.ARGB_8888)
                    }

                    buffer.rewind()
                    reusableBitmap!!.copyPixelsFromBuffer(buffer)

                    val finalBmp = if (bitmapStrideWidth != capWidth) {
                        croppedBitmap?.recycle()
                        croppedBitmap = Bitmap.createBitmap(reusableBitmap!!, 0, 0, capWidth, capHeight)
                        croppedBitmap!!
                    } else {
                        reusableBitmap!!
                    }

                    jpegOut.reset()
                    finalBmp.compress(Bitmap.CompressFormat.JPEG, 76, jpegOut)
                    val b64 = Base64.encodeToString(jpegOut.toByteArray(), Base64.NO_WRAP)

                    lastFrameTimeMs = now
                    frameInFlight.set(true)
                    MainActivity.deliverFrameToJs(b64, capWidth, capHeight)
                } catch (_: Throwable) {
                    frameInFlight.set(false)
                } finally {
                    try {
                        img.close()
                    } catch (_: Throwable) {}
                }
            }, handler)

            virtualDisplay = projection.createVirtualDisplay(
                "DisCrabVirtualDisplay",
                capWidth,
                capHeight,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null,
                handler
            )

            if (includeAudio) {
                startAudioCaptureLoop(projection)
            }

            MainActivity.notifyCaptureStarted(capWidth, capHeight, reqFps)
        } catch (t: Throwable) {
            MainActivity.notifyCaptureError("Falha ao iniciar captura no Android: \${t.message}")
            stopCaptureInternal()
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun startAudioCaptureLoop(projection: MediaProjection) {
        audioRunning.set(true)
        val t = Thread({
            val sampleRate = 48000
            val channelConfig = AudioFormat.CHANNEL_IN_STEREO
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT
            // Bloco de 20ms @ 48kHz Estéreo 16-bit = 960 frames * 2 canais * 2 bytes = 3840 bytes
            val chunkBytesSize = 960 * 2 * 2
            val minBufSize = maxOf(
                AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat),
                chunkBytesSize * 4
            )

            var recorder: AudioRecord? = null

            // 1. Tenta capturar o áudio interno do sistema/jogo via AudioPlaybackCapture (Android 10+ / Quest Horizon OS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    val playbackConfig = AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                        .build()

                    val candidate = AudioRecord.Builder()
                        .setAudioFormat(
                            AudioFormat.Builder()
                                .setEncoding(audioFormat)
                                .setSampleRate(sampleRate)
                                .setChannelMask(channelConfig)
                                .build()
                        )
                        .setBufferSizeInBytes(minBufSize)
                        .setAudioPlaybackCaptureConfig(playbackConfig)
                        .build()

                    if (candidate.state == AudioRecord.STATE_INITIALIZED) {
                        recorder = candidate
                    } else {
                        candidate.release()
                    }
                } catch (_: Throwable) {
                    recorder = null
                }
            }

            // 2. Fallback automático para o microfone caso o dispositivo bloqueie áudio interno
            if (recorder == null) {
                try {
                    val micCandidate = AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        sampleRate,
                        channelConfig,
                        audioFormat,
                        minBufSize
                    )
                    if (micCandidate.state == AudioRecord.STATE_INITIALIZED) {
                        recorder = micCandidate
                    } else {
                        micCandidate.release()
                    }
                } catch (_: Throwable) {
                    recorder = null
                }
            }

            if (recorder == null) return@Thread
            audioRecord = recorder

            try {
                recorder.startRecording()
                val buf = ByteArray(chunkBytesSize)
                while (audioRunning.get() && isCapturing.get()) {
                    var offset = 0
                    while (offset < chunkBytesSize && audioRunning.get()) {
                        val read = recorder.read(buf, offset, chunkBytesSize - offset)
                        if (read > 0) {
                            offset += read
                        } else {
                            break
                        }
                    }
                    if (offset > 0 && isCapturing.get()) {
                        val payload = if (offset == chunkBytesSize) buf else buf.copyOf(offset)
                        val b64 = Base64.encodeToString(payload, Base64.NO_WRAP)
                        MainActivity.deliverAudioChunkToJs(b64, 16, 2, sampleRate)
                    }
                }
            } catch (_: Throwable) {
            } finally {
                try {
                    recorder.stop()
                } catch (_: Throwable) {}
                try {
                    recorder.release()
                } catch (_: Throwable) {}
                audioRecord = null
            }
        }, "DisCrabAndroidAudioThread")
        t.priority = Thread.MAX_PRIORITY
        t.start()
        audioThread = t
    }

    private fun startForegroundNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel(
                CHANNEL_ID,
                "DisCrab Transmissão de Tela",
                NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(chan)
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle("DisCrab Live Ativa")
            .setContentText("Compartilhando tela e áudio na sala...")
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopCaptureResourcesOnly() {
        audioRunning.set(false)
        try {
            audioThread?.join(250)
        } catch (_: Throwable) {}
        audioThread = null

        try {
            virtualDisplay?.release()
        } catch (_: Throwable) {}
        virtualDisplay = null

        try {
            imageReader?.close()
        } catch (_: Throwable) {}
        imageReader = null

        try {
            mediaProjection?.stop()
        } catch (_: Throwable) {}
        mediaProjection = null

        try {
            imageThread?.quitSafely()
        } catch (_: Throwable) {}
        imageThread = null
        imageHandler = null
    }

    fun stopCaptureInternal() {
        val wasRunning = isCapturing.getAndSet(false)
        frameInFlight.set(false)
        stopCaptureResourcesOnly()
        if (wasRunning) {
            MainActivity.notifyCaptureStopped()
        }
        try {
            stopForeground(true)
        } catch (_: Throwable) {}
        try {
            stopSelf()
        } catch (_: Throwable) {}
    }

    override fun onDestroy() {
        stopCaptureInternal()
        if (activeInstance === this) {
            activeInstance = null
        }
        super.onDestroy()
    }
}
`;

  fs.writeFileSync(screenCaptureServicePath, screenCaptureServiceCode, 'utf-8');
  console.log('[setup-android-native] ScreenCaptureService.kt gerado com sucesso.');

  // Verifica se WryActivity.kt possui open fun onWebViewCreate(webView: WebView)
  const wryActivityPath = findFileRecursive(javaSrcRoot, 'WryActivity.kt');
  const hasOnWebViewCreate =
    wryActivityPath &&
    fs.existsSync(wryActivityPath) &&
    /open\s+fun\s+onWebViewCreate\s*\(\s*webView\s*:\s*WebView\s*\)/.test(
      fs.readFileSync(wryActivityPath, 'utf-8')
    );

  const onWebViewCreateOverride = hasOnWebViewCreate
    ? `
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        attachBridgeToWebView(webView, false)
    }
`
    : '';

  const mainActivityCode = `package ${packageName}

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {

    companion object {
        private const val REQ_MEDIA_PROJECTION = 10042
        private const val REQ_AUDIO_PERMISSION_FOR_SCREEN = 10043
        private const val REQ_CAM_AND_MIC_PERMISSION = 10044

        private var activeWebViewRef: WeakReference<WebView>? = null
        private val mainHandler = Handler(Looper.getMainLooper())

        fun evalJsOnMain(script: String) {
            mainHandler.post {
                val wv = activeWebViewRef?.get() ?: return@post
                try {
                    wv.evaluateJavascript(script, null)
                } catch (_: Throwable) {}
            }
        }

        fun deliverFrameToJs(b64Jpeg: String, width: Int, height: Int) {
            evalJsOnMain("window.__onAndroidScreenFrame && window.__onAndroidScreenFrame('$b64Jpeg', $width, $height);")
        }

        fun deliverAudioChunkToJs(b64Pcm: String, bitsPerSample: Int, channels: Int, sampleRate: Int) {
            evalJsOnMain("window.__onAndroidNativeAudioChunk && window.__onAndroidNativeAudioChunk('$b64Pcm', $bitsPerSample, $channels, $sampleRate);")
        }

        fun notifyCaptureStarted(width: Int, height: Int, fps: Int) {
            evalJsOnMain("window.__onAndroidScreenCaptureStarted && window.__onAndroidScreenCaptureStarted($width, $height, $fps);")
        }

        fun notifyCaptureStopped() {
            evalJsOnMain("window.__onAndroidScreenCaptureStopped && window.__onAndroidScreenCaptureStopped();")
        }

        fun notifyCaptureError(msg: String) {
            val safe = msg.replace("'", "\\\\'")
            evalJsOnMain("window.__onAndroidScreenCaptureError && window.__onAndroidScreenCaptureError('$safe');")
        }
    }

    private var pendingWidth = 1280
    private var pendingHeight = 720
    private var pendingFps = 30
    private var pendingIncludeAudio = true
    private var bridgeAttached = false
    private var reloadChecked = false
${onWebViewCreateOverride}
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        scheduleWebViewBridgeAttach()
    }

    override fun onResume() {
        super.onResume()
        scheduleWebViewBridgeAttach()
    }

    private fun attachBridgeToWebView(wv: WebView, checkReloadIfNeeded: Boolean) {
        activeWebViewRef = WeakReference(wv)
        if (!bridgeAttached) {
            bridgeAttached = true
            try {
                wv.settings.javaScriptEnabled = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                wv.settings.domStorageEnabled = true
                wv.settings.databaseEnabled = true
                
                // Concede automaticamente permissões de câmera e microfone solicitadas por WebRTC / getUserMedia na WebView
                wv.webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                        runOnUiThread {
                            try {
                                request.grant(request.resources)
                            } catch (_: Throwable) {}
                        }
                    }
                }

                val bridge = DisCrabAndroidBridge(this)
                wv.addJavascriptInterface(bridge, "DisCrabAndroidBridge")

                val isQuest = bridge.isQuestDevice()
                val injectScript = "window.__DISCRAB_ANDROID_BRIDGE_READY__ = true; window.__IS_META_QUEST__ = $isQuest; window.dispatchEvent(new CustomEvent('discrab-android-bridge-ready', { detail: { isQuest: $isQuest } }));"
                wv.evaluateJavascript(injectScript, null)
            } catch (_: Throwable) {}
        }
        if (checkReloadIfNeeded && !reloadChecked && wv.url != null) {
            reloadChecked = true
            mainHandler.postDelayed({
                try {
                    val bridge = DisCrabAndroidBridge(this)
                    val isQuest = bridge.isQuestDevice()
                    val injectScript = "window.__DISCRAB_ANDROID_BRIDGE_READY__ = true; window.__IS_META_QUEST__ = $isQuest; window.dispatchEvent(new CustomEvent('discrab-android-bridge-ready', { detail: { isQuest: $isQuest } }));"
                    wv.evaluateJavascript(injectScript, null)
                    wv.evaluateJavascript("typeof window.DisCrabAndroidBridge === 'undefined'") { res ->
                        if (res == "true") {
                            wv.reload()
                        }
                    }
                } catch (_: Throwable) {}
            }, 250L)
        }
    }

    private fun scheduleWebViewBridgeAttach(attempt: Int = 0) {
        mainHandler.postDelayed({
            val wv = findWebView(window?.decorView)
            if (wv != null) {
                attachBridgeToWebView(wv, true)
            } else if (attempt < 40) {
                scheduleWebViewBridgeAttach(attempt + 1)
            }
        }, if (attempt == 0) 50L else 150L)
    }

    private fun findWebView(view: View?): WebView? {
        if (view == null) return null
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findWebView(view.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }

    fun startProjectionFlowOnUi(width: Int, height: Int, fps: Int, includeAudio: Boolean) {
        mainHandler.post {
            pendingWidth = width
            pendingHeight = height
            pendingFps = fps
            pendingIncludeAudio = includeAudio

            val permsNeeded = mutableListOf<String>()
            if (includeAudio && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                permsNeeded.add(Manifest.permission.RECORD_AUDIO)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                permsNeeded.add(Manifest.permission.CAMERA)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                permsNeeded.add(Manifest.permission.POST_NOTIFICATIONS)
            }

            if (permsNeeded.isNotEmpty()) {
                ActivityCompat.requestPermissions(
                    this,
                    permsNeeded.toTypedArray(),
                    REQ_AUDIO_PERMISSION_FOR_SCREEN
                )
            } else {
                launchMediaProjectionDialog()
            }
        }
    }

    private fun launchMediaProjectionDialog() {
        try {
            val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            @Suppress("DEPRECATION")
            startActivityForResult(mgr.createScreenCaptureIntent(), REQ_MEDIA_PROJECTION)
        } catch (t: Throwable) {
            notifyCaptureError("Erro ao abrir seletor de tela do Android: \${t.message}")
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO_PERMISSION_FOR_SCREEN) {
            launchMediaProjectionDialog()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_MEDIA_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                val svcIntent = Intent(this, ScreenCaptureService::class.java).apply {
                    putExtra("action", "start")
                    putExtra("resultCode", resultCode)
                    putExtra("resultData", data)
                    putExtra("width", pendingWidth)
                    putExtra("height", pendingHeight)
                    putExtra("fps", pendingFps)
                    putExtra("includeAudio", pendingIncludeAudio)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(svcIntent)
                } else {
                    startService(svcIntent)
                }
            } else {
                notifyCaptureError("A gravação de tela precisa ser aceita no popup de permissão do sistema do Meta Quest ou Android.")
            }
        }
    }

    inner class DisCrabAndroidBridge(private val activity: MainActivity) {

        @JavascriptInterface
        fun startScreenCapture(width: Int, height: Int, fps: Int, includeAudio: Boolean) {
            activity.startProjectionFlowOnUi(width, height, fps, includeAudio)
        }

        @JavascriptInterface
        fun stopScreenCapture() {
            ScreenCaptureService.stopActiveCapture()
        }

        @JavascriptInterface
        fun ackFrame() {
            ScreenCaptureService.frameInFlight.set(false)
        }

        @JavascriptInterface
        fun requestCameraAndMicPermissions() {
            mainHandler.post {
                val perms = mutableListOf(
                    Manifest.permission.CAMERA,
                    Manifest.permission.RECORD_AUDIO,
                    "horizonos.permission.HEADSET_CAMERA",
                    "oculus.permission.HEADSET_CAMERA"
                )
                ActivityCompat.requestPermissions(
                    activity,
                    perms.toTypedArray(),
                    REQ_CAM_AND_MIC_PERMISSION
                )
            }
        }

        @JavascriptInterface
        fun isQuestDevice(): Boolean {
            val man = (Build.MANUFACTURER ?: "").lowercase()
            val model = (Build.MODEL ?: "").lowercase()
            val device = (Build.DEVICE ?: "").lowercase()
            val product = (Build.PRODUCT ?: "").lowercase()
            val hardware = (Build.HARDWARE ?: "").lowercase()
            val board = (Build.BOARD ?: "").lowercase()
            val brand = (Build.BRAND ?: "").lowercase()
            val fingerprint = (Build.FINGERPRINT ?: "").lowercase()
            return man.contains("meta") ||
                man.contains("oculus") ||
                brand.contains("meta") ||
                brand.contains("oculus") ||
                model.contains("quest") ||
                model.contains("miramar") ||
                model.contains("pacific") ||
                device.contains("eureka") ||
                device.contains("panther") ||
                device.contains("hollywood") ||
                device.contains("seacliff") ||
                hardware.contains("eureka") ||
                hardware.contains("hollywood") ||
                hardware.contains("seacliff") ||
                board.contains("eureka") ||
                fingerprint.contains("quest") ||
                fingerprint.contains("oculus") ||
                product.contains("quest")
        }

        @JavascriptInterface
        fun getDeviceModel(): String {
            return "\${Build.MANUFACTURER} \${Build.MODEL} (\${Build.DEVICE})"
        }
    }
}
`;

  fs.writeFileSync(mainActivityPath, mainActivityCode, 'utf-8');
  console.log('[setup-android-native] MainActivity.kt atualizado com ponte DisCrabAndroidBridge e MediaProjection.');
} else {
  console.warn('[setup-android-native] MainActivity.kt não encontrado em src-tauri/gen/android.');
}
