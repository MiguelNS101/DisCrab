//! Atualizador Embutido (Self-Updater via GitHub Releases para Windows .exe e Android .apk)
//! No Windows: baixa o novo .exe com progresso em tempo real, substitui o executável em execução e reinicia.
//! No Android: localiza o .apk na Release do GitHub, faz o download com barra de progresso para a pasta Download
//! e aciona o instalador do sistema Android.

use crate::tunnel::{CloudflaredStatus, TunnelManager};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSystemInfo {
    pub current_version: String,
    pub exe_path: String,
    pub cloudflared: CloudflaredStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_title: String,
    pub release_notes: String,
    pub published_at: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size_mb: f64,
    pub apk_download_url: Option<String>,
    pub apk_asset_name: Option<String>,
    pub apk_size_mb: f64,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressPayload {
    pub stage: String,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub percent: u8,
    pub message: String,
}

/// Ao iniciar o app no Desktop, remove silenciosamente qualquer arquivo `.old.exe` ou `.update.exe`/`.update.tmp`
/// deixado pela atualização anterior.
pub fn cleanup_old_executable() {
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(1200));

        if let Ok(current_exe) = std::env::current_exe() {
            let parent = current_exe.parent().unwrap_or(Path::new("."));
            let stem = current_exe
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("DisCrab");

            let old_exe = parent.join(format!("{}.old.exe", stem));
            let tmp_exe = parent.join(format!("{}.update.tmp", stem));
            let upd_exe = parent.join(format!("{}.update.exe", stem));
            let generic_old = parent.join("StreamCompanion.old.exe");
            let discrab_old = parent.join("DisCrab.old.exe");
            let temp_script = std::env::temp_dir().join("discrab_apply_update.cmd");

            for file in [
                old_exe,
                tmp_exe,
                upd_exe,
                generic_old,
                discrab_old,
                temp_script,
            ] {
                if file.exists() {
                    if std::fs::remove_file(&file).is_ok() {
                        println!("[Updater] Arquivo residual removido com sucesso: {:?}", file);
                    }
                }
            }
        }
    });
}

/// Retorna informações da versão atual do executável e status do cloudflared em %LOCALAPPDATA%
pub fn get_system_info() -> AppSystemInfo {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let exe_path = if cfg!(target_os = "android") {
        "Pacote Android Nativo (.apk)".to_string()
    } else {
        std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Desconhecido".to_string())
    };
    let cloudflared = TunnelManager::get_binary_status();

    AppSystemInfo {
        current_version,
        exe_path,
        cloudflared,
    }
}

pub const FIXED_GITHUB_REPO: &str = "MiguelNS101/StreamCompanion";

/// Normaliza "https://github.com/usuario/repo" ou "usuario/repo" para "usuario/repo"
pub fn normalize_github_repo(input: &str) -> Result<String, String> {
    let trimmed = input
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");

    if trimmed.is_empty() {
        return Ok(FIXED_GITHUB_REPO.to_string());
    }

    let cleaned = if let Some(idx) = trimmed.find("github.com/") {
        &trimmed[idx + "github.com/".len()..]
    } else {
        trimmed
    };

    let parts: Vec<&str> = cleaned.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Ok(FIXED_GITHUB_REPO.to_string());
    }

    Ok(format!("{}/{}", parts[0], parts[1]))
}

/// Compara duas versões semânticas (ex: "1.0.0" vs "v1.1.0")
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let clean_cur = current.trim().trim_start_matches(['v', 'V']);
    let clean_lat = latest.trim().trim_start_matches(['v', 'V']);

    if clean_cur == clean_lat {
        return false;
    }

    let parse_parts = |s: &str| -> Vec<u32> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .filter_map(|p| p.parse::<u32>().ok())
            .collect()
    };

    let cur_parts = parse_parts(clean_cur);
    let lat_parts = parse_parts(clean_lat);

    let max_len = std::cmp::max(cur_parts.len(), lat_parts.len());
    for i in 0..max_len {
        let c = *cur_parts.get(i).unwrap_or(&0);
        let l = *lat_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        } else if l < c {
            return false;
        }
    }

    clean_lat != clean_cur
}

