use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon_rgba_64.bin");

    #[cfg(windows)]
    ensure_windows_rc();

    let windows = tauri_build::WindowsAttributes::new()
        .static_vc_runtime(true)
        .window_icon_path(Path::new("icons/icon.ico"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);

    if let Err(e) = tauri_build::try_build(attrs) {
        eprintln!("cargo:warning=[StreamCompanion] Build attributes warning: {}", e);
        tauri_build::build();
    }
}

#[cfg(windows)]
fn ensure_windows_rc() {
    if std::env::var("RC").is_ok() || std::env::var("RC_x86_64_pc_windows_msvc").is_ok() {
        return;
    }

    if is_command_in_path("rc.exe") {
        return;
    }

    if let Some(rc_path) = find_real_rc_exe() {
        let rc_str = rc_path.to_string_lossy().to_string();
        std::env::set_var("RC", &rc_str);
        std::env::set_var("RC_x86_64_pc_windows_msvc", &rc_str);

        if let Some(parent) = rc_path.parent() {
            if let Ok(cur_path) = std::env::var("PATH") {
                std::env::set_var("PATH", format!("{};{}", parent.display(), cur_path));
            }
        }
        println!(
            "cargo:warning=[StreamCompanion] RC.EXE localizado com sucesso: {}",
            rc_str
        );
        return;
    }

    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string());
    let out_path = PathBuf::from(&out_dir);

    if let Some(stub_exe) = compile_rc_stub_exe(&out_path) {
        let stub_str = stub_exe.to_string_lossy().to_string();
        std::env::set_var("RC", &stub_str);
        std::env::set_var("RC_x86_64_pc_windows_msvc", &stub_str);
        println!(
            "cargo:warning=[StreamCompanion] Compilador de recursos stub com embutidor de ICO ativo: {}",
            stub_str
        );
    }
}

