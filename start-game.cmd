@echo off
setlocal
cd /d "%~dp0"

rem The portable package carries its own node.exe. npm starts child tools by
rem calling "node", so the runtime folder must also be on PATH.
set "RUNTIME_DIR="
if exist "%~dp0runtime\node.exe" set "RUNTIME_DIR=%~dp0runtime"
if not defined RUNTIME_DIR if exist "%~dp0release\runtime\node.exe" set "RUNTIME_DIR=%~dp0release\runtime"
if defined RUNTIME_DIR set "PATH=%RUNTIME_DIR%;%PATH%"

set "NPM_CMD="
if exist "%~dp0runtime\npm.cmd" set "NPM_CMD=%~dp0runtime\npm.cmd"
if not defined NPM_CMD if exist "%~dp0release\runtime\npm.cmd" set "NPM_CMD=%~dp0release\runtime\npm.cmd"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM_CMD=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%APPDATA%\npm\npm.cmd" set "NPM_CMD=%APPDATA%\npm\npm.cmd"
if not defined NPM_CMD (
  where npm.cmd >nul 2>&1 && set "NPM_CMD=npm.cmd"
)
if not defined NPM_CMD (
  echo.
  echo Node.js was not found on this computer.
  echo Install Node.js LTS from https://nodejs.org/ then run this file again.
  echo If you received the portable package, make sure the runtime folder was extracted too.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first run...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo.
    echo Install failed. Please check Node.js and network access, then try again.
    pause
    exit /b 1
  )
)

rem This launcher owns port 3000.  Stop the prior launcher instance first so
rem the browser can never silently stay connected to an older dev server.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo Stopping previous Philosophy Auto Chess server, PID %%P...
  taskkill /PID %%P /T /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

rem --strictPort prevents Vite from moving to 3001 while the launcher still
rem opens 3000.  Every launch therefore serves this exact folder.
start "Philosophy Auto Chess Server" %ComSpec% /d /k ""%NPM_CMD%" run dev -- --host 127.0.0.1 --port 3000 --strictPort"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000/?launcher=%RANDOM%%RANDOM%"
exit /b 0
