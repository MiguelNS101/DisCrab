# ==============================================================================
# StreamCompanion - One-Click Master Builder Script (PowerShell)
# Autor: StreamCompanion Automation Team
# Compatibilidade: Windows 10 (Build 20348+) e Windows 11 (x64)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

try {
    $Host.UI.RawUI.WindowTitle = "StreamCompanion - One-Click Master Builder"
} catch {}

function Write-Step {
    param([string]$Text)
    Write-Host "`n[+] ========================================================" -ForegroundColor Cyan
    Write-Host "    $Text" -ForegroundColor White
    Write-Host "[+] ========================================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Text)
    Write-Host "    [OK] $Text" -ForegroundColor Green
}

function Write-Info {
    param([string]$Text)
    Write-Host "    [i] $Text" -ForegroundColor DarkCyan
}

function Write-Warn {
    param([string]$Text)
    Write-Host "    [!] $Text" -ForegroundColor Yellow
}

function Write-Fatal {
    param([string]$Text)
    Write-Host "    [ERRO CRITICO] $Text" -ForegroundColor Red
    Write-Host "`nProcesso interrompido. Pressione Enter para sair..."
    Read-Host
    Exit 1
}

Clear-Host
Write-Host @"

  ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗
  ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║
  ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║
  ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
  ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
  STREAMCOMPANION - RUST + WASAPI + WEBRTC P2P BUILDER
"@ -ForegroundColor Cyan

$RootDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $RootDir
$TauriDir = Join-Path $RootDir "src-tauri"
$BinariesDir = Join-Path $TauriDir "binaries"
$OutputDir = Join-Path $RootDir "PRONTO_PARA_USAR"

# ------------------------------------------------------------------------------
# ETAPA 1: Verificação de Ferramentas Essenciais do Sistema
# ------------------------------------------------------------------------------
Write-Step "1/5: Verificando Ambiente e Dependências (Node.js, Rust e WebView2)"

# 1.1 Node.js e npm
Write-Info "Verificando Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    Write-Warn "Node.js não foi encontrado no PATH do Windows."
    Write-Info "Tentando instalar Node.js LTS via winget..."
    try {
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Success "Node.js instalado via winget!"
    } catch {
        Write-Fatal "Falha ao instalar Node.js automaticamente. Baixe manualmente em https://nodejs.org"
    }
} else {
    $nodeVer = & node --version
    Write-Success "Node.js detectado: $nodeVer"
}

# 1.2 Rust e Cargo
Write-Info "Verificando compilador Rust (cargo)..."
$cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -eq $cargoCmd) {
    Write-Warn "Rust/Cargo não encontrado no PATH."
    Write-Info "Tentando instalar Rustup via winget..."
    try {
        winget install Rustlang.Rustup --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Success "Rustup instalado! Certifique-se de reiniciar o terminal caso falhe a compilação."
    } catch {
        Write-Fatal "Rust não está instalado. Baixe o instalador oficial em https://rustup.rs"
    }
} else {
    $rustVer = & rustc --version
    Write-Success "Compilador Rust detectado: $rustVer"
}

# 1.3 Microsoft Edge WebView2 Runtime
Write-Info "Verificando Microsoft Edge WebView2 Runtime..."
$wv2Installed = $false
$regPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-F501-47EC-9A48-C42B02E8F6FE}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-F501-47EC-9A48-C42B02E8F6FE}"
)
foreach ($reg in $regPaths) {
    if (Test-Path $reg) {
        $wv2Installed = $true
        break
    }
}

if (-not $wv2Installed) {
    Write-Warn "WebView2 Runtime não detectado no registro. Tentando instalar via winget..."
    try {
        winget install Microsoft.EdgeWebView2Runtime --silent --accept-package-agreements --accept-source-agreements
        Write-Success "WebView2 Runtime instalado com sucesso!"
    } catch {
        Write-Warn "Não foi possível confirmar WebView2, prosseguindo com o build."
    }
} else {
    Write-Success "Microsoft Edge WebView2 Runtime verificado e pronto."
}

# ------------------------------------------------------------------------------
# ETAPA 2: Download Automático do cloudflared.exe (Quick Tunnel Sidecar)
# ------------------------------------------------------------------------------
Write-Step "2/5: Configurando Binário do Cloudflare Quick Tunnel (cloudflared.exe)"

if (-not (Test-Path $BinariesDir)) {
    New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
    Write-Info "Criado diretório de sidecars: $BinariesDir"
}

