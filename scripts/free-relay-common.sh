#!/bin/sh
# Shared free public media relay for macOS and Linux launchers.
# This file is sourced by the existing launchers; it never creates another UI entry.

free_relay_state_root() {
  printf '%s' "$1/.data/free-relay"
}

free_relay_pid_is_cloudflared() {
  PID_TO_CHECK=$1
  [ -n "$PID_TO_CHECK" ] || return 1
  kill -0 "$PID_TO_CHECK" 2>/dev/null || return 1
  COMMAND_TO_CHECK=$(ps -p "$PID_TO_CHECK" -o command= 2>/dev/null || true)
  case "$COMMAND_TO_CHECK" in
    *cloudflared*) return 0 ;;
  esac
  return 1
}

free_relay_stop() {
  ROOT_TO_USE=$1
  STATE_ROOT=$(free_relay_state_root "$ROOT_TO_USE")
  PID_FILE="$STATE_ROOT/cloudflared.pid"
  PID_TO_STOP=$(cat "$PID_FILE" 2>/dev/null || true)
  if free_relay_pid_is_cloudflared "$PID_TO_STOP"; then
    kill "$PID_TO_STOP" 2>/dev/null || true
    ATTEMPT=0
    while [ $ATTEMPT -lt 20 ] && free_relay_pid_is_cloudflared "$PID_TO_STOP"; do
      ATTEMPT=$((ATTEMPT + 1))
      sleep 0.1
    done
    if free_relay_pid_is_cloudflared "$PID_TO_STOP"; then kill -9 "$PID_TO_STOP" 2>/dev/null || true; fi
  fi
  rm -f "$STATE_ROOT/cloudflared.pid" "$STATE_ROOT/public-url.txt"
}

free_relay_is_running() {
  ROOT_TO_USE=$1
  STATE_ROOT=$(free_relay_state_root "$ROOT_TO_USE")
  PID_TO_CHECK=$(cat "$STATE_ROOT/cloudflared.pid" 2>/dev/null || true)
  [ -s "$STATE_ROOT/public-url.txt" ] || return 1
  free_relay_pid_is_cloudflared "$PID_TO_CHECK"
}

free_relay_public_url() {
  ROOT_TO_USE=$1
  STATE_ROOT=$(free_relay_state_root "$ROOT_TO_USE")
  PUBLIC_URL=$(cat "$STATE_ROOT/public-url.txt" 2>/dev/null || true)
  case "$PUBLIC_URL" in
    https://*.trycloudflare.com) printf '%s' "$PUBLIC_URL"; return 0 ;;
  esac
  return 1
}

free_relay_probe() {
  ROOT_TO_USE=$1
  PUBLIC_URL=$(free_relay_public_url "$ROOT_TO_USE" 2>/dev/null || true)
  [ -n "$PUBLIC_URL" ] || return 1
  PROBE_BODY="${TMPDIR:-/tmp}/sanmao-relay-probe-$$.json"
  rm -f "$PROBE_BODY"
  STATUS=$(curl --noproxy '*' -sS -o "$PROBE_BODY" -w '%{http_code}' --connect-timeout 2 --max-time 6 "$PUBLIC_URL/api/health" 2>/dev/null || true)
  if [ "$STATUS" = 200 ] && grep -Eq '"service"[[:space:]]*:[[:space:]]*"sanmao-ai-studio"' "$PROBE_BODY" 2>/dev/null && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$PROBE_BODY" 2>/dev/null; then
    rm -f "$PROBE_BODY"
    return 0
  fi
  rm -f "$PROBE_BODY"
  return 1
}

free_relay_log() {
  ROOT_TO_USE=$1
  LEVEL=$2
  MESSAGE=$3
  LOG_PATH="$ROOT_TO_USE/.data/logs/launcher.log"
  mkdir -p "$(dirname "$LOG_PATH")" 2>/dev/null || true
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$LEVEL" "$MESSAGE" >> "$LOG_PATH" 2>/dev/null || true
}

