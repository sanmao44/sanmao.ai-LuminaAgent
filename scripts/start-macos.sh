#!/bin/sh
set -eu
set -f
IFS=

SCRIPT_DIR=`dirname $0`
ROOT_DIR=`CDPATH= cd -- $SCRIPT_DIR/.. && pwd`
cd $ROOT_DIR

PORT_START="${SANMAO_PORT:-3210}"
case "$PORT_START" in
  ''|*[!0-9]*) PORT_START=3210 ;;
esac
if [ "$PORT_START" -lt 1024 ] || [ "$PORT_START" -gt 65525 ]; then PORT_START=3210; fi
PORT_END=$((PORT_START + 10))

LEGACY_MARKER="${TMPDIR:-/tmp}/sanmao-ai-studio-instance.lock"
LOCK_DIR="${TMPDIR:-/tmp}/sanmao-ai-launcher.lock"

. "$SCRIPT_DIR/launcher-common.sh"
. "$SCRIPT_DIR/free-relay-common.sh"
sanmao_init "$ROOT_DIR" "$PORT_START" "$PORT_END" 3000 3010 "$ROOT_DIR/.data/logs/launcher.log"
sanmao_log "启动器开始运行，根目录：$ROOT_DIR，端口范围：$PORT_START..$PORT_END" INFO

