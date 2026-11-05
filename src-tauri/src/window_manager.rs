//! Módulo de Gerenciamento de Janelas e Processos do Windows (Win32)
//! Lista todas as janelas ativas com PID, título e executável para compartilhamento isolado.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
    pub process_name: String,
}

#[cfg(windows)]
pub fn enumerate_windows() -> Vec<WindowInfo> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    let mut windows_list: Vec<WindowInfo> = Vec::new();

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<WindowInfo>);

        // 1. Deve ser visível
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        // 2. Não deve ser ferramenta auxiliar oculta
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if (ex_style & (WS_EX_TOOLWINDOW.0 as i32)) != 0 {
            return BOOL(1);
        }

        // 3. Ignorar janelas cloaked do DWM (UWP suspensas ou janelas virtuais)
        let mut cloaked: u32 = 0;
        let cloaked_ptr = &mut cloaked as *mut u32 as *mut _;
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            cloaked_ptr,
            std::mem::size_of::<u32>() as u32,
        );
        if hr.is_ok() && cloaked != 0 {
            return BOOL(1);
        }

        // 4. Obter título da janela
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return BOOL(1);
        }

        let mut title_buf = vec![0u16; (len + 1) as usize];
        let copied = GetWindowTextW(hwnd, &mut title_buf);
        if copied == 0 {
            return BOOL(1);
        }

        let title = String::from_utf16_lossy(&title_buf[..copied as usize])
            .trim()
            .to_string();

        // Ignorar títulos irrelevantes do sistema
        if title.is_empty()
            || title == "Program Manager"
            || title == "Settings"
            || title == "Windows Input Experience"
        {
            return BOOL(1);
        }

        // 5. Obter Process ID (PID)
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if pid == 0 {
            return BOOL(1);
        }

        // 6. Obter nome do executável do processo
        let mut process_name = "desconhecido.exe".to_string();
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut name_buf = vec![0u16; 512];
            let len = GetProcessImageFileNameW(handle, &mut name_buf);
            if len > 0 {
                let full_path = OsString::from_wide(&name_buf[..len as usize]);
                if let Some(path_str) = full_path.to_str() {
                    if let Some(filename) = path_str.split('\\').last() {
                        process_name = filename.to_string();
                    }
                }
            }
        }

        list.push(WindowInfo {
            hwnd: hwnd.0 as isize,
            pid,
            title,
            process_name,
        });

        BOOL(1)
    }

    unsafe {
        let ptr = &mut windows_list as *mut Vec<WindowInfo>;
        let _ = EnumWindows(Some(enum_proc), LPARAM(ptr as isize));
    }

    // Ordena alfabeticamente por título
    windows_list.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    windows_list
}

/// Garante que a janela frameless (decorations: false) sempre mantenha os estilos Win32
/// `WS_SYSMENU` e `WS_MINIMIZEBOX` para que o clique na Barra de Tarefas e o Alt+Tab (SC_RESTORE)
/// nunca travem a janela minimizada no Windows.
#[cfg(windows)]
pub fn ensure_win32_restorable_styles(raw_hwnd: isize, allow_resize: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_STYLE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
        WS_THICKFRAME,
    };

    if raw_hwnd == 0 {
        return;
    }

    unsafe {
        let hwnd = HWND(raw_hwnd as *mut _);
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let mut new_style = style | WS_SYSMENU.0 | WS_MINIMIZEBOX.0;
        if allow_resize {
            new_style |= WS_MAXIMIZEBOX.0 | WS_THICKFRAME.0;
        }
        if new_style != style {
            let _ = SetWindowLongW(hwnd, GWL_STYLE, new_style as i32);
        }
    }
}

#[cfg(not(windows))]
pub fn ensure_win32_restorable_styles(_raw_hwnd: isize, _allow_resize: bool) {}

/// Verifica diretamente na API Win32 se a janela está minimizada (IsIconic)
#[cfg(windows)]
pub fn is_window_iconic_win32(raw_hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsIconic;

    if raw_hwnd == 0 {
        return false;
    }
    unsafe { IsIconic(HWND(raw_hwnd as *mut _)).as_bool() }
}

#[cfg(not(windows))]
pub fn is_window_iconic_win32(_raw_hwnd: isize) -> bool {
    false
}

