#!/bin/sh
set -eu

SCRIPT_DIR=`CDPATH= cd -- "$(dirname "$0")" && pwd`
ROOT_DIR=`CDPATH= cd -- "$SCRIPT_DIR/.." && pwd`

PORT_START="${SANMAO_PORT:-3210}"
case "$PORT_START" in
  ''|*[!0-9]*) PORT_START=3210 ;;
esac
if [ "$PORT_START" -lt 1024 ] || [ "$PORT_START" -gt 65525 ]; then PORT_START=3210; fi
PORT_END=$((PORT_START + 10))

. "$SCRIPT_DIR/launcher-common.sh"
sanmao_init "$ROOT_DIR" "$PORT_START" "$PORT_END" 3000 3010 "$ROOT_DIR/.data/logs/launcher.log"
sanmao_log "停止器开始运行，端口范围：$PORT_START..$PORT_END" INFO

TARGETS=$( (sanmao_owned_processes 3000 3010; sanmao_owned_processes "$PORT_START" "$PORT_END") | sort -u -k1,1 )

if [ -z "$TARGETS" ]; then
  printf '%s\n' 'SANMAO.AI 当前没有发现正在运行的本地服务。'
  sanmao_log '没有发现正在运行的 SANMAO.AI 本地服务。' INFO
  exit 0
fi

printf '%s\n' '正在停止 SANMAO.AI 本地服务...'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"
sleep 1

REMAINING=$( (sanmao_owned_processes 3000 3010; sanmao_owned_processes "$PORT_START" "$PORT_END") | sort -u -k1,1 )
if [ -n "$REMAINING" ]; then
  sanmao_log "停止失败，仍存在服务：$REMAINING" ERROR
  printf '停止失败，以下服务仍在运行：\n%s\n' "$REMAINING"
  exit 1
fi

printf '%s\n' 'SANMAO.AI 本地服务已停止。'
sanmao_log 'SANMAO.AI 本地服务已停止。' INFO
