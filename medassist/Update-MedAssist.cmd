@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MedAssist - update
powershell.exe -NoLogo -NoProfile -STA -File "%~dp0updater\Update-MedAssist.ps1"
if not errorlevel 1 exit /b 0
echo The update did not complete. Read the message above.
echo Read START-HERE.txt. Do not change your Windows security settings.
pause
exit /b 1
