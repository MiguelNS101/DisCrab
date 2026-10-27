import React, { useState } from 'react';
import {
  Palette,
  Sliders,
  Code2,
  RotateCcw,
  Download,
  Upload,
  Check,
  X,
  Sparkles,
  Copy,
  Layers,
} from 'lucide-react';
import {
  useTheme,
  THEME_PRESETS,
  ButtonDesignStyle,
  ButtonSizeScale,
  LayoutMaxWidth,
} from '../context/ThemeContext';

const CSS_SNIPPETS: { label: string; description: string; css: string }[] = [
  {
    label: 'Borda Neon Pulsante nos Painéis',
    description: 'Adiciona um brilho suave da cor de destaque ao redor de todos os cards.',
    css: `\n/* Borda Neon Pulsante */\n.sc-card {\n  box-shadow: 0 0 22px rgba(var(--sc-accent-rgb), 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;\n}\n`,
  },
  {
    label: 'Fundo com Grade Cyberpunk',
    description: 'Desenha uma malha técnica sutil no fundo do aplicativo.',
    css: `\n/* Malha Cyberpunk no Fundo */\n.sc-app {\n  background-image:\n    linear-gradient(to right, rgba(var(--sc-accent-rgb), 0.05) 1px, transparent 1px),\n    linear-gradient(to bottom, rgba(var(--sc-accent-rgb), 0.05) 1px, transparent 1px) !important;\n  background-size: 32px 32px !important;\n}\n`,
  },
  {
    label: 'Botões com Elevação 3D no Hover',
    description: 'Faz todos os botões subirem suavemente ao passar o mouse.',
    css: `\n/* Efeito 3D nos Botões */\nbutton:hover {\n  transform: translateY(-2px) scale(1.01);\n  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);\n}\n`,
  },
  {
    label: 'Players de Vídeo com Destaque Cinema',
    description: 'Aumenta a sombra e destaca os players de transmissão ativa.',
    css: `\n/* Destaque Cinema nas Transmissões */\n.sc-stream-grid > div {\n  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(var(--sc-accent-rgb), 0.28) !important;\n}\n`,
  },
  {
    label: 'Modo Ultra Minimalista (Sem Bordas)',
    description: 'Remove todas as bordas divisórias para um visual limpo e contínuo.',
    css: `\n/* Modo Sem Bordas */\n.sc-card, .sc-header {\n  border-color: transparent !important;\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4) !important;\n}\n`,
  },
];

