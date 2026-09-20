#!/bin/sh
set -eu
set -f
IFS=

SCRIPT_DIR=`dirname $0`
ROOT_DIR=`CDPATH= cd -- $SCRIPT_DIR/.. && pwd`
cd $ROOT_DIR

NON_INTERACTIVE=${SANMAO_NONINTERACTIVE:-0}
DETACH_SERVER=${SANMAO_DETACH_SERVER:-0}
OPERATION_TOKEN=${SANMAO_OPERATION_TOKEN:-}
SKIP_BUILD=${SANMAO_SKIP_BUILD:-0}

while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --detach) DETACH_SERVER=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --operation-token) shift; OPERATION_TOKEN=${1:-} ;;
    *) printf '%s\n' "未知启动参数：$1" >&2; exit 2 ;;
  esac
  shift
done

PORT_START="${SANMAO_PORT:-3210}"
case "$PORT_START" in
  ''|*[!0-9]*) PORT_START=3210 ;;
esac
if [ "$PORT_START" -lt 1024 ] || [ "$PORT_START" -gt 65525 ]; then PORT_START=3210; fi
PORT_END=$((PORT_START + 10))

resolve_provider_config_dir() {
  CONFIG_DIR="${SANMAO_PROVIDER_CONFIG_DIR:-${SANMAO_DATA_DIR:-}}"
  if [ -n "$CONFIG_DIR" ]; then
    case "$CONFIG_DIR" in
      /*) printf '%s' "$CONFIG_DIR" ;;
      *) printf '%s/%s' "$ROOT_DIR" "$CONFIG_DIR" ;;
    esac
    return 0
  fi
  COMMON_DIR=`git -C "$ROOT_DIR" rev-parse --git-common-dir 2>/dev/null || true`
  if [ -n "$COMMON_DIR" ]; then
    case "$COMMON_DIR" in
      /*) ;;
      *) COMMON_DIR="$ROOT_DIR/$COMMON_DIR" ;;
    esac
    COMMON_DIR=`CDPATH= cd -- "$COMMON_DIR" 2>/dev/null && pwd || true`
    case "$COMMON_DIR" in
      */.git) printf '%s/.data' "${COMMON_DIR%/.git}"; return 0 ;;
    esac
  fi
  printf '%s/.data' "$ROOT_DIR"
}

export SANMAO_PROVIDER_CONFIG_DIR=`resolve_provider_config_dir`

LEGACY_MARKER="${TMPDIR:-/tmp}/sanmao-ai-studio-instance.lock"
LOCK_DIR="${TMPDIR:-/tmp}/sanmao-ai-launcher.lock"

. "$SCRIPT_DIR/launcher-common.sh"
. "$SCRIPT_DIR/free-relay-common.sh"
sanmao_init "$ROOT_DIR" "$PORT_START" "$PORT_END" 3000 3010 "$ROOT_DIR/.data/logs/launcher.log"
sanmao_log "启动器开始运行，根目录：${ROOT_DIR}，端口范围：${PORT_START}..${PORT_END}" INFO

media_relay_required() {
  DATA_ROOT="$SANMAO_PROVIDER_CONFIG_DIR"
  STATE_PATH="$DATA_ROOT/state.json"
  [ -f "$STATE_PATH" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const fs=require("fs");let s;try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(1)};const cloud=(s.upscaleConnections||[]).some(c=>c.status==="healthy"&&((c.encryptedSecretId&&c.encryptedSecretKey)||(c.encryptedAccessKeyId&&c.encryptedAccessKeySecret)));if(cloud)process.exit(0);const models=s.models||[];const hasVideoModel=p=>models.some(m=>m.providerId===p.id&&(m.kind==="video"||(m.capabilities||[]).includes("video-generate")));const ok=(s.providers||[]).some(p=>{const t=String(p.videoTransport||"").toLowerCase();const credential=Boolean(String(p.encryptedApiKey||p.encryptedVideoApiKey||p.apiKey||"").trim());if(!credential)return false;if(t==="agnes-videos"||t==="openai-videos")return true;if(t==="native-task"||t==="jimeng-cli")return false;return (t==="auto"||!t)&&hasVideoModel(p)});process.exit(ok?0:1)' "$STATE_PATH"
}

MEDIA_RELAY_REQUIRED=0
if media_relay_required; then MEDIA_RELAY_REQUIRED=1; fi

BUILD_ID="$ROOT_DIR/.next/BUILD_ID"
RUNNING_BUILD_MARKER="$ROOT_DIR/.next/.sanmao-running-build-id"
BUILT_SOURCE_MARKER="$ROOT_DIR/.next/.sanmao-source-fingerprint"
RUNNING_SOURCE_MARKER="$ROOT_DIR/.next/.sanmao-running-source-fingerprint"

