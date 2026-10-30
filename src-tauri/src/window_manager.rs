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

/// Motor Nativo Anti-Tela Preta para Streaming em Navegadores (Disney+, Netflix, Prime Video, Chrome/Edge).
/// Evita que o Windows DWM / DirectComposition promova o vídeo para um plano de Hardware Overlay (MPO)
/// invisível à captura quando o mouse para de se mover:
/// 1. Aplica `WS_EX_LAYERED` com `LWA_ALPHA = 254` (99.6% de opacidade, visualmente idêntico a 100%)
///    nas janelas de navegador, forçando composição via shader D3D11 em vez de recorte MPO preto.
/// 2. Mantém um pulso micro-keepalive de 1px sem deslocamento quando o mouse fica ocioso, impedindo
///    que o player entre em estado de suspensão de overlay.
pub struct AntiBlackScreenKeeper {
    enabled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    target_hwnd: std::sync::Arc<std::sync::atomic::AtomicIsize>,
    patched_hwnds: std::sync::Arc<std::sync::Mutex<Vec<isize>>>,
}

impl AntiBlackScreenKeeper {
    pub fn new() -> Self {
        Self {
            enabled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            target_hwnd: std::sync::Arc::new(std::sync::atomic::AtomicIsize::new(0)),
            patched_hwnds: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn set_mode(&self, active: bool, specific_hwnd: isize) {
        self.target_hwnd
            .store(specific_hwnd, std::sync::atomic::Ordering::SeqCst);

        let was_enabled = self
            .enabled
            .swap(active, std::sync::atomic::Ordering::SeqCst);

        if !active {
            self.restore_patched_windows();
            return;
        }

        if !was_enabled {
            let enabled_flag = self.enabled.clone();
            let target_hwnd_ref = self.target_hwnd.clone();
            let patched_ref = self.patched_hwnds.clone();

            std::thread::spawn(move || {
                #[cfg(windows)]
                {
                    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, POINT, WPARAM};
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetCursorPos, GetWindowLongW, IsWindow, PostMessageW, SetCursorPos,
                        SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
                        WM_MOUSEMOVE, WS_EX_LAYERED,
                    };

                    let mut last_cursor = POINT::default();
                    let _ = unsafe { GetCursorPos(&mut last_cursor) };

                    while enabled_flag.load(std::sync::atomic::Ordering::SeqCst) {
                        let current_target =
                            target_hwnd_ref.load(std::sync::atomic::Ordering::SeqCst);

                        // 1. Aplica composição DWM (WS_EX_LAYERED alpha=254) nas janelas de navegador / alvo
                        let all_wins = enumerate_windows();
                        for w in &all_wins {
                            let proc_lower = w.process_name.to_lowercase();
                            let is_browser = proc_lower.contains("chrome")
                                || proc_lower.contains("msedge")
                                || proc_lower.contains("brave")
                                || proc_lower.contains("opera")
                                || proc_lower.contains("vivaldi")
                                || proc_lower.contains("firefox");

                            if (current_target != 0 && w.hwnd == current_target) || is_browser {
                                unsafe {
                                    let hwnd = HWND(w.hwnd as *mut _);
                                    if IsWindow(hwnd).as_bool() {
                                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                                        if (ex_style & WS_EX_LAYERED.0) == 0 {
                                            let _ = SetWindowLongW(
                                                hwnd,
                                                GWL_EXSTYLE,
                                                (ex_style | WS_EX_LAYERED.0) as i32,
                                            );
                                            let _ = SetLayeredWindowAttributes(
                                                hwnd,
                                                COLORREF(0),
                                                254,
                                                LWA_ALPHA,
                                            );
                                            if let Ok(mut lock) = patched_ref.lock() {
                                                if !lock.contains(&w.hwnd) {
                                                    lock.push(w.hwnd);
                                                }
                                            }
                                        } else {
                                            let _ = SetLayeredWindowAttributes(
                                                hwnd,
                                                COLORREF(0),
                                                254,
                                                LWA_ALPHA,
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        // 2. Verifica se o mouse ficou parado e envia micro-pulso de 1px sem deslocamento
                        // para evitar que o player (Disney+ / navegador) promova o vídeo para Hardware Overlay preto
                        let mut cur_pt = POINT::default();
                        if unsafe { GetCursorPos(&mut cur_pt) }.is_ok() {
                            if cur_pt.x == last_cursor.x && cur_pt.y == last_cursor.y {
                                unsafe {
                                    let _ = SetCursorPos(cur_pt.x + 1, cur_pt.y);
                                    if current_target != 0 {
                                        let hwnd = HWND(current_target as *mut _);
                                        if IsWindow(hwnd).as_bool() {
                                            let lparam = ((150isize & 0xFFFF) << 16) | (150isize & 0xFFFF);
                                            let _ = PostMessageW(
                                                hwnd,
                                                WM_MOUSEMOVE,
                                                WPARAM(0),
                                                LPARAM(lparam),
                                            );
                                        }
                                    }
                                    std::thread::sleep(std::time::Duration::from_millis(14));
                                    let _ = SetCursorPos(cur_pt.x, cur_pt.y);
                                }
                            }
                            let _ = unsafe { GetCursorPos(&mut last_cursor) };
                        }

                        for _ in 0..11 {
                            if !enabled_flag.load(std::sync::atomic::Ordering::SeqCst) {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                }
            });
        }
    }

    pub fn restore_patched_windows(&self) {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::{COLORREF, HWND};
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongW, IsWindow, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE,
                LWA_ALPHA, WS_EX_LAYERED,
            };

            if let Ok(mut lock) = self.patched_hwnds.lock() {
                for raw_hwnd in lock.drain(..) {
                    unsafe {
                        let hwnd = HWND(raw_hwnd as *mut _);
                        if IsWindow(hwnd).as_bool() {
                            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
                            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                            if (ex_style & WS_EX_LAYERED.0) != 0 {
                                let _ = SetWindowLongW(
                                    hwnd,
                                    GWL_EXSTYLE,
                                    (ex_style & !WS_EX_LAYERED.0) as i32,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
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
