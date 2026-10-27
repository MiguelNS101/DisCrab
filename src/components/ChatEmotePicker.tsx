import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Smile,
  Search,
  X,
  Heart,
  Gamepad2,
  ThumbsUp,
  Loader2,
  ChevronDown,
} from 'lucide-react';

interface ChatEmotePickerProps {
  onSelectEmote: (emote: string) => void;
  onSelectGif: (gifUrl: string, title: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: 'DisCrab & Games',
    icon: Gamepad2,
    emojis: [
      '🦀', '🏴‍☠️', '🎮', '🕹️', '👾', '🎯', '🎲', '🏆', '🥇', '⚔️',
      '🛡️', '🚀', '💻', '🖥️', '⚡', '🔥', '💥', '🎧', '🔊', '👑',
    ],
  },
  {
    name: 'Reações & Caras',
    icon: Smile,
    emojis: [
      '😂', '🤣', '😭', '💀', '🤡', '😈', '🥳', '😎', '🤔', '😴',
      '🤮', '🤯', '🥺', '🥶', '🥵', '😇', '🤫', '😏', '🫡', '🙄',
    ],
  },
  {
    name: 'Gestos',
    icon: ThumbsUp,
    emojis: [
      '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤘', '👊', '🤙', '👀',
      '🧠', '🦾', '🙏', '💪', '🤌', '🖕', '👋', '🤛', '🤜', '🤳',
    ],
  },
  {
    name: 'Símbolos & Amor',
    icon: Heart,
    emojis: [
      '❤️', '💔', '💖', '💯', '💢', '✨', '🌟', '💣', '💫', '💬',
      '⚠️', '🚩', '⛔', '✔️', '❌', '🔥', '🎉', '🍿', '☕', '🍻',
    ],
  },
];

export interface KaomojiCategoryData {
  key: string;
  label: string;
  keyLower: string;
  labelLower: string;
  items: string[];
}

