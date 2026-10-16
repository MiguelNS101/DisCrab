# 🎮 StreamCompanion — P2P Screen & Process Audio Streaming

> **Transmissão P2P de Tela, Câmera e Áudio de Processo Isolado via WASAPI (Zero Eco do Discord) — Construído em Rust (Tauri v2), WebRTC e React.**

---

### ⚠️ DISCLAIMER IMPORTANTE / AVISO DE VIBECODING ⚠️
> **AVISO:** Este aplicativo foi **100% desenvolvido através de "Vibecoding" (programação conversacional com IA)**. 
> 
> Ele **NÃO é recomendado para uso sério, comercial, corporativo ou de missão crítica**. Este software é um experimento técnico focado em diversão, estudos e transmissões casuais entre amigos para jogar. Não há garantias de estabilidade absoluta, suporte formal ou conformidade empresarial. Utilize por sua conta e risco e divirta-se!

---

## 🚀 Visão Geral

O **StreamCompanion** resolve o clássico problema das transmissões em salas de conversa: **o vazamento de áudio do Discord e o eco de microfone**.

Ao contrário de softwares convencionais que capturam todo o som da placa de som (misturando chamadas de voz com o jogo), o StreamCompanion utiliza as APIs modernas de baixo nível do Windows (**WASAPI Process Loopback**) para capturar **estritamente o áudio do processo/jogo** ou **todo o som do computador excluindo cirurgicamente o Discord**, transmitindo tudo diretamente para amigos através de uma malha **P2P WebRTC** ultrarrápida, sem passar por servidores de vídeo centrais ou exigir cadastros.

---

## ✨ Todas as Funcionalidades

### 🔊 1. Áudio Isolado WASAPI de Ultra Baixa Latência
- **Modo Janela da Live (PID exclusivo):** Captura cirurgicamente apenas os sons emitidos pelo jogo ou executável transmitido (ex: `cs2.exe`, emuladores, navegadores). Sons de notificações, outras abas ou conversa de voz não vazam.
- **Modo Outras Janelas (Mixagem de Múltiplas Fontes de Áudio):** Permite escolher **uma ou mais janelas** da lista para capturar e mixar o áudio simultaneamente (por exemplo: transmitir a janela do jogo e incluir o áudio do Spotify e do navegador ao mesmo tempo).
- **Modo Áudio Total do PC (Sem Discord):** Captura o som de todas as janelas e jogos do Windows, mas localiza o processo raiz do Discord via Win32 ToolHelp e **exclui 100% dos sons do Discord** (`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`).
- **Alternância Ao Vivo:** É possível trocar de fonte de áudio no meio da transmissão sem derrubar o vídeo ou a sala!

### 📺 2. Transmissão de Vídeo & Câmera Simultâneas
- **Captura de Tela ou Janela:** Resoluções 720p, 1080p e 1440p a 30 FPS ou 60 FPS com alta fidelidade de cores.
- **Webcam Integrada:** Suporte a transmissão de webcam ao mesmo tempo em que a tela está sendo compartilhada.
- **Telinha de Auto-Visualização (PiP do Transmissor):** Quem está transmitindo a webcam conta com uma janela flutuante Picture-in-Picture espelhada para se ver em tempo real.
- **Popups Flutuantes Multi-Stream:** Assista transmissões de amigos em janelas flutuantes arrastáveis e redimensionáveis pelo app com controle de volume independente.

### 💬 3. Chat P2P com Arquivos Ilimitados, Emotes e GIFs
- **Upload Sem Limite de Tamanho:** Envie arquivos pesados de qualquer extensão (PDF, ZIP, vídeos, instaladores). Os arquivos são transmitidos via WebRTC DataChannel fragmentado em blocos (chunks) com controle de buffer SCTP contra perda de pacotes.
- **Drag & Drop e Colar da Área de Transferência (Ctrl+V):** Arraste fotos e arquivos diretamente sobre o chat ou pressione `Ctrl+V` para enviar capturas de tela instantaneamente.
- **Tela de Escolha de Local para Download (Save Dialog):** Ao clicar em "Salvar" em qualquer arquivo ou imagem recebida, o app abre uma tela dedicada de confirmação e aciona a janela nativa do Windows Explorer / Sistema Operacional para você escolher exatamente a pasta e nome em que deseja gravar o arquivo no disco.
- **Emotes, Kaomojis e GIFs via API Gratuita:** Botão integrado com catálogo de reações gamer, kaomojis japoneses e buscador de GIFs em tempo real conectado à API pública do Giphy.

