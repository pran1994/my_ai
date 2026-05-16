#!/usr/bin/env sh
set -e

OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_HOST

case "$OLLAMA_HOST" in
  http://*|https://*) OLLAMA_WAIT_URL="$OLLAMA_HOST" ;;
  *) OLLAMA_WAIT_URL="http://${OLLAMA_HOST}" ;;
esac

# Default model cache (override on Render: mount disk + set OLLAMA_MODELS=/data/ollama)
export OLLAMA_MODELS="${OLLAMA_MODELS:-/root/.ollama}"

mkdir -p "$OLLAMA_MODELS"

echo "Starting Ollama ($OLLAMA_WAIT_URL, models dir $OLLAMA_MODELS)..."
ollama serve &
OLLAMA_PID=$!

cleanup() {
  kill "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

n=0
until curl -sf "${OLLAMA_WAIT_URL}/api/tags" >/dev/null 2>&1; do
  n=$((n + 1))
  if [ "$n" -gt 120 ]; then
    echo "Ollama did not become ready in time"
    exit 1
  fi
  sleep 1
done
echo "Ollama is up."

# Optional: comma-separated names, e.g. llama3.2,nomic-embed-text
# First boot can take many minutes — use a big enough Render instance + disk.
if [ -n "$OLLAMA_PULL_MODELS" ]; then
  echo "Pulling models: $OLLAMA_PULL_MODELS"
  oldIFS=$IFS
  IFS=,
  for m in $OLLAMA_PULL_MODELS; do
    m=$(echo "$m" | tr -d ' ')
    [ -z "$m" ] && continue
    ollama pull "$m" || exit 1
  done
  IFS=$oldIFS
fi

echo "Starting Node app..."
exec node src/server.js
