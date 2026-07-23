@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  echo.
  echo [Philosophy Auto Chess] The bundled runtime is missing.
  echo Please extract the entire ZIP and keep all folders together.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0dist\server\index.js" (
  echo.
  echo [Philosophy Auto Chess] The production files are missing.
  echo Please extract the entire ZIP and try again.
  echo.
  pause
  exit /b 1
)

if "%IDEA_GARRISON_FOREGROUND%"=="1" (
  "%NODE%" "%~dp0portable-server.mjs"
  exit /b %errorlevel%
)
start "Philosophy Auto Chess v0.2" /min "%NODE%" "%~dp0portable-server.mjs" --open
exit /b 0
