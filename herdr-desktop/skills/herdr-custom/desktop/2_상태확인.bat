@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo [오류] python 을 찾을 수 없습니다. Python 3.9 이상을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
python setup.py --status
echo.
pause