operation_lock_allows() {
  LOCK_PATH="$ROOT_DIR/.data/update-staging/update.lock"
  [ -f "$LOCK_PATH" ] || return 0
  LOCK_TOKEN=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$LOCK_PATH" 2>/dev/null | head -n 1 || true)
  if [ -n "$OPERATION_TOKEN" ] && [ -n "$LOCK_TOKEN" ] && [ "$OPERATION_TOKEN" = "$LOCK_TOKEN" ]; then return 0; fi
  LOCK_PID=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$LOCK_PATH" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null && sanmao_operation_lock_stale "$LOCK_PATH"; then
    rm -f "$LOCK_PATH"
    return 0
  fi
  if [ -z "$LOCK_PID" ] && sanmao_operation_lock_stale "$LOCK_PATH"; then
    rm -f "$LOCK_PATH"
    return 0
  fi
  printf '%s\n' '已有更新或重启任务正在进行，请稍候再试。' >&2
  return 1
}

build_served_stale() {
  [ -f "$BUILD_ID" ] || return 0
  [ -f "$RUNNING_BUILD_MARKER" ] || return 0
  CURRENT_BUILD_ID=`tr -d '\r\n' < "$BUILD_ID" 2>/dev/null || true`
  SERVED_BUILD_ID=`tr -d '\r\n' < "$RUNNING_BUILD_MARKER" 2>/dev/null || true`
  [ -n "$CURRENT_BUILD_ID" ] && [ "$CURRENT_BUILD_ID" = "$SERVED_BUILD_ID" ] || return 0
  [ -f "$BUILT_SOURCE_MARKER" ] && [ -f "$RUNNING_SOURCE_MARKER" ] || return 0
  BUILT_SOURCE=$(tr -d '\r\n' < "$BUILT_SOURCE_MARKER" 2>/dev/null || true)
  RUNNING_SOURCE=$(tr -d '\r\n' < "$RUNNING_SOURCE_MARKER" 2>/dev/null || true)
  [ -n "$BUILT_SOURCE" ] && [ "$BUILT_SOURCE" = "$RUNNING_SOURCE" ] || return 0
  return 1
}

source_fingerprint() {
  node - "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2]);
const files = [];
function visit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.isFile()) files.push(full);
  }
}
for (const name of ['app', 'components', 'lib', 'public']) visit(path.join(root, name));
for (const name of ['next.config.ts', 'next.config.js', 'tsconfig.json', 'package.json', 'package-lock.json']) if (fs.existsSync(path.join(root, name))) files.push(path.join(root, name));
for (const name of fs.readdirSync(root)) if (name.startsWith('.env') && fs.statSync(path.join(root, name)).isFile()) files.push(path.join(root, name));
files.sort();
const hash = crypto.createHash('sha256');
for (const file of files) { hash.update(path.relative(root, file).split(path.sep).join('/')); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0'); }
process.stdout.write(hash.digest('hex'));
NODE
}

server_is_ready() {
  sanmao_server_health "$1"
}

server_lifecycle_enabled() {
  PORT_TO_CHECK=$1
  BODY="${TMPDIR:-/tmp}/sanmao-lifecycle-health-$$.json"
  rm -f "$BODY"
  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT_TO_CHECK/api/health" 2>/dev/null || true)
  if [ "$STATUS" = 200 ] && grep -Eq '"lifecycleEnabled"[[:space:]]*:[[:space:]]*true' "$BODY" 2>/dev/null; then
    rm -f "$BODY"
    return 0
  fi
  rm -f "$BODY"
  return 1
}

