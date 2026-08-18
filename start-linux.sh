#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm install; fi
if [ ! -f .next/BUILD_ID ]; then npm run build; fi
PORT="${SANMAO_PORT:-3210}"
case "$PORT" in
  ''|*[!0-9]*) PORT=3210 ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65525 ]; then PORT=3210; fi
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT"