/// Realiza a troca atômica do executável atual (funciona tanto para modo Portable quanto modo Instalado em %LOCALAPPDATA%).
/// Caso o diretório exija elevação UAC (ex: C:\Program Files) ou o arquivo esteja com lock, retorna `false`
/// mantendo o executável original intacto para que o script pós-encerramento faça a substituição.
pub fn apply_atomic_exe_swap(
    current_exe: &Path,
    temp_update_path: &Path,
    backup_old_path: &Path,
) -> bool {
    let _ = std::fs::remove_file(backup_old_path);
    if std::fs::rename(current_exe, backup_old_path).is_ok() {
        if std::fs::rename(temp_update_path, current_exe).is_ok() {
            return true;
        }
        if std::fs::copy(temp_update_path, current_exe).is_ok() {
            let _ = std::fs::remove_file(temp_update_path);
            return true;
        }
        // Rollback seguro para nunca deixar o usuário sem executável
        let _ = std::fs::rename(backup_old_path, current_exe);
    }
    false
}

/// Gera o script .cmd de atualização pós-encerramento do Windows compatível com:
/// 1. Modo Portable (DisCrab-Portable.exe em qualquer pasta do usuário)
/// 2. Modo Instalável por Usuário (NSIS em %LOCALAPPDATA%\Programs\DisCrab\DisCrab.exe)
/// 3. Modo Instalável Global (MSI / NSIS em C:\Program Files\DisCrab\DisCrab.exe com fallback UAC RunAs)
/// 4. Pacotes Instaladores NSIS diretos (*-setup.exe com flag silenciosa /S + reinicialização)
pub fn build_windows_update_script(
    old_pid: u32,
    temp_update_str: &str,
    current_exe_str: &str,
    backup_old_str: &str,
    exe_dir_str: &str,
    is_installer_setup: bool,
) -> String {
    if is_installer_setup {
        format!(
            "@echo off\r\n\
             chcp 65001 >nul 2>&1\r\n\
             set /a WAIT_COUNT=0\r\n\
             :wait_pid\r\n\
             tasklist /FI \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n\
             if \"%ERRORLEVEL%\"==\"0\" (\r\n\
               set /a WAIT_COUNT+=1\r\n\
               if %WAIT_COUNT% LSS 15 (\r\n\
                 ping 127.0.0.1 -n 2 >nul\r\n\
                 goto wait_pid\r\n\
               ) else (\r\n\
                 taskkill /F /PID {pid} >nul 2>&1\r\n\
                 ping 127.0.0.1 -n 2 >nul\r\n\
               )\r\n\
             )\r\n\
             \"{tmp}\" /S\r\n\
             if exist \"{tmp}\" del /F /Q \"{tmp}\" >nul 2>&1\r\n\
             if exist \"{dst}\" start \"\" /D \"{dir}\" \"{dst}\"\r\n\
             del /F /Q \"%~f0\" >nul 2>&1\r\n",
            pid = old_pid,
            tmp = temp_update_str,
            dst = current_exe_str,
            dir = exe_dir_str
        )
    } else {
        format!(
            "@echo off\r\n\
             chcp 65001 >nul 2>&1\r\n\
             set /a WAIT_COUNT=0\r\n\
             :wait_pid\r\n\
             tasklist /FI \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n\
             if \"%ERRORLEVEL%\"==\"0\" (\r\n\
               set /a WAIT_COUNT+=1\r\n\
               if %WAIT_COUNT% LSS 15 (\r\n\
                 ping 127.0.0.1 -n 2 >nul\r\n\
                 goto wait_pid\r\n\
               ) else (\r\n\
                 taskkill /F /PID {pid} >nul 2>&1\r\n\
                 ping 127.0.0.1 -n 2 >nul\r\n\
               )\r\n\
             )\r\n\
             set /a TRY_COUNT=0\r\n\
             :replace_loop\r\n\
             if not exist \"{tmp}\" goto replace_done\r\n\
             move /Y \"{tmp}\" \"{dst}\" >nul 2>&1\r\n\
             if not exist \"{tmp}\" goto replace_done\r\n\
             copy /Y /B \"{tmp}\" \"{dst}\" >nul 2>&1\r\n\
             if \"%ERRORLEVEL%\"==\"0\" (\r\n\
               del /F /Q \"{tmp}\" >nul 2>&1\r\n\
               goto replace_done\r\n\
             )\r\n\
             set /a TRY_COUNT+=1\r\n\
             if %TRY_COUNT% LSS 6 (\r\n\
               ping 127.0.0.1 -n 2 >nul\r\n\
               goto replace_loop\r\n\
             )\r\n\
             if exist \"{tmp}\" (\r\n\
               powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command \"Start-Process cmd.exe -ArgumentList '/c move /Y \\\"{tmp}\\\" \\\"{dst}\\\" || (copy /Y /B \\\"{tmp}\\\" \\\"{dst}\\\" && del /F /Q \\\"{tmp}\\\")' -Verb RunAs -WindowStyle Hidden -Wait\" >nul 2>&1\r\n\
             )\r\n\
             :replace_done\r\n\
             if exist \"{old}\" del /F /Q \"{old}\" >nul 2>&1\r\n\
             start \"\" /D \"{dir}\" \"{dst}\"\r\n\
             del /F /Q \"%~f0\" >nul 2>&1\r\n",
            pid = old_pid,
            tmp = temp_update_str,
            dst = current_exe_str,
            old = backup_old_str,
            dir = exe_dir_str
        )
    }
}

