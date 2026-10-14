import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare, Users, ShieldAlert, Sparkles, CheckCheck } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatBoxProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isConnected: boolean;
  peerCount: number;
  myNickname: string;
}

export const ChatBox: React.FC<ChatBoxProps> = ({
  messages,
  onSendMessage,
  isConnected,
  peerCount,
  myNickname,
}) => {
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll ao receber nova mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSendError(null);

    const trimmed = inputText.trim();
    if (!trimmed) return;

    if (!isConnected) {
      setSendError('Você precisa criar ou entrar em uma sala antes de enviar mensagens.');
      return;
    }

    if (peerCount === 0) {
      setSendError('Nenhum outro peer está na sala para receber mensagens P2P no momento. Compartilhe o Código da Sala com um amigo.');
      return;
    }

    try {
      onSendMessage(trimmed);
      setInputText('');
    } catch (err: any) {
      setSendError(err?.message || 'Falha ao transmitir mensagem via RTCDataChannel.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 shadow-xl flex flex-col h-80 sm:h-96">
      {/* Cabeçalho do Chat */}
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-200">
            Chat P2P WebRTC (DataChannel)
          </h3>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-mono">
          {isConnected ? (
            peerCount > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                P2P Direto ({peerCount} {peerCount === 1 ? 'peer' : 'peers'})
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded">
                Aguardando Peers
              </span>
            )
          ) : (
            <span className="text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
              Desconectado
            </span>
          )}
        </div>
      </div>

      {/* Lista de Mensagens */}
      <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 text-xs font-mono">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 text-xs px-4">
            <MessageSquare className="w-8 h-8 text-neutral-700 mb-2 opacity-50" />
            <p className="font-semibold text-neutral-400">Nenhuma mensagem no chat</p>
            <p className="text-[11px] text-neutral-600 mt-1">
              As mensagens são transmitidas diretamente ponto a ponto entre os computadores conectados via RTCDataChannel criptografado, sem passar por banco de dados.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5 px-1 text-[10px] text-neutral-400">
                  <span className={`font-semibold ${msg.isSelf ? 'text-cyan-300' : 'text-neutral-300'}`}>
                    {msg.senderName}
                  </span>
                  <span>·</span>
                  <span className="text-neutral-500">{timeStr}</span>
                </div>

                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs break-words shadow-sm ${
                    msg.isSelf
                      ? 'bg-cyan-950/70 border border-cyan-800/80 text-cyan-100'
                      : 'bg-neutral-950 border border-neutral-800 text-neutral-200'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Alerta de Erro se Houver Falha Real */}
      {sendError && (
        <div className="mb-2 p-2 rounded bg-red-950/70 border border-red-800 text-red-300 text-[11px] font-mono flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">{sendError}</span>
          </div>
          <button
            onClick={() => setSendError(null)}
            className="text-red-400 hover:text-white px-1 font-bold cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Caixa de Entrada de Texto */}
      <form onSubmit={handleSend} className="flex items-center gap-2 pt-2 border-t border-neutral-800 shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !isConnected
              ? 'Conecte-se a uma sala para enviar mensagens...'
              : peerCount === 0
              ? 'Aguardando amigos entrarem na sala...'
              : 'Digite sua mensagem e pressione Enter...'
          }
          disabled={!isConnected}
          className="flex-1 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 outline-none transition-colors"
        />

        <button
          type="submit"
          disabled={!isConnected || !inputText.trim()}
          className="flex items-center justify-center p-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-neutral-800 disabled:text-neutral-500 text-black transition-all cursor-pointer shadow-md shadow-cyan-950/50"
          title="Enviar mensagem via WebRTC DataChannel"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
