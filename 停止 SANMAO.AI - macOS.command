#!/bin/sh
set -eu
SCRIPT_DIR=`CDPATH= cd -- "$(dirname "$0")" && pwd`
/bin/sh "$SCRIPT_DIR/scripts/stop-macos.sh"
printf '\n按回车键关闭窗口...'
read -r _ || true
