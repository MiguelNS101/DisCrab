import React, { createContext, useContext, useState, useEffect } from 'react';

export type ButtonDesignStyle =
  | 'solid'
  | 'gradient'
  | 'neon'
  | 'glass'
  | 'outline'
  | 'brutalist';

export type ButtonSizeScale = 'compact' | 'normal' | 'large';
export type LayoutMaxWidth = 'compact' | 'standard' | 'wide' | 'full';

export interface ThemeConfig {
  presetId: string;
  bgPrimary: string;
  bgSurface: string;
  bgElevated: string;
  accentPrimary: string;
  accentSecondary: string;
  textPrimary: string;
  textMuted: string;
  borderColor: string;
  cardRadius: number; // px (0 - 28)
  buttonRadius: number; // px (0 - 999)
  borderWidth: number; // px (0 - 3)
  glassBlur: number; // px (0 - 24)
  uiScale: number; // % (85 - 115)
  buttonStyle: ButtonDesignStyle;
  buttonSize: ButtonSizeScale;
  layoutWidth: LayoutMaxWidth;
  fontFamily: 'mono' | 'sans' | 'cyber';
  customCss: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  config: Omit<ThemeConfig, 'customCss'>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'cyber-cyan',
    name: 'Cyberpunk Cyan (Padrão)',
    description: 'Visual escuro com alto contraste em ciano elétrico e índigo.',
    config: {
      presetId: 'cyber-cyan',
      bgPrimary: '#0a0a0c',
      bgSurface: '#121318',
      bgElevated: '#09090b',
      accentPrimary: '#06b6d4',
      accentSecondary: '#6366f1',
      textPrimary: '#f4f4f5',
      textMuted: '#a1a1aa',
      borderColor: '#27272a',
      cardRadius: 12,
      buttonRadius: 8,
      borderWidth: 1,
      glassBlur: 12,
      uiScale: 100,
      buttonStyle: 'gradient',
      buttonSize: 'normal',
      layoutWidth: 'standard',
      fontFamily: 'sans',
    },
  },
  {
    id: 'oled-pitch',
    name: 'OLED Pitch Black',
    description: 'Preto absoluto #000000 para monitores OLED com bordas minimalistas.',
    config: {
      presetId: 'oled-pitch',
      bgPrimary: '#000000',
      bgSurface: '#070709',
      bgElevated: '#030304',
      accentPrimary: '#22d3ee',
      accentSecondary: '#10b981',
      textPrimary: '#ffffff',
      textMuted: '#71717a',
      borderColor: '#18181b',
      cardRadius: 8,
      buttonRadius: 6,
      borderWidth: 1,
      glassBlur: 16,
      uiScale: 100,
      buttonStyle: 'neon',
      buttonSize: 'normal',
      layoutWidth: 'wide',
      fontFamily: 'mono',
    },
  },
  {
    id: 'crimson-gamer',
    name: 'Crimson Esports',
    description: 'Vermelho rubi agressivo com botões angulares e alto impacto.',
    config: {
      presetId: 'crimson-gamer',
      bgPrimary: '#0c0608',
      bgSurface: '#170b0f',
      bgElevated: '#090406',
      accentPrimary: '#f43f5e',
      accentSecondary: '#f97316',
      textPrimary: '#fff1f2',
      textMuted: '#fda4af',
      borderColor: '#3f1521',
      cardRadius: 4,
      buttonRadius: 4,
      borderWidth: 1,
      glassBlur: 10,
      uiScale: 100,
      buttonStyle: 'brutalist',
      buttonSize: 'normal',
      layoutWidth: 'wide',
      fontFamily: 'cyber',
    },
  },
  {
    id: 'emerald-matrix',
    name: 'Emerald Terminal',
    description: 'Estética hacker de baixa latência em verde esmeralda e fonte técnica.',
    config: {
      presetId: 'emerald-matrix',
      bgPrimary: '#040b08',
      bgSurface: '#081610',
      bgElevated: '#030806',
      accentPrimary: '#10b981',
      accentSecondary: '#06b6d4',
      textPrimary: '#ecfdf5',
      textMuted: '#6ee7b7',
      borderColor: '#133829',
      cardRadius: 6,
      buttonRadius: 4,
      borderWidth: 1,
      glassBlur: 8,
      uiScale: 98,
      buttonStyle: 'outline',
      buttonSize: 'compact',
      layoutWidth: 'wide',
      fontFamily: 'mono',
    },
  },
  {
    id: 'amethyst-glass',
    name: 'Amethyst Synthwave',
    description: 'Roxo profundo com efeito translúcido suave e cantos arredondados.',
    config: {
      presetId: 'amethyst-glass',
      bgPrimary: '#0b0716',
      bgSurface: '#150d2a',
      bgElevated: '#080510',
      accentPrimary: '#a855f7',
      accentSecondary: '#ec4899',
      textPrimary: '#faf5ff',
      textMuted: '#c084fc',
      borderColor: '#2e1a57',
      cardRadius: 18,
      buttonRadius: 999,
      borderWidth: 1,
      glassBlur: 18,
      uiScale: 100,
      buttonStyle: 'glass',
      buttonSize: 'normal',
      layoutWidth: 'standard',
      fontFamily: 'sans',
    },
  },
  {
    id: 'nordic-slate',
    name: 'Nordic Slate Studio',
    description: 'Tons frios azul-ardósia inspirados em estúdios de broadcast profissionais.',
    config: {
      presetId: 'nordic-slate',
      bgPrimary: '#0f172a',
      bgSurface: '#1e293b',
      bgElevated: '#090e1a',
      accentPrimary: '#38bdf8',
      accentSecondary: '#818cf8',
      textPrimary: '#f8fafc',
      textMuted: '#94a3b8',
      borderColor: '#334155',
      cardRadius: 10,
      buttonRadius: 8,
      borderWidth: 1,
      glassBlur: 12,
      uiScale: 100,
      buttonStyle: 'solid',
      buttonSize: 'normal',
      layoutWidth: 'standard',
      fontFamily: 'sans',
    },
  },
];

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  ...THEME_PRESETS[0].config,
  customCss: `/* Escreva seu CSS personalizado aqui!
   Exemplos de seletores disponíveis:
   .sc-app          -> Container raiz do aplicativo
   .sc-header       -> Barra de topo
   .sc-lobby-card   -> Card central de entrada / criar sala
   .sc-card         -> Todos os painéis e blocos
   .sc-btn-primary  -> Botões de ação principais
   .sc-stream-grid  -> Grade de transmissões ativas
*/`,
};

