#!/bin/sh
# Shared macOS launcher helpers for SANMAO.AI start-macos.sh / stop-macos.sh.
# This file is sourced. Call sanmao_init before using the functions below.

sanmao_init() {
  SANMAO_ROOT_DIR="$1"
  SANMAO_PORT_START="$2"
  SANMAO_PORT_END="$3"
  SANMAO_LEGACY_START="$4"
  SANMAO_LEGACY_END="$5"
  SANMAO_LOG_FILE="$6"
  export SANMAO_ROOT_DIR SANMAO_PORT_START SANMAO_PORT_END SANMAO_LEGACY_START SANMAO_LEGACY_END SANMAO_LOG_FILE
  if [ -n "$SANMAO_LOG_FILE" ]; then
    mkdir -p "$(dirname "$SANMAO_LOG_FILE")" 2>/dev/null || true
  fi
}

sanmao_operation_lock_stale() {
  LOCK_PATH_TO_CHECK=$1
  [ -f "$LOCK_PATH_TO_CHECK" ] || return 1
  LOCK_MTIME=$(stat -f %m "$LOCK_PATH_TO_CHECK" 2>/dev/null || stat -c %Y "$LOCK_PATH_TO_CHECK" 2>/dev/null || printf '0')
  NOW_SECONDS=$(date +%s)
  case "$LOCK_MTIME" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$LOCK_MTIME" -gt 0 ] || return 1
  [ $((NOW_SECONDS - LOCK_MTIME)) -gt 600 ] || return 1
  LOCK_PID_TO_CHECK=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$LOCK_PATH_TO_CHECK" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCK_PID_TO_CHECK" ] && kill -0 "$LOCK_PID_TO_CHECK" 2>/dev/null; then return 1; fi
  return 0
}

sanmao_log() {
  [ -n "$SANMAO_LOG_FILE" ] || return 0
  TS=$(date '+%Y-%m-%d %H:%M:%S')
  printf '[%s] [%s] %s\n' "$TS" "$2" "$1" >> "$SANMAO_LOG_FILE" 2>/dev/null || true
}

sanmao_listening_pid_on_port() {
  PORT=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  else
    netstat -anv -p tcp 2>/dev/null | awk -v p=".$PORT " 'index($0, p) && $0 ~ /LISTEN/ { gsub(/^.* /, "", $0); print $0 }' || true
  fi
}

sanmao_server_health() {
  PORT=$1
  BODY="${TMPDIR:-/tmp}/sanmao-health-$$.json"
  rm -f "$BODY"

  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
  if [ "$STATUS" = 200 ] && grep -q '"service"' "$BODY" 2>/dev/null && grep -q 'sanmao-ai-studio' "$BODY" 2>/dev/null; then
    rm -f "$BODY"
    return 0
  fi

  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT/api/state" 2>/dev/null || true)
  case "$STATUS" in
    2??|3??|4??)
      if grep -q '"providers"' "$BODY" 2>/dev/null && grep -q '"models"' "$BODY" 2>/dev/null && grep -q '"settings"' "$BODY" 2>/dev/null; then
        rm -f "$BODY"
        return 0
      fi
      ;;
  esac

  rm -f "$BODY"
  return 1
}

sanmao_command_owned() {
  PORT=$1
  COMMAND=$2
  [ -n "$COMMAND" ] || return 1

  case "$COMMAND" in
    *"$SANMAO_ROOT_DIR"*next*start*|*"$SANMAO_ROOT_DIR"*next*dev*|*"$SANMAO_ROOT_DIR"*npm*start*)
      return 0
      ;;
  esac

  case "$COMMAND" in
    *node_modules/next/dist/bin/next*start*|*node_modules/next/dist/bin/next*dev*)
      if [ "$PORT" -ge "$SANMAO_PORT_START" ] 2>/dev/null && [ "$PORT" -le "$SANMAO_PORT_END" ] 2>/dev/null; then
        return 0
      fi
      if [ "$PORT" -ge "$SANMAO_LEGACY_START" ] 2>/dev/null && [ "$PORT" -le "$SANMAO_LEGACY_END" ] 2>/dev/null; then
        sanmao_server_health "$PORT" && return 0
      fi
      ;;
  esac

  if sanmao_server_health "$PORT"; then
    case "$COMMAND" in
      *node*) return 0 ;;
    esac
  fi
  return 1
}

sanmao_owned_processes() {
  START=$1
  END=$2
  PORT=$START
  while [ "$PORT" -le "$END" ]; do
    PIDS=$(sanmao_listening_pid_on_port "$PORT")
    if [ -n "$PIDS" ]; then
      printf '%s\n' "$PIDS" | while IFS= read -r PID; do
        [ -n "$PID" ] || continue
        COMMAND=$(ps -p "$PID" -o command= 2>/dev/null || true)
        if sanmao_command_owned "$PORT" "$COMMAND"; then
          printf '%s %s\n' "$PID" "$PORT"
        fi
      done
    fi
    PORT=$((PORT + 1))
  done
}

sanmao_stop_pid() {
  PID=$1
  kill "$PID" 2>/dev/null || true
  ATTEMPT=0
  while [ $ATTEMPT -lt 20 ]; do
    if ! kill -0 "$PID" 2>/dev/null; then return 0; fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 0.1
  done
  kill -9 "$PID" 2>/dev/null || true
}

sanmao_clear_stale() {
  START=$1
  END=$2
  sanmao_owned_processes "$START" "$END" | sort -u -k1,1 | while IFS=' ' read -r PID PORT; do
    [ -n "$PID" ] || continue
    sanmao_log "清理旧服务 PID $PID 端口 $PORT" INFO
    sanmao_stop_pid "$PID"
  done
}
