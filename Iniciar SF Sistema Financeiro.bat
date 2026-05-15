@echo off
setlocal

cd /d "%~dp0"
title SF Sistema de Organizacao Financeira

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Gerando a versao atualizada do site...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo Nao foi possivel gerar o build do site.
  pause
  exit /b 1
)

echo Iniciando o servidor local...
start "SF Servidor Local" /D "%~dp0" cmd /k "npm.cmd run app"

echo Abrindo no navegador...
powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:4173'"

echo.
echo O sistema foi iniciado.
echo Se quiser encerrar, feche a janela chamada 'SF Servidor Local'.
timeout /t 2 /nobreak >nul
