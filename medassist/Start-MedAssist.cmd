@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MedAssist - offline demo

set "APP_FILE=%~dp0app\index.html"
if not exist "%APP_FILE%" goto missing
set "APP_URL=file:///%APP_FILE:\=/%"

set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER goto default_browser

start "" "%BROWSER%" "--app=%APP_URL%"
if errorlevel 1 goto launch_error
exit /b 0

:default_browser
echo Edge and Chrome were not found in their standard folders.
echo Opening MedAssist in your default browser.
echo If it does not open, open app\index.html manually in a browser.
echo Read START-HERE.txt for instructions in Russian.
start "" "%APP_FILE%"
pause
exit /b 0

:missing
echo The app\index.html file was not found.
echo Extract the entire archive before running Start-MedAssist.cmd.
echo Keep this file together with the app folder.
echo Read START-HERE.txt for instructions in Russian.
pause
exit /b 1

:launch_error
echo The browser could not be started.
echo Open app\index.html manually in Edge or Chrome.
echo Read START-HERE.txt for instructions in Russian.
pause
exit /b 1
