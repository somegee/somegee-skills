r"""Terminal Swarm - BAT shortcut generator

Usage:
    python create_bat.py <bat_path> <work_dir>
    python create_bat.py   (interactive mode)

Examples:
    python create_bat.py "C:\Users\me\Desktop\Terminal Swarm.bat" "C:\projects"
    python create_bat.py "$HOME/Desktop/Terminal Swarm.bat" "$HOME/projects"
"""
import sys
import os
import pathlib


BAT_TEMPLATE = r"""@echo off
chcp 65001 >nul 2>&1

cd /d "{work_dir}"

:: 1. Find swarm.py from plugin cache
set "SCRIPT="
for /f "delims=" %%f in ('dir /s /b "%USERPROFILE%\.claude\plugins\cache\*swarm.py" 2^>nul ^| findstr /i "terminal-swarm"') do set "SCRIPT=%%f"

if not defined SCRIPT (
    echo [Swarm] plugin not found. Run: claude plugin install terminal-swarm@somegee-skills
    pause
    exit /b 1
)

:: 2. Read python_path from config
set "PYTHON=python"
set "CONFIG=%USERPROFILE%\.swarm\config.json"
if exist "%CONFIG%" (
    for /f "usebackq delims=" %%i in (`python -c "import json,sys;print(json.load(open(sys.argv[1]))['python_path'])" "%CONFIG%" 2^>nul`) do set "PYTHON=%%i"
)
echo [Swarm] Python: %PYTHON%
echo [Swarm] Script: %SCRIPT%

:: 3. Check dependencies
"%PYTHON%" -c "import winpty,winotify,websockets" >nul 2>&1
if errorlevel 1 (
    echo [Swarm] Installing dependencies...
    "%PYTHON%" -m pip install pywinpty winotify websockets
) else (
    echo [Swarm] Dependencies OK
)

:: 4. Init config if missing
if not exist "%CONFIG%" (
    echo [Swarm] Initializing config...
    "%PYTHON%" "%SCRIPT%" config init
)

:: 5. Hooks setup
echo [Swarm] Checking hooks...
"%PYTHON%" "%SCRIPT%" hooks status >nul 2>&1
if errorlevel 1 (
    echo [Swarm] Setting up hooks...
    "%PYTHON%" "%SCRIPT%" hooks setup
)

:: 6. Stop existing daemon
echo [Swarm] Stopping existing daemon...
"%PYTHON%" "%SCRIPT%" stop >nul 2>&1

:: 7. Start daemon
echo [Swarm] Starting daemon...
start /b "" "%PYTHON%" "%SCRIPT%" start >nul 2>&1
ping -n 3 127.0.0.1 >nul

:: 8. Verify and open dashboard
"%PYTHON%" "%SCRIPT%" status
if errorlevel 1 (
    echo [Swarm] ERROR: Daemon failed to start!
) else (
    start "" "http://localhost:7890/"
    echo [Swarm] Dashboard opened.
)

:: 9. Show sessions
"%PYTHON%" "%SCRIPT%" list

echo.
pause
"""


def create_bat(bat_path: str, work_dir: str) -> None:
    bat_path = pathlib.Path(os.path.expandvars(os.path.expanduser(bat_path)))
    work_dir = pathlib.Path(os.path.expandvars(os.path.expanduser(work_dir)))

    if not work_dir.is_dir():
        print(f"Error: work_dir does not exist: {work_dir}")
        sys.exit(1)

    content = BAT_TEMPLATE.format(work_dir=str(work_dir))
    # Write raw bytes: no BOM, CRLF line endings
    bat_path.write_bytes(content.strip().encode("utf-8").replace(b"\n", b"\r\n") + b"\r\n")
    print(f"Created: {bat_path}")
    print(f"Work dir: {work_dir}")


def main() -> None:
    if len(sys.argv) == 3:
        create_bat(sys.argv[1], sys.argv[2])
    else:
        print("=== Terminal Swarm - BAT Shortcut Generator ===")
        print()
        bat_path = input("BAT file path (e.g. C:\\Users\\me\\Desktop\\Terminal Swarm.bat): ").strip()
        work_dir = input("Working directory (e.g. C:\\Users\\me\\projects): ").strip()
        if not bat_path or not work_dir:
            print("Error: both paths are required.")
            sys.exit(1)
        create_bat(bat_path, work_dir)


if __name__ == "__main__":
    main()