server_media_relay_mode() {
  PORT_TO_CHECK=$1
  BODY="${TMPDIR:-/tmp}/sanmao-relay-health-$$.json"
  rm -f "$BODY"
  STATUS=$(curl --noproxy '*' -sS -o "$BODY" -w '%{http_code}' --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT_TO_CHECK/api/relay/status" 2>/dev/null || true)
  if [ "$STATUS" = 200 ]; then
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"relay"' "$BODY" 2>/dev/null; then printf '%s' relay; rm -f "$BODY"; return 0; fi
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"self-hosted"' "$BODY" 2>/dev/null; then printf '%s' self-hosted; rm -f "$BODY"; return 0; fi
    if grep -Eq '"mode"[[:space:]]*:[[:space:]]*"unavailable"' "$BODY" 2>/dev/null; then printf '%s' unavailable; rm -f "$BODY"; return 0; fi
  fi
  rm -f "$BODY"
  printf '%s' unknown
}

find_existing_server() {
  PORT_TO_CHECK=$PORT_START
  while [ $PORT_TO_CHECK -le $PORT_END ]; do
    if server_is_ready $PORT_TO_CHECK; then
      printf '%s' $PORT_TO_CHECK
      return 0
    fi
    PORT_TO_CHECK=$((PORT_TO_CHECK + 1))
  done
  printf '0'
}

fail() {
  free_relay_stop "$ROOT_DIR"
  sanmao_log "启动失败：$1" ERROR
  printf '\n启动失败：%s\n\n' "$1"
  if [ -n "${SERVER_STDERR:-}" ] && [ -s "$SERVER_STDERR" ]; then
    printf '服务端最后的错误：\n'
    tail -n 12 "$SERVER_STDERR" || true
    printf '\n'
  fi
  if [ "$NON_INTERACTIVE" != 1 ] && [ -t 0 ]; then
    printf '按回车键关闭窗口...'
    read -r _ || true
  fi
  exit 1
}

if ! operation_lock_allows; then exit 1; fi

acquire_lock() {
  TRIES=0
  while [ $TRIES -lt 450 ]; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' $$ > "$LOCK_DIR/pid"
      trap 'rm -rf "$LOCK_DIR"' EXIT HUP INT TERM
      return 0
    fi

    if [ -f "$LOCK_DIR/pid" ]; then
      LOCK_PID=`cat "$LOCK_DIR/pid" 2>/dev/null || true`
      if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
        rm -rf "$LOCK_DIR"
        continue
      fi
    else
      rm -rf "$LOCK_DIR"
      continue
    fi

    TRIES=$((TRIES + 1))
    sleep 0.2
  done
  return 1
}

EXISTING_PORT=`find_existing_server`
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && build_served_stale; then
  sanmao_log "检测到当前服务使用旧构建，正在重启端口 $EXISTING_PORT" WARN
  sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  EXISTING_PORT=0
fi
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && ! server_lifecycle_enabled "$EXISTING_PORT"; then
  sanmao_log "检测到旧服务使用了旧生命周期设置，正在重启端口 $EXISTING_PORT" WARN
  sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
fi
if [ "$EXISTING_PORT" -gt 0 ] 2>/dev/null && server_lifecycle_enabled "$EXISTING_PORT"; then
  EXISTING_RELAY_MODE=`server_media_relay_mode "$EXISTING_PORT"`
  if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ] && [ "$EXISTING_RELAY_MODE" = relay ] && ! free_relay_is_running "$ROOT_DIR"; then
    sanmao_log "检测到免费临时通道已退出，正在重启端口 $EXISTING_PORT" WARN
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  elif [ "$MEDIA_RELAY_REQUIRED" -eq 1 ] && { [ "$EXISTING_RELAY_MODE" = unavailable ] || [ "$EXISTING_RELAY_MODE" = unknown ]; }; then
    sanmao_log "检测到旧服务没有媒体中转通道，正在重启端口 $EXISTING_PORT" WARN
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  elif [ "$MEDIA_RELAY_REQUIRED" -eq 0 ] && [ "$EXISTING_RELAY_MODE" = relay ]; then
    sanmao_log "检测到当前服务不需要媒体中转，正在关闭临时通道并重启端口 $EXISTING_PORT" INFO
    sanmao_clear_stale "$EXISTING_PORT" "$EXISTING_PORT"
  else
    printf 'SANMAO.AI 已在运行：http://localhost:%s\n' $EXISTING_PORT
    rm -f "$LEGACY_MARKER"
    open "http://localhost:$EXISTING_PORT"
    exit 0
  fi
fi
rm -f "$LEGACY_MARKER"

if ! acquire_lock; then
  fail '另一个启动器正在运行，请稍候再试。'
fi
sanmao_log '已获取启动预检锁' INFO

printf '\n==> 清理旧的 SANMAO.AI 后台服务\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

LAUNCHER_VERSION=`node -p "require('./package.json').version" 2>/dev/null || printf '%s' 'unknown'`
printf '%s\n' '========================================'
printf '%s\n' "        SANMAO.AI macOS 启动器 $LAUNCHER_VERSION"
printf '%s\n' '========================================'

printf '\n==> 检查 Node.js\n'
if ! command -v node >/dev/null 2>&1; then
  fail '没有检测到 Node.js。请先安装 Node.js 20.9 或更高版本，然后重新双击启动器。'
fi

NODE_VERSION=`node --version 2>/dev/null || true`
NODE_VERSION=`printf '%s' $NODE_VERSION | sed 's/^v//'`
NODE_MAJOR=`printf '%s' $NODE_VERSION | cut -d. -f1`
NODE_MINOR=`printf '%s' $NODE_VERSION | cut -d. -f2`
if [ $NODE_MAJOR -lt 20 ]; then
  fail 'SANMAO.AI 需要 Node.js 20.9 或更高版本。'