### 🌐 4. Conexão Instantânea Sem Port Forwarding
- **Hospedagem Automática (Host):** O próprio aplicativo desktop sobe um servidor WebSocket de sinalização local.
- **Túnel Cloudflare Quick Tunnel Embutido:** Gera automaticamente uma URL segura WAN (`.trycloudflare.com`) sem necessidade de abrir portas no roteador, configurar firewall ou ter IP público.
- **Modo Rede Local (LAN):** Opção de conexão direta via IP da rede Wi-Fi/Ethernet para zero latência em redes domésticas.
- **Código de Sala Seguro:** O Host recebe um código Base64 URL-Safe único contendo as credenciais da sala. Os amigos só precisam colar o código para entrar.

### ⚡ 5. Diagnóstico & Telemetria em Tempo Real
- **Monitoramento de Memória / Motor em Tempo Real:** Visualização contínua do consumo de RAM (WorkingSet Win32 no desktop ou Heap JS) com histórico dinâmico de tendência.
- **Painel de Desempenho Discreto:** Equalizador de espectro PCM WASAPI em tempo real, status de saúde da malha P2P, latência e registro de alertas.

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologia | Função |
|---|---|---|
| **Backend Desktop** | **Tauri v2 (Rust)** | Empacotador desktop de alto desempenho e footprint minúsculo de memória |
| **Áudio Nativo** | **Windows WASAPI COM API** | `ActivateAudioInterfaceAsync`, `VAD\Process_Loopback` e exclusão de processo |
| **Win32 Hooks** | **windows-rs 0.58** | `EnumWindows`, `ToolHelp32Snapshot`, `GetProcessMemoryInfo`, `JobObjects` |
| **Rede P2P** | **WebRTC** | `RTCPeerConnection` (mesh mesh), `RTCDataChannel` (chat e arquivos) |
| **Processamento Áudio** | **AudioWorklet + RingBuffer** | Buffer circular de 32-bit Float PCM contínuo (elimina clock drift e vazamento) |
| **Túnel WAN** | **Cloudflared Quick Tunnel** | Túnel seguro efêmero para conectar amigos pela Internet sem port forwarding |
| **Frontend** | **React 19 & TypeScript** | Interface moderna com tipagem estrita de eventos |
| **Estilização** | **Tailwind CSS v4** | Design cyberpunk escuro de alto contraste |
| **Ícones** | **Lucide React** | Conjunto completo de ícones de telemetria e controles |
| **Bundler** | **Vite 8** | Compilação rápida de módulos e assets |

---

## 🧠 Arquitetura e Funcionamento Interno

### 1. Captura de Áudio Isolado (WASAPI Process Loopback)
No Windows 10 (Build 20348+) e Windows 11, a Microsoft introduziu a ativação assíncrona com `VAD\Process_Loopback`:
- **Inclusão (`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0`):** Passando o PID do jogo, o subsistema de áudio renderiza apenas a árvore daquele processo.
- **Exclusão (`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1`):** O backend faz um snapshot da lista de processos, identifica o processo raiz do Discord (`discord.exe`) e solicita ao WASAPI que capture todas as fontes de som do computador, exceto o Discord.
- Os pacotes PCM capturados (48.000 Hz, 32-bit Float estéreo) são empacotados em lotes de ~25ms e transferidos via IPC para o `AudioWorkletNode` no frontend, que alimenta a trilha do WebRTC.

### 2. AudioWorklet com Ring Buffer Circular
Para evitar estouros de memória e estalos causados por variações de temporização entre o relógio de hardware do Windows e o relógio do navegador, o `AudioBridge.ts` utiliza um buffer circular pré-alocado de 65.536 amostras com controle de ponteiros atômicos. O áudio flui de forma ininterrupta mesmo se a janela for minimizada.

### 3. Transferência de Arquivos Sem Limite de Tamanho
O `WebRtcEngine.ts` quebra arquivos de qualquer tamanho em pacotes de 16KB/64KB. Ele monitora a propriedade `bufferedAmount` do canal de dados SCTP: sempre que o buffer ultrapassa 256KB, o transmissor pausa assincronamente por alguns milissegundos para permitir o envio físico dos pacotes pela placa de rede, evitando queda da conexão.

---

## 📥 Tutorial de Instalação e Execução

