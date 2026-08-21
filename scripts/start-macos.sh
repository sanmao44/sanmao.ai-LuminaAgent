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
sanmao_init "$ROOT_DIR" "$PORT_START" "$PORT_END" 3000 3010 "$ROOT_DIR/.data/logs/launcher.log"
sanmao_log "????????????$ROOT_DIR??????$PORT_START..$PORT_END" INFO

server_is_ready() {
  sanmao_server_health "$1"
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
  sanmao_log "?????$1" ERROR
  printf '\n?????%s\n\n' "$1"
  if [ -n "${SERVER_STDERR:-}" ] && [ -s "$SERVER_STDERR" ]; then
    printf '?????????\n'
    tail -n 12 "$SERVER_STDERR" || true
    printf '\n'
  fi
  if [ -t 0 ]; then
    printf '????????...'
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
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null; then
  printf 'SANMAO.AI ?????http://localhost:%s\n' $EXISTING_PORT
  rm -f "$LEGACY_MARKER"
  open "http://localhost:$EXISTING_PORT"
  exit 0
fi
rm -f "$LEGACY_MARKER"

if ! acquire_lock; then
  fail '?????????????????'
fi
sanmao_log '????????' INFO

printf '\n==> ???? SANMAO.AI ????\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

printf '%s\n' '========================================'
printf '%s\n' '        SANMAO.AI macOS ??? 0.7.2'
printf '%s\n' '========================================'

printf '\n==> ?? Node.js\n'
if ! command -v node >/dev/null 2>&1; then
  fail '????? Node.js????? Node.js 20.9 ????????????????'
fi

NODE_VERSION=`node --version 2>/dev/null || true`
NODE_VERSION=`printf '%s' $NODE_VERSION | sed 's/^v//'`
NODE_MAJOR=`printf '%s' $NODE_VERSION | cut -d. -f1`
NODE_MINOR=`printf '%s' $NODE_VERSION | cut -d. -f2`
if [ $NODE_MAJOR -lt 20 ]; then
  fail 'SANMAO.AI ?? Node.js 20.9 ??????'
fi
if [ $NODE_MAJOR -eq 20 ] && [ $NODE_MINOR -lt 9 ]; then
  fail 'SANMAO.AI ?? Node.js 20.9 ??????'
fi
printf 'Node.js?v%s\n' $NODE_VERSION

if ! command -v npm >/dev/null 2>&1; then
  fail '????? npm?????? Node.js???? npm ????'
fi
printf 'npm?%s\n' `npm --version`

printf '\n==> ?????????\n'
NEED_INSTALL=0
if [ ! -x node_modules/.bin/next ] || [ ! -f node_modules/typescript/package.json ] || [ ! -f node_modules/@types/node/package.json ] || [ ! -f node_modules/@types/react/package.json ] || [ ! -f node_modules/@types/react-dom/package.json ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" -eq 1 ]; then
  printf '%s\n' '??????????????? npm install????????? 1?5 ???'
  if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund || fail '?????????????????????'; else npm install --include=dev --no-audit --no-fund || fail '?????????????????????'; fi
else
  printf '%s\n' '??????'
fi

if [ ! -x node_modules/.bin/next ]; then
  fail '??????????? Next.js???? node_modules ????????????'
fi

printf '\n==> ??????????\n'

NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"
BUILD_ID="$ROOT_DIR/.next/BUILD_ID"

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
  printf '%s\n' '??????????????????????????????????????'
  printf '%s\n' '?? webpack ????? Turbopack ??????????????'
  "$NEXT_BIN" build --webpack || fail '???????????????????????'
  printf '?????\n'
else
  printf '%s\n' '???????????????????'
fi

printf '\n==> ?? SANMAO.AI\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

PORT=$PORT_START
if command -v lsof >/dev/null 2>&1; then
  while [ $PORT -le $PORT_END ] && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
    PORT=$((PORT + 1))
  done
fi
if [ $PORT -gt $PORT_END ]; then
  fail "$PORT_START?$PORT_END ???????????? SANMAO.AI/?????????"
fi

URL=http://localhost:$PORT
SERVER_STDOUT="${TMPDIR:-/tmp}/sanmao-ai-server.out.log"
SERVER_STDERR="${TMPDIR:-/tmp}/sanmao-ai-server.err.log"
rm -f "$SERVER_STDOUT" "$SERVER_STDERR"
NEXT_CLI="$ROOT_DIR/node_modules/next/dist/bin/next"
unset SANMAO_LIFECYCLE
node "$NEXT_CLI" start -H 127.0.0.1 -p $PORT >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
SERVER_PID=$!
sanmao_log "??????? PID $SERVER_PID????? $PORT ???" INFO

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
  printf '\n??????????????????????%s\n' "$SERVER_STDERR"
  if [ -s "$SERVER_STDERR" ]; then tail -n 12 "$SERVER_STDERR"; fi
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  fail '?????'
fi

printf 'SANMAO.AI ????%s\n' $URL
printf '%s\n' '?????????????????????????'
sanmao_log "??????$URL" INFO
open $URL
wait $SERVER_PID
