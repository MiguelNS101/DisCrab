import React, { useState, useEffect, useRef } from 'react';
import { Smile, Sparkles, Image as ImageIcon, Search, X, Flame, Heart, Gamepad2, ThumbsUp, Loader2 } from 'lucide-react';

interface ChatEmotePickerProps {
  onSelectEmote: (emote: string) => void;
  onSelectGif: (gifUrl: string, title: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: 'Games & Tech',
    icon: Gamepad2,
    emojis: ['🎮', '🕹️', '👾', '🎯', '🎲', '🏆', '🥇', '⚔️', '🛡️', '🚀', '💻', '🖥️', '⚡', '🔥', '💥', '🎧', '🔊', '🤖', '👑', '💎'],
  },
  {
    name: 'Reações & Caras',
    icon: Smile,
    emojis: ['😂', '🤣', '😭', '💀', '🤡', '😈', '🥳', '😎', '🤔', '😴', '🤮', '🤯', '🥺', '🥶', '🥵', '😇', '🤫', '😏', '🫡', '🙄'],
  },
  {
    name: 'Gestos',
    icon: ThumbsUp,
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤘', '👊', '🤙', '👀', '🧠', '🦾', '🙏', '💪', '🤌', '🖕', '👋', '🤛', '🤜', '🤳'],
  },
  {
    name: 'Símbolos & Amor',
    icon: Heart,
    emojis: ['❤️', '💔', '💖', '💯', '💢', '✨', '🌟', '💣', '💫', '💬', '⚠️', '🚩', '⛔', '✔️', '❌', '🔥', '🎉', '🍿', '☕', '🍻'],
  },
];

const KAOMOJI_CATEGORIES = [
  {
    name: 'Alegria & Vitória',
    items: [
      '(≧◡≦)',
      '(*^▽^*)',
      '(＾▽＾)',
      '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
      '＼(＾▽＾)／',
      '(づ｡◕‿‿◕｡)づ',
      '٩(◕‿◕｡)۶',
      '(✿◠‿◠)',
      '(*≧ω≦*)',
      '╰(▔∀▔)╯',
    ],
  },
  {
    name: 'Gamer & Ação',
    items: [
      "(ง'̀-'́)ง",
      '(•̀ᴗ•́)و',
      '(⌐■_■)',
      '¯\\_(ツ)_/¯',
      '(╯°□°)╯︵ ┻━┻',
      '┬─┬ノ( º _ ºノ)',
      '( ͡° ͜ʖ ͡°)',
      '(҂`_´)<︻╦╤─-',
      '(ง •̀_•́)ง',
      'ᕦ(ò_óˇ)ᕤ',
    ],
  },
  {
    name: 'Tristeza & F',
    items: [
      '(ಥ﹏ಥ)',
      '(╥﹏╥)',
      '(T_T)',
      '(ノ_・。)',
      '(っ˘̩╭╮˘̩)っ',
      '(;´༎ຶٹ༎ຶ)',
      '(ノД`)・゜・。',
      '(>_<)',
      '(｡╯3╰｡)',
      '(;﹏;)',
    ],
  },
  {
    name: 'Fofo & Pets',
    items: [
      '(=^･ω･^=)',
      '(｡♥‿♥｡)',
      '(づ￣ ³￣)づ',
      '(・∀・)',
      'ʕ•ᴥ•ʔ',
      '(^=◕ᴥ◕=^)',
      'ฅ^•ﻌ•^ฅ',
      '(｡･ω･｡)',
      '(=^･ｪ･^=)',
      '(◕‿◕)',
    ],
  },
  {
    name: 'Surpreso & WTF',
    items: [
      '(⊙_⊙)',
      '(ﾟДﾟ)',
      '(°o°)',
      '(O_O)',
      '( ﾟдﾟ)',
      '(꒪O꒪)',
      'Σ(°ロ°)',
      '(ﾟoﾟ〃)',
      '(⊙_◎)',
      '(ﾟДﾟ;)',
    ],
  },
];

