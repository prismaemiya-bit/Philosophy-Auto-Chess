@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  echo.
  echo [Sages' Glory] The bundled runtime is missing.
  echo Please extract the entire ZIP and keep all folders together.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0dist\server\index.js" (
  echo.
  echo [Sages' Glory] The production files are missing.
  echo Please extract the entire ZIP and try again.
  echo.
  pause
  exit /b 1
)

if "%IDEA_GARRISON_FOREGROUND%"=="1" (
  "%NODE%" "%~dp0portable-server.mjs"
  exit /b %errorlevel%
)
start "Sages' Glory v0.1 Demo" /min "%NODE%" "%~dp0portable-server.mjs" --open
exit /b 0
