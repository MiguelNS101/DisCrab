export interface WindowItem {
  hwnd: number;
  pid: number;
  title: string;
  process_name: string;
  category: 'game' | 'browser' | 'chat' | 'media' | 'other';
}

export interface VideoInputDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  kind: 'webcam' | 'capture_card';
}

export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface LocalMediaSource {
  sourceId: string;
  deviceId: string;
  audioDeviceId: string; // 'none' | 'default' | specific deviceId
  title: string;
  kind: 'webcam' | 'capture_card';
  resolution: '720p' | '1080p' | '1440p';
  fps: 30 | 60;
  stream: MediaStream;
}

export interface RemoteMediaSourceMeta {
  source_id: string;
  title: string;
  kind: 'webcam' | 'capture_card';
  resolution: '720p' | '1080p' | '1440p';
  fps: 30 | 60;
  video_track_id?: string;
  audio_track_id?: string;
  stream_id?: string;
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
  source_id?: string;
  source_kind?: 'screen' | 'webcam' | 'capture_card';
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

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  isImage: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  attachment?: ChatAttachment;
}

export type StreamQualityPreset = '1080p60' | '720p60' | '480p30' | '360p30' | 'auto';
export type PopupSizePreset = 'compact' | 'medium' | 'large' | 'free';

export interface StreamPopupState {
  streamId: string;
  userName: string;
  title: string;
  type: 'screen' | 'webcam';
  isOpen: boolean;
  isMinimized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  quality: StreamQualityPreset;
  sizePreset: PopupSizePreset;
}

export type AudioSourceMode = 'selected_window' | 'other_window' | 'all_except_discord';
