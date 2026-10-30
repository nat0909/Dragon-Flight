@echo off
cd /d "%~dp0"
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    py -3 serve-game.py
    goto done
)
python -c "import sys" >nul 2>&1
if not errorlevel 1 (
    python serve-game.py
    goto done
)
echo Python 3 is required. Install it from https://www.python.org/downloads/
:done
pause