### Pré-requisitos
1. **Windows 10 (versão 21H2 / Build 20348 ou superior) ou Windows 11**.
2. **Node.js** (versão 20 ou superior): [https://nodejs.org](https://nodejs.org).
3. **Rust & Cargo**: [https://rustup.rs](https://rustup.rs).
4. **Visual Studio C++ Build Tools** (com carga de trabalho de desenvolvimento para Desktop em C++).

### Executando em Modo Desenvolvimento
```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/stream-companion.git
cd stream-companion

# 2. Instale as dependências
npm install

# 3. Inicie o ambiente de desenvolvimento desktop
npm run tauri dev
```

### Compilando o Executável (.exe) Localmente
Para gerar o executável final otimizado para Windows:
```bash
# Executa a compilação de release
npm run tauri build
```
O arquivo `.exe` pronto para uso estará localizado na pasta:
`src-tauri/target/release/StreamCompanion.exe`
(Também é gerado um instalador NSIS completo em `src-tauri/target/release/bundle/nsis/`).

---

## 🤖 Pipeline Automática no GitHub Actions & Como Criar Release com .exe

O repositório inclui uma pipeline de CI/CD completa e pré-configurada em `.github/workflows/build-exe.yml` para compilar o executável nativo do Windows (`.exe`) e publicar automaticamente na aba **Releases** do GitHub.

### ⚙️ Passo Importante: Habilitar Permissões de Release no GitHub
Para que o GitHub Actions consiga criar a Release e anexar o `.exe` na sua conta, é necessário ativar a permissão de escrita:
1. No seu repositório no GitHub, clique na aba **Settings** (Configurações).
2. No menu lateral esquerdo, clique em **Actions** ➔ **General**.
3. Role até a seção **Workflow permissions** e marque a opção:
   - 🔘 **Read and write permissions** (Permissões de leitura e escrita).
4. Marque também a caixinha **Allow GitHub Actions to create and approve pull requests**.
5. Clique em **Save**.

---

### 📦 Como Gerar a Release com o .exe (2 Formas Fáceis):

#### Opção A: Pelo Próprio Navegador (Sem comandos de terminal)
1. Vá na aba **Actions** do seu repositório no GitHub.
2. No menu lateral esquerdo, clique em **"Compilar Executável Windows (StreamCompanion)"**.
3. À direita, clique no botão **"Run workflow"**.
4. Deixe marcada a opção **"Publicar Release no GitHub com os arquivos .exe?"** e digite a versão desejada no campo (ex: `v1.0.0`).
5. Clique no botão verde **Run workflow**.
6. Aguarde a compilação (cerca de 5 a 8 minutos). Ao finalizar, vá na aba **Releases** do repositório: sua Release estará criada com o arquivo **`StreamCompanion-Portable.exe`** e o instalador prontos para qualquer pessoa baixar!

#### Opção B: Via Tag Git no seu Computador
```bash
# Crie uma tag de versão e envie para o GitHub
git tag v1.0.0
git push origin v1.0.0
```
Ao enviar uma tag começando com `v` (ex: `v1.0.0`, `v1.0.1`), o GitHub dispara a build automaticamente e cria a Release oficial com os executáveis anexados.

#### Opção C: Baixar o .exe sem criar Release (Artefato Temporário)
Mesmo se você não quiser criar uma Release formal, toda vez que você fizer `git push` no repositório, o GitHub compila o projeto. Basta ir na aba **Actions**, clicar na execução da build e baixar o arquivo zip na seção **Artifacts** no final da página!

---

## 📖 Guia Básico de Uso

1. **Abrindo o App:** Inicie o `StreamCompanion.exe` e digite seu apelido (ele é salvo automaticamente).
2. **Criando uma Sala (Host):**
   - Na aba **Criar Sala (Host)**, escolha entre **P2P Global (Internet)** (recomendado) ou **Rede LAN**.
   - Clique em **"Criar Sala & Código"**.
   - Clique em **"Copiar Código"** e envie para seus amigos no Discord ou WhatsApp.
3. **Entrando na Sala (Peer):**
   - Seus amigos abrem o app, vão na aba **Entrar na Sala (Peer)**, colam o código e clicam em **"Conectar à Sala"**.
4. **Iniciando a Transmissão de Tela:**
   - No **Seletor de Janela & Áudio**, clique na janela do jogo desejado.
   - Escolha o modo de áudio:
     - *Janela da Live:* apenas o som do jogo.
     - *Outra Janela:* clique em "Definir Áudio" em qualquer outro programa da lista.
     - *Todo o PC (Sem Discord):* manda todo o som do computador com filtro anti-eco do Discord.
   - Clique em **"Iniciar Live"**.
5. **Ligando a Webcam:** Clique em **"Ligar Webcam"** para transmitir sua câmera junto com a tela. Uma telinha PiP flutuante se abrirá para você se ver em tempo real.
6. **Chat e Envio de Arquivos:** No chat à direita, envie mensagens, abra o seletor de **Emotes/GIFs**, ou arraste arquivos pesados para enviar diretamente para a máquina do seu amigo via P2P. Clique em **"Salvar"** para escolher em qual pasta do seu disco salvar os arquivos recebidos!

---

## 📄 Licença
Distribuído sob a licença **MIT** ou **Apache 2.0**.
*Lembre-se: Software construído experimentalmente com vibecoding.*
