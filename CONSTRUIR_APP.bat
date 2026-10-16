@echo off
setlocal
cd /d "%~dp0"
cls
echo ====================================================================
echo   STREAMCOMPANION - CONSTRUTOR AUTOMATIZADO ONE-CLICK (WINDOWS x64)
echo ====================================================================
echo.
echo [1/3] Verificando PowerShell no sistema...
where powershell.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] PowerShell nao foi localizado no Windows PATH.
    echo Por favor, abra o PowerShell e execute builder.ps1 diretamente.
    echo.
    pause
    exit /b 1
)

echo [2/3] Configurando ambiente de desenvolvimento e construtor...
rem Encerra processos antigos para liberar locks de arquivos e permitir substituição/exclusão
taskkill /F /IM StreamCompanion.exe /T >nul 2>&1
taskkill /F /IM stream-companion.exe /T >nul 2>&1
taskkill /F /IM cloudflared.exe /T >nul 2>&1

rem Inicializa variaveis de compilacao C++ (vcvars64.bat) se o Visual Studio estiver instalado
if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" (
    for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath`) do (
        if exist "%%i\VC\Auxiliary\Build\vcvars64.bat" (
            call "%%i\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
        )
    )
)

echo [3/3] Iniciando o construtor automatizado (builder.ps1)...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0builder.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ====================================================================
    echo [ERRO] O processo foi encerrado com codigo de erro %ERRORLEVEL%.
    echo Verifique as mensagens de erro detalhadas acima.
    echo ====================================================================
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================================
echo [SUCESSO] StreamCompanion construido com exito!
echo Verifique a pasta 'PRONTO_PARA_USAR'.
echo ====================================================================
echo.
pause
