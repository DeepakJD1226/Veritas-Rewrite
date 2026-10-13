@echo off
setlocal
cd /d "%~dp0"
title Veritas Rewrite
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or newer from https://nodejs.org/
  echo Then reopen this file.
  pause
  exit /b 1
)
node server.js --open
if errorlevel 1 (
  echo.
  echo The application could not start. Read the message above.
  pause
)
endlocal