free_relay_watch() {
  ROOT_TO_USE=$1
  SERVER_PID_TO_WATCH=$2
  ORIGIN_PORT_TO_WATCH=$3
  UNHEALTHY_CHECKS=0
  STARTUP_DEADLINE=$(($(date +%s) + 45))
  while kill -0 "$SERVER_PID_TO_WATCH" 2>/dev/null; do
    if ! free_relay_is_running "$ROOT_TO_USE"; then
      free_relay_log "$ROOT_TO_USE" WARN '检测到免费媒体中转进程已退出，正在自动重建通道。'
      if NEW_RELAY_URL=$(free_relay_start "$ROOT_TO_USE" "$ORIGIN_PORT_TO_WATCH"); then
        UNHEALTHY_CHECKS=0
        free_relay_log "$ROOT_TO_USE" INFO "免费媒体中转通道已自动恢复：$NEW_RELAY_URL"
      else
        UNHEALTHY_CHECKS=0
        free_relay_log "$ROOT_TO_USE" WARN '免费媒体中转通道自动恢复失败，将继续重试。'
      fi
    elif [ "$(date +%s)" -ge "$STARTUP_DEADLINE" ] && ! free_relay_probe "$ROOT_TO_USE"; then
      UNHEALTHY_CHECKS=$((UNHEALTHY_CHECKS + 1))
      if [ "$UNHEALTHY_CHECKS" -ge 3 ]; then
        free_relay_log "$ROOT_TO_USE" WARN '检测到免费媒体中转公网地址不可达，正在自动更换通道。'
        if NEW_RELAY_URL=$(free_relay_start "$ROOT_TO_USE" "$ORIGIN_PORT_TO_WATCH"); then
          UNHEALTHY_CHECKS=0
          free_relay_log "$ROOT_TO_USE" INFO "免费媒体中转通道已自动恢复：$NEW_RELAY_URL"
        else
          UNHEALTHY_CHECKS=0
          free_relay_log "$ROOT_TO_USE" WARN '免费媒体中转通道自动恢复失败，将继续重试。'
        fi
      fi
    else
      UNHEALTHY_CHECKS=0
    fi
    sleep 10
  done
  free_relay_stop "$ROOT_TO_USE"
}

free_relay_download() {
  ROOT_TO_USE=$1
  STATE_ROOT=$(free_relay_state_root "$ROOT_TO_USE")
  BIN_ROOT="$ROOT_TO_USE/.data/bin"
  LOCAL_BINARY="$BIN_ROOT/cloudflared"
  if [ -x "$LOCAL_BINARY" ]; then printf '%s' "$LOCAL_BINARY"; return 0; fi
  if command -v cloudflared >/dev/null 2>&1; then command -v cloudflared; return 0; fi

  OS_NAME=$(uname -s 2>/dev/null || true)
  MACHINE_NAME=$(uname -m 2>/dev/null || true)
  case "$OS_NAME:$MACHINE_NAME" in
    Darwin:x86_64|Darwin:amd64) ASSET='cloudflared-darwin-amd64.tgz'; ARCHIVE=1 ;;
    Darwin:arm64|Darwin:aarch64) ASSET='cloudflared-darwin-arm64.tgz'; ARCHIVE=1 ;;
    Linux:x86_64|Linux:amd64) ASSET='cloudflared-linux-amd64'; ARCHIVE=0 ;;
    Linux:arm64|Linux:aarch64) ASSET='cloudflared-linux-arm64'; ARCHIVE=0 ;;
    Linux:i386|Linux:i686) ASSET='cloudflared-linux-386'; ARCHIVE=0 ;;
    Linux:armv7l|Linux:armv6l) ASSET='cloudflared-linux-arm'; ARCHIVE=0 ;;
    *) printf '%s\n' '当前系统或处理器架构暂不支持免费媒体中转通道。' >&2; return 1 ;;
  esac

  mkdir -p "$BIN_ROOT" "$STATE_ROOT"
  DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"
  DOWNLOAD_URLS="https://ghfast.top/$DOWNLOAD_URL
$DOWNLOAD_URL
https://ghproxy.net/$DOWNLOAD_URL"
  TEMP_ROOT="$STATE_ROOT/download-$$"
  TEMP_FILE="$TEMP_ROOT/$ASSET"
  rm -rf "$TEMP_ROOT"
  mkdir -p "$TEMP_ROOT"
  if ! command -v curl >/dev/null 2>&1; then
    printf '%s\n' '系统没有 curl，无法自动准备免费媒体中转通道。' >&2
    rm -rf "$TEMP_ROOT"
    return 1
  fi
  DOWNLOAD_OK=0
  while IFS= read -r CANDIDATE_URL; do
    [ -n "$CANDIDATE_URL" ] || continue
    if curl -fL --retry 2 --connect-timeout 10 --max-time 45 -o "$TEMP_FILE" "$CANDIDATE_URL" >/dev/null 2>&1; then
      DOWNLOAD_OK=1
      break
    fi
    rm -f "$TEMP_FILE"
  done <<EOF
