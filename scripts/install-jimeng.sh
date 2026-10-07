#!/usr/bin/env bash
set -Eeuo pipefail

INSTALLER_URL="https://jimeng.jianying.com/cli"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanmao-jimeng.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

fail() {
  printf '%s\n' "[即梦 CLI] 安装失败：$*" >&2
  exit 1
}

say() {
  printf '%s\n' "[即梦 CLI] $*"
}

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) fail "当前系统不是 macOS 或 Linux，请使用对应安装器。" ;;
esac

case "$(uname -m)" in
  arm64|aarch64|x86_64|amd64) ;;
  *) fail "暂不支持当前 CPU 架构：$(uname -m)" ;;
esac

if command -v curl >/dev/null 2>&1; then
  say '正在读取官方安装信息…'
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 60 "$INSTALLER_URL" -o "$TEMP_DIR/install.sh" || fail '无法访问即梦官方安装地址。'
elif command -v wget >/dev/null 2>&1; then
  say '正在读取官方安装信息…'
  wget -q --show-progress -O "$TEMP_DIR/install.sh" "$INSTALLER_URL" || fail '无法访问即梦官方安装地址。'
else
  fail '系统没有 curl 或 wget，无法下载安装程序。'
fi

say '正在运行官方安装器…'
/bin/bash "$TEMP_DIR/install.sh" || fail '官方安装器执行失败，请检查上方提示。'

# The official installer uses ~/.local/bin by default on macOS and Linux.
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
CLI_PATH="${DREAMINA_CLI_PATH:-}"
if [ -z "$CLI_PATH" ] || [ ! -x "$CLI_PATH" ]; then
  if [ -x "$HOME/.local/bin/dreamina" ]; then
    CLI_PATH="$HOME/.local/bin/dreamina"
  elif [ -x "$HOME/bin/dreamina" ]; then
    CLI_PATH="$HOME/bin/dreamina"
  else
    CLI_PATH="$(command -v dreamina || true)"
  fi
fi

[ -n "$CLI_PATH" ] && [ -x "$CLI_PATH" ] || fail '安装完成后没有找到 dreamina 可执行文件。'
VERSION="$($CLI_PATH --version 2>&1 | head -n 1 || true)"
[ -n "$VERSION" ] || fail '程序已安装，但版本验证失败。'

printf '\n'
say "安装完成：$CLI_PATH"
say "版本：$VERSION"
say '请回到 SANMAO.AI 设置页点击“重新检测”，然后连接即梦。'
say '如果当前终端找不到 dreamina，请重新打开终端。'
