@echo off
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-server.ps1"
if errorlevel 1 (
  echo.
  echo MOS Scene Hunt computer server did not start. See the error above.
  pause
)