$DOWNLOAD_URL
https://ghfast.top/$DOWNLOAD_URL
https://ghproxy.net/$DOWNLOAD_URL
EOF
  if [ "$DOWNLOAD_OK" -ne 1 ]; then
    printf '%s\n' '免费媒体中转通道组件下载失败；文本和普通图片仍可使用。' >&2
    rm -rf "$TEMP_ROOT"
    return 1
  fi

  if [ "$ARCHIVE" -eq 1 ]; then
    if ! tar -xzf "$TEMP_FILE" -C "$TEMP_ROOT" >/dev/null 2>&1 || [ ! -f "$TEMP_ROOT/cloudflared" ]; then
      printf '%s\n' '免费媒体中转通道组件解压失败；文本和普通图片仍可使用。' >&2
      rm -rf "$TEMP_ROOT"
      return 1
    fi
  fi
  if [ ! -f "$TEMP_ROOT/cloudflared" ] && [ "$ARCHIVE" -eq 0 ]; then
    printf '%s\n' '免费媒体中转通道组件文件不完整；文本和普通图片仍可使用。' >&2
    rm -rf "$TEMP_ROOT"
    return 1
  fi
  if ! chmod 700 "$TEMP_ROOT/cloudflared" || ! mv "$TEMP_ROOT/cloudflared" "$LOCAL_BINARY"; then
    printf '%s\n' '免费媒体中转通道组件安装失败；文本和普通图片仍可使用。' >&2
    rm -rf "$TEMP_ROOT"
    return 1
  fi
  rm -rf "$TEMP_ROOT"
  printf '%s' "$LOCAL_BINARY"
}

free_relay_start() {
  ROOT_TO_USE=$1
  ORIGIN_PORT=$2
  free_relay_stop "$ROOT_TO_USE"
  STATE_ROOT=$(free_relay_state_root "$ROOT_TO_USE")
  mkdir -p "$STATE_ROOT"
  CLOUDFLARED_BINARY=$(free_relay_download "$ROOT_TO_USE") || return 1
  STDOUT_FILE="$STATE_ROOT/cloudflared.out.log"
  STDERR_FILE="$STATE_ROOT/cloudflared.err.log"
  rm -f "$STDOUT_FILE" "$STDERR_FILE"
  # Force HTTP/2 over TCP. QUIC is blocked or unstable on many home and
  # corporate networks, which can leave a quick-tunnel URL unreachable.
  "$CLOUDFLARED_BINARY" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$ORIGIN_PORT" >"$STDOUT_FILE" 2>"$STDERR_FILE" &
  CLOUDFLARED_PID=$!
  printf '%s\n' "$CLOUDFLARED_PID" > "$STATE_ROOT/cloudflared.pid"

  ATTEMPT=0
  while [ $ATTEMPT -lt 90 ]; do
    if ! free_relay_pid_is_cloudflared "$CLOUDFLARED_PID"; then break; fi
    PUBLIC_URL=$(cat "$STDOUT_FILE" "$STDERR_FILE" 2>/dev/null | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1 | tr -d '\r' || true)
    if [ -n "$PUBLIC_URL" ]; then
      printf '%s\n' "$PUBLIC_URL" > "$STATE_ROOT/public-url.txt"
      # cloudflared prints the URL before the edge is ready. Only publish a
      # tunnel after the public health endpoint reaches the local service.
      PROBE_ATTEMPT=0
      while [ $PROBE_ATTEMPT -lt 40 ]; do
        if ! free_relay_pid_is_cloudflared "$CLOUDFLARED_PID"; then break; fi
        if free_relay_probe "$ROOT_TO_USE"; then
          printf '%s' "$PUBLIC_URL"
          return 0
        fi
        PROBE_ATTEMPT=$((PROBE_ATTEMPT + 1))
        sleep 0.5
      done
      free_relay_stop "$ROOT_TO_USE"
      printf '%s\n' 'Media relay address was not reachable; retrying.' >&2
      return 1
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 0.5
  done

  free_relay_stop "$ROOT_TO_USE"
  printf '%s\n' '免费媒体中转通道没有返回地址；文本和普通图片仍可使用。' >&2
  return 1
}
