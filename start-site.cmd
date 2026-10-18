@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-site.ps1"
set "siteExitCode=%errorlevel%"
if not "%siteExitCode%"=="0" pause
exit /b %siteExitCode%
