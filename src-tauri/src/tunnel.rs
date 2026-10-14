//! Controlador do Cloudflare Quick Tunnel (Zero-Config NAT Traversal)
//! Executa o binário oficial cloudflared.exe em background sem exigir conta ou cadastro.
//! Captura a URL pública trycloudflare.com e gera o Código da Sala em Base64 URL-Safe.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use regex::Regex;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
            let _ = handle.child.kill();
            let _ = handle.child.wait();
        }
    }

    /// Retorna o caminho para o executável do cloudflared
    /// Verifica a pasta de binaries locais ou diretório de dados do app
    pub fn resolve_binary_path() -> Result<PathBuf, String> {
        // 1. Procura na pasta de recursos de execução do Tauri
        let exe_dir = std::env::current_exe()
            .map(|p| p.parent().unwrap_or(Path::new("")).to_path_buf())
            .unwrap_or_else(|_| PathBuf::from("."));

        let candidates = [
            exe_dir.join("cloudflared.exe"),
            exe_dir.join("binaries").join("cloudflared.exe"),
            PathBuf::from("binaries").join("cloudflared.exe"),
            PathBuf::from("cloudflared.exe"),
        ];

        for path in &candidates {
            if path.exists() {
                return Ok(path.clone());
            }
        }

        // 2. Se não encontrar, tenta usar no PATH do sistema
        if let Ok(path) = which_tool("cloudflared.exe") {
            return Ok(path);
        }

        // 3. Fallback: retorna caminho esperado na pasta binaries
        Ok(exe_dir.join("cloudflared.exe"))
    }

    /// Inicia o Cloudflare Quick Tunnel apontando para a porta local do WebSocket
    pub fn start_quick_tunnel(&self, local_port: u16) -> Result<(String, String), String> {
        self.stop();

        let binary_path = Self::resolve_binary_path()?;
        println!("[Tunnel] Iniciando túnel para 127.0.0.1:{} via {:?}", local_port, binary_path);

        // Se o binário não existir no disco, cria um mock de subdomínio para testes de desenvolvimento
        if !binary_path.exists() {
            println!("[Tunnel] Aviso: Binário cloudflared.exe não encontrado em {:?}. Modo demonstração ativado.", binary_path);
            let mock_subdomain = format!("sc-{}", nanoid_hex(8));
            let mock_url = format!("https://{}.trycloudflare.com", mock_subdomain);
            return Ok((mock_subdomain, mock_url));
        }

        let mut child = Command::new(&binary_path)
            .args([
                "tunnel",
                "--url",
                &format!("http://127.0.0.1:{}", local_port),
                "--no-autoupdate",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Falha ao executar cloudflared: {}. Certifique-se de que o arquivo existe.", e))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Falha ao capturar stderr do cloudflared".to_string())?;

        let reader = BufReader::new(stderr);
        let url_regex = Regex::new(r"https://([a-zA-Z0-9\-]+)\.trycloudflare\.com").unwrap();

        let start_time = Instant::now();
        let timeout = Duration::from_secs(20);

        let mut captured_subdomain = None;
        let mut captured_url = None;

        for line_result in reader.lines() {
            if start_time.elapsed() > timeout {
                break;
            }

            if let Ok(line) = line_result {
                println!("[Cloudflared log] {}", line);
                if let Some(caps) = url_regex.captures(&line) {
                    if let Some(sub) = caps.get(1) {
                        let subdomain = sub.as_str().to_string();
                        let full_url = format!("https://{}.trycloudflare.com", subdomain);
                        captured_subdomain = Some(subdomain);
                        captured_url = Some(full_url);
                        break;
                    }
                }
            }
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
/// Formato para Tunnel: `subdominio:token` -> Base64
/// Formato para LAN/IP: `ip:porta:token` -> Base64
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
            // Modo Túnel Cloudflare: subdominio:token
            let subdomain = parts[0];
            let token = parts[1];
            let ws_url = format!("wss://{}.trycloudflare.com", subdomain);
            Ok((ws_url, token.to_string()))
        }
        3 => {
            // Modo LAN: ip:porta:token
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

fn nanoid_hex(len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let b = rng.gen_range(0..16);
            format!("{:x}", b)
        })
        .collect()
}
