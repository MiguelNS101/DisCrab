import React, { useState, useEffect } from 'react';
import {
  Radio,
  KeyRound,
  Copy,
  Check,
  Globe,
  Wifi,
  Users,
  ArrowRight,
  LogOut,
  Sparkles,
  Share2,
  BookmarkCheck,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { RoomDetails } from '../types';
import { encodeRoomCodeUrlSafe, decodeRoomCodeUrlSafe, createNativeRoom, isTauriEnvironment } from '../services/tauriBridge';

interface RoomControlProps {
  nickname: string;
  setNickname: (name: string) => void;
  roomDetails: RoomDetails | null;
  setRoomDetails: (details: RoomDetails | null) => void;
  isHost: boolean;
  setIsHost: (val: boolean) => void;
  isConnected: boolean;
  setIsConnected: (val: boolean) => void;
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
}) => {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [useCloudflare, setUseCloudflare] = useState<boolean>(true);
  const [inputCode, setInputCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSavedRoom, setLastSavedRoom] = useState<string>('');

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

      // Parâmetro de URL: ?room=<codigo>
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

    if (isTauriEnvironment()) {
      try {
        const res = await createNativeRoom(nickname.trim(), useCloudflare);
        const details: RoomDetails = {
          code: res.room_code,
          token: res.token,
          mode: res.mode as any,
          // Para o Host, a conexão local em loopback 127.0.0.1 é instantânea (0ms) e imune a atrasos de DNS/WAN
          ws_url: `ws://127.0.0.1:${res.local_port}`,
          subdomain: res.public_url ? res.public_url.replace(/^https?:\/\//, '').replace(/\..*$/, '') : undefined,
          local_ip: res.local_ip,
          local_port: res.local_port,
          created_at: Date.now(),
        };

        setRoomDetails(details);
        setIsHost(true);
        setIsConnected(true);

        // Salva no localStorage para reconexão futura
        try {
          localStorage.setItem('sc_last_room_code', res.room_code);
          setLastSavedRoom(res.room_code);
        } catch {
          // ignore
        }
      } catch (err: any) {
        setErrorMsg(`Erro ao criar sala nativa: ${err?.message || err}`);
      }
    } else {
      // Modo Web / Full-Stack: Cria a sala no servidor de sinalização Web
      try {
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
          local_port: parseInt(window.location.port || (window.location.protocol === 'https:' ? '443' : '80'), 10),
          created_at: Date.now(),
        };

        setRoomDetails(details);
        setIsHost(true);
        setIsConnected(true);

        try {
          localStorage.setItem('sc_last_room_code', data.room_code);
          setLastSavedRoom(data.room_code);
        } catch {
          // ignore
        }
      } catch (err: any) {
        setErrorMsg(`Falha ao criar sala no servidor web: ${err?.message || err}`);
      }
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

      // Salva no localStorage para reconexão futura
      try {
        localStorage.setItem('sc_last_room_code', code);
        setLastSavedRoom(code);
      } catch {
        // ignore
      }
    } catch (err: any) {
      setErrorMsg('Código da Sala inválido ou formato corrompido.');
    }
  };

  const handleCopyCode = () => {
    if (!roomDetails) return;
    navigator.clipboard.writeText(roomDetails.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Compartilha o link direto com ?room=... ou abre o diálogo nativo do sistema
  const handleShareRoom = async () => {
    if (!roomDetails) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomDetails.code)}`;
    const shareText = `🎮 Entre na minha transmissão no StreamCompanion!\nCódigo da Sala: ${roomDetails.code}\nLink direto: ${shareUrl}`;

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
      } catch {
        // usuário cancelou ou indisponível, segue para cópia na área de transferência
      }
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

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-5 shadow-xl relative overflow-hidden">
      {/* Glow Cyberpunk de fundo */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Se já estiver conectado na sala */}
      {isConnected && roomDetails ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-emerald-400 font-bold uppercase tracking-wider">
                {isHost ? 'Host da Sala' : 'Conectado'}
              </span>
              <span className="text-neutral-500">·</span>
              <span className="text-neutral-300 font-semibold">{nickname}</span>
              <span className="text-neutral-500">·</span>
              <span className="text-[11px] text-neutral-400 flex items-center gap-1">
                {roomDetails.mode === 'cloudflare' ? (
                  <Globe className="w-3 h-3 text-cyan-400" />
                ) : (
                  <Wifi className="w-3 h-3 text-indigo-400" />
                )}
                {roomDetails.mode === 'cloudflare' ? 'WAN Cloudflare' : 'Rede LAN'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Botão de Copiar Código da Sala */}
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-200 text-xs rounded font-mono transition-all cursor-pointer border border-neutral-700"
              title="Copiar código da sala para a área de transferência"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? 'Código Copiado!' : 'Copiar Código'}
            </button>

            {/* Botão de Compartilhar Sala */}
            <button
              onClick={handleShareRoom}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs rounded font-mono transition-all cursor-pointer shadow-md shadow-cyan-950"
              title="Compartilhar convite da sala"
            >
              {copiedShare ? <Check className="w-3.5 h-3.5 text-emerald-950" /> : <Share2 className="w-3.5 h-3.5" />}
              {copiedShare ? 'Link Copiado!' : 'Compartilhar Sala'}
            </button>

            {/* Sair da Sala */}
            <button
              onClick={handleLeaveRoom}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 text-xs rounded font-mono transition-colors cursor-pointer"
              title="Sair da sala e desconectar WebRTC"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      ) : (
        /* Se NÃO estiver conectado: Formulário de Criar ou Entrar */
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                Conectar ou Iniciar Transmissão
              </h2>
              <p className="text-xs text-neutral-400">
                100% P2P e sem cadastro: apelido e última sala salvos automaticamente para acesso rápido.
              </p>
            </div>

            {/* Alternador Criar / Entrar */}
            <div className="flex bg-neutral-950 border border-neutral-800 rounded-lg p-0.5 text-xs font-mono">
              <button
                onClick={() => setTab('create')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  tab === 'create'
                    ? 'bg-cyan-500 text-black font-bold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Criar Sala (Host)
              </button>
              <button
                onClick={() => setTab('join')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  tab === 'join'
                    ? 'bg-cyan-500 text-black font-bold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Entrar na Sala (Peer)
              </button>
            </div>
          </div>

          {/* Campo Nickname e Opções Rápidas Perfeitamente Alinhadas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-end">
            {/* Coluna 1: Apelido */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="h-6 flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Seu Apelido:</span>
                <span className="text-[10px] text-cyan-400 flex items-center gap-1 font-semibold">
                  <BookmarkCheck className="w-3 h-3" />
                  Salvo
                </span>
              </div>
              <input
                type="text"
                value={nickname}
                onChange={(e) => handleNicknameChange(e.target.value)}
                placeholder="Ex: Ghost_Rider"
                maxLength={24}
                className="w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-lg px-3.5 text-xs text-neutral-200 font-mono outline-none transition-colors"
              />
            </div>

            {/* Conteúdo Dinâmico da Aba */}
            {tab === 'create' ? (
              <>
                {/* Coluna 2: Método de Conexão */}
                <div className="space-y-1.5 flex flex-col justify-end">
                  <div className="h-6 flex items-center justify-between text-xs font-mono text-neutral-400">
                    <span>Método de Conexão:</span>
                    <span className="text-[10px] text-neutral-400">
                      {useCloudflare ? 'P2P Global (Internet)' : 'P2P Local (LAN)'}
                    </span>
                  </div>
                  <div className="h-11 flex p-1 bg-neutral-950 border border-neutral-800 rounded-lg gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUseCloudflare(true)}
                      className={`flex-1 h-full flex items-center justify-center gap-1.5 px-2 text-xs rounded-md cursor-pointer font-mono transition-all ${
                        useCloudflare
                          ? 'bg-cyan-950/80 border border-cyan-500/60 text-cyan-300 font-bold shadow-sm'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                      title="Túnel Cloudflare: Amigos conectam de qualquer lugar pela Internet sem abrir portas"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Internet</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseCloudflare(false)}
                      className={`flex-1 h-full flex items-center justify-center gap-1.5 px-2 text-xs rounded-md cursor-pointer font-mono transition-all ${
                        !useCloudflare
                          ? 'bg-indigo-950/80 border border-indigo-500/60 text-indigo-300 font-bold shadow-sm'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                      title="LAN Direta: Conexão via rede local Wi-Fi ou Ethernet"
                    >
                      <Wifi className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Rede LAN</span>
                    </button>
                  </div>
                </div>

                {/* Coluna 3: Botão de Criar Sala */}
                <div className="space-y-1.5 flex flex-col justify-end">
                  <div className="h-6 flex items-center justify-between text-xs font-mono text-neutral-400">
                    <span>Ação Host:</span>
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      Pronto
                    </span>
                  </div>
                  <button
                    onClick={handleCreateRoom}
                    className="w-full h-11 flex items-center justify-center gap-2 px-4 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-lg shadow-cyan-950/50"
                  >
                    <Sparkles className="w-4 h-4 text-neutral-950 shrink-0" />
                    <span>Criar Sala & Código</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Coluna 2: Código da Sala */}
                <div className="space-y-1.5 flex flex-col justify-end">
                  <div className="h-6 flex items-center justify-between text-xs font-mono text-neutral-400">
                    <span>Código da Sala:</span>
                    {lastSavedRoom && (
                      <button
                        type="button"
                        onClick={() => setInputCode(lastSavedRoom)}
                        className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                        title="Preencher com o último código usado"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Última Sala
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value)}
                    placeholder="Cole o código gerado pelo Host"
                    className="w-full h-11 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-lg px-3.5 text-xs text-neutral-200 font-mono outline-none transition-colors"
                  />
                </div>

                {/* Coluna 3: Botão de Conectar */}
                <div className="space-y-1.5 flex flex-col justify-end">
                  <div className="h-6 flex items-center justify-between text-xs font-mono text-neutral-400">
                    <span>Ação Peer:</span>
                    <span className="text-[10px] text-cyan-400 font-semibold flex items-center gap-1">
                      <KeyRound className="w-3 h-3" />
                      Conectar
                    </span>
                  </div>
                  <button
                    onClick={() => handleJoinRoom()}
                    className="w-full h-11 flex items-center justify-center gap-2 px-4 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-lg shadow-cyan-950/50"
                  >
                    <ArrowRight className="w-4 h-4 shrink-0" />
                    <span>Conectar à Sala</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Atalho de Entrada Rápida se houver sala salva */}
          {tab === 'join' && lastSavedRoom && inputCode !== lastSavedRoom && (
            <div className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono">
              <span className="text-neutral-400 truncate max-w-[240px] sm:max-w-md">
                Última sala acessada: <strong className="text-cyan-300">{lastSavedRoom}</strong>
              </span>
              <button
                onClick={() => {
                  setInputCode(lastSavedRoom);
                  handleJoinRoom(lastSavedRoom);
                }}
                className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer shrink-0 ml-2"
              >
                <span>Entrar Automaticamente</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="text-xs font-mono text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-1.5">
              {errorMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