/// Se a janela recebeu foco via Alt+Tab / Barra de Tarefas mas ainda consta como Iconic,
/// força `ShowWindow(SW_RESTORE)`. Além disso, retorna `true` caso a janela esteja fora da tela
/// (ex: presa nas coordenadas -32000,-32000 de minimização ou com tamanho zerado) para que seja centralizada.
#[cfg(windows)]
pub fn force_restore_and_check_offscreen_win32(raw_hwnd: isize, force_unminimize: bool) -> bool {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    if raw_hwnd == 0 {
        return false;
    }

    unsafe {
        let hwnd = HWND(raw_hwnd as *mut _);
        if IsIconic(hwnd).as_bool() {
            if force_unminimize {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            } else {
                return false;
            }
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if rect.left <= -10000 || rect.top <= -10000 || width < 220 || height < 220 {
                return true;
            }
        }
    }
    false
}

#[cfg(not(windows))]
pub fn force_restore_and_check_offscreen_win32(_raw_hwnd: isize, _force_unminimize: bool) -> bool {
    false
}

/// Otimiza o processo do DisCrab e seus subprocessos para manter 60 FPS cravados mesmo quando
/// um Jogo em Tela Cheia (Fullscreen Exclusive / Borderless) ou Vídeo em Tela Cheia estiver em primeiro plano:
/// 1. Eleva a prioridade do processo para `ABOVE_NORMAL_PRIORITY_CLASS`.
/// 2. Desativa o EcoQoS / Efficiency Mode do Windows 10/11 (`PROCESS_POWER_THROTTLING_EXECUTION_SPEED` e `IGNORE_TIMER_RESOLUTION`).
/// 3. Solicita resolução de timer de 1ms no kernel (`timeBeginPeriod(1)`) para evitar que o agendador caia para 15.6ms (~15-20 FPS).
#[cfg(windows)]
pub fn optimize_process_for_fullscreen_streaming() {
    use windows::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetPriorityClass, SetProcessInformation,
        ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };

    #[link(name = "winmm")]
    extern "system" {
        fn timeBeginPeriod(uPeriod: u32) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(esFlags: u32) -> u32;
    }

    const PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION_FLAG: u32 = 0x4;
    const ES_CONTINUOUS_FLAG: u32 = 0x80000000;
    const ES_SYSTEM_REQUIRED_FLAG: u32 = 0x00000001;
    const ES_DISPLAY_REQUIRED_FLAG: u32 = 0x00000002;

    unsafe {
        let _ = timeBeginPeriod(1);

        let proc = GetCurrentProcess();
        let _ = SetPriorityClass(proc, ABOVE_NORMAL_PRIORITY_CLASS);

        // Desativa completamente o Power Throttling (EcoQoS) e o relaxamento de timer em background
        let power_state = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION_FLAG,
            StateMask: 0,
        };
        let _ = SetProcessInformation(
            proc,
            ProcessPowerThrottling,
            &power_state as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );

        let _ = SetThreadExecutionState(
            ES_CONTINUOUS_FLAG | ES_SYSTEM_REQUIRED_FLAG | ES_DISPLAY_REQUIRED_FLAG,
        );
    }
}

#[cfg(not(windows))]
pub fn optimize_process_for_fullscreen_streaming() {}

/// Remove qualquer estilo `WS_EX_LAYERED` residual que versões anteriores possam ter deixado
/// preso em janelas de navegadores (Chrome, Edge, Brave, Opera, Firefox).
/// Isso restaura imediatamente o Hardware Flip nativo de 60 FPS em tela cheia e corrige o visual
/// DirectComposition do player da Crunchyroll/Disney+.
#[cfg(windows)]
pub fn heal_layered_browser_windows() {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, IsWindow, SetLayeredWindowAttributes, SetWindowLongW, SetWindowPos,
        GWL_EXSTYLE, LWA_ALPHA, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_NOZORDER, WS_EX_LAYERED,
    };

    let all_wins = enumerate_windows();
    for w in &all_wins {
        let proc_lower = w.process_name.to_lowercase();
        let is_browser = proc_lower.contains("chrome")
            || proc_lower.contains("msedge")
            || proc_lower.contains("brave")
            || proc_lower.contains("opera")
            || proc_lower.contains("vivaldi")
            || proc_lower.contains("firefox");

        if is_browser {
            unsafe {
                let hwnd = HWND(w.hwnd as *mut _);
                if IsWindow(hwnd).as_bool() {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                    if (ex_style & WS_EX_LAYERED.0) != 0 {
                        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
                        let _ = SetWindowLongW(
                            hwnd,
                            GWL_EXSTYLE,
                            (ex_style & !WS_EX_LAYERED.0) as i32,
                        );
                        let _ = SetWindowPos(
                            hwnd,
                            HWND(std::ptr::null_mut()),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE
                                | SWP_NOSIZE
                                | SWP_NOZORDER
                                | SWP_NOACTIVATE
                                | SWP_FRAMECHANGED,
                        );
                    }
                }
            }
        }
    }
}

