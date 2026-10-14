import { WindowItem, RoomDetails } from '../types';

// Utilitário para codificar em Base64 URL-Safe sem padding '='
export function encodeRoomCodeUrlSafe(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Utilitário para decodificar Base64 URL-Safe
export function decodeRoomCodeUrlSafe(code: string): { wsUrl: string; token: string } {
  let base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const decoded = atob(base64);
  const parts = decoded.split(':');
  
  if (parts.length === 2) {
    // Cloudflare tunnel: subdominio:token
    return {
      wsUrl: `wss://${parts[0]}.trycloudflare.com`,
      token: parts[1],
    };
  } else if (parts.length === 3) {
    // LAN: ip:porta:token
    return {
      wsUrl: `ws://${parts[0]}:${parts[1]}`,
      token: parts[2],
    };
  }
  throw new Error('Formato de Código de Sala inválido. Verifique se copiou o código completo.');
}

// Verifica se está rodando dentro do Tauri v2 nativo
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Chama comando nativo do Tauri ou lança erro se não estiver no ambiente nativo
export async function invokeTauri<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  if (isTauriEnvironment()) {
    const tauri = (window as any).__TAURI__;
    const invokeFn = tauri?.core?.invoke || tauri?.invoke;
    if (typeof invokeFn === 'function') {
      try {
        return await invokeFn(cmd, args);
      } catch (err: any) {
        throw new Error(`Falha no comando nativo '${cmd}': ${err?.message || err}`);
      }
    }
  }
  throw new Error(
    `O recurso '${cmd}' requer execução dentro do executável desktop compilado (StreamCompanion.exe). O ambiente web não possui acesso direto à API Win32/WASAPI.`
  );
}

// Busca as janelas reais do Windows usando Win32 EnumWindows via Rust
export async function fetchSystemWindows(): Promise<WindowItem[]> {
  return await invokeTauri<WindowItem[]>('list_windows');
}

// Cria a sala real no Rust com WebSocket local e Cloudflare Quick Tunnel
export async function createNativeRoom(
  hostNickname: string,
  useCloudflare: boolean
): Promise<{ room_code: string; token: string; mode: string; public_url?: string; local_port: number; local_ip: string }> {
  return await invokeTauri('create_room', {
    hostNickname,
    useCloudflare,
  });
}

// Inicia captura isolada WASAPI por PID
export async function startNativeProcessAudio(pid: number): Promise<void> {
  return await invokeTauri('start_process_audio', { pid });
}

// Para captura isolada WASAPI
export async function stopNativeProcessAudio(): Promise<void> {
  return await invokeTauri('stop_process_audio');
}
