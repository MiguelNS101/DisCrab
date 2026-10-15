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
      setErrorMsg(
        'A criação do Servidor WebSocket local e do túnel Cloudflare em background requer a execução no aplicativo desktop compilado (StreamCompanion.exe). No navegador, utilize a aba "Entrar na Sala (Peer)" para se conectar com um Código de Sala gerado por um Host.'
      );
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
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-semibold">
                Sessão Ativa · {isHost ? 'Você é o Host da Sala' : 'Conectado como Peer'}
              </span>
            </div>

            <button
              onClick={handleLeaveRoom}
              className="flex items-center gap-1.5 px-3 py-1 bg-red-950/40 hover:bg-red-900/60 border border-red-700/50 text-red-300 text-xs rounded font-mono transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair da Sala
            </button>
          </div>

          {/* Cartão de Exibição do Código da Sala com Compartilhamento */}
          <div className="bg-neutral-950 border border-cyan-900/40 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1 flex-wrap gap-2">
              <span className="font-mono text-cyan-400 flex items-center gap-1.5 font-bold">
                <KeyRound className="w-3.5 h-3.5" />
                CÓDIGO DA SALA (Envie para seus amigos):
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-neutral-400">
                  Token: <strong className="text-white">{roomDetails.token}</strong>
                </span>
                {lastSavedRoom === roomDetails.code && (
                  <span className="text-emerald-400 flex items-center gap-1 text-[10px] bg-emerald-950/60 border border-emerald-900 px-1.5 py-0.2 rounded">
                    <BookmarkCheck className="w-3 h-3" />
                    Salvo
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-[200px] bg-neutral-900 border border-neutral-800 rounded px-3 py-2 font-mono text-sm sm:text-base font-bold text-cyan-300 tracking-wider overflow-x-auto select-all">
                {roomDetails.code}
              </div>

              {/* Botão de Copiar Código */}
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white font-semibold text-xs rounded transition-all cursor-pointer font-mono border border-neutral-700"
                title="Copiar apenas o código alfanumérico da sala"
              >
                {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copiedCode ? 'Código Copiado!' : 'Copiar'}
              </button>

              {/* Botão de Compartilhar Sala (Link + Código) */}
              <button
                onClick={handleShareRoom}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-black font-semibold text-xs rounded transition-all cursor-pointer font-mono shadow-md shadow-cyan-950"
                title="Compartilhar link de convite direto para entrar na sala"
              >
                {copiedShare ? <Check className="w-4 h-4 text-emerald-950" /> : <Share2 className="w-4 h-4" />}
                {copiedShare ? 'Link Copiado!' : 'Compartilhar Sala'}
              </button>
            </div>

            {/* Informações técnicas do túnel */}
            <div className="mt-3 pt-3 border-t border-neutral-900 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-neutral-400">
              <div className="flex items-center gap-1.5">
                {roomDetails.mode === 'cloudflare' ? (
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                ) : (
                  <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>
                  Tipo:{' '}
                  <strong className="text-neutral-200">
                    {roomDetails.mode === 'cloudflare' ? 'Cloudflare Quick Tunnel' : 'LAN Direta'}
                  </strong>
                </span>
              </div>

              <div>
                Endpoint WebSocket:{' '}
                <span className="text-neutral-300 underline">{roomDetails.ws_url}</span>
              </div>
            </div>
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

          {/* Campo Nickname e Opções Rápidas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Seu Apelido no Chat/Sala:</span>
                <span className="text-[10px] text-cyan-400 flex items-center gap-1">
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
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded px-3 py-2 text-sm text-neutral-200 font-mono outline-none transition-colors"
              />
            </div>

            {/* Conteúdo Dinâmico da Aba */}
            {tab === 'create' ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-neutral-400">Método de Conexão:</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUseCloudflare(true)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded border cursor-pointer font-mono transition-all ${
                        useCloudflare
                          ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300 font-bold'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Cloudflare Tunnel (Internet)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseCloudflare(false)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded border cursor-pointer font-mono transition-all ${
                        !useCloudflare
                          ? 'bg-indigo-950/60 border-indigo-500 text-indigo-300 font-bold'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                      }`}
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      LAN Direta
                    </button>
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleCreateRoom}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-black font-mono font-bold text-xs uppercase tracking-wider rounded transition-all cursor-pointer shadow-lg shadow-cyan-950/50"
                  >
                    <Sparkles className="w-4 h-4 text-neutral-950" />
                    Criar Sala & Gerar Código
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1 md:col-span-1">
                  <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                    <span>Código da Sala Base64:</span>
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
                    placeholder="Cole o código (ex: YWJjLXh5ejo5OTg4)"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded px-3 py-2 text-sm text-neutral-200 font-mono outline-none transition-colors"
                  />
                </div>

                <div className="flex items-end gap-2">
                  <button
                    onClick={() => handleJoinRoom()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded transition-all cursor-pointer shadow-lg shadow-cyan-950/50"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Conectar à Sala
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