#[cfg(windows)]
fn compile_rc_stub_exe(out_dir: &Path) -> Option<PathBuf> {
    let stub_rs = out_dir.join("rc_stub_v2.rs");
    let stub_exe = out_dir.join("rc_stub_v2.exe");

    if stub_exe.is_file() {
        return Some(stub_exe);
    }

    // Compilador de recursos nativo que embute o icons/icon.ico diretamente no arquivo .res (RT_ICON + RT_GROUP_ICON)
    let code = r#"
use std::path::PathBuf;

fn append_res_record(buf: &mut Vec<u8>, res_type: u16, res_id: u16, data: &[u8]) {
    let data_size = data.len() as u32;
    let header_size: u32 = 32;
    buf.extend_from_slice(&data_size.to_le_bytes());
    buf.extend_from_slice(&header_size.to_le_bytes());
    // Type ordinal: 0xFFFF seguido de u16
    buf.extend_from_slice(&0xFFFFu16.to_le_bytes());
    buf.extend_from_slice(&res_type.to_le_bytes());
    // Name ordinal: 0xFFFF seguido de u16
    buf.extend_from_slice(&0xFFFFu16.to_le_bytes());
    buf.extend_from_slice(&res_id.to_le_bytes());
    // DataVersion (4), MemoryFlags (2), LanguageId (2), Version (4), Characteristics (4)
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(&0x1030u16.to_le_bytes());
    buf.extend_from_slice(&0x0409u16.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(data);
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn build_res_from_ico(ico_bytes: &[u8]) -> Option<Vec<u8>> {
    if ico_bytes.len() < 22 {
        return None;
    }
    let count = u16::from_le_bytes([ico_bytes[4], ico_bytes[5]]) as usize;
    if count == 0 || ico_bytes.len() < 6 + count * 16 {
        return None;
    }

    let mut res = vec![
        0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    let mut grp_data = Vec::with_capacity(6 + count * 14);
    grp_data.extend_from_slice(&ico_bytes[0..6]);

    for i in 0..count {
        let entry_off = 6 + i * 16;
        let entry = &ico_bytes[entry_off..entry_off + 16];
        let size = u32::from_le_bytes([entry[8], entry[9], entry[10], entry[11]]) as usize;
        let offset = u32::from_le_bytes([entry[12], entry[13], entry[14], entry[15]]) as usize;
        if offset + size > ico_bytes.len() {
            return None;
        }
        let icon_id = (i + 1) as u16;
        // RT_ICON = 3
        append_res_record(&mut res, 3, icon_id, &ico_bytes[offset..offset + size]);

        // GRPICONDIRENTRY (12 bytes de cabeçalho + 2 bytes de nID)
        grp_data.extend_from_slice(&entry[0..12]);
        grp_data.extend_from_slice(&icon_id.to_le_bytes());
    }

    // RT_GROUP_ICON = 14 (ID 1 e ID 32512 padrão do tauri-winres)
    append_res_record(&mut res, 14, 1, &grp_data);
    append_res_record(&mut res, 14, 32512, &grp_data);

    Some(res)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut out_file = None;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "/fo" || args[i] == "-fo" {
            if i + 1 < args.len() {
                out_file = Some(args[i + 1].clone());
                i += 1;
            }
        } else if args[i].starts_with("/fo") || args[i].starts_with("-fo") {
            out_file = Some(args[i][3..].trim_start_matches(':').to_string());
        }
        i += 1;
    }

    if let Some(f) = out_file {
        let ico_candidates = [
            PathBuf::from("icons/icon.ico"),
            PathBuf::from("src-tauri/icons/icon.ico"),
            PathBuf::from("../src-tauri/icons/icon.ico"),
        ];
        for cand in &ico_candidates {
            if let Ok(bytes) = std::fs::read(cand) {
                if let Some(res_bytes) = build_res_from_ico(&bytes) {
                    let _ = std::fs::write(&f, &res_bytes);
                    return;
                }
            }
        }

        let empty_res: [u8; 32] = [
            0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00,
            0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let _ = std::fs::write(f, &empty_res);
    }
}
"#;

    if std::fs::write(&stub_rs, code).is_err() {
        return None;
    }

    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let status = std::process::Command::new(rustc)
        .arg(&stub_rs)
        .arg("-o")
        .arg(&stub_exe)
        .status();

    if let Ok(s) = status {
        if s.success() && stub_exe.is_file() {
            return Some(stub_exe);
        }
    }

    None
}

#[cfg(windows)]
fn is_command_in_path(cmd: &str) -> bool {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.join(cmd).is_file() {
                return true;
            }
        }
    }
    false
}

#[cfg(windows)]
fn find_real_rc_exe() -> Option<PathBuf> {
    let program_files_x86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());

    let mut candidates = vec![
        format!(r"{}\Windows Kits\10\bin", program_files_x86),
        format!(r"{}\Windows Kits\10\bin", program_files),
        format!(r"{}\Windows Kits\8.1\bin", program_files_x86),
        format!(r"{}\Microsoft Visual Studio\2022", program_files),
        format!(r"{}\Microsoft Visual Studio\2019", program_files_x86),
    ];

    for drive in &["C", "D", "E", "F"] {
        candidates.push(format!(r"{}:\Program Files (x86)\Windows Kits\10\bin", drive));
        candidates.push(format!(r"{}:\Program Files\Windows Kits\10\bin", drive));
        candidates.push(format!(r"{}:\Windows Kits\10\bin", drive));
        candidates.push(format!(r"{}:\Microsoft Visual Studio\2022", drive));
    }

    for root_dir in &candidates {
        let path = Path::new(root_dir);
        if !path.is_dir() {
            continue;
        }

        if root_dir.contains("Windows Kits") {
            if let Ok(entries) = std::fs::read_dir(path) {
                let mut version_dirs: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_dir()
                            && p.file_name()
                                .map_or(false, |n| n.to_string_lossy().starts_with("10."))
                    })
                    .collect();

                version_dirs.sort();
                version_dirs.reverse();

                for vdir in version_dirs {
                    let rc_x64 = vdir.join("x64").join("rc.exe");
                    if rc_x64.is_file() {
                        return Some(rc_x64);
                    }
                    let rc_x86 = vdir.join("x86").join("rc.exe");
                    if rc_x86.is_file() {
                        return Some(rc_x86);
                    }
                }
            }
        } else if let Some(rc) = find_rc_recursive(path, 4) {
            return Some(rc);
        }
    }

    None
}

#[cfg(windows)]
fn find_rc_recursive(dir: &Path, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    if name.eq_ignore_ascii_case("rc.exe") {
                        return Some(path);
                    }
                }
            } else if path.is_dir() {
                if let Some(found) = find_rc_recursive(&path, depth - 1) {
                    return Some(found);
                }
            }
        }
    }
    None
}
