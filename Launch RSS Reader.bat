@echo off
rem Double-click to start the RSS Reader app server and open it.
rem The project folder lives on the Windows side, the app runs in WSL
rem (build tooling is Linux-only). Extra arguments are passed through,
rem e.g. "Launch RSS Reader.bat --no-open".
cd /d "%~dp0"
wsl bash scripts/launch-wsl.sh %*
