import React, { useState, useEffect, useCallback } from 'react';
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
} from '../services/tauriBridge';
import { AppIcon } from './AppIcon';

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
  onEnterLocalStudio,
}) => {
  // Modo principal: 'mesh' (Sala Fixa com Nome e Senha) | 'create' (Criar Código) | 'join' (Entrar Código)
  const [tab, setTab] = useState<'mesh' | 'create' | 'join'>('mesh');

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

  // Estado do Modo Clássico (No Android nunca usa Cloudflare Tunnel)
  const [useCloudflare, setUseCloudflare] = useState<boolean>(() => !isAndroidEnvironment());
  const [inputCode, setInputCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSavedRoom, setLastSavedRoom] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);

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

  // Carrega apelido, sala fixa, parâmetros de URL e deep-links streamcompanion://
  useEffect(() => {
    try {
      const savedNick = localStorage.getItem('sc_nickname');
      if (savedNick && !nickname) {
        setNickname(savedNick);
      }

      const savedRoom = localStorage.getItem('sc_last_room_code') || '';
      if (savedRoom) {
        setLastSavedRoom(savedRoom);
        setInputCode(savedRoom);
      }

      // 1. Verifica se a janela foi aberta com parâmetros de convite (?mesh_room=... ou ?room=...)
      if (window.location.search) {
        const parsedFromUrl = parseInviteText(window.location.search);
        if (parsedFromUrl) {
          // Limpa a query string da barra de endereço para não repetir ao atualizar
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch {}

          // Se abriu no navegador externo, tenta encaminhar para o StreamCompanion.exe aberto no PC
          if (!isTauriEnvironment()) {
            forwardInviteToLocalDesktopApp(window.location.search).then((forwarded) => {
              if (!forwarded) {
                // Tenta também acionar o protocolo nativo streamcompanion:// registrado no Windows
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
          applyParsedInvite(parsedFromUrl);
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
          if (parsed) applyParsedInvite(parsed);
        }
      });

      let unlistenFn: (() => void) | null = null;
      listen<string>('deep-link-invite', (event) => {
        if (event.payload) {
          const parsed = parseInviteText(event.payload);
          if (parsed) applyParsedInvite(parsed);
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
  }, [applyParsedInvite]);

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

  // MODO 1: Conectado na Sala -> Barra Compacta Discreta
  if (isConnected && roomDetails) {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <div className="flex items-center gap-2 font-mono text-xs flex-wrap">
            {roomDetails.mode === 'mesh' ? (
              <span className="text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Sala Fixa: <strong className="text-white">{roomDetails.room_name}</strong>
              </span>
            ) : (
              <span className="text-emerald-400 font-bold uppercase tracking-wider">
                {isHost ? 'Host' : 'Sala Ativa'}
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

  // MODO 2: Tela Inicial Limpa (Home / Lobby)
  return (
    <div className="w-full max-w-md mx-auto my-auto py-6">
      <div className="sc-card sc-lobby-card bg-neutral-900/95 border border-neutral-800 rounded-2xl p-6 sm:p-7 shadow-2xl space-y-5 relative overflow-hidden">
        {/* Identidade Central com o Novo Ícone DisCrab */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <AppIcon size={68} showLiveDot={true} animated={true} />
          <div>
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
                {lastSavedRoom && (
                  <button
                    type="button"
                    onClick={() => setInputCode(lastSavedRoom)}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Usar Último Código
                  </button>
                )}
              </div>
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoinRoom();
                }}
                placeholder="Cole o código Cloudflare (PC Host) ou LAN..."
                className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl px-4 text-xs text-white font-mono outline-none transition-colors"
              />
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

        {errorMsg && (
          <p className="text-xs font-mono text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2 text-center">
            {errorMsg}
          </p>
        )}

        {/* Rodapé da Home: Modo Estúdio */}
        {onEnterLocalStudio && (
          <div className="pt-4 border-t border-neutral-800/80">
            <button
              type="button"
              onClick={onEnterLocalStudio}
              className="w-full py-2 text-[11px] font-mono text-neutral-400 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-neutral-500" />
              <span>Abrir Estúdio Local (Testar Câmera, Tela e Áudio sem Sala)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
