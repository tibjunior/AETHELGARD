@echo off
cd /d "%~dp0"
cloudflared tunnel --url http://localhost:3000
