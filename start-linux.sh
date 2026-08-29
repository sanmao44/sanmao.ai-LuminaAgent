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
DATA_ROOT="${SANMAO_DATA_DIR:-$ROOT_DIR/.data}"
case "$DATA_ROOT" in
  /*) ;;
  *) DATA_ROOT="$ROOT_DIR/$DATA_ROOT" ;;
esac
AGNES_CONFIGURED=0
if [ -f "$DATA_ROOT/state.json" ] && node -e 'const fs=require("fs");let s;try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(1)};const ok=(s.providers||[]).some(p=>((p.platform==="agnes")||/agnes-ai\.(cn|com)/i.test(String(p.baseUrl||"")))&&Boolean(String(p.encryptedApiKey||p.apiKey||"").trim()));process.exit(ok?0:1)' "$DATA_ROOT/state.json"; then
  AGNES_CONFIGURED=1
fi
if [ "$AGNES_CONFIGURED" -eq 1 ]; then
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  printf '%s\n' '正在准备免费图生视频通道（首次运行会自动下载组件）…'
  if RELAY_URL=$(free_relay_start "$ROOT_DIR" "$PORT"); then
    export SANMAO_RELAY_MODE=1
    export SANMAO_RELAY_PUBLIC_BASE_URL="$RELAY_URL"
    export SANMAO_MEDIA_RELAY_URL="$RELAY_URL"
  else
    printf '%s\n' '免费图生视频通道暂时不可用；文本和普通图片功能仍可使用。'
  fi
else
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  free_relay_stop "$ROOT_DIR"
fi
export SANMAO_LIFECYCLE=1
cleanup() { free_relay_stop "$ROOT_DIR"; }
trap cleanup EXIT
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT"
