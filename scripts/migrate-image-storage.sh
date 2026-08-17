#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
LEGACY_DIR=$(CDPATH= cd -- "$ROOT_DIR/.." && pwd)/image_generation_records
TARGET_DIR="$ROOT_DIR/.data/images"

if [ ! -d "$LEGACY_DIR" ]; then
  printf '%s\n' "旧图片目录不存在：$LEGACY_DIR"
  exit 0
fi
mkdir -p "$TARGET_DIR"
cp -R "$LEGACY_DIR"/. "$TARGET_DIR"/
SOURCE_COUNT=$(find "$LEGACY_DIR" -type f | wc -l | tr -d ' ')
TARGET_COUNT=$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')
if [ "$SOURCE_COUNT" -ne "$TARGET_COUNT" ]; then
  printf '%s\n' "迁移校验失败：源文件 $SOURCE_COUNT 个，目标文件 $TARGET_COUNT 个" >&2
  exit 1
fi
printf '%s\n' "迁移完成并通过文件数量校验：$TARGET_COUNT 个文件。"
printf '%s\n' '旧目录未删除，请确认应用读取正常后再手动处理。'
