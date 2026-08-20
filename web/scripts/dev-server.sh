#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$APP_DIR/.agent"
PID_FILE="$AGENT_DIR/dev-server.pid"
LOG_FILE="$AGENT_DIR/dev-server.log"

mkdir -p "$AGENT_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "Dev server is already running (PID $(cat "$PID_FILE"))."
    return 0
  fi

  rm -f "$PID_FILE"

  echo "Starting dev server..."
  cd "$APP_DIR"

  echo "[$(date '+%H:%M:%S')] === Dev server starting ===" >"$LOG_FILE"

  nohup ./node_modules/.bin/vite --host --port 5173 >>"$LOG_FILE" 2>&1 &
  local pid=$!

  echo "$pid" >"$PID_FILE"

  # Give the process a moment to fail immediately.
  sleep 1

  if ! is_running; then
    echo "Dev server failed to start."
    echo "--- Last logs ---"
    tail -n 50 "$LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi

  echo "Dev server started (PID $pid)."
  echo "Logs: $LOG_FILE"
}

stop() {
  if ! is_running; then
    echo "Dev server is not running."
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"

  echo "Stopping dev server (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  # Wait up to 5 seconds for graceful shutdown.
  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  # Force kill if necessary.
  if kill -0 "$pid" 2>/dev/null; then
    echo "Process did not stop gracefully; killing..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Dev server stopped."
}

status() {
  if is_running; then
    echo "running"
    echo "pid=$(cat "$PID_FILE")"
  else
    echo "stopped"
    rm -f "$PID_FILE"
  fi
}

logs() {
  local lines="${2:-100}"

  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No log file yet."
    return 0
  fi

  tail -n "$lines" "$LOG_FILE"
}

follow_logs() {
  touch "$LOG_FILE"
  tail -f "$LOG_FILE"
}

restart() {
  stop
  start
}

case "${1:-}" in
start)
  start
  ;;
stop)
  stop
  ;;
restart)
  restart
  ;;
status)
  status
  ;;
logs)
  logs "$@"
  ;;
follow)
  follow_logs
  ;;
*)
  echo "Usage:"
  echo "  $0 start"
  echo "  $0 stop"
  echo "  $0 restart"
  echo "  $0 status"
  echo "  $0 logs [lines]"
  echo "  $0 follow"
  exit 1
  ;;
esac