fi
if [ $NODE_MAJOR -eq 20 ] && [ $NODE_MINOR -lt 9 ]; then
  fail 'SANMAO.AI 需要 Node.js 20.9 或更高版本。'
fi
printf 'Node.js：v%s\n' $NODE_VERSION

if ! command -v npm >/dev/null 2>&1; then
  fail '没有检测到 npm。请重新安装 Node.js，并确保 npm 已安装。'
fi
printf 'npm：%s\n' `npm --version`

# package-lock.json carries the app version in its root entry, so every release
# rewrote it; compare the declared dependencies instead of the lock file so a
# version-only update does not trigger a full reinstall.
dependency_fingerprint() {
  node -e 'const fs=require("fs");const crypto=require("crypto");const p=JSON.parse(fs.readFileSync("package.json","utf8"));const lines=[];for(const s of ["dependencies","optionalDependencies","peerDependencies","devDependencies"]){const d=p[s]||{};for(const n of Object.keys(d).sort())lines.push(s+"/"+n+"@"+d[n]);}process.stdout.write(crypto.createHash("sha256").update(lines.join("\n")).digest("hex").toUpperCase());' 2>/dev/null || true
}

ffmpeg_binary_ready() {
  if [ ! -x node_modules/ffmpeg-static/ffmpeg ]; then return 1; fi
  node_modules/ffmpeg-static/ffmpeg -version >/dev/null 2>&1
}

# ffmpeg-static fetches its binary from GitHub through a pipeline that is far
# slower than a plain request on some networks; download it here when possible so
# npm does not have to.
ensure_ffmpeg_binary() {
  if ffmpeg_binary_ready; then return 0; fi
  if [ ! -f node_modules/ffmpeg-static/package.json ]; then return 0; fi
  if ! command -v curl >/dev/null 2>&1; then return 0; fi
  if ! command -v gunzip >/dev/null 2>&1; then return 0; fi
  RELEASE=`node -p "require('./node_modules/ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag']" 2>/dev/null || printf '%s' 'b6.0'`
  BASE_NAME=`node -p "require('./node_modules/ffmpeg-static/package.json')['ffmpeg-static']['executable-base-name']" 2>/dev/null || printf '%s' 'ffmpeg'`
  if [ -z "$RELEASE" ]; then RELEASE=b6.0; fi
  if [ -z "$BASE_NAME" ]; then BASE_NAME=ffmpeg; fi
  BINARIES_URL=${FFMPEG_BINARIES_URL:-https://github.com/eugeneware/ffmpeg-static/releases/download}
  if [ -n "${FFMPEG_BINARIES_URL:-}" ]; then
    # 用户指定了下载源，就只用它。
    FALLBACK_BINARIES_URL=
  else
    # GitHub Release 在国内网络经常连接超时；主地址失败后自动改用公共镜像。
    FALLBACK_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static
  fi
  case "`uname -s`" in
    Darwin) ASSET_PLATFORM=darwin ;;
    *) ASSET_PLATFORM=linux ;;
  esac
  case "`uname -m`" in
    arm64|aarch64) ASSET_ARCH=arm64 ;;
    *) ASSET_ARCH=x64 ;;
  esac
  FFMPEG_TARGET="node_modules/ffmpeg-static/$BASE_NAME"
  FFMPEG_TEMP="$FFMPEG_TARGET.partial-$"
  FFMPEG_ASSET="$BASE_NAME-$ASSET_PLATFORM-$ASSET_ARCH.gz"
  for BASE_URL in "$BINARIES_URL" "$FALLBACK_BINARIES_URL"; do
    [ -n "$BASE_URL" ] || continue
    printf '%s\n' "正在下载 FFmpeg 组件（$BASE_URL）…"
    rm -f "$FFMPEG_TEMP" "$FFMPEG_TEMP.gz"
    if curl -fL --connect-timeout 15 --max-time 900 --retry 2 -o "$FFMPEG_TEMP.gz" "$BASE_URL/$RELEASE/$FFMPEG_ASSET" >/dev/null 2>&1; then
      if gunzip -c "$FFMPEG_TEMP.gz" > "$FFMPEG_TEMP" 2>/dev/null; then
        chmod +x "$FFMPEG_TEMP" 2>/dev/null || true
        if "$FFMPEG_TEMP" -version >/dev/null 2>&1; then
          mv -f "$FFMPEG_TEMP" "$FFMPEG_TARGET"
          rm -f "$FFMPEG_TEMP.gz"
          printf '%s\n' 'FFmpeg 已就绪。'
          return 0
        fi
      fi
    fi
    if [ "$BASE_URL" = "$BINARIES_URL" ] && [ -n "$FALLBACK_BINARIES_URL" ]; then
      printf '%s\n' '主下载地址不可用，改用备用镜像继续。'
    fi
  done
  rm -f "$FFMPEG_TEMP" "$FFMPEG_TEMP.gz"
  return 1
}

