@echo off
title SUS-Sinc | Sistema de Agenda e Pacientes Integrado ao SUS
cd /d "%~dp0"
chcp 65001 > nul
cls

echo ======================================================================
echo   [SUS-SINC] SISTEMA DE AGENDA & PACIENTES INTEGRADO AO SUS
echo   Sincronizacao Automatica (e-SUS PEC / SISREG) e Salvamento Continuo
echo ======================================================================
echo.
echo Diretorio do sistema: %~dp0
echo Verificando instalacao do Node.js...
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERRO] O Node.js nao foi encontrado no seu computador!
    echo Por favor, certifique-se de que o Node.js esta instalado em https://nodejs.org/
    echo.
    echo Pressione qualquer tecla para sair...
    pause >nul
    exit /b 1
)

echo [OK] Node.js detectado com sucesso.
echo [OK] Iniciando banco de dados local SQLite e servidor web...
echo.
echo O navegador abrira automaticamente em: http://localhost:3000
echo (Para encerrar o sistema no final do expediente, basta fechar esta janela)
echo ======================================================================
echo.

node server.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] O servidor encerrou com codigo de erro %ERRORLEVEL%.
    pause
)
