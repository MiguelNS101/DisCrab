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
  throw new Error('Formato de Código de Sala inválido.');
}

// Verifica se está rodando dentro do Tauri v2 nativo
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Mock inicial de janelas do Windows com PIDs realistas
export const SAMPLE_WINDOWS: WindowItem[] = [
  {
    hwnd: 10420,
    pid: 14820,
    title: 'Counter-Strike 2 - Dust II (Competitivo)',
    process_name: 'cs2.exe',
    category: 'game',
  },
  {
    hwnd: 20188,
    pid: 9240,
    title: 'Cyberpunk 2077: Phantom Liberty',
    process_name: 'Cyberpunk2077.exe',
    category: 'game',
  },
  {
    hwnd: 31054,
    pid: 6108,
    title: 'Elden Ring',
    process_name: 'eldenring.exe',
    category: 'game',
  },
  {
    hwnd: 40992,
    pid: 18450,
    title: 'Discord - #geral [Voz Conectada]',
    process_name: 'Discord.exe',
    category: 'chat',
  },
  {
    hwnd: 51200,
    pid: 4328,
    title: 'Spotify Premium - Synthwave Boy',
    process_name: 'Spotify.exe',
    category: 'media',
  },
  {
    hwnd: 60100,
    pid: 12044,
    title: 'Google Chrome - YouTube 4K',
    process_name: 'chrome.exe',
    category: 'browser',
  },
];
