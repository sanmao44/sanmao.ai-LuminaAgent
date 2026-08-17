#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm install; fi
if [ ! -f .next/BUILD_ID ]; then npm run build; fi
npm start