// GIFs de reação instantâneos de alta velocidade gratuitos (otimizados para games)
const CURATED_GIFS = [
  {
    title: 'GG Vitória',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHc3MmZiaGlvZ2M0bHRoNHZxdXF5OG4wdnV4ajhkM2d0OTBjc2pkZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/BPJmthQ3YRwD6QqcVD/giphy.gif',
  },
  {
    title: 'Hype / Dança',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExc2J1bjNsc3dtMGQ5ZzlvYjFzZTN3NW5ndDV6dTR1ZWF0YndkM3A4dCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/blSTtZehjAZ8I/giphy.gif',
  },
  {
    title: 'Popcorn / Assistindo',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNGNid252Ynk5MXNqb3J2dzBqNWc1YmxrY3k2amx5b3VldzcyOHJpcyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/gl0mkIZOW6Nwc/giphy.gif',
  },
  {
    title: 'Rindo Muito',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNndxY2hpOGFsc3Ztb2U4dm1lM29zZWpkODZ1bnR3dm1rNXkwdXAzbiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/10JhviFuU2BQZ2/giphy.gif',
  },
  {
    title: 'Fail / Nooo',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExenF4cW1hZDVqcmFjOWs1Y3Jrc3N6OHVra2M2a2drY2phN3N1cTFkMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/d10dMmzqCYqQ0/giphy.gif',
  },
  {
    title: 'Clap / Palmas',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbmNtdG16ajdmdWJqMmR4OG04bXZ2bHdsMHprbXB4MnlyOWtqNXpqeiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/nbvFVPiEiJh6MQB5O1/giphy.gif',
  },
  {
    title: 'Facepalm',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcWc2dDFiaTdmNmY3d29yMjY5ZHN5bzQ2dWk1MnV5aXlnOTVwbWR1eCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3og0INyCmHlNylks9O/giphy.gif',
  },
  {
    title: 'Mind Blown',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnJtdjJkNHlhZGR3YWRuOGx0eDhpNHJnd2NqOGNkcjU4ZjdxMXBvNyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26ufdipQqU2lhNA4g/giphy.gif',
  },
];

