import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  KeyRound,
  Copy,
  Check,
  Globe,
  Wifi,
  ArrowRight,
  LogOut,
  Sparkles,
  Share2,
  BookmarkCheck,
  RotateCcw,
  Sliders,
  Lock,
  Hash,
  Eye,
  EyeOff,
  Shield,
  Trash2,
  ClipboardPaste,
  X,
  Minus,
  Pin,
  Palette,
  ArrowUpCircle,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { RoomDetails, SavedMeshRoom } from '../types';
import {
  decodeRoomCodeUrlSafe,
  createNativeRoom,
  isTauriEnvironment,
  isAndroidEnvironment,
  consumeStartupInvite,
  forwardInviteToLocalDesktopApp,
  minimizeAppWindow,
  closeCurrentAppWindow,
  startDraggingAppWindow,
  setAppWindowAlwaysOnTop,
  setAppWindowLayoutMode,
  isStrictlyNewerVersion,
} from '../services/tauriBridge';
import { AppIcon } from './AppIcon';
import { useTheme, THEME_PRESETS } from '../context/ThemeContext';
import { getStartupUpdateState } from './Header';

export type ParsedInvite =
  | { kind: 'mesh'; roomName: string; password: string }
  | { kind: 'code'; code: string };

export function parseInviteText(raw: string): ParsedInvite | null {
  const text = raw.trim();
  if (!text) return null;

  // 1. Formato "Sala: <nome> | Senha: <senha>" (em qualquer linha do texto)
  const meshTextMatch = text.match(/Sala:\s*([^\s|\r\n]+)\s*\|\s*Senha:\s*([^\r\n]+)/i);
  if (meshTextMatch) {
    const rName = meshTextMatch[1].trim().toLowerCase();
    // Caso tenha algum link na mesma linha depois da senha, corta antes de streamcompanion:// ou http
    const rPass = meshTextMatch[2]
      .replace(/\s*(streamcompanion:\/\/|https?:\/\/).*$/i, '')
      .trim();
    if (rName && rPass) {
      return { kind: 'mesh', roomName: rName, password: rPass };
    }
  }

  // 2. Formato URL / Deep Link (streamcompanion://join?... ou https://...?mesh_room=... ou ?room=...)
  const queryMatch = text.match(/\?([^\s\r\n]+)/);
  if (queryMatch) {
    try {
      const params = new URLSearchParams(queryMatch[1]);
      const meshRoom = params.get('mesh_room');
      const meshPass = params.get('mesh_pass');
      const roomCode = params.get('room');

      if (meshRoom && meshPass) {
        let decodedPass = meshPass;
        try {
          decodedPass = atob(meshPass);
        } catch {
          decodedPass = meshPass;
        }
        return {
          kind: 'mesh',
          roomName: meshRoom.trim().toLowerCase(),
          password: decodedPass.trim(),
        };
      }

      if (roomCode && roomCode.trim()) {
        return { kind: 'code', code: roomCode.trim() };
      }
    } catch {
      // ignora erro de parse de query
    }
  }

  // 3. Formato "Código: <codigo>" ou "Código da Sala: <codigo>"
  const codeLabelMatch = text.match(/C[oó]digo(?:\s+da\s+Sala)?:\s*([A-Za-z0-9_-]{8,})/i);
  if (codeLabelMatch) {
    return { kind: 'code', code: codeLabelMatch[1].trim() };
  }

  // 4. Código Base64 puro válido
  if (/^[A-Za-z0-9_-]{8,}$/.test(text)) {
    try {
      decodeRoomCodeUrlSafe(text);
      return { kind: 'code', code: text };
    } catch {
      // não é um código Base64 válido
    }
  }

  return null;
}

interface RoomControlProps {
  nickname: string;
  setNickname: (name: string) => void;
  roomDetails: RoomDetails | null;
  setRoomDetails: (details: RoomDetails | null) => void;
  isHost: boolean;
  setIsHost: (val: boolean) => void;
  isConnected: boolean;
  setIsConnected: (val: boolean) => void;
  onOpenUpdater?: () => void;
  onEnterLocalStudio?: () => void;
  isModalOpen?: boolean;
  externalError?: string | null;
  onClearExternalError?: () => void;
}

