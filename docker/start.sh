#!/usr/bin/env bash
set -Eeuo pipefail

ollama serve &
ollama_pid=$!
python /app/main.py &
app_pid=$!

cleanup() {
  trap - EXIT TERM INT
  kill -TERM "$app_pid" "$ollama_pid" 2>/dev/null || true
  wait "$app_pid" "$ollama_pid" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

# If either service exits, stop the other and mark the container as failed.
set +e
wait -n "$ollama_pid" "$app_pid"
status=$?
set -e
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
