@echo off
chcp 65001 >nul
title Meteo apka
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:8765"
python server.py
pause
