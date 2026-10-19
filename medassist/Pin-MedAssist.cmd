@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MedAssist - desktop shortcut
set "MEDASSIST_HOME=%~dp0"
if not exist "%MEDASSIST_HOME%Start-MedAssist.cmd" goto missing
if not exist "%MEDASSIST_HOME%app\index.html" goto missing
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference = 'Stop'; $shell = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); if (-not $desktop) { throw 'Desktop folder is unavailable.' }; $items = @(@{Name='MedAssist.lnk'; Target='Start-MedAssist.cmd'}, @{Name='MedAssist Update.lnk'; Target='Update-MedAssist.cmd'}); foreach ($item in $items) { $target = Join-Path $env:MEDASSIST_HOME $item.Target; if (-not (Test-Path -LiteralPath $target)) { throw ('Missing file: ' + $target) }; $linkPath = Join-Path $desktop $item.Name; if ((Test-Path -LiteralPath $linkPath) -and $shell.CreateShortcut($linkPath).TargetPath -ne $target) { throw ($item.Name + ' already points to another folder. Rename that shortcut and try again.') } }; foreach ($item in $items) { $linkPath = Join-Path $desktop $item.Name; $shortcut = $shell.CreateShortcut($linkPath); $shortcut.TargetPath = Join-Path $env:MEDASSIST_HOME $item.Target; $shortcut.WorkingDirectory = $env:MEDASSIST_HOME; $shortcut.Description = 'MedAssist - local offline prototype'; $shortcut.WindowStyle = 7; $shortcut.Save(); Write-Host ('Shortcut created: ' + $linkPath) }"
if errorlevel 1 goto failed
echo Open MedAssist to work, or MedAssist Update to check for updates.
echo Read START-HERE.txt for instructions in Russian.
pause
exit /b 0
:missing
echo Keep Pin-MedAssist.cmd in the medassist folder with Start-MedAssist.cmd and app.
pause
exit /b 1
:failed
echo The shortcut was not created. See the error above.
echo You can still run Start-MedAssist.cmd directly.
pause
exit /b 1
