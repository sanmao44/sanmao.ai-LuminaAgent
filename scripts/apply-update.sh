#!/usr/bin/env sh
set -eu

ARCHIVE_PATH=${1:?archive path is required}
TARGET_PATH=${2:?target path is required}
PROCESS_ID=${3:?process id is required}
VERSION=${4:?version is required}
RESTART_PORT=${7:-0}
PROGRESS_PATH=${8:-}
STAGING_PATH=$(CDPATH= cd -- "$(dirname "$ARCHIVE_PATH")" && pwd)
EXTRACT_PATH="$STAGING_PATH/extract-$$"
LOCK_PATH="$STAGING_PATH/update.lock"

cleanup() {
  rm -f "$LOCK_PATH"
}
trap cleanup EXIT

write_progress() {
  [ -n "$PROGRESS_PATH" ] || return 0
  PROGRESS_PATH="$PROGRESS_PATH" PROGRESS_STAGE="$1" PROGRESS_MESSAGE="$2" PROGRESS_PERCENT="$3" node -e "const fs=require('fs'); const path=process.env.PROGRESS_PATH; let value={}; try{value=JSON.parse(fs.readFileSync(path,'utf8'))}catch{} value.stage=process.env.PROGRESS_STAGE; value.message=process.env.PROGRESS_MESSAGE; value.percent=Number(process.env.PROGRESS_PERCENT); value.updatedAt=new Date().toISOString(); const tmp=path+'.'+process.pid+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(value,null,2)); fs.renameSync(tmp,path);" 2>/dev/null || true
}

write_progress starting '正在替换程序文件并准备重启…' 98

mkdir -p "$EXTRACT_PATH"
if ! command -v unzip >/dev/null 2>&1; then
  printf '%s\n' '系统缺少 unzip，无法完成本地更新。' >&2
  exit 1
fi
unzip -q -o "$ARCHIVE_PATH" -d "$EXTRACT_PATH"

PACKAGE_ROOT="$EXTRACT_PATH"
if [ ! -f "$PACKAGE_ROOT/package.json" ]; then
  PACKAGE_ROOT=$(find "$EXTRACT_PATH" -mindepth 1 -maxdepth 2 -type f -name package.json -print -quit | sed 's#/package.json$##')
fi
if [ -z "$PACKAGE_ROOT" ] || [ ! -f "$PACKAGE_ROOT/package.json" ]; then
  printf '%s\n' '更新包中没有找到有效的 SANMAO.AI 项目文件。' >&2
  exit 1
fi

ACTUAL_VERSION=$(node -p "require(process.argv[1]).version" "$PACKAGE_ROOT/package.json")
EXPECTED_VERSION=${VERSION#v}
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  printf '更新包版本不匹配：期望 %s，实际 %s\n' "$EXPECTED_VERSION" "$ACTUAL_VERSION" >&2
  exit 1
fi

sleep 1
kill "$PROCESS_ID" 2>/dev/null || true
for _ in $(seq 1 60); do
  if ! kill -0 "$PROCESS_ID" 2>/dev/null; then break; fi
  sleep .25
done

# 只替换程序文件；用户数据、环境变量和已安装依赖保留不动。
find "$TARGET_PATH" -mindepth 1 -maxdepth 1 \
  ! -name .data ! -name node_modules ! -name .git ! -name '.env*' \
  -exec rm -rf {} +
cp -R "$PACKAGE_ROOT"/. "$TARGET_PATH"/
write_progress starting '程序文件已替换，正在重新构建并启动…' 99
rm -rf "$TARGET_PATH/.next" "$ARCHIVE_PATH" "$EXTRACT_PATH"

if [ "$(uname -s)" = "Darwin" ] && [ -f "$TARGET_PATH/scripts/start-macos.sh" ]; then
  if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
    (cd "$TARGET_PATH" && SANMAO_PORT="$RESTART_PORT" nohup sh scripts/start-macos.sh >/dev/null 2>&1 &)
  else
    (cd "$TARGET_PATH" && nohup sh scripts/start-macos.sh >/dev/null 2>&1 &)
  fi
elif [ -f "$TARGET_PATH/start-linux.sh" ]; then
  if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
    (cd "$TARGET_PATH" && SANMAO_PORT="$RESTART_PORT" nohup sh start-linux.sh >/dev/null 2>&1 &)
  else
    (cd "$TARGET_PATH" && nohup sh start-linux.sh >/dev/null 2>&1 &)
  fi
else
  printf '%s\n' '更新后找不到适用的启动器。' >&2
  exit 1
fi

if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
  PROBE_START=$RESTART_PORT
  PROBE_END=$RESTART_PORT
else
  PROBE_START=3210
  PROBE_END=3220
fi

. "$TARGET_PATH/scripts/launcher-common.sh"
sanmao_init "$TARGET_PATH" "$PROBE_START" "$PROBE_END" 3000 3010 "$TARGET_PATH/.data/logs/launcher.log"

write_progress starting '程序文件已替换，正在等待新服务就绪…' 99
READY=0
ATTEMPT=0
while [ $ATTEMPT -lt 360 ]; do
  PROBE_PORT=$PROBE_START
  while [ $PROBE_PORT -le $PROBE_END ]; do
    if sanmao_server_health "$PROBE_PORT"; then READY=1; break; fi
    PROBE_PORT=$((PROBE_PORT + 1))
  done
  [ $READY -eq 1 ] && break
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.5
done

if [ $READY -ne 1 ]; then
  printf '%s\n' '更新后服务未在 180 秒内就绪，请查看 .data/logs/launcher.log 与更新日志后重试。' >&2
  exit 1
fi

write_progress completed '更新完成，服务已恢复。' 100
