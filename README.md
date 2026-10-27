<div align="center">
  <img src="public/app-icon.svg" alt="DisCrab Logo" width="120" height="120" />

  # 🦀🏴‍☠️ DisCrab
  **Transmissão P2P de Tela, Placas de Captura, Câmera e Áudio Isolado (Windows `.exe` & Android `.apk`)**

  *Uma brincadeira interna juntando **Discord + Crab**: um caranguejo pirata de tapa-olho feito para assistir lives com os amigos em 1080p/1440p 60 FPS, zero eco de voz e áudio amplificado até 200%.*
</div>

---

## ⚠️ DISCLAIMER DE VIBE CODING ⚠️

> **AVISO IMPORTANTE:** Este projeto foi **100% desenvolvido na base do "Vibe Coding"** (programação conversacional iterativa assistida por IA, movida a café, testes na hora e piadas internas com caranguejos piratas 🦀).
>
> - **Não é um produto comercial ou corporativo:** O **DisCrab** foi criado exclusivamente para uso casual entre amigos — jogar junto, compartilhar tela de jogos/emuladores/placas de captura, conversar no chat P2P e assistir lives na cama pelo celular ou no PC.
> - **Sem garantias formais:** Embora conte com bateria de testes automatizados de áudio e conexão P2P, códigos de criptografia e auto-update, podem existir gambiarras criativas sob o capô. Use por sua conta e risco e divirta-se!

---

## 🦀 O que é o DisCrab?

O **DisCrab** (antigo *StreamCompanion*) nasceu para resolver os maiores problemas de transmitir jogos para amigos:
1. **O vazamento de áudio da call (eco do Discord):** No Windows, o DisCrab usa a API nativa **WASAPI Process Loopback** para capturar **apenas o som do jogo/janela escolhida** ou **todo o áudio do PC excluindo cirurgicamente o processo do Discord**.
2. **Qualidade comprimida e atraso:** As transmissões trafegam em malha **WebRTC P2P direta** (com áudio **Opus Estéreo 48kHz @ 160kbps CBR** sem cortes de silêncio e vídeo a **60 FPS**).
3. **Assistir no PC ou no Celular (Android):** Conta com executável nativo para **Windows (`.exe`)** e aplicativo nativo para **Android (`.apk`)** com motor de áudio próprio.

---

## ✨ Todas as Funcionalidades Atualizadas (`v1.1.0`)

### 🔐 1. Salas Fixas P2P Mesh (Nome e Senha) & Código Rápido (WAN / LAN)
- **Sala Fixa Mesh P2P (AES-256):** Entre digitando apenas o **Nome da Sala** e a **Senha da Sala**. As credenciais geram uma chave criptográfica **AES-256-GCM** ponta a ponta e sincronizam os participantes automaticamente (com histórico de salas salvas para entrar com 1 clique).
- **Modo Código via Cloudflare Quick Tunnel (WAN):** No PC, o Host pode criar uma sala pela Internet sem abrir portas no roteador. O próprio app baixa e gerencia o `cloudflared.exe` silenciosamente em `%LOCALAPPDATA%` (não precisa mais baixar o `cloudflared.exe` separado na Release!).
- **Modo Rede Local (LAN Wi-Fi / Ethernet):** Conexão direta via IP local com latência sub-milissegundo para quem está na mesma rede ou VPN.
- **Convites Rápidos (`streamcompanion://`):** Copie o convite com 1 clique e cole direto no app — qualquer campo reconhece automaticamente o formato `"Sala: X | Senha: Y"` ou o deep-link nativo.
- **Tela de Transição & Auto-Reconexão:** Transição visual em tela cheia ao sincronizar o handshake da sala e reconexão automática transparente caso a internet oscile.

### 🔊 2. Áudio Isolado WASAPI (Windows), Motor DSP 48kHz (Android) e Boost até 200%
- **Volume até 200% (Audio Boost):** Cada live possui controle de volume individual que vai de **0% a 200%**. Acima de 100%, o player ativa um amplificador digital (`WebAudio GainNode`) para aumentar o som de transmissões baixas sem distorcer, salvando o volume preferido de cada amigo automaticamente.
- **WASAPI Process Loopback (Windows 10/11):**
  - *Somente Janela da Live:* Captura exclusivamente o PID do jogo transmitido.
  - *Múltiplas Janelas Mixadas:* Escolha vários programas abertos (ex: Jogo + Spotify + Navegador) para mixar na mesma live.
  - *Todo o PC (Sem Discord):* Captura todo o som do Windows excluindo automaticamente a árvore de processos do Discord (`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`).