const KAOMOJI_CATEGORY_LABELS: Record<string, string> = {
  kani: '🦀 Caranguejo (DisCrab)',
  smile: '😊 Sorriso (Smile)',
  happy: '🎉 Feliz (Happy)',
  yorokobu: '✨ Radiante (Yorokobu)',
  yatta: '🏆 Vitória (Yatta)',
  sumairu: '😄 Clássicos (Sumairu)',
  doya: '😎 Confiante (Doya)',
  yumekawa: '🎀 Estético (Yumekawa)',
  cat: '🐱 Gatinho (Cat)',
  nyaa: '🐾 Nyaa (Gato)',
  dog: '🐶 Cachorrinho (Dog)',
  cute: '🥺 Fofo (Cute)',
  shy: '😳 Tímido (Shy)',
  cry: '😭 Chorando (Cry)',
  pien: '🥺 Pien / Chorinho',
  angry: '😡 Irritado (Angry)',
  mukatsuku: '💢 Furioso (Mukatsuku)',
  chabudaigaeshi: '┻━┻ Virando a Mesa',
  mukimuki: '💪 Forte / Músculos',
  power: '⚡ Poder (Power)',
  fight: '🔥 Torcida (Fight)',
  good_job: '👍 Mandou Bem (GG)',
  'good-job': '👍 Mandou Bem (GG)',
  iine: '👍 Curtir (Iine)',
  ok: '👌 OK!',
  hug: '🫂 Abraço (Hug)',
  gyu: '🤗 Abraço Apertado',
  kiss: '💋 Beijo (Kiss)',
  chu: '😘 Chu (Beijinho)',
  love: '❤️ Amor (Love)',
  heart: '💖 Coração (Heart)',
  kyun: '💘 Apaixonado (Kyun)',
  dance: '💃 Dançando (Dance)',
  norinori: '🎵 No Ritmo (Norinori)',
  utau: '🎤 Cantando (Utau)',
  karaoke: '🎙️ Karaokê',
  beer: '🍺 Cerveja (Beer)',
  kanpai: '🍻 Brinde (Kanpai)',
  gokugoku: '🥤 Bebendo (Goku)',
  cafe: '☕ Café & Chá',
  ocha: '🍵 Chá Verde (Ocha)',
  raamen: '🍜 Lámen (Ramen)',
  takoyaki: '🐙 Takoyaki',
  rice: '🍙 Arroz & Onigiri',
  taberu: '🍴 Comendo (Taberu)',
  mogumogu: '😋 Mastigando (Mogu)',
  umai: '🤤 Delicioso (Umai)',
  delicious: '🍰 Saboroso',
  drooling: '🤤 Babando',
  banana: '🍌 Banana',
  juu: '🔫 Armas / Sniper',
  punch: '🥊 Soco (Punch)',
  oraora: '👊 Ora Ora!',
  naguru: '💥 Pancada',
  ninja: '🥷 Ninja',
  shuriken: '卍 Shuriken',
  magic: '🪄 Magia',
  majo: '🧙‍♀️ Bruxinha',
  beam: '⚡ Laser / Beam',
  sneaky: '🫣 Espiando (Sneaky)',
  peek: '👀 Espreitando (Peek)',
  chirachira: '👁️ Olhadinha',
  jii: '👀 Encarando (Jii)',
  surprise: '😲 Surpreso',
  shock: '😱 Choque (Shock)',
  gaan: '😨 Gaan (Impacto)',
  pokaan: '😶 Boquiaberto',
  hatena: '❓ Dúvida (Hatena)',
  gimon: '🤔 Pergunta',
  wakaranai: '🤷 Não Sei',
  kangaeru: '💭 Pensando',
  naruhodo: '💡 Entendi!',
  hirameku: '💡 Ideia!',
  akubi: '🥱 Bocejo (Akubi)',
  nemui: '😴 Com Sono (Nemui)',
  suyaa: '💤 Dormindo (Suyaa)',
  neru: '🛌 Indo Dormir',
  futon: '🛌 No Cobertor',
  gorogoro: '🛋️ Rolando (Gorogoro)',
  goron: '🛋️ Deitado',
  tired: '😩 Cansado (Tired)',
  shindoi: '🥵 Exausto',
  guttari: '🫠 Esgotado',
  tokeru: '🫠 Derretendo',
  thanks: '🙏 Obrigado (Thanks)',
  orei: '💝 Agradecimento',
  azasu: '🙌 Valeu (Azasu)',
  sorry: '🙇 Desculpa (Sorry)',
  sumimasen: '🙇‍♂️ Perdão',
  dogeza: '🙇‍♀️ Dogeza (Perdão)',
  bow: '🙇 Reverência (Bow)',
  salute: '🫡 Continência',
  understand: '🫡 Entendido!',
  aisatsu: '👋 Oi / Saudação',
  'good-morning': '☀️ Bom Dia',
  'good-night': '🌙 Boa Noite',
  byebye: '👋 Tchau (Bye Bye)',
  matane: '👋 Até Mais (Matane)',
  sayounara: '👋 Adeus',
  okaeri: '🏠 Bem-vindo de Volta',
  tadaima: '🏠 Cheguei!',
  otsukaresama: '🍵 Bom Trabalho Hoje',
  ahaha: '😆 Risada (Ahaha)',
  bakushou: '🤣 Morrendo de Rir',
  kusukusu: '🤭 Risadinha',
  pupupu: '🤭 Segurando o Riso',
  bufo: '🤣 Cuspiu de Rir',
  kusa: '🌱 Kusa (Lol/Www)',
  doraemon: '🔔 Doraemon',
  kirby: '⭐ Kirby',
  chiikawa: '🐹 Chiikawa',
  'my-melody': '🐰 My Melody',
  miffy: '🐰 Miffy',
  kitty: '🎀 Gatinha (Kitty)',
  rabbit: '🐇 Coelho (Rabbit)',
  kuma: '🐻 Urso (Kuma)',
  kitsune: '🦊 Raposa (Kitsune)',
  tanuki: '🦝 Tanuki',
  hamusutaa: '🐹 Hamster',
  tora: '🐯 Tigre (Tora)',
  lion: '🦁 Leão (Lion)',
  buta: '🐷 Porquinho (Buta)',
  gorira: '🦍 Gorila',
  azarashi: '🦭 Foquinha',
  pengin: '🐧 Pinguim',
  hiyoko: '🐤 Pintinho',
  ahiru: '🦆 Patinho',
  tori: '🐦 Pássaro',
  karasu: '🐦‍⬛ Corvo',
  kamome: '🕊️ Gaivota',
  kaeru: '🐸 Sapo (Kaeru)',
  fish: '🐟 Peixe (Fish)',
  same: '🦈 Tubarão (Shark)',
  ika: '🦑 Lula (Squid)',
  tako: '🐙 Polvo (Octopus)',
  kurage: '🪼 Água-Viva',
  unagi: '🐍 Enguia',
  uupaaruupaa: '🦎 Axolote',
  horse: '🐴 Cavalo',
  animal: '🐾 Animais',
  glasses: '👓 Óculos',
  sunglasses: '🕶️ Óculos Escuros',
  wink: '😉 Piscadinha (Wink)',
  tehepero: '😜 Tehepero',
  tehe: '😛 Tehe',
  peace: '✌️ Paz (Peace)',
  applause: '👏 Aplausos',
  pachipachi: '👏 Palmas (8888)',
  congratulations: '🎊 Parabéns!',
  birthday: '🎂 Feliz Aniversário',
  kurisumasu: '🎄 Natal',
  halloween: '🎃 Halloween',
  oshogatsu: '🎍 Ano Novo',
  valentine: '🍫 Dia dos Namorados',
};

