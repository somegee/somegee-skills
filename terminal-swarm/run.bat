@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "CONFIG=%USERPROFILE%\.swarm\config.json"
set "PYTHON=python"
set "SCRIPT=%~dp0scripts\swarm.py"

:: Read python_path from config
if exist "!CONFIG!" (
    for /f "usebackq delims=" %%i in (`python -c "import json,sys;print(json.load(open(sys.argv[1]))['python_path'])" "!CONFIG!" 2^>nul`) do set "PYTHON=%%i"
)
echo [Swarm] Python: !PYTHON!
echo [Swarm] Script: !SCRIPT!

:: Check dependencies
"!PYTHON!" -c "import winpty,winotify,websockets" >nul 2>&1
if errorlevel 1 (
    echo [Swarm] Installing dependencies...
    "!PYTHON!" -m pip install pywinpty winotify websockets
) else (
    echo [Swarm] Dependencies OK
)

:: Init config if missing
if not exist "!CONFIG!" (
    echo [Swarm] Initializing config...
    "!PYTHON!" "!SCRIPT!" config init
)

:: Stop existing daemon
echo [Swarm] Stopping existing daemon...
"!PYTHON!" "!SCRIPT!" stop >nul 2>&1

:: Start daemon
echo [Swarm] Starting daemon...
start /b "" "!PYTHON!" "!SCRIPT!" start >nul 2>&1
ping -n 3 127.0.0.1 >nul 2>&1

:: Verify
"!PYTHON!" "!SCRIPT!" status
if errorlevel 1 (
    echo [Swarm] ERROR: Daemon failed to start!
) else (
    start "" "http://localhost:7890/"
    echo [Swarm] Dashboard opened in browser.
)

echo.
pause
endlocal
