@echo off
chcp 65001 >nul
title StreamCompanion - Automação One-Click Builder
color 0B

echo.
echo  ========================================================================
echo    STREAMCOMPANION - CONSTRUTOR AUTOMATIZADO ONE-CLICK (WINDOWS 10/11)
echo  ========================================================================
echo.
echo  [+] Inicializando o construtor nativo em PowerShell...
echo  [+] Permissões e políticas de execução ajustadas automaticamente.
echo.

:: Obtém o diretório do script batch
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:: Executa o script PowerShell mestre com Bypass de ExecutionPolicy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%builder.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [!] Ocorreu um erro durante a compilação.
    echo  [!] Verifique os logs acima para detalhes.
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo  [+] Processo finalizado com sucesso!
echo.
pause