# 首次安装依赖时官方 npm 源在国内网络下常常只有几十 KB/s（首次要下载约 800 MB），
# 用户会以为程序卡住了。这里做一次很短的探测，官方源慢就整体切到国内镜像；依赖仍由
# package-lock.json 校验完整性。可用 SANMAO_NO_MIRROR=1 完全禁用镜像，用
# SANMAO_NPM_REGISTRY 指定自定义源。
sanmao_mirror_registry=https://registry.npmmirror.com

sanmao_remote_source_fast() {
  # 只关心能不能在时限内拿到响应，404 也算网络是通的。
  command -v curl >/dev/null 2>&1 || return 1
  curl -s -I -o /dev/null --max-time "$2" "$1" >/dev/null 2>&1
}

sanmao_resolve_npm_registry() {
  # 输出空字符串表示继续使用 npm 自身的默认源；提示走 stderr，避免污染返回值。
  if [ "${SANMAO_NO_MIRROR:-0}" = '1' ]; then return 0; fi
  if [ -n "${SANMAO_NPM_REGISTRY:-}" ]; then printf '%s' "$SANMAO_NPM_REGISTRY"; return 0; fi
  if sanmao_remote_source_fast 'https://registry.npmjs.org/-/ping' 2; then return 0; fi
  printf '%s\n' '官方 npm 源响应很慢，本次改用国内镜像 registry.npmmirror.com 下载依赖。' >&2
  printf '%s\n' '依赖仍按 package-lock.json 校验完整性；如需只用官方源，可先设置环境变量 SANMAO_NO_MIRROR=1。' >&2
  printf '%s' "$sanmao_mirror_registry"
}

sanmao_format_duration() {
  TOTAL_SECONDS=${1:-0}
  DURATION_HOURS=$((TOTAL_SECONDS / 3600))
  DURATION_MINUTES=$(((TOTAL_SECONDS % 3600) / 60))
  DURATION_SECONDS=$((TOTAL_SECONDS % 60))
  if [ "$DURATION_HOURS" -gt 0 ]; then
    printf '%s' "${DURATION_HOURS} 小时 ${DURATION_MINUTES} 分"
  elif [ "$DURATION_MINUTES" -gt 0 ]; then
    printf '%s' "${DURATION_MINUTES} 分 ${DURATION_SECONDS} 秒"
  else
    printf '%s' "${DURATION_SECONDS} 秒"
  fi
}

sanmao_dir_size_mb() {
  SIZE_MB=`du -sm "$1" 2>/dev/null | cut -f1 || true`
  if [ -z "$SIZE_MB" ]; then SIZE_MB=0; fi
  printf '%s' "$SIZE_MB"
}

sanmao_show_log_tail() {
  [ -s "$1" ] || return 0
  printf '\n最后几行输出（完整日志：%s）：\n' "$1"
  tail -n "${2:-20}" "$1" | sed 's/\r$//' | sed 's/^/   /' || true
}

# 进度提示：长耗时步骤在后台执行并把输出写进日志，前台每隔几秒打印“已用时间 + 目录
# 体积 + 最近一行输出”，让用户能确认程序仍在下载，而不是卡死。npm 在输出被重定向时
# 自己不打印进度，所以必须由启动器心跳兜底。返回子进程的退出码。
sanmao_run_with_progress() {
  STEP_SIZE_DIR=$1
  STEP_SIZE_LABEL=$2
  STEP_LOG_PATH=$3
  STEP_QUIET_HINT=$4
  shift 4
  mkdir -p "`dirname "$STEP_LOG_PATH"`"
  : > "$STEP_LOG_PATH"
  STEP_START_TS=`date +%s`
  "$@" >"$STEP_LOG_PATH" 2>&1 &
  STEP_PID=$!
  STEP_TICKS=0
  while kill -0 "$STEP_PID" 2>/dev/null; do
    sleep 8
    kill -0 "$STEP_PID" 2>/dev/null || break
    STEP_TICKS=$((STEP_TICKS + 1))
    STEP_ELAPSED=$((`date +%s` - STEP_START_TS))
    STEP_LINE="   已用 `sanmao_format_duration $STEP_ELAPSED`"
    if [ -n "$STEP_SIZE_DIR" ]; then
      STEP_LINE="$STEP_LINE ｜ $STEP_SIZE_LABEL `sanmao_dir_size_mb "$STEP_SIZE_DIR"` MB"
    fi
    STEP_TAIL=`tail -n 1 "$STEP_LOG_PATH" 2>/dev/null | tr -d '\r' || true`
    if [ -n "$STEP_TAIL" ]; then
      STEP_LINE="$STEP_LINE ｜ $STEP_TAIL"
    fi
    printf '%s\n' "$STEP_LINE"
    if [ -n "$STEP_QUIET_HINT" ] && [ $((STEP_TICKS % 8)) -eq 0 ]; then
      printf '   提示：%s\n' "$STEP_QUIET_HINT"
    fi
  done
  if wait "$STEP_PID"; then return 0; else return $?; fi
}

