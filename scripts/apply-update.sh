#!/usr/bin/env sh
set -eu

ARCHIVE_PATH=${1:?archive path is required}
TARGET_PATH=${2:?target path is required}
PROCESS_ID=${3:?process id is required}
VERSION=${4:?version is required}
STAGING_PATH=$(CDPATH= cd -- "$(dirname "$ARCHIVE_PATH")" && pwd)
EXTRACT_PATH="$STAGING_PATH/extract-$$"
LOCK_PATH="$STAGING_PATH/update.lock"

cleanup() {
  rm -f "$LOCK_PATH"
}
trap cleanup EXIT

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
  ! -name .data ! -name node_modules ! -name '.env*' \
  -exec rm -rf {} +
cp -R "$PACKAGE_ROOT"/. "$TARGET_PATH"/
rm -rf "$TARGET_PATH/.next" "$ARCHIVE_PATH" "$EXTRACT_PATH"

if [ "$(uname -s)" = "Darwin" ] && [ -f "$TARGET_PATH/scripts/start-macos.sh" ]; then
  (cd "$TARGET_PATH" && nohup sh scripts/start-macos.sh >/dev/null 2>&1 &)
elif [ -f "$TARGET_PATH/start-linux.sh" ]; then
  (cd "$TARGET_PATH" && nohup sh start-linux.sh >/dev/null 2>&1 &)
else
  printf '%s\n' '更新后找不到适用的启动器。' >&2
  exit 1
fi
