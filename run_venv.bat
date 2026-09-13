@echo off
title Live Bilingual Classroom Translation Application (Virtual Environment)
echo ============================================================
echo   Starting 100%% Local Live Bilingual Translation Pipeline
echo   ADI205/501 Group Project (Isolated .venv)
echo ============================================================
echo.

:: 1. Check/Create virtual environment
if not exist ".venv\Scripts\python.exe" (
    echo [Setup] Virtual environment '.venv' not found.
    echo [Setup] Creating Python virtual environment in .venv ...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment. Ensure 'python' is installed and in PATH.
        pause
        exit /b 1
    )
    echo [Setup] Upgrading pip and installing dependencies into .venv ...
    .\.venv\Scripts\python.exe -m pip install --upgrade pip
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install requirements into virtual environment.
        pause
        exit /b 1
    )
) else (
    :: Verify dependencies are present inside .venv
    .\.venv\Scripts\python.exe -c "import uvicorn, fastapi, faster_whisper, requests" 2>nul
    if %errorlevel% neq 0 (
        echo [Setup] Missing packages in .venv. Installing requirements.txt ...
        .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    )
)

:: 2. Check local Ollama service
echo.
echo [1/2] Checking local Ollama service...
.\.venv\Scripts\python.exe -c "import urllib.request; urllib.request.urlopen('http://localhost:11434/api/tags', timeout=2)" 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Ollama server does not appear to be running on port 11434.
    echo Please make sure Ollama is started!
) else (
    echo [OK] Ollama is active!
)

:: 3. Launch application server via .venv
echo.
echo [2/2] Launching application server on http://localhost:8000 ...
start http://localhost:8000
.\.venv\Scripts\python.exe main.py
pause
