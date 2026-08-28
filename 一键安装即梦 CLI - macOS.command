#!/bin/sh
set -u

SCRIPT_DIR=`CDPATH= cd -- "$(dirname "$0")" && pwd`
/bin/bash "$SCRIPT_DIR/scripts/install-jimeng.sh"
EXIT_CODE=$?

printf '\n'
if [ "$EXIT_CODE" -eq 0 ]; then
  printf '%s\n' '安装成功。请回到 SANMAO.AI 设置页点击“重新检测”。'
else
  printf '%s\n' '安装未完成，请根据上方提示处理后重试。'
fi
printf '%s' '按回车键关闭此窗口…'
read -r _
exit "$EXIT_CODE"