printf '\n==> 检查并安装程序依赖\n'
NEED_INSTALL=0
DEPS_READY=1
if [ "$SKIP_BUILD" = 1 ]; then
  printf '%s\n' '回滚模式：保留当前依赖，不执行 npm install。'
else
  if [ ! -x node_modules/.bin/next ] || [ ! -x node_modules/ffmpeg-static/ffmpeg ] || [ ! -f node_modules/typescript/package.json ] || [ ! -f node_modules/@types/node/package.json ] || [ ! -f node_modules/@types/react/package.json ] || [ ! -f node_modules/@types/react-dom/package.json ]; then
    DEPS_READY=0
  fi
  DEPS_FINGERPRINT=`dependency_fingerprint`
  STORED_DEPS_FINGERPRINT=`cat node_modules/.sanmao-deps.sha256 2>/dev/null | tr -d '\r\n' || true`
  if [ "$DEPS_READY" -eq 0 ] || [ -z "$DEPS_FINGERPRINT" ] || [ "$STORED_DEPS_FINGERPRINT" != "$DEPS_FINGERPRINT" ]; then
    NEED_INSTALL=1
  fi
fi
if [ "$NEED_INSTALL" -eq 1 ]; then
  if [ "$DEPS_READY" -eq 1 ]; then
    printf '%s\n' '依赖清单有变化，正在增量同步依赖（保留已安装文件，优先使用本地缓存）。'
  else
    printf '%s\n' '首次运行或依赖不完整，正在安装依赖。'
    printf '%s\n' '首次要下载约 800 MB 依赖（其中 FFmpeg 约 29 MB），网速较慢时可能要十几分钟甚至更久。'
    printf '%s\n' '安装期间会持续显示进度；下载阶段没有输出属正常现象，请不要关闭窗口。'
  fi
  printf '%s\n' '正在检测下载源速度…'
  NPM_REGISTRY=`sanmao_resolve_npm_registry`
  NPM_REGISTRY_ARG=
  if [ -n "$NPM_REGISTRY" ]; then NPM_REGISTRY_ARG=" --registry=$NPM_REGISTRY"; fi
  NPM_LOG="$ROOT_DIR/.data/logs/npm-install.log"
  NPM_MIRROR_LOG="$ROOT_DIR/.data/logs/npm-install-mirror.log"
  NPM_HINT='依赖下载阶段通常没有输出，属正常现象；请保持窗口打开。'
  NPM_SIZE_DIR=node_modules
  NPM_SIZE_LABEL='依赖目录'
  STEP_STATUS=0
  if [ -f package-lock.json ] && [ ! -d node_modules ]; then
    sanmao_run_with_progress "$NPM_SIZE_DIR" "$NPM_SIZE_LABEL" "$NPM_LOG" "$NPM_HINT" sh -c "npm ci --include=dev --no-audit --no-fund --prefer-offline --ignore-scripts$NPM_REGISTRY_ARG" || STEP_STATUS=$?
    if [ "$STEP_STATUS" -eq 0 ]; then
      ensure_ffmpeg_binary || true
      sanmao_run_with_progress '' '' "$NPM_LOG" '' sh -c "npm rebuild --no-audit --no-fund$NPM_REGISTRY_ARG" || STEP_STATUS=$?
    fi
  else
    sanmao_run_with_progress "$NPM_SIZE_DIR" "$NPM_SIZE_LABEL" "$NPM_LOG" "$NPM_HINT" sh -c "npm install --include=dev --no-audit --no-fund --prefer-offline$NPM_REGISTRY_ARG" || STEP_STATUS=$?
  fi
  if [ "$STEP_STATUS" -ne 0 ] && [ -z "$NPM_REGISTRY" ] && [ "${SANMAO_NO_MIRROR:-0}" != 1 ]; then
    printf '%s\n' '官方源安装失败，正在改用国内镜像重试。'
    NPM_LOG=$NPM_MIRROR_LOG
    STEP_STATUS=0
    sanmao_run_with_progress "$NPM_SIZE_DIR" "$NPM_SIZE_LABEL" "$NPM_LOG" "$NPM_HINT" sh -c "npm install --include=dev --no-audit --no-fund --prefer-offline --registry=$sanmao_mirror_registry" || STEP_STATUS=$?
  fi
  if [ "$STEP_STATUS" -ne 0 ]; then
    sanmao_show_log_tail "$NPM_LOG" 20
    fail '依赖安装失败，请检查网络后再次运行启动器。'
  fi
  ensure_ffmpeg_binary || true
  if [ -n "$DEPS_FINGERPRINT" ]; then printf '%s' "$DEPS_FINGERPRINT" > node_modules/.sanmao-deps.sha256; fi
  rm -f node_modules/.sanmao-package-lock.sha256
