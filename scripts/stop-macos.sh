#!/bin/sh
set -eu
SCRIPT_DIR=`CDPATH= cd -- "$(dirname "$0")" && pwd`
ROOT_DIR=`CDPATH= cd -- "$SCRIPT_DIR/.." && pwd`
FOUND=0

stop_range() {
  PORT=$1
  LAST_PORT=$2
  while [ $PORT -le $LAST_PORT ]; do
    PIDS=`lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true`
    for PID in $PIDS; do
      COMMAND=`ps -p "$PID" -o command= 2>/dev/null || true`
      case "$COMMAND" in
        *"$ROOT_DIR"*next*start*|*"$ROOT_DIR"*npm*start*)
          kill "$PID" 2>/dev/null || true
          FOUND=1
          ;;
      esac
    done
    PORT=$((PORT + 1))
  done
}

if command -v lsof >/dev/null 2>&1; then
  stop_range 3000 3010
  stop_range 3210 3220
fi

if [ "$FOUND" -eq 1 ]; then
  printf '%s\n' 'SANMAO.AI 本地服务已停止。'
else
  printf '%s\n' 'SANMAO.AI 当前没有发现正在运行的本地服务。'
fi
