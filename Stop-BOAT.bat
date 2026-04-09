@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "scripts\stop-system.ps1"
endlocal