#[cfg(not(windows))]
pub fn heal_layered_browser_windows() {}

/// Motor Nativo Anti-Tela Preta de Segunda Geração (Zero Gambiarra / Sem Mexer no Mouse / 60 FPS em Tela Cheia).
///
/// Como funciona:
/// - NUNCA move o cursor do mouse (`SetCursorPos` removido) e NUNCA injeta `WS_EX_LAYERED` na janela do navegador/jogo
///   (o que antes derrubava o FPS de tela cheia para 15–20 FPS e quebrava o DirectComposition da Crunchyroll).
/// - Em vez disso, mantém um micro-pino Win32 próprio de `2x2` pixels, 100% invisível ao olho humano (`alpha = 1/255`),
///   totalmente click-through (`WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST`), posicionado
///   no canto do monitor/janela alvo.
/// - Como existe uma superfície Topmost Layered de 2x2px sobreposta ao monitor atualizando sua composição no DWM,
///   o Windows Desktop Window Manager (DWM) fica impedido de promover vídeos em tela cheia (Disney+, Crunchyroll, Netflix)
///   para um plano de Hardware Overlay (MPO Independent Flip) invisível ao capturador, mantendo 60 FPS cravados!
pub struct AntiBlackScreenKeeper {
    enabled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    target_hwnd: std::sync::Arc<std::sync::atomic::AtomicIsize>,
}