else
  printf '%s\n' '依赖已安装。'
fi

if [ ! -x node_modules/.bin/next ]; then
  fail '依赖安装完成后仍找不到 Next.js。请删除 node_modules 文件夹后重新运行启动器。'
fi
if [ ! -x node_modules/ffmpeg-static/ffmpeg ]; then
  fail '依赖安装完成后仍找不到 FFmpeg。请删除 node_modules 文件夹后重新运行启动器。'
fi

if [ "$SKIP_BUILD" = 1 ] && [ ! -f "$BUILD_ID" ]; then
  fail '回滚构建产物不存在，无法安全启动旧服务。'
fi

printf '\n==> 检查构建产物是否最新\n'

NEXT_BIN="$ROOT_DIR/node_modules/.bin/next"

NEED_BUILD=0
if [ "$SKIP_BUILD" = 1 ]; then
  NEED_BUILD=0
elif [ "${SANMAO_FORCE_BUILD:-0}" = "1" ]; then
  NEED_BUILD=1
elif [ ! -f "$BUILD_ID" ]; then
  NEED_BUILD=1
else
  BUILD_MTIME=$(stat -f '%m' "$BUILD_ID" 2>/dev/null) || true
  NEWEST_MTIME=$(find "$ROOT_DIR/app" "$ROOT_DIR/components" "$ROOT_DIR/lib" "$ROOT_DIR/public" -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -n 1) || true
  ENV_MTIME=$(find "$ROOT_DIR" -maxdepth 1 -type f -name '.env*' -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -n 1) || true
  if [ -n "$BUILD_MTIME" ] && [ -n "$NEWEST_MTIME" ] && [ "$NEWEST_MTIME" -ge "$BUILD_MTIME" ]; then
    NEED_BUILD=1
  fi
  if [ "$NEED_BUILD" -eq 0 ] && [ -n "$ENV_MTIME" ] && [ "$ENV_MTIME" -ge "$BUILD_MTIME" ]; then
    NEED_BUILD=1
  fi
  if [ "$NEED_BUILD" -eq 0 ] && [ -f "$BUILT_SOURCE_MARKER" ]; then
    CURRENT_SOURCE=$(source_fingerprint)
    BUILT_SOURCE=$(tr -d '\r\n' < "$BUILT_SOURCE_MARKER" 2>/dev/null || true)
    if [ -z "$BUILT_SOURCE" ] || [ "$CURRENT_SOURCE" != "$BUILT_SOURCE" ]; then NEED_BUILD=1; fi
  elif [ "$NEED_BUILD" -eq 0 ]; then
    NEED_BUILD=1
  fi
  if [ "$NEED_BUILD" -eq 0 ]; then
    for F in next.config.ts next.config.js tsconfig.json package.json package-lock.json; do
      if [ -f "$ROOT_DIR/$F" ] && [ ! "$BUILD_ID" -nt "$ROOT_DIR/$F" ]; then
        NEED_BUILD=1
        break
      fi
    done
  fi
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  printf '%s\n' '需要重新构建（首次运行或代码有更新）。只需等这一次，之后启动会直接跳过构建。'
  printf '%s\n' '使用 webpack 构建，避免 Turbopack 在中文内容中的字符边界崩溃。'
  "$NEXT_BIN" build --webpack || fail '网页构建失败。请查看终端中构建失败上方的报错。'
  source_fingerprint > "$BUILT_SOURCE_MARKER"
  printf '构建完成。\n'
else
  printf '%s\n' '构建产物已是最新，跳过构建，直接启动。'
fi

printf '\n==> 启动 SANMAO.AI\n'
sanmao_clear_stale 3000 3010
sanmao_clear_stale "$PORT_START" "$PORT_END"