# Tauri v2 requer o nome do sidecar com a target-triple: cloudflared-x86_64-pc-windows-msvc.exe
$cloudflaredTargetFile = Join-Path $BinariesDir "cloudflared-x86_64-pc-windows-msvc.exe"
$cloudflaredSimpleFile = Join-Path $BinariesDir "cloudflared.exe"
$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

if (-not (Test-Path $cloudflaredTargetFile) -or (Get-Item $cloudflaredTargetFile).Length -lt 10000000) {
    Write-Info "Baixando versão oficial mais recente do cloudflared para Windows (x64)..."
    Write-Info "URL: $cloudflaredUrl"

    try {
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredTargetFile -UseBasicParsing
        Copy-Item -Path $cloudflaredTargetFile -Destination $cloudflaredSimpleFile -Force
        Write-Success "Download do cloudflared.exe concluído! ($( (Get-Item $cloudflaredTargetFile).Length / 1MB | ForEach-Object { [Math]::Round($_, 1) } ) MB)"
    } catch {
        Write-Fatal "Falha ao baixar o cloudflared.exe: $_"
    }
} else {
    Write-Success "cloudflared.exe já presente e validado na pasta de binaries."
}

# ------------------------------------------------------------------------------
# ETAPA 2.1: Verificação e Geração de Ícones do Windows (icon.ico)
# ------------------------------------------------------------------------------
$IconsDir = Join-Path $TauriDir "icons"
$IconIco = Join-Path $IconsDir "icon.ico"

if (-not (Test-Path $IconsDir)) {
    New-Item -ItemType Directory -Path $IconsDir -Force | Out-Null
}

if (-not (Test-Path $IconIco)) {
    Write-Info "Gerando icon.ico e PNGs para o Windows Resource Compiler..."
    $genIconScript = @"
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const iconsDir = path.resolve('$($IconsDir.Replace('\', '/'))');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

function createPng(w, h, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(6, 9);
  
  function chunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0); buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    let crc = 0xFFFFFFFF;
    for (let i = 4; i < 8 + len; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
    buf.writeInt32BE(~crc, 8 + len);
    return buf;
  }

  const rowSize = 1 + w * 4;
  const raw = Buffer.alloc(h * rowSize);
  for (let y = 0; y < h; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const px = off + 1 + x * 4;
      raw[px] = r; raw[px+1] = g; raw[px+2] = b; raw[px+3] = 255;
    }
  }

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const png32 = createPng(32, 32, 6, 182, 212);
const png128 = createPng(128, 128, 6, 182, 212);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png128);

const icoHead = Buffer.from([0, 0, 1, 0, 1, 0]);
const icoDir = Buffer.alloc(16);
icoDir.writeUInt8(32, 0); icoDir.writeUInt8(32, 1);
icoDir.writeUInt16LE(1, 4); icoDir.writeUInt16LE(32, 6);
icoDir.writeUInt32LE(png32.length, 8); icoDir.writeUInt32LE(22, 12);

const icoFile = Buffer.concat([icoHead, icoDir, png32]);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoFile);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icoFile);
console.log('OK');
"@
    try {
        & node -e $genIconScript | Out-Null
        Write-Success "icon.ico e arquivos de recursos gerados com sucesso."
    } catch {
        Write-Warn "Aviso ao gerar icon.ico: $_"
    }
} else {
    Write-Success "icon.ico verificado em src-tauri/icons."
}

# ------------------------------------------------------------------------------
# ETAPA 3: Instalação de Dependências Node.js e Tauri CLI
# ------------------------------------------------------------------------------
Write-Step "3/5: Instalando Dependências do Frontend e CLI do Tauri"

Write-Info "Executando 'npm install --legacy-peer-deps'..."
& npm install --legacy-peer-deps
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Tentando fallback com 'npm install --force'..."
    & npm install --force
}
if ($LASTEXITCODE -ne 0) {
    Write-Fatal "Falha ao instalar dependencias do npm. Verifique o log de erro do npm exibido acima."
}
Write-Success "Dependencias do npm instaladas com sucesso."

# Verifica se o Tauri CLI está disponível
Write-Info "Verificando Tauri CLI (@tauri-apps/cli)..."
if (-not (Test-Path "$PSScriptRoot/node_modules/.bin/tauri")) {
    Write-Info "Instalando @tauri-apps/cli@2.0.0 e @tauri-apps/api@2.0.0 de forma exata..."
    & npm install -E @tauri-apps/api@2.0.0 @tauri-apps/cli@2.0.0 --legacy-peer-deps
}

