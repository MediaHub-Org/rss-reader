@echo off
rem Double-click to start the RSS Reader app server and open it.
rem Runs node directly on Windows -- no WSL hop. node_modules here was
rem installed by Windows npm (win32 rollup/esbuild binaries), so routing
rem through WSL's Linux node fails on a missing @rollup/rollup-linux-x64-gnu.
rem Extra arguments are passed through, e.g. "Launch RSS Reader.bat --no-open".
cd /d "%~dp0"
node scripts\launch.mjs %*
if errorlevel 1 pause
