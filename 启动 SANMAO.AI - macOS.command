#!/bin/sh
set -eu
set -f
IFS=
SCRIPT_DIR=`CDPATH= cd -- "$(dirname "$0")" && pwd`
LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$LOG_DIR"
nohup /bin/sh "$SCRIPT_DIR/scripts/start-macos.sh" >"$LOG_DIR/SANMAO.AI-startup.log" 2>&1 </dev/null &
exit 0
