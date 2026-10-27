import React, { useState, useEffect } from 'react';
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
  ArrowUpCircle,
  Palette,
  Sliders,
} from 'lucide-react';
import { RoomDetails } from '../types';
import { decodeRoomCodeUrlSafe, createNativeRoom, isTauriEnvironment } from '../services/tauriBridge';
import { AppIcon } from './AppIcon';
import { useTheme } from '../context/ThemeContext';

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
  onOpenUpdater,
  onEnterLocalStudio,
}) => {
  const { setIsCustomizerOpen } = useTheme();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [useCloudflare, setUseCloudflare] = useState<boolean>(true);
  const [inputCode, setInputCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSavedRoom, setLastSavedRoom] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Carrega apelido e código salvo do localStorage ou parâmetro de URL (?room=...)
  useEffect(() => {
    try {
      const savedNick = localStorage.getItem('sc_nickname');
      if (savedNick && !nickname) {
        setNickname(savedNick);
      }

      const savedRoom = localStorage.getItem('sc_last_room_code') || '';
      if (savedRoom) {
        setLastSavedRoom(savedRoom);
      }

      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam) {
        setInputCode(roomParam.trim());
        setTab('join');
      } else if (savedRoom) {
        setInputCode(savedRoom);
      }
    } catch {
      // Ignora erro de storage se indisponível
    }
  }, []);

  const handleNicknameChange = (val: string) => {
    setNickname(val);
    try {
      localStorage.setItem('sc_nickname', val);
    } catch {
      // ignore
    }
  };

  // Manipulador para o Host criar a sala
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

  // Manipulador para o Peer entrar na sala
  const handleJoinRoom = (codeToJoin?: string) => {
    const code = (codeToJoin || inputCode).trim();
    if (!nickname.trim()) {
      setErrorMsg('Digite seu apelido antes de entrar na sala.');
      return;
    }
    if (!code) {
      setErrorMsg('Cole o Código da Sala fornecido pelo Host.');
      return;
    }

    try {
      setErrorMsg(null);
      const decoded = decodeRoomCodeUrlSafe(code);

      const details: RoomDetails = {
        code: code,
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
        localStorage.setItem('sc_last_room_code', code);
        setLastSavedRoom(code);
      } catch {}
    } catch {
      setErrorMsg('Código da Sala inválido ou formato corrompido.');
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
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(
      roomDetails.code
    )}`;
    const shareText = `Entre na minha transmissão no StreamCompanion!\nCódigo da Sala: ${roomDetails.code}\nLink direto: ${shareUrl}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Convite para StreamCompanion',
          text: shareText,
          url: shareUrl,
        });
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
        return;
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    } catch (e) {
      console.warn('Erro ao copiar share link:', e);
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
            <span className="text-emerald-400 font-bold uppercase tracking-wider">
              {isHost ? 'Host' : 'Sala Ativa'}
            </span>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-200 font-semibold">{nickname}</span>
            <span className="text-neutral-600 hidden sm:inline">·</span>
            <span className="text-[11px] text-neutral-400 hidden sm:flex items-center gap-1">
              {roomDetails.mode === 'cloudflare' ? (
                <Globe className="w-3 h-3 text-cyan-400" />
              ) : (
                <Wifi className="w-3 h-3 text-indigo-400" />
              )}
              {roomDetails.mode === 'cloudflare' ? 'WAN Cloudflare' : 'LAN'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleCopyCode}
            className="sc-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-950 hover:bg-neutral-800 text-neutral-200 text-xs rounded-lg font-mono transition-all cursor-pointer border border-neutral-800"
            title="Copiar código da sala"
          >
            {copiedCode ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>{copiedCode ? 'Copiado!' : 'Código'}</span>
          </button>

          <button
            onClick={handleShareRoom}
            className="sc-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-950 hover:bg-neutral-800 text-neutral-200 text-xs rounded-lg font-mono transition-all cursor-pointer border border-neutral-800"
            title="Compartilhar link da sala"
          >
            {copiedShare ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span className="hidden sm:inline">{copiedShare ? 'Link Copiado!' : 'Convidar'}</span>
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
      <div className="sc-card sc-lobby-card bg-neutral-900/95 border border-neutral-800 rounded-2xl p-6 sm:p-7 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Identidade Central com o Novo Ícone */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <AppIcon size={68} showLiveDot={true} animated={true} />
          <div>
            <h2 className="text-xl font-black tracking-wider text-white font-mono uppercase">
              Stream<span className="text-cyan-400">Companion</span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Escolha seu apelido para criar ou entrar em uma sala P2P
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

        {/* Alternador: Criar Sala vs Entrar em Sala */}
        <div className="grid grid-cols-2 p-1 bg-neutral-950 border border-neutral-800 rounded-xl text-xs font-mono gap-1">
          <button
            type="button"
            onClick={() => {
              setTab('create');
              setErrorMsg(null);
            }}
            className={`sc-btn sc-btn-sized py-2.5 rounded-lg transition-all cursor-pointer font-bold ${
              tab === 'create'
                ? 'sc-btn-primary bg-cyan-500 text-black shadow'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Criar Sala
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('join');
              setErrorMsg(null);
            }}
            className={`sc-btn sc-btn-sized py-2.5 rounded-lg transition-all cursor-pointer font-bold ${
              tab === 'join'
                ? 'sc-btn-primary bg-cyan-500 text-black shadow'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Entrar em Sala
          </button>
        </div>

        {/* Conteúdo da Aba Selecionada */}
        {tab === 'create' ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Modo de Rede da Sala:</span>
                <span className="text-[11px] text-cyan-400 font-semibold">
                  {useCloudflare ? 'Internet (Cloudflare)' : 'Rede Local (LAN)'}
                </span>
              </div>
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
                  <span>Internet</span>
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
            </div>

            <button
              type="button"
              disabled={isCreating}
              onClick={handleCreateRoom}
              className="sc-btn sc-btn-primary sc-btn-sized w-full h-12 flex items-center justify-center gap-2 px-5 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>{isCreating ? 'Criando Sala...' : 'Criar Sala Agora'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Código da Sala:</span>
                {lastSavedRoom && (
                  <button
                    type="button"
                    onClick={() => setInputCode(lastSavedRoom)}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Usar Última Sala
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
                placeholder="Cole o código enviado pelo Host..."
                className="sc-input w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl px-4 text-xs text-white font-mono outline-none transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={() => handleJoinRoom()}
              className="sc-btn sc-btn-primary sc-btn-sized w-full h-12 flex items-center justify-center gap-2 px-5 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>Entrar na Sala</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        )}

        {errorMsg && (
          <p className="text-xs font-mono text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2 text-center">
            {errorMsg}
          </p>
        )}

        {/* Rodapé da Home: Atualizar App, Tema/CSS e Modo Estúdio */}
        <div className="pt-4 border-t border-neutral-800/80 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {onOpenUpdater && (
              <button
                type="button"
                onClick={onOpenUpdater}
                className="sc-btn flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs font-mono text-cyan-300 cursor-pointer transition-colors"
              >
                <ArrowUpCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Atualizar App</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsCustomizerOpen(true)}
              className="sc-btn flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs font-mono text-neutral-200 cursor-pointer transition-colors"
            >
              <Palette className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Personalizar UI</span>
            </button>
          </div>

          {onEnterLocalStudio && (
            <button
              type="button"
              onClick={onEnterLocalStudio}
              className="w-full py-2 text-[11px] font-mono text-neutral-400 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-neutral-500" />
              <span>Abrir Estúdio Local (Testar Câmera, Tela e Áudio sem Sala)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