const STORAGE_KEY = 'sc_theme_config_v1';

interface ThemeContextValue {
  theme: ThemeConfig;
  updateTheme: (partial: Partial<ThemeConfig>) => void;
  applyPreset: (presetId: string) => void;
  resetTheme: () => void;
  exportThemeJson: () => string;
  importThemeJson: (rawJson: string) => boolean;
  isCustomizerOpen: boolean;
  setIsCustomizerOpen: (open: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function hexToRgbString(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return `${r}, ${g}, ${b}`;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return `${r}, ${g}, ${b}`;
  }
  return '6, 182, 212';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_THEME_CONFIG, ...parsed };
      }
    } catch {
      // ignore
    }
    return DEFAULT_THEME_CONFIG;
  });

  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);

  const updateTheme = (partial: Partial<ThemeConfig>) => {
    setTheme((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const applyPreset = (presetId: string) => {
    const found = THEME_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setTheme((prev) => {
      const next: ThemeConfig = {
        ...found.config,
        customCss: prev.customCss,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const resetTheme = () => {
    setTheme(DEFAULT_THEME_CONFIG);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_THEME_CONFIG));
    } catch {
      // ignore
    }
  };

  const exportThemeJson = () => {
    return JSON.stringify(theme, null, 2);
  };

  const importThemeJson = (rawJson: string): boolean => {
    try {
      const parsed = JSON.parse(rawJson);
      if (typeof parsed !== 'object' || !parsed) return false;
      const merged: ThemeConfig = {
        ...DEFAULT_THEME_CONFIG,
        ...parsed,
      };
      setTheme(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return true;
    } catch {
      return false;
    }
  };

  // Aplica variáveis CSS e folha de estilo dinâmica em tempo real
  useEffect(() => {
    const root = document.documentElement;
    const accentRgb = hexToRgbString(theme.accentPrimary);
    const accentSecRgb = hexToRgbString(theme.accentSecondary);
    const surfaceRgb = hexToRgbString(theme.bgSurface);

    root.style.setProperty('--sc-bg-primary', theme.bgPrimary);
    root.style.setProperty('--sc-bg-surface', theme.bgSurface);
    root.style.setProperty('--sc-bg-surface-rgb', surfaceRgb);
    root.style.setProperty('--sc-bg-elevated', theme.bgElevated);
    root.style.setProperty('--sc-accent', theme.accentPrimary);
    root.style.setProperty('--sc-accent-rgb', accentRgb);
    root.style.setProperty('--sc-accent-secondary', theme.accentSecondary);
    root.style.setProperty('--sc-accent-secondary-rgb', accentSecRgb);
    root.style.setProperty('--sc-text-primary', theme.textPrimary);
    root.style.setProperty('--sc-text-muted', theme.textMuted);
    root.style.setProperty('--sc-border-color', theme.borderColor);
    root.style.setProperty('--sc-card-radius', `${theme.cardRadius}px`);
    root.style.setProperty('--sc-btn-radius', `${theme.buttonRadius}px`);
    root.style.setProperty('--sc-border-width', `${theme.borderWidth}px`);
    root.style.setProperty('--sc-glass-blur', `${theme.glassBlur}px`);
    root.style.setProperty('--sc-ui-scale', `${theme.uiScale / 100}`);

    root.setAttribute('data-btn-style', theme.buttonStyle);
    root.setAttribute('data-btn-size', theme.buttonSize);
    root.setAttribute('data-layout-width', theme.layoutWidth);
    root.setAttribute('data-font-family', theme.fontFamily);

    // Injeta o <style id="sc-dynamic-theme-engine"> + CSS personalizado do usuário
    let styleEl = document.getElementById('sc-dynamic-theme-engine') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'sc-dynamic-theme-engine';
      document.head.appendChild(styleEl);
    }

    const btnPadY =
      theme.buttonSize === 'compact'
        ? '0.32rem'
        : theme.buttonSize === 'large'
        ? '0.72rem'
        : '0.5rem';
    const btnPadX =
      theme.buttonSize === 'compact'
        ? '0.65rem'
        : theme.buttonSize === 'large'
        ? '1.25rem'
        : '0.9rem';

    const maxWValue =
      theme.layoutWidth === 'compact'
        ? '1080px'
        : theme.layoutWidth === 'wide'
        ? '1560px'
        : theme.layoutWidth === 'full'
        ? '100%'
        : '1280px';

    const fontStack =
      theme.fontFamily === 'mono'
        ? `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
        : theme.fontFamily === 'cyber'
        ? `'Outfit', 'Rajdhani', 'Plus Jakarta Sans', system-ui, sans-serif`
        : `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif`;

    styleEl.textContent = `
      :root {
        font-size: ${theme.uiScale}%;
      }
      body, .sc-app {
        background-color: var(--sc-bg-primary) !important;
        color: var(--sc-text-primary) !important;
        font-family: ${fontStack} !important;
      }
      .sc-container-width {
        max-width: ${maxWValue} !important;
      }
      /* Superfícies & Cards */
      .sc-card,
      .bg-neutral-900\\/90,
      .bg-neutral-900\\/80,
      .bg-neutral-900 {
        background-color: rgba(var(--sc-bg-surface-rgb), 0.92) !important;
        border-color: var(--sc-border-color) !important;
        border-width: var(--sc-border-width) !important;
        border-radius: var(--sc-card-radius) !important;
        backdrop-filter: blur(var(--sc-glass-blur)) !important;
      }
      /* Inputs & Fundos Elevados */
      .sc-input,
      .bg-neutral-950 {
        background-color: var(--sc-bg-elevated) !important;
        border-color: var(--sc-border-color) !important;
      }
      .sc-input {
        border-radius: var(--sc-btn-radius) !important;
        color: var(--sc-text-primary) !important;
      }
      .sc-input:focus {
        border-color: var(--sc-accent) !important;
        box-shadow: 0 0 0 2px rgba(var(--sc-accent-rgb), 0.2) !important;
      }
      /* Textos secundários */
      .text-neutral-400 {
        color: var(--sc-text-muted) !important;
      }
      /* Destaques na cor primária do tema */
      .text-cyan-400, .text-cyan-300 {
        color: var(--sc-accent) !important;
      }
      .border-cyan-500, .border-cyan-500\\/60, .border-cyan-800 {
        border-color: var(--sc-accent) !important;
      }
      /* Barra de Título Customizada da Janela (Frameless Titlebar) */
      .sc-titlebar {
        background-color: var(--sc-bg-elevated) !important;
        border-color: var(--sc-border-color) !important;
      }
      .sc-titlebar .sc-win-btn {
        border-radius: 0px !important;
      }
      .sc-titlebar .sc-win-btn:hover {
        background-color: rgba(var(--sc-accent-rgb), 0.16) !important;
        color: var(--sc-accent) !important;
      }
      .sc-titlebar .sc-win-btn-close {
        border-radius: 0px !important;
      }
      .sc-titlebar .sc-win-btn-close:hover {
        background-color: #e11d48 !important;
        color: #ffffff !important;
      }
      /* Botões gerais */
      button:not(.sc-win-btn):not(.sc-win-btn-close), .sc-btn {
        border-radius: var(--sc-btn-radius) !important;
      }
      .sc-btn-sized {
        padding-top: ${btnPadY} !important;
        padding-bottom: ${btnPadY} !important;
        padding-left: ${btnPadX} !important;
        padding-right: ${btnPadX} !important;
      }
      /* Estilos de Design do Botão Primário */
      .sc-btn-primary,
      .bg-cyan-500,
      .bg-cyan-600 {
        ${
          theme.buttonStyle === 'solid'
            ? `
              background: var(--sc-accent) !important;
              color: #050505 !important;
              border: 1px solid var(--sc-accent) !important;
              box-shadow: 0 4px 14px rgba(var(--sc-accent-rgb), 0.25) !important;
            `
            : theme.buttonStyle === 'gradient'
            ? `
              background: linear-gradient(135deg, var(--sc-accent), var(--sc-accent-secondary)) !important;
              color: #ffffff !important;
              text-shadow: 0 1px 2px rgba(0,0,0,0.45) !important;
              border: 1px solid rgba(255,255,255,0.14) !important;
              box-shadow: 0 6px 18px rgba(var(--sc-accent-rgb), 0.3) !important;
            `
            : theme.buttonStyle === 'neon'
            ? `
              background: rgba(var(--sc-accent-rgb), 0.14) !important;
              color: var(--sc-accent) !important;
              border: 1.5px solid var(--sc-accent) !important;
              box-shadow: 0 0 14px rgba(var(--sc-accent-rgb), 0.45), inset 0 0 8px rgba(var(--sc-accent-rgb), 0.2) !important;
            `
            : theme.buttonStyle === 'glass'
            ? `
              background: rgba(var(--sc-accent-rgb), 0.22) !important;
              color: var(--sc-text-primary) !important;
              border: 1px solid rgba(var(--sc-accent-rgb), 0.45) !important;
              backdrop-filter: blur(16px) !important;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35) !important;
            `
            : theme.buttonStyle === 'outline'
            ? `
              background: transparent !important;
              color: var(--sc-accent) !important;
              border: 1.5px solid var(--sc-accent) !important;
              box-shadow: none !important;
            `
            : `
              background: var(--sc-accent) !important;
              color: #000000 !important;
              border: 2px solid #ffffff !important;
              box-shadow: 4px 4px 0px var(--sc-accent-secondary) !important;
              transform: translate(-1px, -1px);
            `
        }
      }
      .sc-btn-primary:hover,
      .bg-cyan-500:hover,
      .bg-cyan-600:hover {
        filter: brightness(1.12);
      }

      /* === CSS PERSONALIZADO DO USUÁRIO === */
      ${theme.customCss || ''}
    `;
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        updateTheme,
        applyPreset,
        resetTheme,
        exportThemeJson,
        importThemeJson,
        isCustomizerOpen,
        setIsCustomizerOpen,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de um ThemeProvider');
  }
  return ctx;
};
