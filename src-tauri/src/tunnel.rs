//! Controlador do Cloudflare Quick Tunnel (Zero-Config NAT Traversal)
//! Gerencia automaticamente o binário oficial cloudflared.exe em %LOCALAPPDATA%\StreamCompanion\bin
//! para que o usuário não precise manter o cloudflared.exe na mesma pasta do app portable.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflaredStatus {
    pub installed: bool,
    pub path: String,
    pub size_mb: f64,
    pub location_type: String,
}

#[allow(dead_code)]
pub struct TunnelHandle {
    pub child: Child,
    pub subdomain: String,
    pub public_url: String,
    pub local_port: u16,
}

pub struct TunnelManager {
    current_tunnel: Arc<Mutex<Option<TunnelHandle>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            current_tunnel: Arc::new(Mutex::new(None)),
        }
    }

    /// Encerra o túnel ativo se houver
    pub fn stop(&self) {
        let mut lock = self.current_tunnel.lock().unwrap();
        if let Some(mut handle) = lock.take() {
            println!("[Tunnel] Encerrando cloudflared...");
            let pid = handle.child.id();
            let _ = handle.child.kill();
            let _ = handle.child.wait();

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string(), "/T"])
                    .creation_flags(0x08000000)
                    .status();
                let _ = Command::new("taskkill")
                    .args(["/F", "/IM", "cloudflared.exe", "/T"])
                    .creation_flags(0x08000000)
                    .status();
            }
        }
    }

    /// Retorna o diretório dedicado oculto do sistema: %LOCALAPPDATA%\StreamCompanion\bin
    pub fn get_appdata_bin_dir() -> PathBuf {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let dir = PathBuf::from(local_app_data)
                .join("StreamCompanion")
                .join("bin");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            let dir = PathBuf::from(app_data)
                .join("StreamCompanion")
                .join("bin");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
        let fallback = std::env::temp_dir().join("StreamCompanion").join("bin");
        let _ = std::fs::create_dir_all(&fallback);
        fallback
    }

    /// Verifica se um arquivo cloudflared.exe existe e tem tamanho válido (> 5 MB)
    fn is_valid_binary(path: &Path) -> bool {
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.is_file() && meta.len() > 5 * 1024 * 1024;
        }
        false
    }

    /// Retorna o status detalhado do cloudflared.exe para exibição na interface
    pub fn get_binary_status() -> CloudflaredStatus {
        let appdata_path = Self::get_appdata_bin_dir().join("cloudflared.exe");
        if Self::is_valid_binary(&appdata_path) {
            let size_bytes = std::fs::metadata(&appdata_path).map(|m| m.len()).unwrap_or(0);
            let size_mb = ((size_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
            return CloudflaredStatus {
                installed: true,
                path: appdata_path.to_string_lossy().to_string(),
                size_mb,
                location_type: "appdata".to_string(),
            };
        }

        if let Ok(resolved) = Self::resolve_binary_path() {
            if Self::is_valid_binary(&resolved) {
                let size_bytes = std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0);
                let size_mb = ((size_bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                return CloudflaredStatus {
                    installed: true,
                    path: resolved.to_string_lossy().to_string(),
                    size_mb,
                    location_type: "local".to_string(),
                };
            }
        }

        CloudflaredStatus {
            installed: false,
            path: appdata_path.to_string_lossy().to_string(),
            size_mb: 0.0,
            location_type: "appdata".to_string(),
        }
    }

    /// Retorna o caminho para o executável do cloudflared.
    /// Prioriza %LOCALAPPDATA%\StreamCompanion\bin\cloudflared.exe para que o app portable fique limpo.
    /// Se encontrar um cloudflared.exe na pasta do app portable, copia automaticamente para o %LOCALAPPDATA%.
    pub fn resolve_binary_path() -> Result<PathBuf, String> {
        let appdata_bin = Self::get_appdata_bin_dir().join("cloudflared.exe");
        if Self::is_valid_binary(&appdata_bin) {
            return Ok(appdata_bin);
        }

        // Procura na pasta atual do executável caso o usuário já tenha um cloudflared.exe antigo lá
        let exe_dir = std::env::current_exe()
            .map(|p| p.parent().unwrap_or(Path::new("")).to_path_buf())
            .unwrap_or_else(|_| PathBuf::from("."));

        let local_candidates = [
            exe_dir.join("cloudflared.exe"),
            exe_dir.join("binaries").join("cloudflared.exe"),
            PathBuf::from("binaries").join("cloudflared.exe"),
            PathBuf::from("cloudflared.exe"),
        ];

        for candidate in &local_candidates {
            if Self::is_valid_binary(candidate) {
                // Migra uma cópia para %LOCALAPPDATA%\StreamCompanion\bin automaticamente
                if std::fs::copy(candidate, &appdata_bin).is_ok() && Self::is_valid_binary(&appdata_bin) {
                    println!(
                        "[Tunnel] cloudflared.exe copiado automaticamente para {:?}",
                        appdata_bin
                    );
                    return Ok(appdata_bin);
                }
                return Ok(candidate.clone());
            }
        }

        // Tenta localizar no PATH do sistema
        if let Ok(path) = which_tool("cloudflared.exe") {
            if Self::is_valid_binary(&path) {
                return Ok(path);
            }
        }

        // Caminho padrão onde será baixado automaticamente
        Ok(appdata_bin)
    }

    /// Garante que o cloudflared.exe existe em %LOCALAPPDATA%\StreamCompanion\bin\cloudflared.exe (Apenas Windows)
    pub fn ensure_binary_exists() -> Result<PathBuf, String> {
        #[cfg(target_os = "android")]
        {
            return Err("No Android o Cloudflare Tunnel não é utilizado (conecte via Sala Fixa Mesh P2P ou Rede Local Wi-Fi).".to_string());
        }

        #[cfg(not(target_os = "android"))]
        {
            let binary_path = Self::resolve_binary_path()?;
            if Self::is_valid_binary(&binary_path) {
                return Ok(binary_path);
            }

            let target_dir = Self::get_appdata_bin_dir();
            let _ = std::fs::create_dir_all(&target_dir);
            let final_path = target_dir.join("cloudflared.exe");
            let temp_path = target_dir.join("cloudflared.download.tmp");

            println!(
                "[Tunnel] Baixando cloudflared.exe automaticamente para {:?}...",
                final_path
            );

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;

                let download_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
                let temp_str = temp_path.to_string_lossy().to_string();

                let _ = std::fs::remove_file(&temp_path);

                let status = Command::new("curl.exe")
                    .args(["-L", "--fail", "-s", "-o", &temp_str, download_url])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();

                if status.map(|s| s.success()).unwrap_or(false) && Self::is_valid_binary(&temp_path) {
                    let _ = std::fs::remove_file(&final_path);
                    std::fs::rename(&temp_path, &final_path).map_err(|e| {
                        format!("Falha ao mover cloudflared.exe para pasta final: {}", e)
                    })?;
                    println!(
                        "[Tunnel] Download automático do cloudflared.exe concluído em {:?}!",
                        final_path
                    );
                    return Ok(final_path);
                }

                let _ = std::fs::remove_file(&temp_path);
                let ps_script = format!(
                    "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
                    download_url, temp_str
                );
                let status_ps = Command::new("powershell.exe")
                    .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();

                if status_ps.map(|s| s.success()).unwrap_or(false) && Self::is_valid_binary(&temp_path) {
                    let _ = std::fs::remove_file(&final_path);
                    std::fs::rename(&temp_path, &final_path).map_err(|e| {
                        format!("Falha ao salvar cloudflared.exe: {}", e)
                    })?;
                    println!(
                        "[Tunnel] Download do cloudflared.exe concluído via PowerShell em {:?}!",
                        final_path
                    );
                    return Ok(final_path);
                }
            }

            let _ = temp_path;
            if Self::is_valid_binary(&final_path) {
                Ok(final_path)
            } else {
                Err("Não foi possível baixar o cloudflared.exe automaticamente. Verifique sua conexão com a Internet ou use o modo Rede Local (LAN).".to_string())
            }
        }
    }

    /// Inicia o Cloudflare Quick Tunnel apontando para a porta local do WebSocket
    pub fn start_quick_tunnel(&self, local_port: u16) -> Result<(String, String), String> {
        self.stop();

        let binary_path = Self::ensure_binary_exists()?;
        println!(
            "[Tunnel] Iniciando túnel para 127.0.0.1:{} via {:?}",
            local_port, binary_path
        );

        let mut cmd = Command::new(&binary_path);
        cmd.args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{}", local_port),
            "--no-autoupdate",
            "--protocol",
            "http2",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Falha ao executar cloudflared em {:?}: {}",
                binary_path, e
            )
        })?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Falha ao capturar stderr do cloudflared".to_string())?;

        let mut reader = BufReader::new(stderr);
        let url_regex = Regex::new(r"https://([a-zA-Z0-9\-]+)\.trycloudflare\.com").unwrap();

        let start_time = Instant::now();
        let timeout = Duration::from_secs(25);

        let mut captured_subdomain = None;
        let mut captured_url = None;
        let mut url_found_at: Option<Instant> = None;

        for line_result in (&mut reader).lines() {
            if start_time.elapsed() > timeout {
                break;
            }

            if let Ok(line) = line_result {
                println!("[Cloudflared log] {}", line);
                if captured_subdomain.is_none() {
                    if let Some(caps) = url_regex.captures(&line) {
                        if let Some(sub) = caps.get(1) {
                            let subdomain = sub.as_str().to_string();
                            let full_url = format!("https://{}.trycloudflare.com", subdomain);
                            captured_subdomain = Some(subdomain);
                            captured_url = Some(full_url);
                            url_found_at = Some(Instant::now());
                        }
                    }
                } else {
                    // Aguarda o cloudflared confirmar que a conexão do túnel foi registrada na borda da Cloudflare
                    let lower = line.to_lowercase();
                    if lower.contains("registered tunnel connection")
                        || (lower.contains("connection") && lower.contains("registered"))
                    {
                        std::thread::sleep(Duration::from_millis(350));
                        break;
                    }
                    if let Some(found_instant) = url_found_at {
                        if found_instant.elapsed() > Duration::from_secs(4) {
                            break;
                        }
                    }
                }
            }
        }

        if captured_subdomain.is_some() {
            std::thread::spawn(move || {
                for _ in reader.lines() {}
            });
        }

        match (captured_subdomain, captured_url) {
            (Some(subdomain), Some(url)) => {
                let mut lock = self.current_tunnel.lock().unwrap();
                *lock = Some(TunnelHandle {
                    child,
                    subdomain: subdomain.clone(),
                    public_url: url.clone(),
                    local_port,
                });
                Ok((subdomain, url))
            }
            _ => {
                let _ = child.kill();
                Err("Timeout ao obter URL do Cloudflare Tunnel. Verifique sua conexão com a internet.".to_string())
            }
        }
    }
}