/// Consulta a última Release publicada no GitHub Releases (extraindo tanto o .exe quanto o .apk)
pub async fn check_github_release(repo_input: &str) -> Result<UpdateCheckResult, String> {
    let repo = normalize_github_repo(repo_input)?;
    let api_url = format!("https://api.github.com/repos/{}/releases/latest", repo);

    let client = reqwest::Client::builder()
        .user_agent("DisCrab-AutoUpdater/2.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let resp = client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar GitHub ({}): {}", repo, e))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!(
            "Nenhuma Release encontrada em '{}' (ou o repositório ainda não possui Releases publicadas).",
            repo
        ));
    }

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API retornou status {}: verifique o repositório '{}'.",
            resp.status(),
            repo
        ));
    }

    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Erro ao ler resposta do GitHub: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("JSON inválido retornado pelo GitHub: {}", e))?;

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let tag_name = json["tag_name"]
        .as_str()
        .unwrap_or(&current_version)
        .to_string();
    let release_title = json["name"]
        .as_str()
        .unwrap_or(&tag_name)
        .to_string();
    let release_notes = json["body"]
        .as_str()
        .unwrap_or("Sem notas de atualização detalhadas.")
        .to_string();
    let published_at = json["published_at"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let html_url = json["html_url"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let mut exe_download_url: Option<String> = None;
    let mut exe_asset_name: Option<String> = None;
    let mut exe_size_mb: f64 = 0.0;
    let mut exe_is_portable: bool = false;

    let mut apk_download_url: Option<String> = None;
    let mut apk_asset_name: Option<String> = None;
    let mut apk_size_mb: f64 = 0.0;

    if let Some(assets) = json["assets"].as_array() {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            let lower = name.to_lowercase();
            let size_bytes = asset["size"].as_u64().unwrap_or(0);
            let size_mb = ((size_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

            if lower.ends_with(".exe") && !lower.contains("cloudflared") {
                // Prioriza sempre o executável standalone (DisCrab-Portable.exe) sobre instaladores NSIS (*-setup.exe)
                let is_portable_candidate = lower.contains("portable")
                    || (!lower.contains("setup") && !lower.contains("install"));

                if exe_download_url.is_none() || (is_portable_candidate && !exe_is_portable) {
                    exe_download_url =
                        asset["browser_download_url"].as_str().map(|s| s.to_string());
                    exe_asset_name = Some(name.to_string());
                    exe_size_mb = size_mb;
                    exe_is_portable = is_portable_candidate;
                }
            }

            if apk_download_url.is_none() && lower.ends_with(".apk") {
                apk_download_url = asset["browser_download_url"].as_str().map(|s| s.to_string());
                apk_asset_name = Some(name.to_string());
                apk_size_mb = size_mb;
            }
        }
    }

    let (download_url, asset_name, asset_size_mb) = if cfg!(target_os = "android") {
        (
            apk_download_url.clone().or(exe_download_url),
            apk_asset_name.clone().or(exe_asset_name),
            if apk_size_mb > 0.0 {
                apk_size_mb
            } else {
                exe_size_mb
            },
        )
    } else {
        (
            exe_download_url.or_else(|| apk_download_url.clone()),
            exe_asset_name.or_else(|| apk_asset_name.clone()),
            if exe_size_mb > 0.0 {
                exe_size_mb
            } else {
                apk_size_mb
            },
        )
    };

    let has_update = is_newer_version(&current_version, &tag_name);

    Ok(UpdateCheckResult {
        current_version,
        latest_version: tag_name,
        has_update,
        release_title,
        release_notes,
        published_at,
        download_url,
        asset_name,
        asset_size_mb,
        apk_download_url,
        apk_asset_name,
        apk_size_mb,
        html_url,
    })
}

/// No Android: faz o download do novo .apk com progresso em tempo real, salva em Download (se disponível)
/// e abre o instalador/navegador do sistema Android para concluir a atualização do APK.
#[cfg(target_os = "android")]
pub async fn download_and_apply_update(
    app: AppHandle,
    download_url: String,
    _tunnel_manager: &TunnelManager,
) -> Result<(), String> {
    let _ = app.emit(
        "update-progress",
        UpdateProgressPayload {
            stage: "connecting".to_string(),
            downloaded_mb: 0.0,
            total_mb: 0.0,
            percent: 5,
            message: "Conectando ao GitHub Releases para baixar o APK...".to_string(),
        },
    );

    let client = reqwest::Client::builder()
        .user_agent("DisCrab-AndroidUpdater/2.0")
        .build()
        .map_err(|e| format!("Falha ao iniciar cliente HTTP no Android: {}", e))?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Falha ao iniciar download do APK: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Servidor retornou erro HTTP {} ao baixar o APK.",
            resp.status()
        ));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let total_mb = ((total_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

    // Tenta gravar uma cópia direta na pasta pública de Downloads do Android se permitido
    let public_download_dir = PathBuf::from("/storage/emulated/0/Download");
    let target_apk_path = if public_download_dir.exists() {
        public_download_dir.join("DisCrab-Android.apk")
    } else {
        std::env::temp_dir().join("DisCrab-Android.apk")
    };

    let mut maybe_file = std::fs::File::create(&target_apk_path).ok();
    let mut downloaded_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut first_chunk_checked = false;
    let mut last_emitted_percent: u8 = 0;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Erro durante download do APK: {}", e))?;

        if !first_chunk_checked && chunk.len() >= 2 {
            first_chunk_checked = true;
            // Verifica assinatura ZIP/APK ('PK')
            if chunk[0] != b'P' || chunk[1] != b'K' {
                return Err(
                    "O arquivo baixado não é um pacote Android válido (.apk).".to_string()
                );
            }
        }

        if let Some(ref mut f) = maybe_file {
            let _ = f.write_all(&chunk);
        }

        downloaded_bytes += chunk.len() as u64;
        let downloaded_mb = ((downloaded_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

        let percent = if total_bytes > 0 {
            std::cmp::min(95, ((downloaded_bytes * 95) / total_bytes) as u8)
        } else {
            60
        };

        if percent >= last_emitted_percent + 3 || downloaded_bytes == total_bytes {
            last_emitted_percent = percent;
            let _ = app.emit(
                "update-progress",
                UpdateProgressPayload {
                    stage: "downloading".to_string(),
                    downloaded_mb,
                    total_mb,
                    percent,
                    message: format!("Baixando APK de atualização ({:.1} MB)...", downloaded_mb),
                },
            );
        }
    }

    if let Some(mut f) = maybe_file {
        let _ = f.flush();
    }

    let _ = app.emit(
        "update-progress",
        UpdateProgressPayload {
            stage: "installing".to_string(),
            downloaded_mb: total_mb,
            total_mb,
            percent: 100,
            message: "Download concluído! Abrindo instalador de pacote do Android...".to_string(),
        },
    );

    // Aciona o sistema Android via tauri_plugin_shell para abrir/instalar o APK
    use tauri_plugin_shell::ShellExt;
    let _ = app.shell().open(&download_url, None);

    Ok(())
}

/// No Desktop (Windows): baixa o novo .exe, substitui o executável atual em execução
/// (compatível tanto com modo Portable quanto modo Instalado NSIS/MSI) e reinicia o aplicativo!
#[cfg(not(target_os = "android"))]
pub async fn download_and_apply_update(
    app: AppHandle,
    download_url: String,
    tunnel_manager: &TunnelManager,
) -> Result<(), String> {
    use std::process::Command;

    let current_exe: PathBuf = std::env::current_exe()
        .map_err(|e| format!("Não foi possível localizar o executável atual: {}", e))?;

    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Diretório do executável inválido.".to_string())?;

    let stem = current_exe
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("DisCrab");

    // Usa extensão .update.exe para que o Windows sempre o reconheça como executável válido em PATHEXT/UAC
    let mut temp_update_path = exe_dir.join(format!("{}.update.exe", stem));
    let backup_old_path = exe_dir.join(format!("{}.old.exe", stem));

    let _ = app.emit(
        "update-progress",
        UpdateProgressPayload {
            stage: "connecting".to_string(),
            downloaded_mb: 0.0,
            total_mb: 0.0,
            percent: 2,
            message: "Conectando ao servidor do GitHub Releases...".to_string(),
        },
    );

    let client = reqwest::Client::builder()
        .user_agent("DisCrab-AutoUpdater/2.0")
        .build()
        .map_err(|e| format!("Falha ao iniciar cliente HTTP: {}", e))?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Falha ao iniciar download da atualização: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Servidor retornou erro HTTP {} ao baixar a atualização.",
            resp.status()
        ));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let total_mb = ((total_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

    let _ = std::fs::remove_file(&temp_update_path);
    let mut file = match std::fs::File::create(&temp_update_path) {
        Ok(f) => f,
        Err(_) => {
            // Fallback para %TEMP% caso o diretório atual exija elevação (ex: C:\Program Files\DisCrab)
            temp_update_path = std::env::temp_dir().join(format!("{}.update.exe", stem));
            let _ = std::fs::remove_file(&temp_update_path);
            std::fs::File::create(&temp_update_path).map_err(|e| {
                format!(
                    "Sem permissão para criar arquivo temporário de atualização: {}",
                    e
                )
            })?
        }
    };

    let mut downloaded_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut first_chunk_checked = false;
    let mut last_emitted_percent: u8 = 0;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Erro durante download da atualização: {}", e))?;

        if !first_chunk_checked && chunk.len() >= 2 {
            first_chunk_checked = true;
            // Verifica assinatura PE 'MZ' de executável Windows
            if chunk[0] != b'M' || chunk[1] != b'Z' {
                let _ = std::fs::remove_file(&temp_update_path);
                return Err(
                    "O arquivo baixado não é um executável Windows válido (.exe). Verifique o link da Release."
                        .to_string(),
                );
            }
        }

        file.write_all(&chunk)
            .map_err(|e| format!("Erro ao gravar dados no disco: {}", e))?;

        downloaded_bytes += chunk.len() as u64;
        let downloaded_mb = ((downloaded_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

        let percent = if total_bytes > 0 {
            std::cmp::min(95, ((downloaded_bytes * 95) / total_bytes) as u8)
        } else {
            50
        };

        if percent >= last_emitted_percent + 2 || downloaded_bytes == total_bytes {
            last_emitted_percent = percent;
            let _ = app.emit(
                "update-progress",
                UpdateProgressPayload {
                    stage: "downloading".to_string(),
                    downloaded_mb,
                    total_mb,
                    percent,
                    message: format!("Baixando novo executável ({:.1} MB)...", downloaded_mb),
                },
            );
        }
    }

    file.flush()
        .map_err(|e| format!("Erro ao finalizar arquivo no disco: {}", e))?;
    drop(file);

    if downloaded_bytes < 512 * 1024 {
        let _ = std::fs::remove_file(&temp_update_path);
        return Err("O arquivo baixado é muito pequeno e parece estar incompleto.".to_string());
    }

    let _ = app.emit(
        "update-progress",
        UpdateProgressPayload {
            stage: "installing".to_string(),
            downloaded_mb: total_mb,
            total_mb,
            percent: 100,
            message: "Aplicando atualização e reiniciando o DisCrab...".to_string(),
        },
    );

    tunnel_manager.stop();
    // Desativa JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE antes de lançar o script e encerrar
    crate::disable_job_kill_on_close();

    let lower_url = download_url.to_lowercase();
    let is_installer_setup =
        lower_url.ends_with("-setup.exe") || lower_url.contains("_setup.exe");

    // Se o executável não for um instalador NSIS, tentamos também a troca atômica imediata
    // (renomeando o atual para .old.exe) ANTES do script auxiliar entrar em ação.
    if !is_installer_setup {
        let _ = apply_atomic_exe_swap(&current_exe, &temp_update_path, &backup_old_path);
    }

    // Cria e executa um script .cmd independente fora do Job Object para aguardar o encerramento
    // completo do processo antigo, garantir a substituição do .exe e reabrir o DisCrab limpo.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;

        let script_path = std::env::temp_dir().join("discrab_apply_update.cmd");
        let current_exe_str = current_exe.to_string_lossy().to_string();
        let exe_dir_str = exe_dir.to_string_lossy().to_string();
        let temp_update_str = temp_update_path.to_string_lossy().to_string();
        let backup_old_str = backup_old_path.to_string_lossy().to_string();
        let old_pid = std::process::id();

        let script_content = build_windows_update_script(
            old_pid,
            &temp_update_str,
            &current_exe_str,
            &backup_old_str,
            &exe_dir_str,
            is_installer_setup,
        );

        let _ = std::fs::write(&script_path, script_content);

        let spawn_breakaway = Command::new("cmd.exe")
            .args(["/C", &script_path.to_string_lossy()])
            .current_dir(exe_dir)
            .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
            .spawn();

        if spawn_breakaway.is_err() {
            let _ = Command::new("cmd.exe")
                .args(["/C", &script_path.to_string_lossy()])
                .current_dir(exe_dir)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new(&current_exe).current_dir(exe_dir).spawn();
    }

    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(250));
        std::process::exit(0);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_version_semantics() {
        assert!(is_newer_version("1.1.2", "v1.1.3"));
        assert!(is_newer_version("1.0.0", "1.1.0"));
        assert!(!is_newer_version("1.1.3", "v1.1.3"));
        assert!(!is_newer_version("1.2.0", "v1.1.9"));
    }

    #[test]
    fn test_atomic_exe_swap_portable_and_installed() {
        let temp_dir = std::env::temp_dir().join(format!("discrab_upd_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let current_exe = temp_dir.join("DisCrab.exe");
        let temp_update = temp_dir.join("DisCrab.update.exe");
        let backup_old = temp_dir.join("DisCrab.old.exe");

        std::fs::write(&current_exe, b"MZ_OLD_VERSION_1_1_2").unwrap();
        std::fs::write(&temp_update, b"MZ_NEW_VERSION_1_1_3").unwrap();

        let swapped = apply_atomic_exe_swap(&current_exe, &temp_update, &backup_old);
        assert!(swapped, "A troca atômica de executável deve ter sucesso");
        assert!(current_exe.exists(), "O novo DisCrab.exe deve existir no caminho original");
        assert!(!temp_update.exists(), "O arquivo temporário .update.exe deve ter sido movido");
        assert!(backup_old.exists(), "O backup .old.exe deve existir até a limpeza");

        let updated_bytes = std::fs::read(&current_exe).unwrap();
        assert_eq!(updated_bytes, b"MZ_NEW_VERSION_1_1_3");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_windows_update_script_supports_portable_and_installed_modes() {
        let portable_script = build_windows_update_script(
            4242,
            "C:\\Users\\User\\AppData\\Local\\Temp\\DisCrab.update.exe",
            "C:\\Program Files\\DisCrab\\DisCrab.exe",
            "C:\\Program Files\\DisCrab\\DisCrab.old.exe",
            "C:\\Program Files\\DisCrab",
            false,
        );
        assert!(portable_script.contains("PID eq 4242"));
        assert!(portable_script.contains(":replace_loop"));
        assert!(portable_script.contains("-Verb RunAs"));
        assert!(portable_script.contains("start \"\" /D \"C:\\Program Files\\DisCrab\" \"C:\\Program Files\\DisCrab\\DisCrab.exe\""));

        let installer_script = build_windows_update_script(
            4242,
            "C:\\Users\\User\\AppData\\Local\\Temp\\DisCrab_1.1.3_x64-setup.update.exe",
            "C:\\Users\\User\\AppData\\Local\\Programs\\DisCrab\\DisCrab.exe",
            "C:\\Users\\User\\AppData\\Local\\Programs\\DisCrab\\DisCrab.old.exe",
            "C:\\Users\\User\\AppData\\Local\\Programs\\DisCrab",
            true,
        );
        assert!(installer_script.contains("/S"));
        assert!(installer_script.contains("start \"\" /D"));
    }
}
