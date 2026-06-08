@echo off
@echo off
title Aethelgard - Launcher
color 0A

echo.
echo  ########################################
echo  #         AETHELGARD MMORPG            #
echo  #      Iniciando tudo...               #
echo  ########################################
echo.

:: Inicia o servidor de jogo em uma janela separada
echo [1/3] Iniciando servidor de jogo (porta 3000)...
start "Aethelgard - Servidor" cmd /k "cd /d %~dp0server && npm run dev"

:: Aguarda 3 segundos para o servidor subir
timeout /t 3 /nobreak > nul

:: Inicia o cliente Vite em uma janela separada
echo [2/3] Iniciando cliente web (porta 5173)...
start "Aethelgard - Cliente" cmd /k "cd /d %~dp0client && npm run dev"

:: Aguarda 2 segundos para o Vite subir
timeout /t 2 /nobreak > nul

:: Pergunta se quer expor o servidor via cloudflared
echo.
echo [3/3] Deseja expor o servidor (porta 3000) para acesso externo? (S/N)
set /p TUNNEL_CHOICE=
if /I "%TUNNEL_CHOICE%"=="S" (
    start "Aethelgard - Cloudflare" cmd /k "start-cloudflared.bat"
    echo cloudflared iniciado. Copie a URL https://*.trycloudflare.com que aparecer.
) else (
    echo tunnel nao iniciado.
)

echo.
echo  ########################################
echo  #  Tudo pronto!                        #
echo  #                                      #
echo  #  Jogo:   http://localhost:5173       #
echo  #  Admin:  http://localhost:5173/admin.html #
echo  ########################################
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause > nul