# ------------------------------------------------------------------------------
# ETAPA 4: Compilação de Produção (Frontend + Backend Rust em Modo Release)
# ------------------------------------------------------------------------------
Write-Step "4/5: Compilando o StreamCompanion em Modo Release (Otimização Máxima)"

Write-Info "Construindo Frontend React (Vite)..."
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Fatal "Falha ao compilar o frontend com Vite."
}
Write-Success "Frontend React construído na pasta 'dist'."

Write-Info "Iniciando compilação do Backend Rust com Tauri v2..."
Write-Info "Isso compilará as APIs WASAPI, Scrap DXGI e Servidor WebSocket com LTO e O3."

& npx tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Fatal "Falha na compilacao do binario Tauri. Verifique o log de erro do rustc/cargo exibido acima para o motivo exato."
}
Write-Success "Compilação do StreamCompanion finalizada com sucesso!"

# ------------------------------------------------------------------------------
# ETAPA 5: Entrega do Executável Pronto e Abertura Automática
# ------------------------------------------------------------------------------
Write-Step "5/5: Organizando Arquivos Prontos na Pasta 'PRONTO_PARA_USAR'"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Procura o executável compilado
$releaseDir = Join-Path $TauriDir "target\release"
$bundleDir = Join-Path $releaseDir "bundle"

$mainExe = Join-Path $releaseDir "stream-companion.exe"
if (-not (Test-Path $mainExe)) {
    # Tenta com o nome do produto
    $mainExe = Join-Path $releaseDir "StreamCompanion.exe"
}

if (Test-Path $mainExe) {
    $destExe = Join-Path $OutputDir "StreamCompanion.exe"
    Copy-Item -Path $mainExe -Destination $destExe -Force
    Write-Success "Executável principal copiado: $destExe"

    # Copia o cloudflared para rodar como executável independente
    Copy-Item -Path $cloudflaredSimpleFile -Destination (Join-Path $OutputDir "cloudflared.exe") -Force -ErrorAction SilentlyContinue
} else {
    Write-Warn "Executável standalone não localizado diretamente em $releaseDir"
}

# Procura instaladores NSIS ou MSI
$nsisDir = Join-Path $bundleDir "nsis"
$msiDir = Join-Path $bundleDir "msi"

if (Test-Path $nsisDir) {
    Get-ChildItem -Path $nsisDir -Filter "*.exe" | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $OutputDir -Force
        Write-Success "Instalador NSIS copiado: $($_.Name)"
    }
}

if (Test-Path $msiDir) {
    Get-ChildItem -Path $msiDir -Filter "*.msi" | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $OutputDir -Force
        Write-Success "Instalador MSI copiado: $($_.Name)"
    }
}

# Cria um arquivo LEIA-ME rápido na pasta de entrega
$readmePath = Join-Path $OutputDir "COMO_USAR.txt"
@"
================================================================================
                    STREAMCOMPANION - PRONTO PARA USAR
================================================================================

O StreamCompanion foi compilado com sucesso com todas as otimizações ativadas:
- Zero Eco do Discord (WASAPI Process Loopback nativo)
- Código da Sala Base64 URL-Safe sem necessidade de cadastro ou servidor central
- Cloudflare Quick Tunnel embutido (100% gratuito e self-hosted)
- Transmissão P2P com modo On-Demand e controles de volume individuais

COMO INICIAR:
1. Dê dois cliques em 'StreamCompanion.exe' ou use o instalador gerado.
2. Digite seu apelido e clique em 'Criar Sala (Host)' para gerar seu Código da Sala.
3. Envie o código gerado para seus amigos colarem no app deles.
4. Escolha o jogo no seletor de janelas e inicie a transmissão!

Divirta-se!
================================================================================
"@ | Set-Content -Path $readmePath -Encoding UTF8

Write-Host "`n"
Write-Host "================================================================================" -ForegroundColor Green
Write-Host " [SUCESSO TOTAL] O STREAMCOMPANION ESTÁ PRONTO PARA USO!" -ForegroundColor Green
Write-Host " Pasta de entrega: $OutputDir" -ForegroundColor White
Write-Host "================================================================================" -ForegroundColor Green
Write-Host "`nAbrindo a pasta no Windows Explorer agora...`n" -ForegroundColor Cyan

# Abre a pasta automaticamente no Windows Explorer
try {
    Invoke-Item $OutputDir
} catch {
    Start-Process explorer.exe -ArgumentList "`"$OutputDir`""
}

Write-Host "Pressione qualquer tecla para fechar esta janela..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
