export interface WindowItem {
  hwnd: number;
  pid: number;
  title: string;
  process_name: string;
  category: 'game' | 'browser' | 'chat' | 'media' | 'other';
}

export interface RoomDetails {
  code: string;
  token: string;
  mode: 'cloudflare' | 'lan';
  ws_url: string;
  subdomain?: string;
  local_ip: string;
  local_port: number;
  created_at: number;
}

export interface StreamItem {
  id: string;
  user_name: string;
  type: 'screen' | 'webcam';
  title: string;
  resolution: '720p' | '1080p' | '1440p';
  fps: 30 | 60;
  volume: number;
  is_muted: boolean;
  is_watched: boolean;
  isolated_audio: boolean;
  audio_pid?: number;
  process_name?: string;
  stream?: MediaStream | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
}