export const ChatEmotePicker: React.FC<ChatEmotePickerProps> = ({
  onSelectEmote,
  onSelectGif,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'emotes' | 'kaomoji' | 'gifs'>('emotes');
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<{ title: string; url: string }[]>(CURATED_GIFS);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Busca de GIFs via endpoint público gratuito com debounce
  useEffect(() => {
    if (activeTab !== 'gifs') return;

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setGifs(CURATED_GIFS);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingGifs(true);
      try {
        // Giphy Public Search endpoint
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=sXpGFDGZs0Dv1mmNFvYaGUvYwKX0P4W9&q=${encodeURIComponent(
            trimmed
          )}&limit=16&rating=g`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data) && data.data.length > 0) {
            const mapped = data.data.map((item: any) => ({
              title: item.title || 'GIF',
              url: item.images?.fixed_height?.url || item.images?.original?.url,
            })).filter((item: any) => !!item.url);
            setGifs(mapped);
          } else {
            setGifs([]);
          }
        }
      } catch (err) {
        console.warn('[ChatEmotePicker] Falha ao buscar GIFs da API, exibindo selecionados:', err);
        setGifs(
          CURATED_GIFS.filter((g) =>
            g.title.toLowerCase().includes(trimmed.toLowerCase())
          )
        );
      } finally {
        setIsLoadingGifs(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-16 right-0 left-0 sm:left-auto sm:w-80 bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col h-80 backdrop-blur-md font-mono text-xs"
    >
      {/* Header com Abas */}
      <div className="flex items-center justify-between p-2 border-b border-neutral-800 bg-neutral-950/80">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('emotes')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'emotes'
                ? 'bg-cyan-500 text-black shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Emotes
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('kaomoji')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'kaomoji'
                ? 'bg-cyan-500 text-black shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Kaomoji
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('gifs')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'gifs'
                ? 'bg-cyan-500 text-black shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            GIFs
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-red-400 rounded transition-colors cursor-pointer"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Barra de Pesquisa */}
      <div className="p-2 border-b border-neutral-800 bg-neutral-950">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'emotes'
                ? 'Filtrar emotes...'
                : activeTab === 'kaomoji'
                ? 'Buscar kaomoji...'
                : 'Pesquisar GIFs gratuitos (ex: gg, win, fail)...'
            }
            className="w-full bg-neutral-900 border border-neutral-800 focus:border-cyan-500 rounded pl-8 pr-2 py-1 text-xs text-neutral-200 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-neutral-400 hover:text-white text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo com Scroll */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* Aba de Emotes */}
        {activeTab === 'emotes' && (
          <div className="space-y-3">
            {EMOJI_CATEGORIES.map((cat) => {
              const filtered = cat.emojis.filter((e) =>
                !searchQuery ? true : e.includes(searchQuery)
              );
              if (filtered.length === 0) return null;

              return (
                <div key={cat.name} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-bold uppercase">
                    <cat.icon className="w-3 h-3 text-cyan-400" />
                    <span>{cat.name}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {filtered.map((emote, idx) => (
                      <button
                        key={`${emote}-${idx}`}
                        type="button"
                        onClick={() => onSelectEmote(emote)}
                        className="h-8 flex items-center justify-center text-lg hover:bg-neutral-800 rounded transition-transform hover:scale-125 cursor-pointer"
                        title={emote}
                      >
                        {emote}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Aba de Kaomojis */}
        {activeTab === 'kaomoji' && (
          <div className="space-y-3">
            {KAOMOJI_CATEGORIES.map((cat) => {
              const filtered = cat.items.filter((k) =>
                !searchQuery ? true : k.toLowerCase().includes(searchQuery.toLowerCase())
              );
              if (filtered.length === 0) return null;

              return (
                <div key={cat.name} className="space-y-1.5">
                  <span className="text-[10px] text-cyan-300 font-bold uppercase block">
                    {cat.name}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {filtered.map((kaomoji, idx) => (
                      <button
                        key={`${kaomoji}-${idx}`}
                        type="button"
                        onClick={() => onSelectEmote(` ${kaomoji} `)}
                        className="px-2 py-1 bg-neutral-950 hover:bg-cyan-950/60 border border-neutral-800 hover:border-cyan-500/60 text-neutral-200 text-xs rounded transition-colors cursor-pointer"
                      >
                        {kaomoji}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Aba de GIFs */}
        {activeTab === 'gifs' && (
          <div className="space-y-2">
            {/* Sugestões rápidas de tags */}
            <div className="flex flex-wrap gap-1 pb-1">
              {['GG', 'Win', 'Fail', 'Hype', 'Dance', 'Laugh', 'Popcorn'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSearchQuery(tag)}
                  className="px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-[10px] text-neutral-400 hover:text-cyan-300 hover:border-cyan-500/50 cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
            </div>

            {isLoadingGifs ? (
              <div className="h-40 flex flex-col items-center justify-center text-neutral-500 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mb-2" />
                <span>Buscando GIFs gratuitos...</span>
              </div>
            ) : gifs.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-neutral-500 text-xs text-center p-4">
                Nenhum GIF encontrado para "{searchQuery}".
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {gifs.map((gif, idx) => (
                  <div
                    key={`${gif.url}-${idx}`}
                    onClick={() => onSelectGif(gif.url, gif.title)}
                    className="relative group rounded overflow-hidden border border-neutral-800 bg-black cursor-pointer hover:border-cyan-400 transition-all aspect-video flex items-center justify-center"
                  >
                    <img
                      src={gif.url}
                      alt={gif.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-1 text-center">
                      <span className="text-[10px] font-bold text-cyan-300 truncate">
                        Enviar GIF
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
