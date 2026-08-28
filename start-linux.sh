#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -x node_modules/.bin/next ] || [ ! -f node_modules/typescript/package.json ] || [ ! -f node_modules/@types/node/package.json ] || [ ! -f node_modules/@types/react/package.json ] || [ ! -f node_modules/@types/react-dom/package.json ]; then
  if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi
fi
if [ ! -f .next/BUILD_ID ]; then npm run build; fi
PORT="${SANMAO_PORT:-3210}"
case "$PORT" in
  ''|*[!0-9]*) PORT=3210 ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65525 ]; then PORT=3210; fi
export SANMAO_LIFECYCLE=1
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT"
