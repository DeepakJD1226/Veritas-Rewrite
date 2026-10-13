@echo off
setlocal
cd /d "%~dp0"
title Veritas Rewrite - First-time setup
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ first.
  pause
  exit /b 1
)
node scripts/setup.js
if errorlevel 1 (
  echo.
  echo Setup needs attention. Read the message above, then run setup again.
) else (
  echo.
  echo Setup complete. Double-click START_WINDOWS.bat to open the application.
)
pause
endlocal
