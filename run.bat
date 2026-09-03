@echo off
title Live Bilingual Classroom Translation Application
echo ============================================================
echo   Starting 100%% Local Live Bilingual Translation Pipeline
echo   ADI205/501 Group Project
echo ============================================================
echo.

python -c "import uvicorn, fastapi, faster_whisper, requests" 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Required Python packages not found.
    echo Running: pip install -r requirements.txt
    pip install -r requirements.txt
)

echo [1/2] Checking local Ollama service...
python -c "import urllib.request; urllib.request.urlopen('http://localhost:11434/api/tags', timeout=2)" 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Ollama server does not appear to be running on port 11434.
    echo Please make sure Ollama is started!
) else (
    echo [OK] Ollama is active with qwen2.5:3b!
)

echo [2/2] Launching application server on http://localhost:8000 ...
start http://localhost:8000
python main.py
pause
