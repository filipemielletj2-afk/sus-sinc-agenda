@echo off
title SUS-Sinc | Enviar para o GitHub
cd /d "%~dp0"
chcp 65001 > nul
cls

echo ======================================================================
echo   [SUS-SINC] PUBLICADOR AUTOMATICO PARA O GITHUB
echo ======================================================================
echo.

set /p GITHUB_URL="Cole aqui a URL do seu repositorio no GitHub (ou seu usuario do GitHub): "

if "%GITHUB_URL%"=="" (
    echo [ERRO] Nenhuma URL ou usuario informado.
    pause
    exit /b 1
)

:: Se o usuario digitou apenas o nome de usuario
echo %GITHUB_URL% | findstr /i "http" >nul
if %ERRORLEVEL% neq 0 (
    set GITHUB_URL=https://github.com/%GITHUB_URL%/sus-sinc-agenda.git
)

echo.
echo Conectando ao repositorio remoto: %GITHUB_URL%...
git remote remove origin >nul 2>&1
git remote add origin %GITHUB_URL%
git branch -M master

echo.
echo Enviando arquivos para o GitHub...
git push -u origin master

if %ERRORLEVEL% equ 0 (
    echo.
    echo ======================================================================
    echo   [SUCESSO] Seu sistema foi publicado com sucesso no GitHub!
    echo   Acesse: %GITHUB_URL%
    echo ======================================================================
) else (
    echo.
    echo [AVISO] Houve um problema no envio. Verifique suas permissoes no GitHub.
)

pause
