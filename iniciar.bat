@echo off
title Aethelgard MMORPG
color 0A

echo.
echo  ########################################
echo  #         AETHELGARD MMORPG            #
echo  #      Iniciando Servidores...         #
echo  ########################################
echo.

:: Inicia o servidor de jogo em uma janela separada
echo [1/2] Iniciando servidor de jogo (porta 3000)...
start "Aethelgard - Servidor" cmd /k "cd /d %~dp0server && npm run dev"

:: Aguarda 2 segundos para o servidor subir antes de iniciar o cliente
timeout /t 2 /nobreak > nul

:: Inicia o cliente Vite em uma janela separada
echo [2/2] Iniciando cliente web (porta 5173)...
start "Aethelgard - Cliente" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo  ########################################
echo  #  Servidores iniciados com sucesso!   #
echo  #                                      #
echo  #  Jogo:   http://localhost:5173       #
echo  #  Admin:  http://localhost:5173/admin.html #
echo  ########################################
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause > nul