/// Codifica o Código da Sala em Base64 URL-Safe limpo (sem padding '=')
pub fn encode_room_code(target: &str, token: &str) -> String {
    let raw = format!("{}:{}", target.trim(), token.trim());
    URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

/// Decodifica o Código da Sala Base64 URL-Safe
/// Retorna `(ws_url, token)`
pub fn decode_room_code(code: &str) -> Result<(String, String), String> {
    let clean_code = code.trim();
    let decoded_bytes = URL_SAFE_NO_PAD
        .decode(clean_code)
        .map_err(|e| format!("Código de sala inválido (Base64 corrompido): {}", e))?;

    let text = String::from_utf8(decoded_bytes)
        .map_err(|e| format!("Texto decodificado inválido: {}", e))?;

    let parts: Vec<&str> = text.split(':').collect();

    match parts.len() {
        2 => {
            let subdomain = parts[0];
            let token = parts[1];
            let ws_url = format!("wss://{}.trycloudflare.com", subdomain);
            Ok((ws_url, token.to_string()))
        }
        3 => {
            let ip = parts[0];
            let port = parts[1];
            let token = parts[2];
            let ws_url = format!("ws://{}:{}", ip, port);
            Ok((ws_url, token.to_string()))
        }
        _ => Err("Formato de Código de Sala desconhecido.".to_string()),
    }
}

fn which_tool(cmd: &str) -> Result<PathBuf, ()> {
    if let Ok(path_var) = std::env::var("PATH") {
        for p in std::env::split_paths(&path_var) {
            let full = p.join(cmd);
            if full.exists() {
                return Ok(full);
            }
        }
    }
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_decode_cloudflare_room_code() {
        let code = encode_room_code("fast-neon-tiger", "9K4P2M");
        let (ws_url, token) = decode_room_code(&code).expect("Deve decodificar código WAN");
        assert_eq!(ws_url, "wss://fast-neon-tiger.trycloudflare.com");
        assert_eq!(token, "9K4P2M");
    }

    #[test]
    fn test_encode_and_decode_lan_room_code() {
        let code = encode_room_code("192.168.1.42:54321", "AB12CD");
        let (ws_url, token) = decode_room_code(&code).expect("Deve decodificar código LAN");
        assert_eq!(ws_url, "ws://192.168.1.42:54321");
        assert_eq!(token, "AB12CD");
    }

    #[test]
    fn test_invalid_room_code_rejected() {
        assert!(decode_room_code("!!!invalido!!!").is_err());
    }
}

