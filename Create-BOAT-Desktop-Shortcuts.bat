@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "scripts\create-desktop-shortcuts.ps1"
echo.
pause
endlocal
