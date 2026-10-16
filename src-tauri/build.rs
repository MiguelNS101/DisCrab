use std::path::{Path, PathBuf};

fn main() {
    #[cfg(windows)]
    ensure_windows_rc();

    let windows = tauri_build::WindowsAttributes::new().static_vc_runtime(true);
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);

    if let Err(e) = tauri_build::try_build(attrs) {
        eprintln!("cargo:warning=[StreamCompanion] Build attributes warning: {}", e);
        // Fallback direto
        tauri_build::build();
    }
}

#[cfg(windows)]
fn ensure_windows_rc() {
    // 1. Verifica se RC ou RC_$TARGET já foram fornecidos
    if std::env::var("RC").is_ok() || std::env::var("RC_x86_64_pc_windows_msvc").is_ok() {
        return;
    }

    // 2. Verifica se rc.exe já está acessível no PATH
    if is_command_in_path("rc.exe") {
        return;
    }

    // 3. Procura o rc.exe real nas pastas do Windows Kits e Visual Studio em todas as unidades do sistema
    if let Some(rc_path) = find_real_rc_exe() {
        let rc_str = rc_path.to_string_lossy().to_string();
        std::env::set_var("RC", &rc_str);
        std::env::set_var("RC_x86_64_pc_windows_msvc", &rc_str);

        if let Some(parent) = rc_path.parent() {
            if let Ok(cur_path) = std::env::var("PATH") {
                std::env::set_var("PATH", format!("{};{}", parent.display(), cur_path));
            }
        }
        println!("cargo:warning=[StreamCompanion] RC.EXE localizado com sucesso: {}", rc_str);
        return;
    }

    // 4. Fallback Seguro: Compila um executável stub nativo rc_stub.exe via rustc
    // Garante que o tauri-winres gere um .res válido sem falhar ou depender do Windows SDK completo.
    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string());
    let out_path = PathBuf::from(&out_dir);

    if let Some(stub_exe) = compile_rc_stub_exe(&out_path) {
        let stub_str = stub_exe.to_string_lossy().to_string();
        std::env::set_var("RC", &stub_str);
        std::env::set_var("RC_x86_64_pc_windows_msvc", &stub_str);
        println!("cargo:warning=[StreamCompanion] Compilador de recursos stub ativo: {}", stub_str);
    }
}

#[cfg(windows)]
fn compile_rc_stub_exe(out_dir: &Path) -> Option<PathBuf> {
    let stub_rs = out_dir.join("rc_stub.rs");
    let stub_exe = out_dir.join("rc_stub.exe");

    if stub_exe.is_file() {
        return Some(stub_exe);
    }

    let code = r#"
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
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());

    let mut candidates = vec![
        format!(r"{}\Windows Kits\10\bin", program_files_x86),
        format!(r"{}\Windows Kits\10\bin", program_files),
        format!(r"{}\Windows Kits\8.1\bin", program_files_x86),
        format!(r"{}\Microsoft Visual Studio\2022", program_files),
        format!(r"{}\Microsoft Visual Studio\2019", program_files_x86),
    ];

    // Adiciona drives comuns onde o usuário possa ter instalado SDKs ou Visual Studio (ex: F:\)
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

        // Se for uma pasta do Windows Kits, lista as versões (ex: 10.0.22621.0, 10.0.19041.0)
        if root_dir.contains("Windows Kits") {
            if let Ok(entries) = std::fs::read_dir(path) {
                let mut version_dirs: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.is_dir() && p.file_name().map_or(false, |n| n.to_string_lossy().starts_with("10.")))
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
        } else {
            if let Some(rc) = find_rc_recursive(path, 4) {
                return Some(rc);
            }
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