export const RoomControl: React.FC<RoomControlProps> = ({
  nickname,
  setNickname,
  roomDetails,
  setRoomDetails,
  isHost,
  setIsHost,
  isConnected,
  setIsConnected,
  onOpenUpdater,
  onEnterLocalStudio,
  isModalOpen = false,
  externalError = null,
  onClearExternalError,
}) => {
  // Modo principal: 'mesh' (Sala Fixa com Nome e Senha) | 'create' (Criar Código) | 'join' (Entrar Código)
  const [tab, setTab] = useState<'mesh' | 'create' | 'join'>('mesh');
  const { theme, applyPreset, isCustomizerOpen, setIsCustomizerOpen } = useTheme();
  const lobbyCardRef = useRef<HTMLDivElement | null>(null);
  const [isCardPinned, setIsCardPinned] = useState<boolean>(false);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(() => {
    const res = getStartupUpdateState().result;
    return Boolean(
      res?.has_update &&
        isStrictlyNewerVersion(res.current_version || '1.1.7', res.latest_version)
    );
  });
  const [latestTag, setLatestTag] = useState<string>(
    () => getStartupUpdateState().result?.latest_version || ''
  );

  useEffect(() => {
    const syncFromStartup = () => {
      const st = getStartupUpdateState();
      if (st.result) {
        const verified = Boolean(
          st.result.has_update &&
            isStrictlyNewerVersion(
              st.result.current_version || '1.1.7',
              st.result.latest_version
            )
        );
        setHasUpdateAvailable(verified);
        setLatestTag(st.result.latest_version || '');
      }
    };
    syncFromStartup();

    const onUpdateStatus = (ev: Event) => {
      const custom = ev as CustomEvent<{ hasUpdate: boolean; latestTag: string }>;
      if (custom.detail) {
        const tag = custom.detail.latestTag || '';
        const verified = Boolean(
          custom.detail.hasUpdate && tag && isStrictlyNewerVersion('1.1.7', tag)
        );
        setHasUpdateAvailable(verified);
        setLatestTag(tag);
      }
    };
    window.addEventListener('sc-update-status', onUpdateStatus);
    return () => window.removeEventListener('sc-update-status', onUpdateStatus);
  }, []);

  // Estado da Sala Fixa (Mesh P2P com Nome + Senha)
  const [meshRoomName, setMeshRoomName] = useState<string>(() => {
    try {
      return localStorage.getItem('sc_mesh_room_name') || '';
    } catch {
      return '';
    }
  });
  const [meshPassword, setMeshPassword] = useState<string>(() => {
    try {
      return localStorage.getItem('sc_mesh_room_password') || '';
    } catch {
      return '';
    }
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [savedMeshRooms, setSavedMeshRooms] = useState<SavedMeshRoom[]>(() => {
    try {
      const raw = localStorage.getItem('sc_saved_mesh_rooms');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const isAndroid = isAndroidEnvironment();
  const isDesktopTauri = isTauriEnvironment() && !isAndroid;

  // Estado do Modo Clássico (No Android nunca usa Cloudflare Tunnel)
  const [useCloudflare, setUseCloudflare] = useState<boolean>(() => !isAndroidEnvironment());
  const [inputCode, setInputCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSavedRoom, setLastSavedRoom] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Ajusta dinamicamente a janela nativa do SO (sem redimensionamento manual e sem scrollbar) para o exato tamanho do cartão de login
  useEffect(() => {
    if (roomDetails || !isTauriEnvironment() || isAndroidEnvironment()) return;

    if (isCustomizerOpen || isModalOpen) {
      setAppWindowLayoutMode('workspace', undefined, undefined, false);
      return;
    }

    const el = lobbyCardRef.current;
    if (!el) return;

    let lastAppliedH = 0;

    const applyCardBounds = () => {
      if (
        typeof document !== 'undefined' &&
        (document.hidden || window.innerWidth < 100 || window.innerHeight < 100)
      ) {
        return;
      }
      const rawH = Math.ceil(el.offsetHeight || el.scrollHeight || 0);
      if (rawH < 200) return;

      // 36px da barra superior do cartão + altura exata do conteúdo interno + 2px de borda
      const targetW = 460;
      const targetH = Math.max(500, rawH + 38);
      if (Math.abs(targetH - lastAppliedH) < 2) return;
      lastAppliedH = targetH;
      setAppWindowLayoutMode('lobby', targetW, targetH, false);
    };

    applyCardBounds();
    const observer = new ResizeObserver(() => {
      applyCardBounds();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    roomDetails,
    tab,
    savedMeshRooms.length,
    errorMsg,
    externalError,
    isCustomizerOpen,
    isModalOpen,
  ]);

  const saveMeshRoomToFavorites = useCallback((roomName: string, password: string) => {
    try {
      const normalized = roomName.trim().toLowerCase();
      setSavedMeshRooms((prev) => {
        const updated: SavedMeshRoom[] = [
          { roomName: normalized, password, lastUsedAt: Date.now() },
          ...prev.filter((r) => r.roomName.toLowerCase() !== normalized),
        ].slice(0, 6);
        try {
          localStorage.setItem('sc_saved_mesh_rooms', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    } catch {}
  }, []);

  // Manipulador para Entrar ou Abrir Sala Fixa Mesh P2P (Nome + Senha)
  const handleConnectMeshRoom = useCallback(
    (customRoomName?: string, customPassword?: string) => {
      const targetRoom = (customRoomName ?? meshRoomName).trim().toLowerCase();
      const targetPass = (customPassword ?? meshPassword).trim();
      const effectiveNick = (nickname || 'Jogador_1').trim();

      if (!effectiveNick) {
        setErrorMsg('Digite seu apelido antes de conectar na sala.');
        return;
      }
      if (!targetRoom || targetRoom.length < 2) {
        setErrorMsg('Digite um Nome para a Sala Fixa (mínimo 2 caracteres).');
        return;
      }
      if (!targetPass) {
        setErrorMsg('Digite uma Senha para proteger sua Sala Fixa.');
        return;
      }

      setErrorMsg(null);
      setMeshRoomName(targetRoom);
      setMeshPassword(targetPass);

      try {
        localStorage.setItem('sc_mesh_room_name', targetRoom);
        localStorage.setItem('sc_mesh_room_password', targetPass);
      } catch {}

      saveMeshRoomToFavorites(targetRoom, targetPass);

      const details: RoomDetails = {
        code: `Sala: ${targetRoom} | Senha: ${targetPass}`,
        token: targetPass,
        mode: 'mesh',
        room_name: targetRoom,
        ws_url: `mesh://${encodeURIComponent(targetRoom)}`,
        local_ip: 'Mesh P2P',
        local_port: 0,
        created_at: Date.now(),
      };

      setRoomDetails(details);
      setIsHost(true);
      setIsConnected(true);
    },
    [meshRoomName, meshPassword, nickname, saveMeshRoomToFavorites, setRoomDetails, setIsHost, setIsConnected]
  );

  // Manipulador para o Peer entrar na sala por código
  const handleJoinRoom = useCallback(
    (codeToJoin?: string) => {
      const code = (codeToJoin || inputCode).trim();
      const effectiveNick = (nickname || 'Jogador_1').trim();

      if (!effectiveNick) {
        setErrorMsg('Digite seu apelido antes de entrar na sala.');
        return;
      }
      if (!code) {
        setErrorMsg('Cole o Código ou Convite da Sala.');
        return;
      }

      // Verifica se o texto colado é um convite completo (Mesh ou Código/URL)
      const parsed = parseInviteText(code);
      if (parsed?.kind === 'mesh') {
        handleConnectMeshRoom(parsed.roomName, parsed.password);
        return;
      }
      const cleanCode = parsed?.kind === 'code' ? parsed.code : code;

      try {
        setErrorMsg(null);
        const decoded = decodeRoomCodeUrlSafe(cleanCode);

        const details: RoomDetails = {
          code: cleanCode,
          token: decoded.token,
          mode: decoded.wsUrl.includes('trycloudflare') ? 'cloudflare' : 'lan',
          ws_url: decoded.wsUrl,
          local_ip: '127.0.0.1',
          local_port: 0,
          created_at: Date.now(),
        };

        setRoomDetails(details);
        setIsHost(false);
        setIsConnected(true);

        try {
          localStorage.setItem('sc_last_room_code', cleanCode);
          setLastSavedRoom(cleanCode);
        } catch {}
      } catch {
        setErrorMsg('Código da Sala inválido ou formato corrompido.');
      }
    },
    [inputCode, nickname, handleConnectMeshRoom, setRoomDetails, setIsHost, setIsConnected]
  );

  // Aplica um convite extraído (de link streamcompanion://, parâmetros de URL ou área de transferência) e entra direto na sala
  const applyParsedInvite = useCallback(
    (parsed: ParsedInvite) => {
      if (parsed.kind === 'mesh') {
        setTab('mesh');
        handleConnectMeshRoom(parsed.roomName, parsed.password);
      } else {
        setTab('join');
        setInputCode(parsed.code);
        handleJoinRoom(parsed.code);
      }
    },
    [handleConnectMeshRoom, handleJoinRoom]
  );

  const didInitStartupRef = useRef<boolean>(false);
  const applyParsedInviteRef = useRef(applyParsedInvite);
  useEffect(() => {
    applyParsedInviteRef.current = applyParsedInvite;
  }, [applyParsedInvite]);

  // Carrega apelido, último código salvo (sem travar o input!), parâmetros de URL e deep-links streamcompanion:// apenas 1 vez na montagem
  useEffect(() => {
    if (didInitStartupRef.current) return;
    didInitStartupRef.current = true;

    try {
      const savedNick = localStorage.getItem('sc_nickname');
      if (savedNick && !nickname) {
        setNickname(savedNick);
      }

      const savedRoom = localStorage.getItem('sc_last_room_code') || '';
      if (savedRoom) {
        setLastSavedRoom(savedRoom);
      }

      // 1. Verifica se a janela foi aberta com parâmetros de convite (?mesh_room=... ou ?room=...)
      if (window.location.search) {
        const parsedFromUrl = parseInviteText(window.location.search);
        if (parsedFromUrl) {
          // Limpa a query string da barra de endereço para não repetir ao atualizar
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch {}

          // Se abriu no navegador externo, tenta encaminhar para o DisCrab.exe aberto no PC
          if (!isTauriEnvironment()) {
            forwardInviteToLocalDesktopApp(window.location.search).then((forwarded) => {
              if (!forwarded) {
                const deepUrl = `streamcompanion://join${window.location.search}`;
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = deepUrl;
                document.body.appendChild(iframe);
                setTimeout(() => iframe.remove(), 1500);
              }
            });
          }

          // Entra automaticamente na sala
          applyParsedInviteRef.current(parsedFromUrl);
        }
      }
    } catch {
      // Ignora erro de storage se indisponível
    }

    // 2. Se estiver no aplicativo Desktop (Tauri), consome convite de inicialização e escuta novos links streamcompanion://
    if (isTauriEnvironment()) {
      consumeStartupInvite().then((inviteStr) => {
        if (inviteStr) {
          const parsed = parseInviteText(inviteStr);
          if (parsed) applyParsedInviteRef.current(parsed);
        }
      });

      let unlistenFn: (() => void) | null = null;
      listen<string>('deep-link-invite', (event) => {
        if (event.payload) {
          const parsed = parseInviteText(event.payload);
          if (parsed) applyParsedInviteRef.current(parsed);
        }
      })
        .then((fn) => {
          unlistenFn = fn;
        })
        .catch(() => {});

      return () => {
        if (unlistenFn) unlistenFn();
      };
    }
  }, []);

  // Suporte a Ctrl+V direto na tela inicial (mesmo sem clicar em nenhuma caixa de texto)
  useEffect(() => {
    if (isConnected) return;
    const onGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const text = e.clipboardData?.getData('text') || '';
      const parsed = parseInviteText(text);
      if (parsed) {
        e.preventDefault();
        applyParsedInvite(parsed);
      }
    };
    window.addEventListener('paste', onGlobalPaste);
    return () => window.removeEventListener('paste', onGlobalPaste);
  }, [isConnected, applyParsedInvite]);

  const handlePasteInviteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setErrorMsg('A área de transferência está vazia. Copie o convite enviado pelo seu amigo.');
        return;
      }
      const parsed = parseInviteText(text);
      if (!parsed) {
        setErrorMsg('Nenhum convite ou código de sala válido encontrado no texto copiado.');
        return;
      }
      setErrorMsg(null);
      applyParsedInvite(parsed);
    } catch {
      setErrorMsg('Permissão negada para ler a área de transferência. Pressione Ctrl+V na caixa da sala.');
    }
  };

  const handleNicknameChange = (val: string) => {
    setNickname(val);
    try {
      localStorage.setItem('sc_nickname', val);
    } catch {
      // ignore
    }
  };

  const handleMeshRoomNameChange = (val: string) => {
    // Se colar o convite completo dentro do campo Nome da Sala, já preenche Sala e Senha automaticamente
    const parsed = parseInviteText(val);
    if (parsed?.kind === 'mesh') {
      setMeshRoomName(parsed.roomName);
      setMeshPassword(parsed.password);
      try {
        localStorage.setItem('sc_mesh_room_name', parsed.roomName);
        localStorage.setItem('sc_mesh_room_password', parsed.password);
      } catch {}
      return;
    }

    setMeshRoomName(val);
    try {
      localStorage.setItem('sc_mesh_room_name', val);
    } catch {}
  };

  const handleMeshPasswordChange = (val: string) => {
    const parsed = parseInviteText(val);
    if (parsed?.kind === 'mesh') {
      setMeshRoomName(parsed.roomName);
      setMeshPassword(parsed.password);
      try {
        localStorage.setItem('sc_mesh_room_name', parsed.roomName);
        localStorage.setItem('sc_mesh_room_password', parsed.password);
      } catch {}
      return;
    }

    setMeshPassword(val);
    try {
      localStorage.setItem('sc_mesh_room_password', val);
    } catch {}
  };

  const handleRemoveSavedMeshRoom = (roomName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = savedMeshRooms.filter(
        (r) => r.roomName.toLowerCase() !== roomName.toLowerCase()
      );
      setSavedMeshRooms(updated);
      localStorage.setItem('sc_saved_mesh_rooms', JSON.stringify(updated));
    } catch {}
  };

  // Manipulador para o Host criar a sala por código (Cloudflare / LAN)
  const handleCreateRoom = async () => {
    if (!nickname.trim()) {
      setErrorMsg('Digite seu apelido antes de criar a sala.');
      return;
    }
    setErrorMsg(null);
    setIsCreating(true);

    try {
      if (isTauriEnvironment()) {
        const res = await createNativeRoom(nickname.trim(), useCloudflare);
        const details: RoomDetails = {
          code: res.room_code,
          token: res.token,
          mode: res.mode as any,
          ws_url: `ws://127.0.0.1:${res.local_port}`,
          subdomain: res.public_url
            ? res.public_url.replace(/^https?:\/\//, '').replace(/\..*$/, '')
            : undefined,
          local_ip: res.local_ip,
          local_port: res.local_port,
          created_at: Date.now(),
        };

        setRoomDetails(details);
        setIsHost(true);
        setIsConnected(true);

        try {
          localStorage.setItem('sc_last_room_code', res.room_code);
          setLastSavedRoom(res.room_code);
        } catch {}
      } else {
        const resp = await fetch('/api/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostNickname: nickname.trim() }),
        });
        if (!resp.ok) {
          throw new Error(`Servidor respondeu com código ${resp.status}`);
        }
        const data = await resp.json();
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const details: RoomDetails = {
          code: data.room_code,
          token: data.token,
          mode: 'cloudflare',
          ws_url: `${wsProtocol}//${window.location.host}/ws`,
          local_ip: window.location.hostname,
          local_port: parseInt(
            window.location.port || (window.location.protocol === 'https:' ? '443' : '80'),
            10
          ),
          created_at: Date.now(),
        };

        setRoomDetails(details);
        setIsHost(true);
        setIsConnected(true);

        try {
          localStorage.setItem('sc_last_room_code', data.room_code);
          setLastSavedRoom(data.room_code);
        } catch {}
      }
    } catch (err: any) {
      setErrorMsg(`Falha ao criar sala: ${err?.message || err}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyCode = () => {
    if (!roomDetails) return;
    navigator.clipboard.writeText(roomDetails.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleShareRoom = async () => {
    if (!roomDetails) return;

    if (roomDetails.mode === 'mesh' && roomDetails.room_name) {
      const encodedPass = btoa(roomDetails.token);
      const appDeepLink = `streamcompanion://join?mesh_room=${encodeURIComponent(
        roomDetails.room_name
      )}&mesh_pass=${encodeURIComponent(encodedPass)}`;
      const shareText = `Sala: ${roomDetails.room_name} | Senha: ${roomDetails.token}\nAbrir no App: ${appDeepLink}`;

      try {
        await navigator.clipboard.writeText(shareText);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
      } catch {}
      return;
    }

    const appDeepLink = `streamcompanion://join?room=${encodeURIComponent(roomDetails.code)}`;
    const shareText = `Código da Sala: ${roomDetails.code}\nAbrir no App: ${appDeepLink}`;

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    } catch (e) {
      console.warn('Erro ao copiar convite:', e);
    }
  };

  const handleLeaveRoom = () => {
    setIsConnected(false);
    setRoomDetails(null);
  };

  // MODO 1: Na Sala (Conectado ou Conectando) -> Barra Compacta Discreta
  if (roomDetails) {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isConnected ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </span>
          <div className="flex items-center gap-2 font-mono text-xs flex-wrap">
            {roomDetails.mode === 'mesh' ? (
              <span className="text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Sala Fixa: <strong className="text-white">{roomDetails.room_name}</strong>
              </span>
            ) : (
              <span className="text-emerald-400 font-bold uppercase tracking-wider">
                {isHost ? 'Host' : isConnected ? 'Sala Ativa' : 'Conectando...'}
              </span>
            )}
            {!isConnected && roomDetails.mode === 'mesh' && (
              <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
                (Conectando...)
              </span>
            )}
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-200 font-semibold">{nickname}</span>
            <span className="text-neutral-600 hidden sm:inline">·</span>
            <span className="text-[11px] text-neutral-400 hidden sm:flex items-center gap-1">
              {roomDetails.mode === 'mesh' ? (
                <>
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span>Mesh P2P (AES-256)</span>
                </>
              ) : roomDetails.mode === 'cloudflare' ? (
                <>
                  <Globe className="w-3 h-3 text-cyan-400" />
                  <span>WAN Cloudflare</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3 h-3 text-indigo-400" />
                  <span>LAN</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleCopyCode}
            className="sc-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-950 hover:bg-neutral-800 text-neutral-200 text-xs rounded-lg font-mono transition-all cursor-pointer border border-neutral-800"
            title={
              roomDetails.mode === 'mesh'
                ? 'Copiar Nome da Sala e Senha'
                : 'Copiar código da sala'
            }
          >
            {copiedCode ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>
              {copiedCode
                ? 'Copiado!'
                : roomDetails.mode === 'mesh'
                ? 'Sala & Senha'
                : 'Código'}
            </span>
          </button>

          <button
            onClick={handleShareRoom}
            className="sc-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-950 hover:bg-neutral-800 text-neutral-200 text-xs rounded-lg font-mono transition-all cursor-pointer border border-neutral-800"
            title="Copiar convite direto para o app (link streamcompanion:// + credenciais)"
          >
            {copiedShare ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span className="hidden sm:inline">{copiedShare ? 'Convite Copiado!' : 'Convidar'}</span>
          </button>

          <button
            onClick={handleLeaveRoom}
            className="sc-btn flex items-center gap-1 px-2.5 py-1.5 bg-red-950/50 hover:bg-red-900/70 border border-red-800/60 text-red-300 text-xs rounded-lg font-mono transition-colors cursor-pointer"
            title="Sair da sala e voltar ao início"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    );
  }

  const activePreset =
    THEME_PRESETS.find((p) => p.id === theme.presetId) || THEME_PRESETS[0];

  const handleCardDragMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isAndroid || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, a, input, select, textarea, label, [data-no-drag="true"]'
      )
    ) {
      return;
    }
    e.preventDefault();
    startDraggingAppWindow();
  };

  const handleToggleCardPin = async () => {
    const next = !isCardPinned;
    const applied = await setAppWindowAlwaysOnTop(next);
    setIsCardPinned(applied);
  };

  const handleCyclePresetRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentIndex = THEME_PRESETS.findIndex((p) => p.id === theme.presetId);
    const nextIndex = (currentIndex + 1) % THEME_PRESETS.length;
    applyPreset(THEME_PRESETS[nextIndex].id);
  };

  const displayError = errorMsg || externalError;

  // MODO 2: Tela Inicial Limpa (Cartão de Login Independente esticado 100% na janela sem scroll)
  return (
    <div
      className={
        isDesktopTauri
          ? 'w-screen h-screen overflow-hidden flex items-stretch justify-stretch'
          : 'w-full max-w-md mx-auto my-auto py-4'
      }
    >
      <div
        data-tauri-drag-region
        onMouseDown={handleCardDragMouseDown}
        className={`sc-card sc-lobby-card w-full bg-neutral-900/95 border border-neutral-800 ${
          isDesktopTauri
            ? 'h-full rounded-xl flex flex-col justify-between overflow-hidden select-none'
            : 'rounded-2xl shadow-2xl overflow-hidden'
        } relative`}
      >
        {/* Filete luminoso no topo do cartão nas cores do tema */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none opacity-95 z-30"
          style={{
            background:
              'linear-gradient(90deg, var(--sc-accent, #06b6d4) 0%, var(--sc-accent-secondary, #6366f1) 50%, var(--sc-accent, #06b6d4) 100%)',
          }}
        />

        {/* Barra de Topo do Cartão (100% Arrastável em qualquer parte que não seja botão) */}
        {!isAndroid && (
          <div
            data-tauri-drag-region
            onMouseDown={handleCardDragMouseDown}
            className="sc-titlebar w-full h-9 shrink-0 flex items-center justify-between pl-3 pr-0 border-b select-none"
            style={{
              backgroundColor: 'var(--sc-bg-elevated, #09090b)',
              borderColor: 'var(--sc-border-color, #27272a)',
            }}
          >
            {/* Área de Arraste Esquerda/Central */}
            <div
              data-tauri-drag-region
              className="flex-1 h-full flex items-center gap-2 cursor-default"
            >
              <div className="pointer-events-none flex items-center gap-2">
                <AppIcon size={18} showLiveDot={true} animated={false} />
                <span className="text-xs font-black tracking-wider font-mono text-white">
                  Dis<span className="text-rose-400">Crab</span>
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-mono tracking-wider"
                  style={{
                    backgroundColor: 'rgba(var(--sc-accent-rgb, 6, 182, 212), 0.12)',
                    color: 'var(--sc-accent, #06b6d4)',
                    border: '1px solid rgba(var(--sc-accent-rgb, 6, 182, 212), 0.28)',
                  }}
                >
                  v1.1.6
                </span>
              </div>
            </div>

            {/* Botões de Controle da Janela (Fixar, Minimizar, Fechar) */}
            <div data-no-drag="true" className="flex items-center h-full shrink-0">
              <button
                type="button"
                onClick={handleToggleCardPin}
                className="sc-win-btn h-full w-9 flex items-center justify-center transition-colors cursor-pointer"
                style={{
                  color: isCardPinned
                    ? 'var(--sc-accent, #06b6d4)'
                    : 'var(--sc-text-muted, #a1a1aa)',
                  backgroundColor: isCardPinned
                    ? 'rgba(var(--sc-accent-rgb, 6, 182, 212), 0.16)'
                    : 'transparent',
                  borderRadius: 0,
                }}
                title={
                  isCardPinned
                    ? 'Janela fixada no topo (clique para desafixar)'
                    : 'Fixar cartão sempre no topo'
                }
              >
                <Pin
                  className={`w-3.5 h-3.5 ${isCardPinned ? 'rotate-45' : ''} transition-transform`}
                />
              </button>

              <button
                type="button"
                onClick={minimizeAppWindow}
                className="sc-win-btn h-full w-10 flex items-center justify-center transition-colors cursor-pointer"
                style={{
                  color: 'var(--sc-text-muted, #a1a1aa)',
                  borderRadius: 0,
                }}
                title="Minimizar janela"
                aria-label="Minimizar janela"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={closeCurrentAppWindow}
                className="sc-win-btn-close h-full w-11 flex items-center justify-center transition-all cursor-pointer text-neutral-400 hover:bg-rose-600 hover:text-white"
                style={{ borderRadius: 0 }}
                title="Fechar aplicativo"
                aria-label="Fechar aplicativo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Corpo Interno Medido Automaticamente para Ajustar a Altura Exata do Cartão */}
        <div
          ref={lobbyCardRef}
          data-tauri-drag-region
          onMouseDown={handleCardDragMouseDown}
          className="w-full px-6 pt-4 pb-5 space-y-4"
        >
          {/* Identidade Central com o Ícone DisCrab */}
          <div
            data-tauri-drag-region
            className="flex flex-col items-center text-center space-y-2 cursor-default"
          >
            <div className="pointer-events-none">
              <AppIcon size={62} showLiveDot={true} animated={true} />
            </div>
            <div className="pointer-events-none">
              <h2 className="text-xl font-black tracking-wider text-white font-mono">
                Dis<span className="text-rose-400">Crab</span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Entre na sua Sala Fixa com Nome e Senha ou use Código P2P
              </p>
            </div>
          </div>

        {/* Campo 1: Seu Apelido */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono text-neutral-300">
            <label htmlFor="sc-nickname-input" className="font-bold">
              Seu Apelido
            </label>
            {nickname.trim() && (
              <span className="text-[10px] text-cyan-400 flex items-center gap-1 font-semibold">
                <BookmarkCheck className="w-3 h-3" />
                Salvo automaticamente
              </span>
            )}
          </div>
          <input
            id="sc-nickname-input"
            type="text"
            value={nickname}
            onChange={(e) => handleNicknameChange(e.target.value)}
            placeholder="Digite seu nome ou nick..."
            maxLength={24}
            className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl px-4 text-sm text-white font-mono outline-none transition-all"
          />
        </div>

        {/* Botão Rápido: Colar Convite Copiado e Entrar Direto */}
        <button
          type="button"
          onClick={handlePasteInviteFromClipboard}
          className="sc-btn w-full py-2 px-3 bg-neutral-950 hover:bg-neutral-800 border border-cyan-500/40 hover:border-cyan-400 rounded-xl flex items-center justify-center gap-2 text-xs font-mono text-cyan-300 transition-all cursor-pointer"
          title="Se seu amigo te mandou um convite, copie e clique aqui (ou aperte Ctrl+V) para entrar direto"
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Colar Convite Copiado e Entrar Direto (Ctrl+V)</span>
        </button>

        {/* Alternador de Modos: Sala Fixa (Nome/Senha) | Criar Código | Entrar Código */}
        <div className="grid grid-cols-3 p-1 bg-neutral-950 border border-neutral-800 rounded-xl text-[11px] font-mono gap-1">
          <button
            type="button"
            onClick={() => {
              setTab('mesh');
              setErrorMsg(null);
            }}
            className={`sc-btn sc-btn-sized py-2 rounded-lg transition-all cursor-pointer font-bold ${
              tab === 'mesh'
                ? 'sc-btn-primary bg-cyan-500 text-black shadow'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Sala Fixa
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('create');
              setErrorMsg(null);
            }}
            className={`sc-btn sc-btn-sized py-2 rounded-lg transition-all cursor-pointer font-bold ${
              tab === 'create'
                ? 'sc-btn-primary bg-cyan-500 text-black shadow'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Criar Código
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('join');
              setErrorMsg(null);
            }}
            className={`sc-btn sc-btn-sized py-2 rounded-lg transition-all cursor-pointer font-bold ${
              tab === 'join'
                ? 'sc-btn-primary bg-cyan-500 text-black shadow'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Usar Código
          </button>
        </div>

        {/* ABA 1: SALA FIXA MESH P2P (NOME + SENHA) */}
        {tab === 'mesh' && (
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-300">
                <label htmlFor="sc-mesh-room-input" className="flex items-center gap-1.5 font-bold">
                  <Hash className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Nome da Sala Fixa</span>
                </label>
                <span className="text-[10px] text-emerald-400 font-semibold">
                  Mesh P2P (Sem trocar código)
                </span>
              </div>
              <input
                id="sc-mesh-room-input"
                type="text"
                value={meshRoomName}
                onChange={(e) => handleMeshRoomNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnectMeshRoom();
                }}
                placeholder="Ex: sala-dos-amigos"
                maxLength={40}
                className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl px-4 text-xs text-white font-mono outline-none transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-300">
                <label htmlFor="sc-mesh-pass-input" className="flex items-center gap-1.5 font-bold">
                  <Lock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Senha da Sala</span>
                </label>
                <span className="text-[10px] text-neutral-500">Criptografia AES-256</span>
              </div>
              <div className="relative">
                <input
                  id="sc-mesh-pass-input"
                  type={showPassword ? 'text' : 'password'}
                  value={meshPassword}
                  onChange={(e) => handleMeshPasswordChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConnectMeshRoom();
                  }}
                  placeholder="Digite a senha combinada com seus amigos..."
                  maxLength={64}
                  className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl pl-4 pr-10 text-xs text-white font-mono outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white p-1 cursor-pointer"
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleConnectMeshRoom()}
              className="sc-btn sc-btn-primary sc-btn-sized w-full h-12 flex items-center justify-center gap-2 px-5 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg"
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span>Entrar / Abrir Sala Fixa</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            {/* Lista de Salas Fixas Salvas (1 Clique) */}
            {savedMeshRooms.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block">
                  Salas Salvas (1 Clique):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {savedMeshRooms.map((item) => (
                    <div
                      key={item.roomName}
                      onClick={() => handleConnectMeshRoom(item.roomName, item.password)}
                      className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-cyan-500/50 text-xs font-mono text-neutral-200 cursor-pointer transition-all"
                      title={`Entrar direto na sala "${item.roomName}"`}
                    >
                      <Hash className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate max-w-[130px]">{item.roomName}</span>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveSavedMeshRoom(item.roomName, e)}
                        className="opacity-60 hover:opacity-100 text-neutral-500 hover:text-red-400 p-0.5 cursor-pointer"
                        title="Remover sala salva"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA 2: CRIAR SALA POR CÓDIGO (HOST CLOUDFLARE NO PC / HOST LAN NO PC E ANDROID) */}
        {tab === 'create' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Modo de Rede do Host:</span>
                <span className="text-[11px] text-cyan-400 font-semibold">
                  {isAndroid
                    ? 'Host Rede Local Wi-Fi (LAN)'
                    : useCloudflare
                    ? 'Host Internet (Cloudflare Tunnel)'
                    : 'Host Rede Local (LAN)'}
                </span>
              </div>
              {isAndroid ? (
                <div className="p-2.5 bg-neutral-950 border border-indigo-500/50 rounded-xl flex items-center justify-between text-xs font-mono text-indigo-200">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>
                      Host Android cria sala via Wi-Fi/LAN (ser Host Cloudflare é pelo PC; para entrar em sala Cloudflare do PC use &quot;Usar Código&quot;)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-950 border border-neutral-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setUseCloudflare(true)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs rounded-lg cursor-pointer font-mono transition-all ${
                      useCloudflare
                        ? 'bg-neutral-800 border border-cyan-500/60 text-cyan-300 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>Internet (Cloudflare)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseCloudflare(false)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs rounded-lg cursor-pointer font-mono transition-all ${
                      !useCloudflare
                        ? 'bg-neutral-800 border border-indigo-500/60 text-indigo-300 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Wifi className="w-3.5 h-3.5 shrink-0" />
                    <span>Rede LAN</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={isCreating}
              onClick={handleCreateRoom}
              className="sc-btn sc-btn-primary sc-btn-sized w-full h-12 flex items-center justify-center gap-2 px-5 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>{isCreating ? 'Criando Sala...' : 'Gerar Código de Sala'}</span>
            </button>
          </div>
        )}

        {/* ABA 3: ENTRAR POR CÓDIGO MANUAL (SUPORTA CLOUDFLARE TUNNEL E LAN EM TODAS AS PLATAFORMAS) */}
        {tab === 'join' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Código da Sala (Cloudflare ou LAN):</span>
                <div className="flex items-center gap-2">
                  {inputCode && (
                    <button
                      type="button"
                      onClick={() => {
                        setInputCode('');
                        setErrorMsg(null);
                      }}
                      className="text-[11px] text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      Limpar
                    </button>
                  )}
                  {lastSavedRoom && inputCode !== lastSavedRoom && (
                    <button
                      type="button"
                      onClick={() => {
                        setInputCode(lastSavedRoom);
                        setErrorMsg(null);
                      }}
                      className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Usar Último Código
                    </button>
                  )}
                </div>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    setErrorMsg(null);
                    // Se o usuário colou o bloco completo "Código da Sala: xxx...", extrai apenas o código limpo
                    if (rawVal.includes('Código') || rawVal.includes('streamcompanion://')) {
                      const parsed = parseInviteText(rawVal);
                      if (parsed?.kind === 'code') {
                        setInputCode(parsed.code);
                        return;
                      }
                    }
                    setInputCode(rawVal);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleJoinRoom();
                  }}
                  placeholder="Cole o código Cloudflare (PC Host) ou LAN..."
                  className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl pl-4 pr-9 text-xs text-white font-mono outline-none transition-colors"
                />
                {inputCode && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputCode('');
                      setErrorMsg(null);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white p-1 cursor-pointer"
                    title="Apagar código"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleJoinRoom()}
              className="sc-btn sc-btn-primary sc-btn-sized w-full h-12 flex items-center justify-center gap-2 px-5 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>Entrar com Código</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        )}

          {displayError && (
            <div className="text-xs font-mono text-red-300 bg-red-950/60 border border-red-800/80 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-left flex-1">{displayError}</span>
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  if (onClearExternalError) onClearExternalError();
                }}
                className="text-red-400 hover:text-white p-0.5 cursor-pointer shrink-0"
                title="Fechar aviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Rodapé do Cartão: Abrir Estúdio Local + Tema & CSS e Atualizar App logo abaixo */}
          <div className="pt-3 border-t border-neutral-800/80 space-y-2">
            {onEnterLocalStudio && (
              <button
                type="button"
                onClick={onEnterLocalStudio}
                className="sc-btn w-full py-2 px-3 rounded-xl bg-neutral-950/90 hover:bg-neutral-800 border border-neutral-800 text-[11px] font-mono text-neutral-300 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Abrir Estúdio Local (Testar Câmera, Tela e Áudio)</span>
              </button>
            )}

            {/* Linha de Botões: Tema & CSS + Atualizar App (embaixo do Estúdio Local) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsCustomizerOpen(true)}
                onContextMenu={handleCyclePresetRightClick}
                className="sc-btn py-2 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 font-mono text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                title={`Tema atual: ${activePreset.name} — Clique para personalizar Tema & CSS | Botão direito alterna o preset`}
              >
                <Palette className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">Tema & CSS</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenUpdater && onOpenUpdater()}
                className={`sc-btn py-2 px-3 rounded-xl border font-mono text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  hasUpdateAvailable
                    ? 'bg-emerald-950/90 hover:bg-emerald-900/90 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-950/50 animate-pulse'
                    : 'bg-neutral-950 hover:bg-neutral-800 border-neutral-800 text-cyan-300'
                }`}
                title="Verificar atualizações do aplicativo e gerenciar o Cloudflared"
              >
                <ArrowUpCircle
                  className={`w-3.5 h-3.5 shrink-0 ${
                    hasUpdateAvailable ? 'text-emerald-400' : 'text-cyan-400'
                  }`}
                />
                <span className="font-semibold truncate">
                  {hasUpdateAvailable ? `Atualizar (${latestTag})` : 'Atualizar App'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