- **Motor de Áudio Android Dedicado (`AndroidAudioProcessor` DSP):**
  - Quando compilado para Android, desativa automaticamente os módulos exclusivos do Windows (`#[cfg(windows)]`) e ativa um motor DSP nativo em Rust de **48kHz Estéreo (32-bit Float)**.
  - Inclui **Filtro High-Pass DC Blocker (~20Hz)**, **Ganho Digital** e **Soft-Clipping Limiter hiperbólico** (`tanh`) com suporte a áudio interno (`MediaProjection`), microfone aprimorado ou mixagem ao vivo.
- **Qualidade de Estúdio no WebRTC:** Negociação SDP forçada para **Opus Estéreo 160kbps CBR** com `usedtx=0` (impede que o áudio fique "picotando" em cenas silenciosas) e `AudioBridge` com Jitter Buffer elástico anti-atraso.

### 📺 3. Palco Multi-Stream, Placas de Captura, Espelhamento e Janelas Pop-out
- **Múltiplas Fontes Simultâneas:** Transmita sua tela/jogo em **720p, 1080p ou 1440p (30/60 FPS)** e ligue ao mesmo tempo quantas **Webcams** ou **Placas de Captura USB/HDMI** quiser.
- **Inverter / Espelhar Vídeo (`Mirror`):** Botão direto no player para espelhar horizontalmente qualquer tela ou câmera (com memória persistente).
- **Janela Pop-out Real do Sistema Operacional:** Destaque a live de qualquer amigo para uma janela independente do Windows para arrastar para o segundo monitor, ou use o **Modo Teatro / Tela Cheia**.
- **Auto-Visualização PiP:** Janela flutuante Picture-in-Picture para você visualizar sua própria câmera enquanto joga.

### 💬 4. Chat P2P com 535 Categorias de Kaomojis, GIFs e Arquivos Ilimitados
- **Mega Catálogo de Kaomojis (535 Categorias):** Lista completa atualizada (incluindo a categoria especial **`kani`** de caranguejos 🦀 `(\/) (°,,,,°) (\/)`), com busca instantânea, carregamento assíncrono em memória e paginação otimizada para abrir sem qualquer travamento.
- **GIFs Integrados & Emotes:** Buscador de GIFs em tempo real via Giphy API e atalhos rápidos de reações.
- **Transferência P2P de Arquivos Sem Limite:** Envie fotos (com `Ctrl+V` direto da área de transferência ou Drag & Drop), vídeos, ZIPs ou instaladores via `RTCDataChannel` em blocos com controle de fluxo SCTP e janela nativa para escolher onde salvar.

### 🔄 5. Auto-Update Automático (Windows `.exe` & Android `.apk`)
- **Repositório Oficial Fixo (`MiguelNS101/StreamCompanion`):** O app consulta automaticamente as Releases oficiais do repositório **uma única vez ao iniciar** (sem verificações em loop) e permite checar manualmente a qualquer momento pelo botão no cabeçalho.
- **No Windows (`.exe`):** Baixa o novo executável com barra de progresso em tempo real, substitui o `.exe` atual em execução e reinicia o aplicativo sozinho.
- **No Android (`.apk`):** Detecta automaticamente o pacote `.apk` na Release, avisa na abertura do app quando há versão nova, baixa o `.apk` validando a assinatura do pacote e abre o instalador do Android.