media_relay_required() {
  DATA_ROOT="${SANMAO_DATA_DIR:-$ROOT_DIR/.data}"
  case "$DATA_ROOT" in
    /*) ;;
    *) DATA_ROOT="$ROOT_DIR/$DATA_ROOT" ;;
  esac
  STATE_PATH="$DATA_ROOT/state.json"
  [ -f "$STATE_PATH" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const fs=require("fs");let s;try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(1)};const cloud=(s.upscaleConnections||[]).some(c=>c.status==="healthy"&&((c.encryptedSecretId&&c.encryptedSecretKey)||(c.encryptedAccessKeyId&&c.encryptedAccessKeySecret)));if(cloud)process.exit(0);const models=s.models||[];const hasVideoModel=p=>models.some(m=>m.providerId===p.id&&(m.kind==="video"||(m.capabilities||[]).includes("video-generate")));const ok=(s.providers||[]).some(p=>{const t=String(p.videoTransport||"").toLowerCase();const credential=Boolean(String(p.encryptedApiKey||p.encryptedVideoApiKey||p.apiKey||"").trim());if(!credential)return false;if(t==="agnes-videos"||t==="openai-videos")return true;if(t==="native-task"||t==="jimeng-cli")return false;return (t==="auto"||!t)&&hasVideoModel(p)});process.exit(ok?0:1)' "$STATE_PATH"
}

MEDIA_RELAY_REQUIRED=0
if media_relay_required; then MEDIA_RELAY_REQUIRED=1; fi

BUILD_ID="$ROOT_DIR/.next/BUILD_ID"
RUNNING_BUILD_MARKER="$ROOT_DIR/.next/.sanmao-running-build-id"

build_served_stale() {
  [ -f "$BUILD_ID" ] || return 0
  [ -f "$RUNNING_BUILD_MARKER" ] || return 0
  CURRENT_BUILD_ID=`tr -d '\r\n' < "$BUILD_ID" 2>/dev/null || true`
  SERVED_BUILD_ID=`tr -d '\r\n' < "$RUNNING_BUILD_MARKER" 2>/dev/null || true`
  [ -n "$CURRENT_BUILD_ID" ] && [ "$CURRENT_BUILD_ID" = "$SERVED_BUILD_ID" ] || return 0
  return 1
}

server_is_ready() {
  sanmao_server_health "$1"
}

server_lifecycle_enabled() {
  PORT_TO_CHECK=$1
  BODY="${TMPDIR:-/tmp}/sanmao-lifecycle-health-$$.json"
  rm -f "$BODY"
  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT_TO_CHECK/api/health" 2>/dev/null || true)
  if [ "$STATUS" = 200 ] && grep -Eq '"lifecycleEnabled"[[:space:]]*:[[:space:]]*true' "$BODY" 2>/dev/null; then
    rm -f "$BODY"
    return 0
  fi
  rm -f "$BODY"
  return 1
}

server_media_relay_mode() {
  PORT_TO_CHECK=$1
  BODY="${TMPDIR:-/tmp}/sanmao-relay-health-$$.json"
  rm -f "$BODY"
  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT_TO_CHECK/api/relay/status" 2>/dev/null || true)
  if [ "$STATUS" = 200 ]; then
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"relay"' "$BODY" 2>/dev/null; then printf '%s' relay; rm -f "$BODY"; return 0; fi
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"self-hosted"' "$BODY" 2>/dev/null; then printf '%s' self-hosted; rm -f "$BODY"; return 0; fi
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"unavailable"' "$BODY" 2>/dev/null; then printf '%s' unavailable; rm -f "$BODY"; return 0; fi
  fi
  rm -f "$BODY"
  printf '%s' unknown
}

find_existing_server() {
  PORT_TO_CHECK=$PORT_START
  while [ $PORT_TO_CHECK -le $PORT_END ]; do
    if server_is_ready $PORT_TO_CHECK; then
      printf '%s' $PORT_TO_CHECK
      return 0
    fi
    PORT_TO_CHECK=$((PORT_TO_CHECK + 1))
  done
  printf '0'
}

fail() {
  free_relay_stop "$ROOT_DIR"
  sanmao_log "启动失败：$1" ERROR
  printf '\n启动失败：%s\n\n' "$1"
  if [ -n "${SERVER_STDERR:-}" ] && [ -s "$SERVER_STDERR" ]; then
    printf '服务端最后的错误：\n'
    tail -n 12 "$SERVER_STDERR" || true
    printf '\n'
  fi
  if [ -t 0 ]; then
    printf '按回车键关闭窗口...'
    read -r _ || true
  fi
  exit 1
}

acquire_lock() {
  TRIES=0
  while [ $TRIES -lt 450 ]; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' $$ > "$LOCK_DIR/pid"
      trap 'rm -rf "$LOCK_DIR"' EXIT HUP INT TERM
      return 0
    fi

    if [ -f "$LOCK_DIR/pid" ]; then
      LOCK_PID=`cat "$LOCK_DIR/pid" 2>/dev/null || true`
      if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
        rm -rf "$LOCK_DIR"
        continue
      fi
    else
      rm -rf "$LOCK_DIR"
      continue
    fi

    TRIES=$((TRIES + 1))
    sleep 0.2
  done
  return 1
}

EXISTING_PORT=`find_existing_server`
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && build_served_stale; then
  sanmao_log "检测到当前服务使用旧构建，正在重启端口 $EXISTING_PORT" WARN
  sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  EXISTING_PORT=0
fi
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && ! server_lifecycle_enabled "$EXISTING_PORT"; then
  sanmao_log "检测到旧服务使用了旧生命周期设置，正在重启端口 $EXISTING_PORT" WARN
  sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
fi
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && server_lifecycle_enabled "$EXISTING_PORT"; then
  EXISTING_RELAY_MODE=`server_media_relay_mode "$EXISTING_PORT"`
  if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ] && [ "$EXISTING_RELAY_MODE" = relay ] && ! free_relay_is_running "$ROOT_DIR"; then
    sanmao_log "检测到免费临时通道已退出，正在重启端口 $EXISTING_PORT" WARN
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  elif [ "$MEDIA_RELAY_REQUIRED" -eq 1 ] && { [ "$EXISTING_RELAY_MODE" = unavailable ] || [ "$EXISTING_RELAY_MODE" = unknown ]; }; then
    sanmao_log "检测到旧服务没有媒体中转通道，正在重启端口 $EXISTING_PORT" WARN
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  elif [ "$MEDIA_RELAY_REQUIRED" -eq 0 ] && [ "$EXISTING_RELAY_MODE" = relay ]; then
    sanmao_log "检测到当前服务不需要媒体中转，正在关闭临时通道并重启端口 $EXISTING_PORT" INFO
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  else
    printf 'SANMAO.AI 已在运行：http://localhost:%s\n' $EXISTING_PORT
    rm -f "$LEGACY_MARKER"
    open "http://localhost:$EXISTING_PORT"
    exit 0
  fi
fi
rm -f "$LEGACY_MARKER"

if ! acquire_lock; then
  fail '另一个启动器正在运行，请稍候再试。'
fi
sanmao_log '已获取启动预检锁' INFO

printf '\n==> 清理旧的 SANMAO.AI 后台服务\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

printf '%s\n' '========================================'
printf '%s\n' '        SANMAO.AI macOS 启动器 0.7.21'
printf '%s\n' '========================================'

printf '\n==> 检查 Node.js\n'
if ! command -v node >/dev/null 2>&1; then
  fail '没有检测到 Node.js。请先安装 Node.js 20.9 或更高版本，然后重新双击启动器。'
fi

NODE_VERSION=`node --version 2>/dev/null || true`
NODE_VERSION=`printf '%s' $NODE_VERSION | sed 's/^v//'`
NODE_MAJOR=`printf '%s' $NODE_VERSION | cut -d. -f1`
NODE_MINOR=`printf '%s' $NODE_VERSION | cut -d. -f2`
if [ $NODE_MAJOR -lt 20 ]; then
  fail 'SANMAO.AI 需要 Node.js 20.9 或更高版本。'
fi
if [ $NODE_MAJOR -eq 20 ] && [ $NODE_MINOR -lt 9 ]; then
  fail 'SANMAO.AI 需要 Node.js 20.9 或更高版本。'
fi
printf 'Node.js：v%s\n' $NODE_VERSION

if ! command -v npm >/dev/null 2>&1; then
  fail '没有检测到 npm。请重新安装 Node.js，并确保 npm 已安装。'
fi
printf 'npm：%s\n' `npm --version`

printf '\n==> 检查并安装程序依赖\n'
NEED_INSTALL=0
if [ ! -x node_modules/.bin/next ] || [ ! -f node_modules/typescript/package.json ] || [ ! -f node_modules/@types/node/package.json ] || [ ! -f node_modules/@types/react/package.json ] || [ ! -f node_modules/@types/react-dom/package.json ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" -eq 1 ]; then
  printf '%s\n' '首次运行或依赖不完整，正在执行 npm install。这个过程通常需要 1～5 分钟。'
  if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund || fail '依赖安装失败，请检查网络后再次运行启动器。'; else npm install --include=dev --no-audit --no-fund || fail '依赖安装失败，请检查网络后再次运行启动器。'; fi
else
  printf '%s\n' '依赖已安装。'
fi

if [ ! -x node_modules/.bin/next ]; then
  fail '依赖安装完成后仍找不到 Next.js。请删除 node_modules 文件夹后重新运行启动器。'
fi

printf '\n==> 检查构建产物是否最新\n'

NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"

NEED_BUILD=0
if [ "${SANMAO_FORCE_BUILD:-0}" = "1" ]; then
  NEED_BUILD=1
elif [ ! -f "$BUILD_ID" ]; then
  NEED_BUILD=1
else
  BUILD_MTIME=$(stat -f '%m' "$BUILD_ID" 2>/dev/null) || true
  NEWEST_MTIME=$(find "$ROOT_DIR/app" "$ROOT_DIR/components" "$ROOT_DIR/lib" "$ROOT_DIR/public" -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -n 1) || true
  ENV_MTIME=$(find "$ROOT_DIR" -maxdepth 1 -type f -name '.env*' -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -n 1) || true
  if [ -n "$BUILD_MTIME" ] && [ -n "$NEWEST_MTIME" ] && [ "$NEWEST_MTIME" -ge "$BUILD_MTIME" ]; then
    NEED_BUILD=1
  fi
  if [ "$NEED_BUILD" -eq 0 ] && [ -n "$ENV_MTIME" ] && [ "$ENV_MTIME" -ge "$BUILD_MTIME" ]; then
    NEED_BUILD=1
  fi
  if [ "$NEED_BUILD" -eq 0 ]; then
    for F in next.config.ts next.config.js tsconfig.json package.json package-lock.json; do
      if [ -f "$ROOT_DIR/$F" ] && [ ! "$BUILD_ID" -nt "$ROOT_DIR/$F" ]; then
        NEED_BUILD=1
        break
      fi
    done
  fi
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  printf '%s\n' '需要重新构建（首次运行或代码有更新）。只需等这一次，之后启动会直接跳过构建。'
  printf '%s\n' '使用 webpack 构建，避免 Turbopack 在中文内容中的字符边界崩溃。'
  "$NEXT_BIN" build --webpack || fail '网页构建失败。请查看终端中构建失败上方的报错。'
  printf '构建完成。\n'
else
  printf '%s\n' '构建产物已是最新，跳过构建，直接启动。'
fi

printf '\n==> 启动 SANMAO.AI\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

PORT=$PORT_START
if command -v lsof >/dev/null 2>&1; then
  while [ $PORT -le $PORT_END ] && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
    PORT=$((PORT + 1))
  done
fi
if [ $PORT -gt $PORT_END ]; then
  fail "$PORT_START～$PORT_END 端口都被占用，请关闭旧的 SANMAO.AI/开发服务器后再试。"
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

URL=http://localhost:$PORT
SERVER_STDOUT="${TMPDIR:-/tmp}/sanmao-ai-server.out.log"
SERVER_STDERR="${TMPDIR:-/tmp}/sanmao-ai-server.err.log"
rm -f "$SERVER_STDOUT" "$SERVER_STDERR"
NEXT_CLI="$ROOT_DIR/node_modules/next/dist/bin/next"
export SANMAO_LIFECYCLE=1
node "$NEXT_CLI" start -H 127.0.0.1 -p $PORT >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
SERVER_PID=$!

RELAY_WATCH_PID=''
if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  free_relay_watch "$ROOT_DIR" "$SERVER_PID" "$PORT" &
  RELAY_WATCH_PID=$!
fi
sanmao_log "已启动服务进程 PID $SERVER_PID，等待端口 $PORT 就绪。" INFO

READY=0
ATTEMPT=0
while [ $ATTEMPT -lt 150 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.2
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    break
  fi
  if server_is_ready $PORT; then READY=1; break; fi
done

if [ $READY -ne 1 ]; then
  printf '\n服务器没有在预期时间内启动。服务端错误日志：%s\n' "$SERVER_STDERR"
  if [ -s "$SERVER_STDERR" ]; then tail -n 12 "$SERVER_STDERR"; fi
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  fail '启动超时。'
fi

if [ -f "$BUILD_ID" ]; then
  tr -d '\r\n' < "$BUILD_ID" > "$RUNNING_BUILD_MARKER"
fi

if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  if RELAY_URL=$(free_relay_start "$ROOT_DIR" "$PORT"); then
    export SANMAO_RELAY_MODE=1
    export SANMAO_RELAY_PUBLIC_BASE_URL="$RELAY_URL"
    export SANMAO_MEDIA_RELAY_URL="$RELAY_URL"
    sanmao_log "已启动免费临时通道：$RELAY_URL" INFO
  else
    printf '%s\n' '免费媒体中转通道暂时不可用；后台将继续自动重试。'
    sanmao_log '免费临时通道首次启动失败，将继续自动重试。' WARN
  fi
  free_relay_watch "$ROOT_DIR" "$SERVER_PID" "$PORT" &
  RELAY_WATCH_PID=$!
fi

printf 'SANMAO.AI 已启动：%s\n' $URL
printf '%s\n' '本地服务会保持运行，下一次启动会直接打开已有服务。'
sanmao_log "服务已就绪：$URL" INFO
open $URL
wait $SERVER_PID
if [ -n "${RELAY_WATCH_PID:-}" ]; then kill "$RELAY_WATCH_PID" 2>/dev/null || true; wait "$RELAY_WATCH_PID" 2>/dev/null || true; fi
free_relay_stop "$ROOT_DIR"