impl AntiBlackScreenKeeper {
    pub fn new() -> Self {
        Self {
            enabled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            target_hwnd: std::sync::Arc::new(std::sync::atomic::AtomicIsize::new(0)),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn set_mode(&self, active: bool, specific_hwnd: isize) {
        heal_layered_browser_windows();
        self.target_hwnd
            .store(specific_hwnd, std::sync::atomic::Ordering::SeqCst);

        let was_enabled = self
            .enabled
            .swap(active, std::sync::atomic::Ordering::SeqCst);

        if !active {
            return;
        }

        if !was_enabled {
            let enabled_flag = self.enabled.clone();
            let target_hwnd_ref = self.target_hwnd.clone();

            std::thread::spawn(move || {
                #[cfg(windows)]
                {
                    use windows::Win32::Foundation::{COLORREF, HWND, RECT};
                    use windows::Win32::Graphics::Dwm::{
                        DwmFlush, DwmSetWindowAttribute, DWMWINDOWATTRIBUTE,
                    };
                    use windows::Win32::UI::WindowsAndMessaging::{
                        CreateWindowExW, DestroyWindow, DispatchMessageW, GetWindowRect, IsWindow,
                        PeekMessageW, SetLayeredWindowAttributes, SetWindowPos, ShowWindow,
                        TranslateMessage, HMENU, HWND_TOPMOST, LWA_ALPHA, MSG, PM_REMOVE,
                        SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WS_EX_LAYERED,
                        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
                        WS_POPUP,
                    };

                    #[link(name = "kernel32")]
                    extern "system" {
                        fn SetThreadExecutionState(esFlags: u32) -> u32;
                    }

                    const ES_CONTINUOUS_FLAG: u32 = 0x80000000;
                    const ES_SYSTEM_REQUIRED_FLAG: u32 = 0x00000001;
                    const ES_DISPLAY_REQUIRED_FLAG: u32 = 0x00000002;

                    optimize_process_for_fullscreen_streaming();

                    unsafe {
                        // Cria o pino DWM invisível de 2x2 pixels (click-through, sem foco, sem ícone na barra)
                        let pin_hwnd = CreateWindowExW(
                            WS_EX_TOPMOST
                                | WS_EX_TRANSPARENT
                                | WS_EX_LAYERED
                                | WS_EX_TOOLWINDOW
                                | WS_EX_NOACTIVATE,
                            windows_core::w!("STATIC"),
                            windows_core::w!("DisCrabDwmMpoBlockerPin"),
                            WS_POPUP,
                            8,
                            8,
                            2,
                            2,
                            HWND(std::ptr::null_mut()),
                            HMENU(std::ptr::null_mut()),
                            None,
                            None,
                        )
                        .unwrap_or(HWND(std::ptr::null_mut()));

                        if !pin_hwnd.0.is_null() {
                            // Exclui da captura WGC se suportado, mantendo apenas o bloqueio de promoção MPO no DWM
                            let _ = SetLayeredWindowAttributes(pin_hwnd, COLORREF(0), 1, LWA_ALPHA);
                            let _ = ShowWindow(pin_hwnd, SW_SHOWNOACTIVATE);
                        }

                        let mut alpha_toggle: u8 = 1;
                        let mut msg = MSG::default();

                        while enabled_flag.load(std::sync::atomic::Ordering::SeqCst) {
                            while PeekMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0, PM_REMOVE)
                                .as_bool()
                            {
                                let _ = TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                            }

                            let _ = SetThreadExecutionState(
                                ES_CONTINUOUS_FLAG
                                    | ES_SYSTEM_REQUIRED_FLAG
                                    | ES_DISPLAY_REQUIRED_FLAG,
                            );

                            let current_target =
                                target_hwnd_ref.load(std::sync::atomic::Ordering::SeqCst);

                            let mut pin_x = 8;
                            let mut pin_y = 8;

                            if current_target != 0 {
                                let target = HWND(current_target as *mut _);
                                if IsWindow(target).as_bool() {
                                    // Garante que o DWM nunca suspenda o buffer de captura da janela alvo
                                    let disable_iconic: i32 = 0;
                                    // DWMWA_FORCE_ICONIC_REPRESENTATION = 7
                                    let _ = DwmSetWindowAttribute(
                                        target,
                                        DWMWINDOWATTRIBUTE(7),
                                        &disable_iconic as *const _ as *const _,
                                        std::mem::size_of::<i32>() as u32,
                                    );

                                    let mut rect = RECT::default();
                                    if GetWindowRect(target, &mut rect).is_ok() {
                                        if rect.right > rect.left + 20 && rect.bottom > rect.top + 20
                                        {
                                            pin_x = rect.right - 6;
                                            pin_y = rect.bottom - 6;
                                        }
                                    }
                                }
                            }

                            if !pin_hwnd.0.is_null() && IsWindow(pin_hwnd).as_bool() {
                                alpha_toggle = if alpha_toggle == 1 { 2 } else { 1 };
                                let _ = SetLayeredWindowAttributes(
                                    pin_hwnd,
                                    COLORREF(0),
                                    alpha_toggle,
                                    LWA_ALPHA,
                                );
                                let _ = SetWindowPos(
                                    pin_hwnd,
                                    HWND_TOPMOST,
                                    pin_x,
                                    pin_y,
                                    2,
                                    2,
                                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                );
                            }

                            let _ = DwmFlush();

                            for _ in 0..4 {
                                if !enabled_flag.load(std::sync::atomic::Ordering::SeqCst) {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(60));
                            }
                        }

                        if !pin_hwnd.0.is_null() && IsWindow(pin_hwnd).as_bool() {
                            let _ = DestroyWindow(pin_hwnd);
                        }
                    }
                }
            });
        }
    }
}

/// Abre uma janela dedicada do navegador instalado (Chrome, Edge, Brave, Opera ou Vivaldi)
/// pré-configurada com flags que desativam DirectComposition Video Overlays, Hardware DRM MPO
/// e Occlusion Throttling. Isso resolve 100% da tela preta na Crunchyroll, Disney+, Netflix e Prime Video
/// tanto em captura de Janela quanto em Tela Cheia, mantendo logins salvos em `%LOCALAPPDATA%\DisCrab\StreamingBrowserProfile`.
#[cfg(windows)]
pub fn launch_browser_with_streaming_flags(target_url: Option<String>) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;

    heal_layered_browser_windows();

