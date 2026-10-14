# ==============================================================================
# StreamCompanion - One-Click Master Builder Script (PowerShell)
# Autor: StreamCompanion Automation Team
# Compatibilidade: Windows 10 (Build 20348+) e Windows 11 (x64)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "StreamCompanion - One-Click Master Builder"

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
    Write-Host "    [ERRO CRÍTICO] $Text" -ForegroundColor Red
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

$RootDir = Get-Location
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
# ETAPA 3: Instalação de Dependências Node.js e Tauri CLI
# ------------------------------------------------------------------------------
Write-Step "3/5: Instalando Dependências do Frontend e CLI do Tauri"

Write-Info "Executando 'npm install'..."
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Fatal "Falha ao instalar dependências do npm. Verifique sua conexão com a internet."
}
Write-Success "Dependências do npm instaladas com sucesso."

# Verifica se o Tauri CLI está disponível
Write-Info "Verificando Tauri CLI (cargo-tauri ou @tauri-apps/cli)..."
$hasCargoTauri = Get-Command cargo-tauri -ErrorAction SilentlyContinue
if ($null -eq $hasCargoTauri) {
    Write-Info "Instalando @tauri-apps/cli localmente..."
    & npm install -D @tauri-apps/cli
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

if ($null -ne $hasCargoTauri) {
    & cargo tauri build
} else {
    & npx tauri build
}

if ($LASTEXITCODE -ne 0) {
    Write-Fatal "Falha na compilação do binário Tauri. Verifique se o Visual Studio C++ Build Tools está instalado."
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