export const ThemeCustomizerModal: React.FC = () => {
  const {
    theme,
    updateTheme,
    applyPreset,
    resetTheme,
    exportThemeJson,
    importThemeJson,
    isCustomizerOpen,
    setIsCustomizerOpen,
  } = useTheme();

  const [activeTab, setActiveTab] = useState<'presets' | 'visual' | 'css'>('presets');
  const [importText, setImportText] = useState<string>('');
  const [showImportBox, setShowImportBox] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  if (!isCustomizerOpen) return null;

  const handleCopyThemeJson = () => {
    navigator.clipboard.writeText(exportThemeJson());
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadCssFile = () => {
    const blob = new Blob([theme.customCss || ''], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamcompanion-theme-${theme.presetId}.css`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = () => {
    if (!importText.trim()) return;
    const ok = importThemeJson(importText.trim());
    if (ok) {
      setImportStatus('Tema importado com sucesso!');
      setImportText('');
      setTimeout(() => {
        setImportStatus(null);
        setShowImportBox(false);
      }, 1500);
    } else {
      setImportStatus('Erro: JSON de tema inválido.');
    }
  };

  const handleAppendSnippet = (snippetCss: string) => {
    const current = theme.customCss || '';
    updateTheme({ customCss: `${current}\n${snippetCss}`.trim() });
  };

  const colorFields: { key: keyof typeof theme; label: string; hint: string }[] = [
    { key: 'bgPrimary', label: 'Fundo Principal do App', hint: '--sc-bg-primary' },
    { key: 'bgSurface', label: 'Fundo dos Painéis / Cards', hint: '--sc-bg-surface' },
    { key: 'bgElevated', label: 'Fundo de Inputs & Caixas', hint: '--sc-bg-elevated' },
    { key: 'accentPrimary', label: 'Cor Principal (Botões & Destaques)', hint: '--sc-accent' },
    { key: 'accentSecondary', label: 'Cor Secundária (Gradientes)', hint: '--sc-accent-secondary' },
    { key: 'textPrimary', label: 'Cor do Texto Principal', hint: '--sc-text-primary' },
    { key: 'textMuted', label: 'Cor do Texto Secundário', hint: '--sc-text-muted' },
    { key: 'borderColor', label: 'Cor das Bordas e Linhas', hint: '--sc-border-color' },
  ];

  const buttonStyles: { id: ButtonDesignStyle; label: string; desc: string }[] = [
    { id: 'solid', label: 'Sólido Clássico', desc: 'Cor chapada de alto contraste' },
    { id: 'gradient', label: 'Gradiente Duplo', desc: 'Transição suave Primária -> Secundária' },
    { id: 'neon', label: 'Neon Cyberpunk', desc: 'Borda brilhante com glow luminoso' },
    { id: 'glass', label: 'Glassmorphism', desc: 'Translúcido com desfoque de vidro' },
    { id: 'outline', label: 'Minimalista (Outline)', desc: 'Apenas contorno fino e limpo' },
    { id: 'brutalist', label: 'Brutalista (Hard Shadow)', desc: 'Sombra deslocada marcada estilo arcade' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
      <div className="sc-card bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header do Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
                Estúdio de Customização UI & Motor CSS
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300">
                  Tempo Real
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Personalize cores, formato de botões, tamanhos, escala e injete qualquer regra CSS na interface.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-mono rounded-lg cursor-pointer transition-colors"
              title="Restaurar tema padrão original"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Restaurar Padrão</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCustomizerOpen(false)}
              className="p-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white rounded-lg cursor-pointer transition-colors"
              title="Fechar Estúdio de Temas"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navegação de Abas */}
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-2.5 bg-neutral-950/60 border-b border-neutral-800 text-xs font-mono">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                activeTab === 'presets'
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white bg-neutral-900/60'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Cores & Botões</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                activeTab === 'visual'
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white bg-neutral-900/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Tamanhos, Bordas & Layout</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('css')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                activeTab === 'css'
                  ? 'sc-btn-primary bg-cyan-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white bg-neutral-900/60'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Editor CSS Avançado</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyThemeJson}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 cursor-pointer"
              title="Copiar configuração completa do tema (JSON)"
            >
              {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedJson ? 'Copiado!' : 'Exportar Tema'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowImportBox(!showImportBox)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 cursor-pointer"
              title="Importar tema via código JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar</span>
            </button>
          </div>
        </div>

        {/* Caixa de Importação JSON (se aberta) */}
        {showImportBox && (
          <div className="px-5 py-3 bg-neutral-950 border-b border-neutral-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-neutral-300">
              <span>Cole abaixo o JSON de um tema exportado:</span>
              {importStatus && <span className="text-cyan-400 font-bold">{importStatus}</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"presetId": "custom", "bgPrimary": "#000000", ...}'
                className="sc-input flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none"
              />
              <button
                type="button"
                onClick={handleImportSubmit}
                className="sc-btn-primary px-4 py-1.5 bg-cyan-500 text-black font-mono font-bold text-xs rounded-lg cursor-pointer"
              >
                Aplicar Tema
              </button>
            </div>
          </div>
        )}

        {/* Corpo Principal Rolável */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'presets' && (
            <>
              {/* 1. Temas Prontos */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Temas Prontos (1 Clique)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {THEME_PRESETS.map((preset) => {
                    const isSelected = theme.presetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'bg-neutral-800/90 border-cyan-500 shadow-lg'
                            : 'bg-neutral-950/70 border-neutral-800 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold font-mono text-white">{preset.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white/20"
                              style={{ backgroundColor: preset.config.bgPrimary }}
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white/20"
                              style={{ backgroundColor: preset.config.accentPrimary }}
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white/20"
                              style={{ backgroundColor: preset.config.accentSecondary }}
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-snug">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Design de Botão */}
              <div className="space-y-2.5 pt-2 border-t border-neutral-800">
                <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Design & Estilo dos Botões
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {buttonStyles.map((bs) => {
                    const active = theme.buttonStyle === bs.id;
                    return (
                      <button
                        key={bs.id}
                        type="button"
                        onClick={() => updateTheme({ buttonStyle: bs.id, presetId: 'custom' })}
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-neutral-800 border-cyan-500 text-white'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono font-bold text-white">{bs.label}</span>
                          {active && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                        </div>
                        <p className="text-[11px] text-neutral-400">{bs.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Paleta de Cores Completa */}
              <div className="space-y-2.5 pt-2 border-t border-neutral-800">
                <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
                  Paleta de Cores Personalizada
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {colorFields.map((field) => {
                    const currentVal = String(theme[field.key] || '#000000');
                    return (
                      <div
                        key={field.key}
                        className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono text-neutral-200 font-semibold truncate">
                            {field.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={currentVal}
                            onChange={(e) =>
                              updateTheme({ [field.key]: e.target.value, presetId: 'custom' })
                            }
                            className="w-8 h-8 rounded cursor-pointer bg-transparent border border-neutral-700 shrink-0"
                          />
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) =>
                              updateTheme({ [field.key]: e.target.value, presetId: 'custom' })
                            }
                            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                          />
                        </div>
                        <span className="block text-[10px] font-mono text-neutral-500">{field.hint}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'visual' && (
            <div className="space-y-6">
              {/* Sliders de Dimensão e Geometria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-neutral-200 font-bold">Escala Geral da Interface (Zoom/Fonte)</span>
                    <span className="text-cyan-400 font-bold">{theme.uiScale}%</span>
                  </div>
                  <input
                    type="range"
                    min={85}
                    max={115}
                    step={1}
                    value={theme.uiScale}
                    onChange={(e) =>
                      updateTheme({ uiScale: Number(e.target.value), presetId: 'custom' })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-neutral-400">
                    Ajusta proporcionalmente o tamanho de todos os textos, ícones e espaçamentos do programa.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-neutral-200 font-bold">Arredondamento dos Painéis (Card Radius)</span>
                    <span className="text-cyan-400 font-bold">{theme.cardRadius}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={28}
                    step={1}
                    value={theme.cardRadius}
                    onChange={(e) =>
                      updateTheme({ cardRadius: Number(e.target.value), presetId: 'custom' })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-neutral-400">
                    0px para visual industrial reto, 12px padrão ou 28px para curvas suaves.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-neutral-200 font-bold">Formato / Curva dos Botões</span>
                    <span className="text-cyan-400 font-bold">
                      {theme.buttonRadius >= 40 ? 'Pílula (999px)' : `${theme.buttonRadius}px`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={theme.buttonRadius > 40 ? 40 : theme.buttonRadius}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateTheme({
                        buttonRadius: val >= 40 ? 999 : val,
                        presetId: 'custom',
                      });
                    }}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-neutral-400">
                    Deixe os botões quadrados (0px), levemente arredondados (8px) ou em formato pílula total.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-neutral-200 font-bold">Transparência / Glass Blur</span>
                    <span className="text-cyan-400 font-bold">{theme.glassBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={1}
                    value={theme.glassBlur}
                    onChange={(e) =>
                      updateTheme({ glassBlur: Number(e.target.value), presetId: 'custom' })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-neutral-400">
                    Intensidade do efeito de vidro jateado nos painéis do aplicativo.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <span className="block text-xs font-mono font-bold text-neutral-200">
                    Tamanho dos Botões
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                    {(['compact', 'normal', 'large'] as ButtonSizeScale[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => updateTheme({ buttonSize: sz, presetId: 'custom' })}
                        className={`py-2 rounded border cursor-pointer capitalize ${
                          theme.buttonSize === sz
                            ? 'sc-btn-primary bg-cyan-500 text-black font-bold border-cyan-400'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        {sz === 'compact' ? 'Compacto' : sz === 'large' ? 'Grande' : 'Normal'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <span className="block text-xs font-mono font-bold text-neutral-200">
                    Largura da Área de Trabalho
                  </span>
                  <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                    {(
                      [
                        { id: 'compact', label: 'Compacto' },
                        { id: 'standard', label: 'Padrão' },
                        { id: 'wide', label: 'Wide 1560px' },
                        { id: 'full', label: 'Tela Cheia 100%' },
                      ] as { id: LayoutMaxWidth; label: string }[]
                    ).map((lw) => (
                      <button
                        key={lw.id}
                        type="button"
                        onClick={() => updateTheme({ layoutWidth: lw.id, presetId: 'custom' })}
                        className={`py-1.5 px-2 rounded border cursor-pointer text-[11px] ${
                          theme.layoutWidth === lw.id
                            ? 'sc-btn-primary bg-cyan-500 text-black font-bold border-cyan-400'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        {lw.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <span className="block text-xs font-mono font-bold text-neutral-200">
                    Tipografia Principal
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                    {(
                      [
                        { id: 'sans', label: 'Moderna' },
                        { id: 'mono', label: 'Técnica Mono' },
                        { id: 'cyber', label: 'Display Gamer' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updateTheme({ fontFamily: f.id, presetId: 'custom' })}
                        className={`py-2 px-1 rounded border cursor-pointer text-[11px] ${
                          theme.fontFamily === f.id
                            ? 'sc-btn-primary bg-cyan-500 text-black font-bold border-cyan-400'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'css' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold">
                    Injetor de CSS Personalizado em Tempo Real
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Qualquer regra CSS escrita abaixo é aplicada imediatamente em toda a janela do programa e salva automaticamente.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadCssFile}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-cyan-300 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Arquivo .CSS
                </button>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-neutral-400">
                  Adicionar Efeito Rápido ao CSS:
                </span>
                <div className="flex flex-wrap gap-2">
                  {CSS_SNIPPETS.map((snip) => (
                    <button
                      key={snip.label}
                      type="button"
                      onClick={() => handleAppendSnippet(snip.css)}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-cyan-500/50 text-xs font-mono text-neutral-200 cursor-pointer transition-colors"
                      title={snip.description}
                    >
                      + {snip.label}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={theme.customCss}
                onChange={(e) => updateTheme({ customCss: e.target.value })}
                rows={11}
                spellCheck={false}
                placeholder="/* Digite seu CSS personalizado aqui... */"
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-cyan-500 rounded-xl p-4 text-xs font-mono text-cyan-200 outline-none leading-relaxed resize-y"
              />

              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs font-mono space-y-2">
                <span className="text-neutral-200 font-bold block">
                  Guia Rápido de Classes & Variáveis para Modificação Total:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-neutral-400">
                  <div>
                    <code className="text-cyan-300">.sc-app</code> — Container principal da janela
                  </div>
                  <div>
                    <code className="text-cyan-300">.sc-header</code> — Barra superior do programa
                  </div>
                  <div>
                    <code className="text-cyan-300">.sc-lobby-card</code> — Tela inicial de Apelido / Sala
                  </div>
                  <div>
                    <code className="text-cyan-300">.sc-toolbar</code> — Barra discreta de controles da sala
                  </div>
                  <div>
                    <code className="text-cyan-300">.sc-stream-grid</code> — Grade principal das transmissões
                  </div>
                  <div>
                    <code className="text-cyan-300">.sc-btn-primary</code> — Todos os botões principais de ação
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-5 py-3 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs font-mono">
          <span className="text-neutral-400">
            Todas as alterações são salvas automaticamente neste dispositivo.
          </span>
          <button
            type="button"
            onClick={() => setIsCustomizerOpen(false)}
            className="sc-btn-primary px-5 py-1.5 rounded-lg bg-cyan-500 text-black font-bold cursor-pointer"
          >
            Concluir & Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
