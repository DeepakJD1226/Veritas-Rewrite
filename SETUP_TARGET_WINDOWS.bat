@echo off
setlocal
cd /d "%~dp0"
title Veritas Rewrite - Local detector setup
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ first.
  pause
  exit /b 1
)
echo Installing pinned detector runtime and model. Internet is needed once.
call npm install --no-audit --no-fund
if errorlevel 1 goto failed
node scripts/setup-detector.js
if errorlevel 1 goto failed
echo.
echo Detector setup complete. Restart START_WINDOWS.bat and check the connection.
pause
exit /b 0
:failed
echo.
echo Detector setup failed. Read the error above and run this file again.
echo You can turn target mode off to use normal rewriting.
pause
exit /b 1