### 🧪 6. Bateria de Testes Automatizados Pré-Compilação
Antes de qualquer compilação (`bun run build`) ou geração de Release no GitHub Actions, o projeto executa **26 testes automatizados** (`scripts/prebuild-tests.ts`) + **testes unitários nativos em Rust** (`cargo test`), validando:
- Codificação/decodificação de salas LAN e conexão cliente Cloudflare Tunnel (`wss://*.trycloudflare.com`) para PC e Android;
- Parser de convites (`streamcompanion://` e texto `"Sala: X | Senha: Y"`);
- Handshake WebSocket `AuthOk` e relay de sinalização WebRTC P2P;
- Pipeline completa de **Áudio da Stream** (5 pacotes de 20ms @ 48kHz Estéreo, confirmação de energia sonora RMS nos canais L/R, separação estéreo 440Hz/880Hz sem colapso para mono, proteção contra `NaN`/`Infinity`, rampa anti-estalo, relógio do Jitter Buffer e ressincronização automática);
- Carregamento e integridade das 535 categorias de Kaomojis.

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologia | Função |
|---|---|---|
| **Core Nativo (PC & Mobile)** | **Tauri v2 (Rust)** | Backend multiplataforma compilado para Windows (`x86_64-pc-windows-msvc`) e Android (`aarch64-linux-android`) |
| **Áudio Windows** | **WASAPI Process Loopback** | `ActivateAudioInterfaceAsync` (`VAD\Process_Loopback`) para isolamento de áudio por PID e exclusão do Discord |
| **Áudio Android** | **Android DSP 48kHz (Rust)** | Filtro High-Pass DC Blocker, ganho digital e Soft-Clipping Limiter para transmissões mobile |
| **Malha P2P** | **WebRTC + AES-256 Mesh** | `RTCPeerConnection` (vídeo 60fps + áudio Opus 160kbps CBR) e `RTCDataChannel` (chat e arquivos) |
| **Frontend** | **React 19 + TypeScript** | Interface escura responsiva com temas personalizáveis e suporte a popups multi-monitor |
| **Estilização** | **Tailwind CSS v4 + Lucide** | Visual escuro de alto contraste inspirado na identidade do caranguejo pirata **DisCrab** |

---

## 🚀 Como Executar e Compilar Localmente

### Pré-requisitos
- **Node.js 20+** ou **Bun**
- **Rust & Cargo** ([rustup.rs](https://rustup.rs))
- **Para Windows:** Windows 10 (Build 20348+) ou Windows 11 + Visual Studio C++ Build Tools
- **Para Android:** Android SDK (Platform 34, Build-Tools 34.0.0) + Android NDK `26.1.10909125` + Java JDK 17

### Comandos Principais
```bash
# 1. Instalar dependências
bun install

# 2. Rodar a bateria de 26 testes automatizados (Conexão P2P + Áudio da Stream + Kaomojis)
bun run test

# 3. Gerar todos os ícones oficiais do DisCrab (.svg, .png, .ico, .icns e binários RGBA)
node scripts/generate-icons.mjs

# 4. Rodar em modo desenvolvimento Desktop (Tauri)
bun run tauri:dev

# 5. Compilar o executável Windows (.exe)
bun run tauri:build
```

---

## 🤖 GitHub Actions: Gerando `.exe` (Windows) e `.apk` (Android) na Release

O workflow `.github/workflows/build-exe.yml` está configurado com 4 estágios automáticos:
1. **`test-suite`**: Roda todos os 26 testes de conexão P2P e áudio da stream + checagem TypeScript (`tsc --noEmit`).
2. **`build-windows`**: Roda os testes nativos Rust (`cargo test`), gera os ícones do DisCrab e compila o **`DisCrab-Portable.exe`** e instaladores Windows.
3. **`build-android`**: Configura o Android SDK/NDK 26 diretamente via `sdkmanager`, compila a biblioteca nativa Rust ARM64 (`libstream_companion_lib.so`), gera e assina digitalmente o **`DisCrab-Android.apk`**.
4. **`publish-release`**: Anexa automaticamente o **`.exe`** e o **`.apk`** na Release oficial do GitHub (sem `cloudflared.exe` avulso).

### Como disparar uma nova Release:
- **Pela aba Actions do GitHub:** Clique em **"Compilar DisCrab (Windows .exe + Android .apk)"** ➔ **"Run workflow"**, informe a tag desejada (ex: `v1.1.0`) e clique em **Run workflow**.
- **Ou via Git Tag:**
  ```bash
  git tag v1.1.0
  git push origin v1.1.0
  ```

---

## 📄 Licença

Distribuído sob a licença **MIT / Apache 2.0**.  
*Feito com 🦀, chapéu de pirata e 100% Vibe Coding para assistir lives com os amigos.*
