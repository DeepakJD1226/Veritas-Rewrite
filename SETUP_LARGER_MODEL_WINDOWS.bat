@echo off
setlocal
cd /d "%~dp0"
title Veritas Rewrite - Optional larger local model
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ first.
  pause
  exit /b 1
)
echo This optional setup downloads qwen2.5:7b, about 4.7 GB, if missing.
echo It selects that model only after local model verification succeeds.
echo It requires more memory than llama3.2 and can be slower on a CPU.
echo.
node scripts/setup.js --larger-model
if errorlevel 1 (
  echo The larger model was not selected. Read the message above.
) else (
  echo Restart START_WINDOWS.bat to use the selected model.
)
pause
endlocal
