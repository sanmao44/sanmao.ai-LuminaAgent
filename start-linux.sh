#!/usr/bin/env sh
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$SCRIPT_DIR
cd "$ROOT_DIR"
. "$SCRIPT_DIR/scripts/free-relay-common.sh"
if [ ! -x node_modules/.bin/next ] || [ ! -f node_modules/typescript/package.json ] || [ ! -f node_modules/@types/node/package.json ] || [ ! -f node_modules/@types/react/package.json ] || [ ! -f node_modules/@types/react-dom/package.json ]; then
  if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi
fi
if [ ! -f .next/BUILD_ID ]; then npm run build; fi
PORT="${SANMAO_PORT:-3210}"
case "$PORT" in
  ''|*[!0-9]*) PORT=3210 ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65525 ]; then PORT=3210; fi
resolve_provider_config_dir() {
  CONFIG_DIR="${SANMAO_PROVIDER_CONFIG_DIR:-${SANMAO_DATA_DIR:-}}"
  if [ -n "$CONFIG_DIR" ]; then
    case "$CONFIG_DIR" in
      /*) printf '%s' "$CONFIG_DIR" ;;
      *) printf '%s/%s' "$ROOT_DIR" "$CONFIG_DIR" ;;
    esac
    return 0
  fi
  COMMON_DIR=`git -C "$ROOT_DIR" rev-parse --git-common-dir 2>/dev/null || true`
  if [ -n "$COMMON_DIR" ]; then
    case "$COMMON_DIR" in
      /*) ;;
      *) COMMON_DIR="$ROOT_DIR/$COMMON_DIR" ;;
    esac
    COMMON_DIR=`CDPATH= cd -- "$COMMON_DIR" 2>/dev/null && pwd || true`
    case "$COMMON_DIR" in
      */.git) printf '%s/.data' "${COMMON_DIR%/.git}"; return 0 ;;
    esac
  fi
  printf '%s/.data' "$ROOT_DIR"
}

export SANMAO_PROVIDER_CONFIG_DIR=`resolve_provider_config_dir`
DATA_ROOT="$SANMAO_PROVIDER_CONFIG_DIR"
MEDIA_RELAY_REQUIRED=0
if [ -f "$DATA_ROOT/state.json" ] && node -e 'const fs=require("fs");let s;try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(1)};const cloud=(s.upscaleConnections||[]).some(c=>c.status==="healthy"&&((c.encryptedSecretId&&c.encryptedSecretKey)||(c.encryptedAccessKeyId&&c.encryptedAccessKeySecret)));if(cloud)process.exit(0);const models=s.models||[];const hasVideoModel=p=>models.some(m=>m.providerId===p.id&&(m.kind==="video"||(m.capabilities||[]).includes("video-generate")));const ok=(s.providers||[]).some(p=>{const t=String(p.videoTransport||"").toLowerCase();const credential=Boolean(String(p.encryptedApiKey||p.encryptedVideoApiKey||p.apiKey||"").trim());if(!credential)return false;if(t==="agnes-videos"||t==="openai-videos")return true;if(t==="native-task"||t==="jimeng-cli")return false;return (t==="auto"||!t)&&hasVideoModel(p)});process.exit(ok?0:1)' "$DATA_ROOT/state.json"; then
  MEDIA_RELAY_REQUIRED=1
fi
if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  export SANMAO_RELAY_MODE=1
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  free_relay_stop "$ROOT_DIR"
  printf '%s\n' '正在准备免费媒体中转通道（首次运行会自动下载组件）…'
else
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  free_relay_stop "$ROOT_DIR"
fi
export SANMAO_LIFECYCLE=1
RELAY_WATCH_PID=''
SERVER_PID=''
cleanup() {
  if [ -n "${RELAY_WATCH_PID:-}" ]; then kill "$RELAY_WATCH_PID" 2>/dev/null || true; wait "$RELAY_WATCH_PID" 2>/dev/null || true; fi
  free_relay_stop "$ROOT_DIR"
}
trap cleanup EXIT
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT" &
SERVER_PID=$!
READY=0
ATTEMPT=0
while [ $ATTEMPT -lt 150 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.2
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  if curl --noproxy '*' -fsS --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
done
if [ "$READY" -ne 1 ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  printf '%s\n' 'SANMAO.AI 服务启动超时。' >&2
  exit 1
fi
if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  if RELAY_URL=$(free_relay_start "$ROOT_DIR" "$PORT"); then
    export SANMAO_RELAY_MODE=1
    export SANMAO_RELAY_PUBLIC_BASE_URL="$RELAY_URL"
    export SANMAO_MEDIA_RELAY_URL="$RELAY_URL"
  else
    printf '%s\n' '免费媒体中转通道暂时不可用；后台将继续自动重试。'
  fi
  free_relay_watch "$ROOT_DIR" "$SERVER_PID" "$PORT" &
  RELAY_WATCH_PID=$!
fi
wait "$SERVER_PID"
