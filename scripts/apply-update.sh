#!/usr/bin/env sh
set -eu

ARCHIVE_PATH=${1:?archive path is required}
TARGET_PATH=${2:?target path is required}
PROCESS_ID=${3:?process id is required}
VERSION=${4:?version is required}
LOG_PATH=${5:-}
STAGING_PATH=$(CDPATH= cd -- "$(dirname "$ARCHIVE_PATH")" && pwd)
EXTRACT_PATH="$STAGING_PATH/extract-$$"
LOCK_PATH="$STAGING_PATH/update.lock"
LOG_PATH=${LOG_PATH:-"$STAGING_PATH/update.log"}

write_log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_PATH" 2>/dev/null || true
}

cleanup() {
  rm -f "$LOCK_PATH"
  rm -rf "$EXTRACT_PATH"
}
trap cleanup EXIT

write_log "开始应用 SANMAO.AI $VERSION，目标目录：$TARGET_PATH"
mkdir -p "$EXTRACT_PATH"
if ! command -v unzip >/dev/null 2>&1; then
  printf '%s\n' '系统缺少 unzip，无法完成本地更新。' >&2
  exit 1
fi
unzip -q -o "$ARCHIVE_PATH" -d "$EXTRACT_PATH"
write_log '更新包已解压'

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
write_log "更新包版本校验通过：$ACTUAL_VERSION"

sleep 1
write_log "正在停止旧服务进程 PID $PROCESS_ID"
kill "$PROCESS_ID" 2>/dev/null || true
for _ in $(seq 1 60); do
  if ! kill -0 "$PROCESS_ID" 2>/dev/null; then break; fi
  sleep .25
done
if kill -0 "$PROCESS_ID" 2>/dev/null; then
  printf '旧服务进程未能在 15 秒内退出。\n' >&2
  exit 1
fi

# 只替换程序文件；用户数据、环境变量和已安装依赖保留不动。
find "$TARGET_PATH" -mindepth 1 -maxdepth 1 \
  ! -name .data ! -name node_modules ! -name '.env*' \
  -exec rm -rf {} +
cp -R "$PACKAGE_ROOT"/. "$TARGET_PATH"/
if [ -f "$TARGET_PATH/scripts/apply-update.sh" ]; then
  cp "$0" "$TARGET_PATH/scripts/apply-update.sh"
  chmod +x "$TARGET_PATH/scripts/apply-update.sh"
fi
rm -rf "$TARGET_PATH/.next" "$ARCHIVE_PATH" "$EXTRACT_PATH"
write_log '程序文件替换完成'

if [ "$(uname -s)" = "Darwin" ] && [ -f "$TARGET_PATH/scripts/start-macos.sh" ]; then
  (cd "$TARGET_PATH" && nohup sh scripts/start-macos.sh >/dev/null 2>&1 &)
elif [ -f "$TARGET_PATH/start-linux.sh" ]; then
  (cd "$TARGET_PATH" && nohup sh start-linux.sh >/dev/null 2>&1 &)
else
  printf '%s\n' '更新后找不到适用的启动器。' >&2
  exit 1
fi
write_log '已启动更新后启动器，等待新服务就绪'
