@echo off
chcp 65001 >nul
title ULTRON - Agente IA
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] Node.js nao encontrado. Baixe em https://nodejs.org
  echo  Alternativa: clique duplo em index.html para abrir sem servidor.
  pause
  exit /b 1
)

echo  Subindo o servidor ULTRON...
start "" /b node server.js > ultron-server.log 2>&1

set CONT=0
:AGUARDAR
timeout /t 1 /nobreak >nul
powershell -noprofile -command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8080);$c.Close();exit 0}catch{exit 1}"
if not errorlevel 1 goto PRONTO
set /a CONT+=1
if %CONT% GEQ 20 (
  echo.
  echo  [ERRO] O servidor nao respondeu em 20s. Detalhes:
  type ultron-server.log
  echo.
  echo  Tente abrir manualmente: http://127.0.0.1:8080
  pause
  exit /b 1
)
goto AGUARDAR

:PRONTO
echo  Servidor no ar! Abrindo o navegador...
start "" http://localhost:8080
echo.
echo  ULTRON em http://localhost:8080
echo  Se o navegador ainda mostrar erro, aperte F5 uma vez.
echo  NAO FECHE esta janela preta enquanto estiver usando o ULTRON.
echo  Para encerrar o ULTRON, feche esta janela.
echo.
pause
