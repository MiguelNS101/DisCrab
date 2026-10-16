import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  MessageSquare,
  ShieldAlert,
  Paperclip,
  Image as ImageIcon,
  File as FileIcon,
  Download,
  X,
  ExternalLink,
  UploadCloud,
  CheckCircle2,
  Smile,
  Loader2,
} from 'lucide-react';
import { ChatMessage, ChatAttachment } from '../types';
import { ChatEmotePicker } from './ChatEmotePicker';
import { downloadFileWithSaveDialog } from '../services/tauriBridge';

interface ChatBoxProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, attachment?: ChatAttachment) => void;
  isConnected: boolean;
  peerCount: number;
  myNickname: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
  const [selectedFile, setSelectedFile] = useState<ChatAttachment | null>(null);
  const [previewModalImg, setPreviewModalImg] = useState<{ url: string; name: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEmotePicker, setShowEmotePicker] = useState(false);
  const [savingFileMap, setSavingFileMap] = useState<Record<string, boolean>>({});
  const [saveModalTarget, setSaveModalTarget] = useState<{
    name: string;
    dataUrl: string;
    size?: number;
    isImage?: boolean;
  } | null>(null);
  const [customSaveName, setCustomSaveName] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll ao receber nova mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedFile]);

  // Processa arquivo selecionado SEM LIMITE DE TAMANHO
  const processFile = useCallback((file: File) => {
    setSendError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const isImg = file.type.startsWith('image/');
      setSelectedFile({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
        isImage: isImg,
      });
    };
    reader.onerror = () => {
      setSendError('Falha ao processar o arquivo selecionado.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      e.target.value = '';
    }
  };

  // Suporte a colar imagens diretamente da área de transferência (Ctrl+V)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            break;
          }
        }
      }
    },
    [processFile]
  );

  // Suporte a Drag & Drop de arquivos e fotos sobre o chat
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSendError(null);

    const trimmed = inputText.trim();
    if (!trimmed && !selectedFile) return;

    if (!isConnected) {
      setSendError('Você precisa criar ou entrar em uma sala antes de enviar mensagens.');
      return;
    }

    if (peerCount === 0) {
      setSendError(
        'Nenhum outro peer está na sala para receber mensagens P2P no momento. Compartilhe o Código da Sala com um amigo.'
      );
      return;
    }

    setIsSending(true);
    try {
      onSendMessage(trimmed, selectedFile || undefined);
      setInputText('');
      setSelectedFile(null);
      setShowEmotePicker(false);
    } catch (err: any) {
      setSendError(err?.message || 'Falha ao transmitir mensagem via RTCDataChannel.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Abre a tela de escolha de local e confirmação de salvamento
  const openSaveModal = (name: string, dataUrl: string, size?: number, isImage?: boolean) => {
    setSaveModalTarget({ name, dataUrl, size, isImage });
    setCustomSaveName(name);
  };

  const handleConfirmSave = async () => {
    if (!saveModalTarget) return;
    const finalName = customSaveName.trim() || saveModalTarget.name;
    setSavingFileMap((prev) => ({ ...prev, [saveModalTarget.name]: true }));
    try {
      await downloadFileWithSaveDialog(finalName, saveModalTarget.dataUrl);
      setSaveModalTarget(null);
    } catch (err) {
      console.error('[ChatBox] Erro ao salvar arquivo:', err);
    } finally {
      setSavingFileMap((prev) => ({ ...prev, [saveModalTarget.name]: false }));
    }
  };

  const handleDownloadFile = async (name: string, dataUrl: string) => {
    openSaveModal(name, dataUrl);
  };

  // Inserção de Emote ou Kaomoji no texto
  const handleSelectEmote = (emote: string) => {
    setInputText((prev) => prev + emote);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Envio de GIF selecionado da API
  const handleSelectGif = (gifUrl: string, title: string) => {
    if (!isConnected) {
      setSendError('Conecte-se a uma sala antes de enviar GIFs.');
      return;
    }
    if (peerCount === 0) {
      setSendError('Aguarde amigos entrarem na sala para enviar GIFs.');
      return;
    }

    setShowEmotePicker(false);
    try {
      const gifName = `${title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'gif'}.gif`;
      onSendMessage('', {
        name: gifName,
        type: 'image/gif',
        size: 300000,
        dataUrl: gifUrl,
        isImage: true,
      });
    } catch (err: any) {
      setSendError(err?.message || 'Falha ao transmitir GIF via DataChannel.');
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-neutral-900/90 border rounded-xl p-4 shadow-xl flex flex-col h-80 sm:h-96 relative transition-colors ${
        isDragOver ? 'border-cyan-400 bg-neutral-900/95 ring-2 ring-cyan-500/30' : 'border-neutral-800'
      }`}
    >
      {/* Overlay de Drag & Drop */}
      {isDragOver && (
        <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center rounded-xl border-2 border-dashed border-cyan-400">
          <UploadCloud className="w-12 h-12 text-cyan-400 animate-bounce mb-2" />
          <h4 className="font-mono font-bold text-sm text-cyan-200">Solte o arquivo ou imagem aqui</h4>
          <p className="font-mono text-xs text-neutral-400 mt-1">
            Envio P2P direto via WebRTC · Sem limite de tamanho
          </p>
        </div>
      )}

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
      <div className="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1 text-xs font-mono">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 text-xs px-4">
            <MessageSquare className="w-8 h-8 text-neutral-700 mb-2 opacity-50" />
            <p className="font-semibold text-neutral-400">Nenhuma mensagem no chat</p>
            <p className="text-[11px] text-neutral-600 mt-1">
              Envie mensagens, emotes, kaomojis, GIFs e arquivos sem limite de tamanho direto pelo DataChannel.
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
                  className={`max-w-[85%] rounded-lg p-2.5 text-xs break-words shadow-sm space-y-1.5 ${
                    msg.isSelf
                      ? 'bg-cyan-950/70 border border-cyan-800/80 text-cyan-100'
                      : 'bg-neutral-950 border border-neutral-800 text-neutral-200'
                  }`}
                >
                  {/* Texto da Mensagem */}
                  {msg.text && <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>}

                  {/* Anexo de Imagem ou GIF */}
                  {msg.attachment?.isImage && (
                    <div className="mt-1 rounded overflow-hidden border border-neutral-800 bg-neutral-900/50">
                      <img
                        src={msg.attachment.dataUrl}
                        alt={msg.attachment.name}
                        onClick={() =>
                          setPreviewModalImg({
                            url: msg.attachment!.dataUrl,
                            name: msg.attachment!.name,
                          })
                        }
                        className="max-h-48 max-w-full rounded cursor-pointer hover:opacity-95 transition-opacity object-contain bg-black/40"
                      />
                      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-neutral-400 bg-neutral-950/60">
                        <span className="truncate max-w-[150px]">{msg.attachment.name}</span>
                        <div className="flex items-center gap-2">
                          <span>{formatBytes(msg.attachment.size)}</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadFile(msg.attachment!.name, msg.attachment!.dataUrl)
                            }
                            disabled={savingFileMap[msg.attachment.name]}
                            className="text-cyan-400 hover:text-white flex items-center gap-1 cursor-pointer"
                            title="Escolher onde salvar o arquivo"
                          >
                            {savingFileMap[msg.attachment.name] ? (
                              <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Anexo de Arquivo Genérico */}
                  {msg.attachment && !msg.attachment.isImage && (
                    <div className="flex items-center justify-between gap-3 p-2 rounded bg-neutral-900 border border-neutral-800 mt-1">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div className="overflow-hidden">
                          <span className="block truncate font-semibold text-neutral-200">
                            {msg.attachment.name}
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            {formatBytes(msg.attachment.size)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadFile(msg.attachment!.name, msg.attachment!.dataUrl)
                        }
                        disabled={savingFileMap[msg.attachment.name]}
                        className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-[11px] rounded transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                        title="Escolher local no computador para salvar o arquivo"
                      >
                        {savingFileMap[msg.attachment.name] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>Salvar</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Popover de Emotes, Kaomojis e GIFs */}
      {showEmotePicker && (
        <ChatEmotePicker
          onSelectEmote={handleSelectEmote}
          onSelectGif={handleSelectGif}
          onClose={() => setShowEmotePicker(false)}
        />
      )}

      {/* Alerta de Erro se Houver Falha */}
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

      {/* Pré-visualização do Anexo Selecionado para Envio */}
      {selectedFile && (
        <div className="mb-2 p-2 rounded bg-neutral-950 border border-cyan-500/50 flex items-center justify-between gap-2 text-xs font-mono shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            {selectedFile.isImage ? (
              <img
                src={selectedFile.dataUrl}
                alt={selectedFile.name}
                className="w-9 h-9 rounded object-cover border border-neutral-700 shrink-0"
              />
            ) : (
              <FileIcon className="w-6 h-6 text-cyan-400 shrink-0" />
            )}
            <div className="overflow-hidden">
              <span className="block truncate text-neutral-200 font-semibold text-[11px]">
                {selectedFile.name}
              </span>
              <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                {formatBytes(selectedFile.size)} · Pronto para envio P2P (Sem Limite)
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            className="p-1 text-neutral-400 hover:text-red-400 rounded transition-colors cursor-pointer"
            title="Remover anexo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Caixa de Entrada de Texto e Botões */}
      <form onSubmit={handleSend} className="flex items-center gap-1.5 pt-2 border-t border-neutral-800 shrink-0">
        {/* Input Oculto de Imagens */}
        <input
          ref={imageInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
          accept="image/*"
        />

        {/* Input Oculto de Arquivos Gerais (Sem limite) */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
          accept="*/*"
        />

        {/* Botão de Emotes, Kaomojis e GIFs */}
        <button
          type="button"
          onClick={() => setShowEmotePicker(!showEmotePicker)}
          className={`p-2 rounded-lg border transition-colors cursor-pointer shrink-0 ${
            showEmotePicker
              ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
              : 'bg-neutral-950 hover:bg-neutral-800 text-neutral-400 hover:text-cyan-400 border-neutral-800'
          }`}
          title="Inserir Emotes, Kaomojis e GIFs gratuitos"
        >
          <Smile className="w-4 h-4" />
        </button>

        {/* Botão de Enviar Imagem */}
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={!isConnected}
          className="p-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-neutral-400 hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-800 transition-colors cursor-pointer shrink-0"
          title="Enviar imagem (ou cole com Ctrl+V)"
        >
          <ImageIcon className="w-4 h-4" />
        </button>

        {/* Botão de Enviar Arquivo (Sem Limite) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!isConnected}
          className="p-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-neutral-400 hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-800 transition-colors cursor-pointer shrink-0"
          title="Enviar qualquer arquivo (PDF, ZIP, vídeos, documentos - Sem Limite)"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            !isConnected
              ? 'Conecte-se a uma sala para enviar...'
              : peerCount === 0
              ? 'Aguardando amigos entrarem...'
              : selectedFile
              ? 'Adicione uma legenda ou envie...'
              : 'Mensagem, emotes, GIFs, arquivos...'
          }
          disabled={!isConnected}
          className="flex-1 bg-neutral-950 border border-neutral-800 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 outline-none transition-colors"
        />

        <button
          type="submit"
          disabled={!isConnected || (!inputText.trim() && !selectedFile) || isSending}
          className="flex items-center justify-center p-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-neutral-800 disabled:text-neutral-500 text-black transition-all cursor-pointer shadow-md shadow-cyan-950/50 shrink-0"
          title="Enviar via WebRTC DataChannel P2P"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Modal Lightbox de Visualização de Imagem */}
      {previewModalImg && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewModalImg(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewModalImg.url}
              alt="Visualização"
              className="max-w-full max-h-[85vh] rounded-lg border border-neutral-800 shadow-2xl object-contain"
            />
            <div className="absolute top-2 right-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleDownloadFile(previewModalImg.name || 'imagem.png', previewModalImg.url)
                }
                className="p-1.5 rounded-full bg-neutral-900/90 border border-neutral-700 text-white hover:bg-cyan-600 transition-colors cursor-pointer shadow-lg"
                title="Escolher onde salvar a imagem"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewModalImg(null)}
                className="p-1.5 rounded-full bg-neutral-900/90 border border-neutral-700 text-white hover:bg-red-600 transition-colors cursor-pointer shadow-lg"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tela / Modal para Escolher Local e Nome para Salvar o Arquivo */}
      {saveModalTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setSaveModalTarget(null)}
        >
          <div
            className="w-full max-w-md bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl p-5 space-y-4 font-mono text-xs text-neutral-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
              <div className="flex items-center gap-2 font-bold text-sm text-white">
                <Download className="w-4 h-4 text-cyan-400" />
                <span>Salvar Arquivo</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveModalTarget(null)}
                className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
                {saveModalTarget.isImage ? (
                  <img
                    src={saveModalTarget.dataUrl}
                    alt="Preview"
                    className="w-12 h-12 rounded object-cover border border-neutral-700 shrink-0"
                  />
                ) : (
                  <FileIcon className="w-8 h-8 text-cyan-400 shrink-0" />
                )}
                <div className="overflow-hidden space-y-1">
                  <span className="block truncate font-semibold text-neutral-200 text-xs">
                    {saveModalTarget.name}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                    {saveModalTarget.size && <span>{formatBytes(saveModalTarget.size)}</span>}
                    <span>·</span>
                    <span className="text-emerald-400">P2P Integridade Verificada</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-neutral-400 font-semibold block">
                  Nome do arquivo para salvar:
                </label>
                <input
                  type="text"
                  value={customSaveName}
                  onChange={(e) => setCustomSaveName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 outline-none"
                  placeholder="Nome do arquivo..."
                />
              </div>

              <p className="text-[10px] text-neutral-400 leading-relaxed bg-neutral-950/70 p-2.5 rounded border border-neutral-800">
                💡 O aplicativo abrirá a janela nativa do seu sistema (Explorer / Diálogo de Arquivos) para você escolher em qual pasta do seu disco deseja salvar o arquivo.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setSaveModalTarget(null)}
                className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-neutral-300 text-xs cursor-pointer font-mono"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={savingFileMap[saveModalTarget.name]}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase tracking-wider font-mono cursor-pointer shadow-md shadow-cyan-950 disabled:opacity-50"
              >
                {savingFileMap[saveModalTarget.name] ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Abrindo Seletor...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Escolher Local & Salvar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