    let url = target_url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "https://www.crunchyroll.com".to_string());

    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Temp".to_string());
    let prog_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
    let prog_files_x86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

    let candidates: Vec<(&str, PathBuf)> = vec![
        (
            "Google Chrome",
            PathBuf::from(&prog_files).join("Google\\Chrome\\Application\\chrome.exe"),
        ),
        (
            "Google Chrome",
            PathBuf::from(&prog_files_x86).join("Google\\Chrome\\Application\\chrome.exe"),
        ),
        (
            "Google Chrome",
            PathBuf::from(&local_app_data).join("Google\\Chrome\\Application\\chrome.exe"),
        ),
        (
            "Brave",
            PathBuf::from(&prog_files)
                .join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        ),
        (
            "Brave",
            PathBuf::from(&prog_files_x86)
                .join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        ),
        (
            "Brave",
            PathBuf::from(&local_app_data)
                .join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        ),
        (
            "Microsoft Edge",
            PathBuf::from(&prog_files_x86).join("Microsoft\\Edge\\Application\\msedge.exe"),
        ),
        (
            "Microsoft Edge",
            PathBuf::from(&prog_files).join("Microsoft\\Edge\\Application\\msedge.exe"),
        ),
        (
            "Opera GX",
            PathBuf::from(&local_app_data).join("Programs\\Opera GX\\opera.exe"),
        ),
        (
            "Opera",
            PathBuf::from(&local_app_data).join("Programs\\Opera\\opera.exe"),
        ),
        (
            "Vivaldi",
            PathBuf::from(&local_app_data).join("Vivaldi\\Application\\vivaldi.exe"),
        ),
    ];

    let found = candidates.into_iter().find(|(_, path)| path.exists());
    let (browser_name, browser_exe) = found.ok_or_else(|| {
        "Nenhum navegador compatível (Chrome, Brave, Edge, Opera ou Vivaldi) foi encontrado no caminho padrão.".to_string()
    })?;

    let profile_dir = PathBuf::from(&local_app_data)
        .join("DisCrab")
        .join("StreamingBrowserProfile");
    let _ = std::fs::create_dir_all(&profile_dir);

    // Garante que o Local State do perfil de streaming desative o modo de aceleração de overlay DRM
    // que causa tela preta na Crunchyroll, Disney+ e Netflix em captura de janela/tela cheia
    let local_state_path = profile_dir.join("Local State");
    if !local_state_path.exists() {
        let initial_state = r#"{"hardware_acceleration_mode":{"enabled":false},"background_mode":{"enabled":false}}"#;
        let _ = std::fs::write(&local_state_path, initial_state);
    } else if let Ok(existing) = std::fs::read_to_string(&local_state_path) {
        if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&existing) {
            if let Some(obj) = json_val.as_object_mut() {
                obj.insert(
                    "hardware_acceleration_mode".to_string(),
                    serde_json::json!({ "enabled": false }),
                );
                if let Ok(serialized) = serde_json::to_string(&json_val) {
                    let _ = std::fs::write(&local_state_path, serialized);
                }
            }
        }
    }

    let user_data_arg = format!("--user-data-dir={}", profile_dir.to_string_lossy());

    const DETACHED_PROCESS: u32 = 0x00000008;
    std::process::Command::new(&browser_exe)
        .args([
            &user_data_arg,
            "--new-window",
            "--disable-direct-composition-video-overlays",
            "--disable-gpu-driver-bug-workarounds",
            "--disable-features=DirectCompositionVideoOverlays,UseMultiPlaneFormatForHardwareVideo,MediaFoundationClearPlayback,MediaFoundationD3D11VideoCapture,CalculateNativeWinOcclusion,UseEcoQoSForBackgroundProcess",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-frame-rate-limit",
            "--autoplay-policy=no-user-gesture-required",
            &url,
        ])
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map_err(|e| format!("Falha ao abrir {}: {}", browser_name, e))?;

    Ok(browser_name.to_string())
}

#[cfg(not(windows))]
pub fn launch_browser_with_streaming_flags(target_url: Option<String>) -> Result<String, String> {
    let _ = target_url;
    Ok("Navegador Padrão".to_string())
}

#[cfg(not(windows))]
pub fn enumerate_windows() -> Vec<WindowInfo> {
    // Fallback de desenvolvimento para teste fora de Windows
    vec![
        WindowInfo {
            hwnd: 1001,
            pid: 4120,
            title: "Counter-Strike 2".to_string(),
            process_name: "cs2.exe".to_string(),
        },
        WindowInfo {
            hwnd: 1002,
            pid: 8840,
            title: "Cyberpunk 2077".to_string(),
            process_name: "Cyberpunk2077.exe".to_string(),
        },
        WindowInfo {
            hwnd: 1003,
            pid: 14200,
            title: "Spotify Free".to_string(),
            process_name: "Spotify.exe".to_string(),
        },
        WindowInfo {
            hwnd: 1004,
            pid: 6290,
            title: "Discord".to_string(),
            process_name: "Discord.exe".to_string(),
        },
    ]
}