// Categorias prioritárias que aparecem nos chips rápidos e no topo da lista
const PRIORITY_CATEGORY_KEYS = [
  'kani',
  'smile',
  'happy',
  'yatta',
  'doya',
  'cat',
  'dog',
  'cute',
  'yumekawa',
  'hug',
  'love',
  'ahaha',
  'mukimuki',
  'fight',
  'good-job',
  'chabudaigaeshi',
  'juu',
  'oraora',
  'beer',
  'raamen',
  'cry',
  'pien',
  'angry',
  'surprise',
  'akubi',
];

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function formatCategoryLabel(key: string): string {
  if (KAOMOJI_CATEGORY_LABELS[key]) {
    return KAOMOJI_CATEGORY_LABELS[key];
  }
  const capitalized = key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `✨ ${capitalized}`;
}

const FALLBACK_KAOMOJIS: KaomojiCategoryData[] = [
  {
    key: 'kani',
    label: '🦀 Caranguejo (DisCrab)',
    keyLower: 'kani',
    labelLower: '🦀 caranguejo (discrab)',
    items: [
      '🦀⸜( •⌄• )⸝🦀',
      '(V)(°‿°)(V)',
      '(V)(◕‿◕)(V)',
      '🦀( •̀ᴗ•́ )و ̑̑ｶﾆ!!',
      '≧[ﾟ∀ﾟ]≦',
      'V(๑•̀ㅂ•́)و✧ｶﾆｶﾆ',
      '🦀( ˙▿˙ 🦀)ｶﾆﾁｬﾝ',
      '(V)(´・ω・`)(V)',
    ],
  },
  {
    key: 'smile',
    label: '😊 Sorriso (Smile)',
    keyLower: 'smile',
    labelLower: '😊 sorriso (smile)',
    items: [
      '(≧◡≦)',
      '(*^ω^*)',
      '(╹◡╹)',
      '(*´꒳`*)',
      '(˶ᵔ ᵕ ᵔ˶)',
      '( ˶ˆ꒳ˆ˵ )',
      '\\(*ˊᗜˋ*)/',
      '(๑>◡<๑)',
    ],
  },
];

let cachedKaomojiCategories: KaomojiCategoryData[] | null = null;
let preloadPromise: Promise<KaomojiCategoryData[]> | null = null;

function ensureKaomojisLoaded(): Promise<KaomojiCategoryData[]> {
  if (cachedKaomojiCategories) {
    return Promise.resolve(cachedKaomojiCategories);
  }
  if (preloadPromise) {
    return preloadPromise;
  }

  preloadPromise = fetch('/assets/aistudio/kaomoji_7373e5da.json')
    .then((res) => res.json())
    .then((rawJson: Record<string, string[]>) => {
      if (!rawJson || typeof rawJson !== 'object') {
        return FALLBACK_KAOMOJIS;
      }
      const allKeys = Object.keys(rawJson);
      const prioritySet = new Set(PRIORITY_CATEGORY_KEYS);
      const orderedKeys = [
        ...PRIORITY_CATEGORY_KEYS.filter((k) => k in rawJson),
        ...allKeys.filter((k) => !prioritySet.has(k)),
      ];

      const parsed: KaomojiCategoryData[] = orderedKeys
        .map((key) => {
          const list = Array.isArray(rawJson[key]) ? rawJson[key] : [];
          const seen = new Set<string>();
          const uniqueDecoded: string[] = [];
          for (let i = 0; i < list.length; i++) {
            const decoded = decodeHtmlEntities(String(list[i]).trim());
            if (decoded && !seen.has(decoded)) {
              seen.add(decoded);
              uniqueDecoded.push(decoded);
            }
          }
          const label = formatCategoryLabel(key);
          return {
            key,
            label,
            keyLower: key.toLowerCase(),
            labelLower: label.toLowerCase(),
            items: uniqueDecoded,
          };
        })
        .filter((cat) => cat.items.length > 0);

      cachedKaomojiCategories = parsed;
      return parsed;
    })
    .catch((err) => {
      console.warn('[ChatEmotePicker] Erro ao carregar arquivo JSON de kaomojis:', err);
      preloadPromise = null;
      return FALLBACK_KAOMOJIS;
    });

  return preloadPromise;
}

