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

echo [2/3] Iniciando o construtor automatizado (builder.ps1)...
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
