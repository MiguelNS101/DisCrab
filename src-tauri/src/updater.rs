//! Atualizador Embutido (Self-Updater via GitHub Releases)
//! Permite verificar novas Releases no GitHub, baixar o novo .exe com progresso em tempo real,
//! substituir o executável portable em execução (via renomeação atômica NTFS) e reiniciar o app automaticamente.

use crate::tunnel::{CloudflaredStatus, TunnelManager};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
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

/// Ao iniciar o app, remove silenciosamente qualquer arquivo `.old.exe` ou `.update.tmp`
/// deixado pela atualização anterior.
pub fn cleanup_old_executable() {
    std::thread::spawn(|| {
        // Aguarda 1.2s para garantir que o processo antigo já encerrou totalmente
        std::thread::sleep(std::time::Duration::from_millis(1200));

        if let Ok(current_exe) = std::env::current_exe() {
            let parent = current_exe.parent().unwrap_or(Path::new("."));
            let stem = current_exe
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("StreamCompanion");

            let old_exe = parent.join(format!("{}.old.exe", stem));
            let tmp_exe = parent.join(format!("{}.update.tmp", stem));
            let generic_old = parent.join("StreamCompanion.old.exe");

            for file in [old_exe, tmp_exe, generic_old] {
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
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Desconhecido".to_string());
    let cloudflared = TunnelManager::get_binary_status();

    AppSystemInfo {
        current_version,
        exe_path,
        cloudflared,
    }
}

pub const FIXED_GITHUB_REPO: &str = "MiguelNS101/StreamCompanion";

/// Normaliza "https://github.com/usuario/repo" ou "usuario/repo" para "usuario/repo"
fn normalize_github_repo(input: &str) -> Result<String, String> {
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
fn is_newer_version(current: &str, latest: &str) -> bool {
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

    // Se a tag mudou mas não segue semver numérico, considera como nova versão
    clean_lat != clean_cur
}

/// Consulta a última Release publicada no GitHub Releases
pub async fn check_github_release(repo_input: &str) -> Result<UpdateCheckResult, String> {
    let repo = normalize_github_repo(repo_input)?;
    let api_url = format!("https://api.github.com/repos/{}/releases/latest", repo);

    let client = reqwest::Client::builder()
        .user_agent("StreamCompanion-AutoUpdater/2.0")
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
            "Nenhuma Release encontrada em '{}' (ou o repositório é privado/inexistente). Crie uma Release na aba Releases do GitHub anexando o .exe.",
            repo
        ));
    }

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API retornou status {}: verifique o nome do repositório '{}'.",
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

    // Procura o arquivo .exe anexado nos assets da Release (ignorando cloudflared.exe caso esteja junto)
    let mut download_url: Option<String> = None;
    let mut asset_name: Option<String> = None;
    let mut asset_size_mb: f64 = 0.0;

    if let Some(assets) = json["assets"].as_array() {
        // Prioriza executáveis do StreamCompanion (.exe)
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            let lower = name.to_lowercase();
            if lower.ends_with(".exe") && !lower.contains("cloudflared") {
                download_url = asset["browser_download_url"].as_str().map(|s| s.to_string());
                asset_name = Some(name.to_string());
                let size_bytes = asset["size"].as_u64().unwrap_or(0);
                asset_size_mb = ((size_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                break;
            }
        }
    }

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
        html_url,
    })
}

/// Baixa o novo .exe, substitui o executável atual em execução (renomeando o atual para .old.exe)
/// e reinicia o aplicativo automaticamente!
pub async fn download_and_apply_update(
    app: AppHandle,
    download_url: String,
    tunnel_manager: &TunnelManager,
) -> Result<(), String> {
    let current_exe: PathBuf = std::env::current_exe()
        .map_err(|e| format!("Não foi possível localizar o executável atual: {}", e))?;

    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Diretório do executável inválido.".to_string())?;

    let stem = current_exe
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("StreamCompanion");

    let temp_update_path = exe_dir.join(format!("{}.update.tmp", stem));
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
        .user_agent("StreamCompanion-AutoUpdater/2.0")
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
    let mut file = std::fs::File::create(&temp_update_path).map_err(|e| {
        format!(
            "Sem permissão para criar arquivo de atualização na pasta {:?}: {}",
            exe_dir, e
        )
    })?;

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
            percent: 98,
            message: "Substituindo executável e reiniciando o StreamCompanion...".to_string(),
        },
    );

    // Remove backup anterior se existir
    let _ = std::fs::remove_file(&backup_old_path);

    // No Windows NTFS, podemos renomear o próprio .exe em execução para .old.exe!
    std::fs::rename(&current_exe, &backup_old_path).map_err(|e| {
        format!(
            "Falha ao renomear executável atual para backup ({:?}): {}",
            backup_old_path, e
        )
    })?;

    // Move o novo executável para o nome original (ex: StreamCompanion.exe)
    if let Err(e) = std::fs::rename(&temp_update_path, &current_exe) {
        // Rollback imediato caso falhe
        let _ = std::fs::rename(&backup_old_path, &current_exe);
        return Err(format!("Falha ao ativar novo executável: {}", e));
    }

    // Encerra o túnel Cloudflare antes de reiniciar para liberar portas
    tunnel_manager.stop();

    // Inicia a nova versão do StreamCompanion.exe
    let _ = Command::new(&current_exe).spawn();

    // Encerra o processo antigo
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(350));
        std::process::exit(0);
    });

    Ok(())
}
