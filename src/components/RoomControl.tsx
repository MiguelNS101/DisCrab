import React, { useState } from 'react';
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
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  const handleJoinRoom = () => {
    if (!nickname.trim()) {
      setErrorMsg('Digite seu apelido antes de entrar na sala.');
      return;
    }
    if (!inputCode.trim()) {
      setErrorMsg('Cole o Código da Sala fornecido pelo Host.');
      return;
    }

    try {
      setErrorMsg(null);
      const decoded = decodeRoomCodeUrlSafe(inputCode);

      const details: RoomDetails = {
        code: inputCode.trim(),
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
    } catch (err: any) {
      setErrorMsg('Código da Sala inválido ou formato corrompido.');
    }
  };

  const handleCopyCode = () => {
    if (!roomDetails) return;
    navigator.clipboard.writeText(roomDetails.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

          {/* Cartão de Exibição do Código da Sala */}
          <div className="bg-neutral-950 border border-cyan-900/40 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span className="font-mono text-cyan-400 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                CÓDIGO DA SALA (Envie para seus amigos):
              </span>
              <span className="font-mono text-[11px] text-neutral-400">
                Token: <strong className="text-white">{roomDetails.token}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 font-mono text-sm sm:text-base font-bold text-cyan-300 tracking-wider overflow-x-auto select-all">
                {roomDetails.code}
              </div>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-black font-semibold text-xs rounded transition-all cursor-pointer font-mono shadow-md shadow-cyan-950"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-950" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>

            {/* Informações técnicas do túnel */}
            <div className="mt-3 pt-3 border-t border-neutral-900 flex flex-wrap gap-4 text-[11px] font-mono text-neutral-400">
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
                100% P2P e sem cadastro: gere um código seguro e envie para seus amigos.
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

          {/* Campo Nickname */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-mono text-neutral-400">Seu Apelido no Chat/Sala:</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
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
                  <label className="text-xs font-mono text-neutral-400">Código da Sala Base64:</label>
                  <input
                    type="text"
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value)}
                    placeholder="Cole o código (ex: YWJjLXh5ejo5OTg4)"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded px-3 py-2 text-sm text-neutral-200 font-mono outline-none transition-colors"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleJoinRoom}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold text-xs uppercase tracking-wider rounded transition-all cursor-pointer shadow-lg shadow-cyan-950/50"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Conectar à Sala
                  </button>
                </div>
              </>
            )}
          </div>

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
