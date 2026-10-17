@echo off
chcp 65001 >nul
title 356-maktab sayti
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js o'rnatilmagan. https://nodejs.org saytidan LTS versiyasini o'rnating.
  echo.
  pause
  exit /b
)
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000/admin"
node server.js
pause
