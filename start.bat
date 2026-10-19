@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
if errorlevel 1 goto end
node server.mjs
:end
pause