PORT=$PORT_START
if command -v lsof >/dev/null 2>&1; then
  while [ $PORT -le $PORT_END ] && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
    PORT=$((PORT + 1))
  done
fi
if [ $PORT -gt $PORT_END ]; then
  fail "${PORT_START}～${PORT_END} 端口都被占用，请关闭旧的 SANMAO.AI/开发服务器后再试。"
fi

if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  export SANMAO_RELAY_MODE=1
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  free_relay_stop "$ROOT_DIR"
  printf '%s\n' '正在准备免费媒体中转通道（首次运行会自动下载组件）…'
else
  unset SANMAO_RELAY_MODE SANMAO_RELAY_PUBLIC_BASE_URL
  case "${SANMAO_MEDIA_RELAY_URL:-}" in
    https://*.trycloudflare.com|https://*.trycloudflare.com/) unset SANMAO_MEDIA_RELAY_URL ;;
  esac
  free_relay_stop "$ROOT_DIR"
fi

URL=http://localhost:$PORT
SERVER_STDOUT="${TMPDIR:-/tmp}/sanmao-ai-server.out.log"
SERVER_STDERR="${TMPDIR:-/tmp}/sanmao-ai-server.err.log"
rm -f "$SERVER_STDOUT" "$SERVER_STDERR"
NEXT_CLI="$ROOT_DIR/node_modules/next/dist/bin/next"
SANMAO_RUNTIME_INSTANCE_ID=$(node -e "process.stdout.write(require('node:crypto').randomUUID())")
export SANMAO_RUNTIME_INSTANCE_ID
export SANMAO_LIFECYCLE=1
if [ "$DETACH_SERVER" = 1 ]; then
  nohup node "$NEXT_CLI" start -H 127.0.0.1 -p $PORT >"$SERVER_STDOUT" 2>"$SERVER_STDERR" </dev/null &
else
  node "$NEXT_CLI" start -H 127.0.0.1 -p $PORT >"$SERVER_STDOUT" 2>"$SERVER_STDERR" &
fi
SERVER_PID=$!

RELAY_WATCH_PID=''
if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  free_relay_watch "$ROOT_DIR" "$SERVER_PID" "$PORT" &
  RELAY_WATCH_PID=$!
fi
sanmao_log "已启动服务进程 PID ${SERVER_PID}，等待端口 $PORT 就绪。" INFO

READY=0
ATTEMPT=0
while [ $ATTEMPT -lt 150 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.2
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    break
  fi
  if server_is_ready $PORT; then READY=1; break; fi
done

if [ $READY -ne 1 ]; then
  printf '\n服务器没有在预期时间内启动。服务端错误日志：%s\n' "$SERVER_STDERR"
  if [ -s "$SERVER_STDERR" ]; then tail -n 12 "$SERVER_STDERR"; fi
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  fail '启动超时。'
fi

if [ -f "$BUILD_ID" ]; then
  tr -d '\r\n' < "$BUILD_ID" > "$RUNNING_BUILD_MARKER"
fi
if [ -f "$BUILT_SOURCE_MARKER" ]; then
  cp "$BUILT_SOURCE_MARKER" "$RUNNING_SOURCE_MARKER"
fi

if [ "$MEDIA_RELAY_REQUIRED" -eq 1 ]; then
  if RELAY_URL=$(free_relay_start "$ROOT_DIR" "$PORT"); then
    export SANMAO_RELAY_MODE=1
    export SANMAO_RELAY_PUBLIC_BASE_URL="$RELAY_URL"
    export SANMAO_MEDIA_RELAY_URL="$RELAY_URL"
    sanmao_log "已启动免费临时通道：$RELAY_URL" INFO
  else
    printf '%s\n' '免费媒体中转通道暂时不可用；后台将继续自动重试。'
    sanmao_log '免费临时通道首次启动失败，将继续自动重试。' WARN
  fi
  free_relay_watch "$ROOT_DIR" "$SERVER_PID" "$PORT" &
  RELAY_WATCH_PID=$!
fi

printf 'SANMAO.AI 已启动：%s\n' $URL
printf '%s\n' '本地服务会保持运行，下一次启动会直接打开已有服务。'
sanmao_log "服务已就绪：$URL" INFO
if [ "$NON_INTERACTIVE" != 1 ]; then open $URL; fi
if [ "$DETACH_SERVER" = 1 ]; then
  exit 0
fi
wait $SERVER_PID
if [ -n "${RELAY_WATCH_PID:-}" ]; then kill "$RELAY_WATCH_PID" 2>/dev/null || true; wait "$RELAY_WATCH_PID" 2>/dev/null || true; fi
free_relay_stop "$ROOT_DIR"
