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
