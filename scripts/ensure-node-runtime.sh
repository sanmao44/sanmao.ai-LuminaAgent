#!/bin/sh
set -eu

DATA_DIR=
PRINT_BIN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data-dir) shift; DATA_DIR=${1:-} ;;
    --print-bin) PRINT_BIN=1 ;;
    *) printf '%s\n' "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DATA_DIR=${DATA_DIR:-$ROOT_DIR/.data}
NODE_VERSION=22.13.0

version_ok() {
  CANDIDATE=$1
  [ -x "$CANDIDATE" ] || return 1
  VERSION=$("$CANDIDATE" --version 2>/dev/null || true)
  VERSION=${VERSION#v}
  MAJOR=${VERSION%%.*}
  REST=${VERSION#*.}
  MINOR=${REST%%.*}
  case "$MAJOR" in ''|*[!0-9]*) return 1 ;; esac
  case "$MINOR" in ''|*[!0-9]*) return 1 ;; esac
  [ "$MAJOR" -gt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -ge 13 ]; }
}

runtime_ok() {
  CANDIDATE=$1
  version_ok "$CANDIDATE" || return 1
  NPM_PATH="$(dirname "$CANDIDATE")/npm"
  [ -x "$NPM_PATH" ] || return 1
  "$NPM_PATH" --version >/dev/null 2>&1
}

if command -v node >/dev/null 2>&1 && runtime_ok "$(command -v node)"; then
  [ "$PRINT_BIN" -eq 1 ] && dirname "$(command -v node)" || printf '%s\n' "系统 Node.js 已可用。"
  exit 0
fi

OS=$(uname -s 2>/dev/null || true)
ARCH=$(uname -m 2>/dev/null || true)
case "$OS:$ARCH" in
  Darwin:arm64|Darwin:aarch64) PLATFORM=darwin-arm64 ;;
  Darwin:*) PLATFORM=darwin-x64 ;;
  Linux:arm64|Linux:aarch64) PLATFORM=linux-arm64 ;;
  Linux:*) PLATFORM=linux-x64 ;;
  *) printf '%s\n' "不支持的系统：$OS/$ARCH" >&2; exit 1 ;;
esac

FILE_NAME="node-v$NODE_VERSION-$PLATFORM.tar.gz"
RUNTIME_ROOT="$DATA_DIR/runtime"
RUNTIME_PATH="$RUNTIME_ROOT/node-v$NODE_VERSION-$PLATFORM"
RUNTIME_NODE="$RUNTIME_PATH/bin/node"
if runtime_ok "$RUNTIME_NODE"; then
  [ "$PRINT_BIN" -eq 1 ] && printf '%s\n' "$RUNTIME_PATH" || printf '%s\n' "应用内 Node.js 已就绪。"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  printf '%s\n' '自动准备 Node.js 需要 curl 和 tar。' >&2
  exit 1
fi
mkdir -p "$RUNTIME_ROOT"
PARTIAL="$RUNTIME_ROOT/$FILE_NAME.partial-$$"
EXTRACT="$RUNTIME_ROOT/.node-extract-$$"
cleanup() { rm -f "$PARTIAL"; rm -rf "$EXTRACT"; }
trap cleanup EXIT HUP INT TERM

LAST_ERROR='没有可用下载源'
try_download() {
  URL=$1
  if curl -fL --retry 2 --connect-timeout 15 --max-time 300 -o "$PARTIAL" "$URL" >/dev/null 2>&1; then
    rm -rf "$EXTRACT"
    mkdir -p "$EXTRACT"
    EXTRACTED="$EXTRACT/node-v$NODE_VERSION-$PLATFORM"
    if tar -xzf "$PARTIAL" -C "$EXTRACT" 2>/dev/null && runtime_ok "$EXTRACTED/bin/node"; then
      rm -rf "$RUNTIME_PATH"
      mkdir -p "$(dirname "$RUNTIME_PATH")"
      mv "$EXTRACTED" "$RUNTIME_PATH"
      [ "$PRINT_BIN" -eq 1 ] && printf '%s\n' "$RUNTIME_PATH" || printf '%s\n' "已自动准备应用内 Node.js。"
      exit 0
    fi
    LAST_ERROR='Node.js 下载文件无法运行'
  else
    LAST_ERROR="下载失败：$URL"
  fi
  rm -f "$PARTIAL"
}

if [ -n "${SANMAO_NODE_DOWNLOAD_URL:-}" ]; then try_download "$SANMAO_NODE_DOWNLOAD_URL"; fi
if [ -n "${SANMAO_NODE_MIRROR_URL:-}" ]; then try_download "${SANMAO_NODE_MIRROR_URL%/}/$FILE_NAME"; fi
try_download "https://nodejs.org/dist/v$NODE_VERSION/$FILE_NAME"
try_download "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$FILE_NAME"
printf '%s\n' "Node.js 自动准备失败：$LAST_ERROR" >&2
exit 1
