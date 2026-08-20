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

server_is_ready() {
  PORT_TO_CHECK=$1
  if command -v lsof >/dev/null 2>&1 && ! lsof -nP -iTCP:$PORT_TO_CHECK -sTCP:LISTEN >/dev/null 2>&1; then
    return 1
  fi
  STATUS=`curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 0.2 --max-time 1 "http://127.0.0.1:$PORT_TO_CHECK/api/state" 2>/dev/null || true`
  case $STATUS in
    2??|3??|4??) return 0 ;;
  esac
  return 1
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
  printf '\n启动失败：%s\n\n' $1
  printf '按回车键关闭窗口...'
  read -r _ || true
  exit 1
}

EXISTING_PORT=`find_existing_server`
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null; then
  printf 'SANMAO.AI 已在运行：http://localhost:%s\n' $EXISTING_PORT
  rm -f "$LEGACY_MARKER"
  open "http://localhost:$EXISTING_PORT"
  exit 0
fi
rm -f "$LEGACY_MARKER"

printf '%s\n' '========================================'
printf '%s\n' '        SANMAO.AI macOS 启动器 0.6.4'
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
BUILD_ID="$ROOT_DIR/.next/BUILD_ID"

# 需要重新构建：强制构建（SANMAO_FORCE_BUILD=1）、没有构建产物、或源码比构建产物新
NEED_BUILD=0
if [ "${SANMAO_FORCE_BUILD:-0}" = "1" ]; then
  NEED_BUILD=1
elif [ ! -f "$BUILD_ID" ]; then
  NEED_BUILD=1
else
  # 源码里只要有文件的修改时间 >= 构建产物时间（即构建产物并非严格更新），就重新构建
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
PORT=$PORT_START
if command -v lsof >/dev/null 2>&1; then
  while [ $PORT -le $PORT_END ] && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
    PORT=$((PORT + 1))
  done
fi
if [ $PORT -gt $PORT_END ]; then
  fail '3000～3010 端口都被占用，请关闭旧的 SANMAO.AI/开发服务器后再试。'
fi

URL=http://localhost:$PORT
SERVER_STDOUT="${TMPDIR:-/tmp}/sanmao-ai-server.out.log"
SERVER_STDERR="${TMPDIR:-/tmp}/sanmao-ai-server.err.log"
rm -f "$SERVER_STDOUT" "$SERVER_STDERR"
NEXT_CLI="$ROOT_DIR/node_modules/next/dist/bin/next"
unset SANMAO_LIFECYCLE
node "$NEXT_CLI" start -H 127.0.0.1 -p $PORT >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
SERVER_PID=$!

READY=0
ATTEMPT=0
while [ $ATTEMPT -lt 60 ]; do
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

printf 'SANMAO.AI 已启动：%s\n' $URL
printf '%s\n' '本地服务会保持运行，下一次启动会直接打开已有服务。'
open $URL
wait $SERVER_PID