// Inicia o pré-carregamento em segundo plano assim que o app carrega (evita qualquer travamento ao clicar na aba)
if (typeof window !== 'undefined') {
  setTimeout(() => {
    ensureKaomojisLoaded();
  }, 150);
}

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

// Quantidade inicial de categorias renderizadas no modo "Todas" para manter 0ms de lag no DOM
const INITIAL_VISIBLE_CATEGORIES = 6;
const CATEGORIES_PAGE_STEP = 8;
const PREVIEW_ITEMS_PER_CATEGORY = 12;
const SINGLE_CATEGORY_PAGE_SIZE = 48;

export const ChatEmotePicker: React.FC<ChatEmotePickerProps> = ({
  onSelectEmote,
  onSelectGif,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'emotes' | 'kaomoji' | 'gifs'>('emotes');
  const [searchQuery, setSearchQuery] = useState('');
  const [kaomojiCategories, setKaomojiCategories] = useState<KaomojiCategoryData[]>(
    cachedKaomojiCategories || FALLBACK_KAOMOJIS
  );
  const [selectedKaomojiCat, setSelectedKaomojiCat] = useState<string>('all');
  const [visibleCategoryLimit, setVisibleCategoryLimit] = useState<number>(
    INITIAL_VISIBLE_CATEGORIES
  );
  const [expandedItemCounts, setExpandedItemCounts] = useState<Record<string, number>>({});
  const [gifs, setGifs] = useState<{ title: string; url: string }[]>(CURATED_GIFS);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    ensureKaomojisLoaded().then((loaded) => {
      if (mounted) {
        setKaomojiCategories(loaded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Reseta a paginação leve sempre que mudar de categoria ou busca
  useEffect(() => {
    setVisibleCategoryLimit(INITIAL_VISIBLE_CATEGORIES);
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0;
    }
  }, [selectedKaomojiCat, searchQuery, activeTab]);

  // Chips rápidos (apenas as 14 principais categorias para não pesar o DOM)
  const quickChipCategories = useMemo(
    () => kaomojiCategories.slice(0, 14),
    [kaomojiCategories]
  );

  // Filtra categorias e itens de Kaomoji com alta performance
  const filteredKaomojiCategories = useMemo(() => {
    if (activeTab !== 'kaomoji') return [];

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      if (selectedKaomojiCat === 'all') {
        return kaomojiCategories;
      }
      return kaomojiCategories.filter((c) => c.key === selectedKaomojiCat);
    }

    const results: KaomojiCategoryData[] = [];
    for (let i = 0; i < kaomojiCategories.length; i++) {
      const cat = kaomojiCategories[i];
      if (cat.keyLower.includes(query) || cat.labelLower.includes(query)) {
        results.push(cat);
      } else {
        const matchingItems = cat.items.filter((k) => k.toLowerCase().includes(query));
        if (matchingItems.length > 0) {
          results.push({
            ...cat,
            items: matchingItems,
          });
        }
      }
      // Limita resultados de busca a 15 categorias para resposta instantânea ao digitar
      if (results.length >= 15) break;
    }
    return results;
  }, [activeTab, kaomojiCategories, selectedKaomojiCat, searchQuery]);

  const displayedKaomojiCategories = useMemo(() => {
    if (selectedKaomojiCat !== 'all' || searchQuery.trim()) {
      return filteredKaomojiCategories;
    }
    return filteredKaomojiCategories.slice(0, visibleCategoryLimit);
  }, [filteredKaomojiCategories, selectedKaomojiCat, searchQuery, visibleCategoryLimit]);

  const remainingCategoriesCount =
    filteredKaomojiCategories.length - displayedKaomojiCategories.length;

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
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=sXpGFDGZs0Dv1mmNFvYaGUvYwKX0P4W9&q=${encodeURIComponent(
            trimmed
          )}&limit=16&rating=g`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data) && data.data.length > 0) {
            const mapped = data.data
              .map((item: any) => ({
                title: item.title || 'GIF',
                url: item.images?.fixed_height?.url || item.images?.original?.url,
              }))
              .filter((item: any) => !!item.url);
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
      className="absolute bottom-16 right-0 left-0 sm:left-auto sm:w-96 bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col h-96 backdrop-blur-md font-mono text-xs"
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
            Kaomojis ({kaomojiCategories.length})
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

      {/* Barra de Pesquisa & Filtro Rápido de Categorias */}
      <div className="p-2 border-b border-neutral-800 bg-neutral-950 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 flex items-center">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'emotes'
                  ? 'Filtrar emotes...'
                  : activeTab === 'kaomoji'
                  ? 'Buscar (ex: kani, cat, smile)...'
                  : 'Pesquisar GIFs (ex: gg, win)...'
              }
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-cyan-500 rounded pl-8 pr-6 py-1 text-xs text-neutral-200 outline-none"
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

          {/* Seletor Dropdown leve para acessar qualquer uma das 128 categorias sem travar o DOM */}
          {activeTab === 'kaomoji' && (
            <div className="relative shrink-0">
              <select
                value={selectedKaomojiCat}
                onChange={(e) => {
                  setSelectedKaomojiCat(e.target.value);
                  setSearchQuery('');
                }}
                className="appearance-none bg-neutral-900 border border-neutral-800 hover:border-cyan-500/60 focus:border-cyan-500 rounded pl-2 pr-6 py-1 text-[11px] text-cyan-300 font-bold outline-none cursor-pointer max-w-[135px] truncate"
                title="Escolher categoria de Kaomoji"
              >
                <option value="all">Todas ({kaomojiCategories.length})</option>
                {kaomojiCategories.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {cat.label} ({cat.items.length})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-cyan-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Barra enxuta com as categorias favoritas */}
        {activeTab === 'kaomoji' && !searchQuery.trim() && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
            <button
              type="button"
              onClick={() => setSelectedKaomojiCat('all')}
              className={`px-2 py-0.5 rounded text-[10px] shrink-0 cursor-pointer border transition-colors ${
                selectedKaomojiCat === 'all'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              Destaques
            </button>
            {quickChipCategories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedKaomojiCat(cat.key)}
                className={`px-2 py-0.5 rounded text-[10px] shrink-0 cursor-pointer border transition-colors ${
                  selectedKaomojiCat === cat.key
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conteúdo com Scroll */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-2 space-y-3">
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

        {/* Aba de Kaomojis Otimizada (Zero Lag) */}
        {activeTab === 'kaomoji' && (
          <div className="space-y-3">
            {displayedKaomojiCategories.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-neutral-500 text-xs text-center p-4">
                Nenhum kaomoji encontrado para &quot;{searchQuery}&quot;.
              </div>
            ) : (
              <>
                {displayedKaomojiCategories.map((cat) => {
                  const isSingleCatSelected = selectedKaomojiCat === cat.key;
                  const baseLimit = isSingleCatSelected
                    ? SINGLE_CATEGORY_PAGE_SIZE
                    : PREVIEW_ITEMS_PER_CATEGORY;
                  const currentLimit = expandedItemCounts[cat.key] || baseLimit;
                  const displayedItems = cat.items.slice(0, currentLimit);
                  const remainingItems = cat.items.length - displayedItems.length;

                  return (
                    <div key={cat.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedKaomojiCat(cat.key)}
                          className="text-[10px] text-cyan-300 hover:text-cyan-200 font-bold uppercase cursor-pointer text-left"
                        >
                          {cat.label}{' '}
                          <span className="text-neutral-500 font-normal">({cat.items.length})</span>
                        </button>
                        {remainingItems > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedItemCounts((prev) => ({
                                ...prev,
                                [cat.key]: currentLimit + SINGLE_CATEGORY_PAGE_SIZE,
                              }))
                            }
                            className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                          >
                            Ver mais (+{remainingItems})
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {displayedItems.map((kaomoji, idx) => (
                          <button
                            key={`${cat.key}-${idx}`}
                            type="button"
                            onClick={() => onSelectEmote(` ${kaomoji} `)}
                            className="px-2 py-1 bg-neutral-950 hover:bg-cyan-950/60 border border-neutral-800 hover:border-cyan-500/60 text-neutral-200 text-xs rounded transition-colors cursor-pointer text-left"
                            title={`Inserir ${kaomoji}`}
                          >
                            {kaomoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {remainingCategoriesCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCategoryLimit((prev) => prev + CATEGORIES_PAGE_STEP)
                    }
                    className="w-full py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-cyan-500/40 text-cyan-300 font-bold text-[11px] transition-colors cursor-pointer"
                  >
                    Mostrar mais categorias (+{remainingCategoriesCount} restantes)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Aba de GIFs */}
        {activeTab === 'gifs' && (
          <div className="space-y-2">
            {/* Sugestões rápidas de tags */}
            <div className="flex flex-wrap gap-1 pb-1">
              {['Crab', 'GG', 'Win', 'Fail', 'Hype', 'Dance', 'Laugh', 'Popcorn'].map((tag) => (
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
                Nenhum GIF encontrado para &quot;{searchQuery}&quot;.
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
