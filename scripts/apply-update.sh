#!/usr/bin/env sh
set -eu

ARCHIVE_PATH=${1:?archive path is required}
TARGET_PATH=${2:?target path is required}
PROCESS_ID=${3:?process id is required}
VERSION=${4:?version is required}
RESTART_PORT=${7:-0}
PROGRESS_PATH=${8:-}
OPERATION_TOKEN=${9:-}
STAGING_PATH=$(CDPATH= cd -- "$(dirname "$ARCHIVE_PATH")" && pwd)
EXTRACT_PATH="$STAGING_PATH/extract-$$"
LOCK_PATH="$STAGING_PATH/update.lock"
DRAIN_PATH="$TARGET_PATH/.data/runtime-draining.json"
LOG_PATH=${5:-"$STAGING_PATH/update.log"}
BACKUP_DIR="$STAGING_PATH/previous-update-$$"
BACKUP_CREATED=0
BACKUP_COMPLETE=0

write_log() {
  mkdir -p "$(dirname "$LOG_PATH")" 2>/dev/null || true
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_PATH" 2>/dev/null || true
}

remove_update_drain() {
  [ -n "$OPERATION_TOKEN" ] || return 0
  node - "$DRAIN_PATH" "$LOCK_PATH" "$OPERATION_TOKEN" <<'NODE' >/dev/null 2>&1 || true
const fs = require('fs');
const [drainPath, lockPath, token] = process.argv.slice(2);
try {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const drain = JSON.parse(fs.readFileSync(drainPath, 'utf8'));
  if (lock.token === token && drain.operationId === lock.jobId) fs.rmSync(drainPath, { force: true });
} catch {}
NODE
}

cleanup() {
  remove_update_drain
  if [ -z "$OPERATION_TOKEN" ]; then
    rm -f "$LOCK_PATH"
  else
    node - "$LOCK_PATH" "$OPERATION_TOKEN" <<'NODE' >/dev/null 2>&1 || true
const fs = require('fs');
const [lockPath, token] = process.argv.slice(2);
try { if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).token === token) fs.rmSync(lockPath, { force: true }); } catch {}
NODE
  fi
}
trap cleanup EXIT

claim_update_lock() {
  [ -n "$OPERATION_TOKEN" ] || return 0
  node - "$LOCK_PATH" "$OPERATION_TOKEN" "$$" <<'NODE'
const fs = require('fs');
const [lockPath, token, pid] = process.argv.slice(2);
let lock;
try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { process.exit(1); }
if (lock.token !== token) process.exit(1);
lock.pid = Number(pid);
const temporary = `${lockPath}.${pid}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(lock, null, 2));
fs.renameSync(temporary, lockPath);
NODE
}

start_rollback_service() {
  [ -f "$TARGET_PATH/scripts/start-macos.sh" ] || return 1
  ROLLBACK_OUT="$TARGET_PATH/.data/runtime-restart/rollback.out.log"
  ROLLBACK_ERR="$TARGET_PATH/.data/runtime-restart/rollback.err.log"
  mkdir -p "$(dirname "$ROLLBACK_OUT")"
  if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
    (cd "$TARGET_PATH" && SANMAO_PORT="$RESTART_PORT" SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" SANMAO_SKIP_BUILD=1 SANMAO_NONINTERACTIVE=1 SANMAO_DETACH_SERVER=1 nohup sh scripts/start-macos.sh >"$ROLLBACK_OUT" 2>"$ROLLBACK_ERR" </dev/null &)
    PROBE_START=$RESTART_PORT
    PROBE_END=$RESTART_PORT
  else
    (cd "$TARGET_PATH" && SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" SANMAO_SKIP_BUILD=1 SANMAO_NONINTERACTIVE=1 SANMAO_DETACH_SERVER=1 nohup sh scripts/start-macos.sh >"$ROLLBACK_OUT" 2>"$ROLLBACK_ERR" </dev/null &)
    PROBE_START=3210
    PROBE_END=3220
  fi
  for _ in $(seq 1 360); do
    PROBE_PORT=$PROBE_START
    while [ "$PROBE_PORT" -le "$PROBE_END" ]; do
      if curl --noproxy '*' -fsS --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PROBE_PORT/api/health" >/dev/null 2>&1; then return 0; fi
      PROBE_PORT=$((PROBE_PORT + 1))
    done
    sleep 0.5
  done
  return 1
}

rollback_update() {
  [ "$BACKUP_CREATED" -eq 1 ] || return 1
  write_log '新版本服务未能就绪，正在恢复上一份程序文件'
  if [ -f "$TARGET_PATH/scripts/stop-macos.sh" ]; then
    sh "$TARGET_PATH/scripts/stop-macos.sh" --operation-token "$OPERATION_TOKEN" >/dev/null 2>&1 || true
  fi
  if [ "$BACKUP_COMPLETE" -eq 1 ]; then
    find "$TARGET_PATH" -mindepth 1 -maxdepth 1 \
      ! -name .data ! -name node_modules ! -name .git ! -name '.env*' \
      -exec rm -rf {} +
  fi
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -exec mv {} "$TARGET_PATH"/ \;
  if start_rollback_service; then
    BACKUP_CREATED=0
    BACKUP_COMPLETE=0
    write_log '旧版本服务已恢复'
    return 0
  fi
  return 1
}

write_progress() {
  [ -n "$PROGRESS_PATH" ] || return 0
  PROGRESS_PATH="$PROGRESS_PATH" PROGRESS_STAGE="$1" PROGRESS_MESSAGE="$2" PROGRESS_PERCENT="$3" node -e "const fs=require('fs'); const path=process.env.PROGRESS_PATH; let value={}; try{value=JSON.parse(fs.readFileSync(path,'utf8'))}catch{} value.stage=process.env.PROGRESS_STAGE; value.message=process.env.PROGRESS_MESSAGE; value.percent=Number(process.env.PROGRESS_PERCENT); value.updatedAt=new Date().toISOString(); const tmp=path+'.'+process.pid+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(value,null,2)); fs.renameSync(tmp,path);" 2>/dev/null || true
}

write_progress starting '正在替换程序文件并准备重启…' 98
claim_update_lock || { printf '%s\n' '更新任务锁校验失败，操作已取消。' >&2; exit 1; }
write_log "开始应用 SANMAO.AI $VERSION，目标目录：$TARGET_PATH"

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
if kill -0 "$PROCESS_ID" 2>/dev/null; then
  write_log "旧服务进程 PID $PROCESS_ID 未能退出，取消更新"
  exit 1
fi

# 只替换程序文件；用户数据、环境变量和已安装依赖保留不动。
mkdir -p "$BACKUP_DIR"
BACKUP_CREATED=1
if ! find "$TARGET_PATH" -mindepth 1 -maxdepth 1 \
  ! -name .data ! -name node_modules ! -name .git ! -name '.env*' \
  -exec mv {} "$BACKUP_DIR"/ \;
then
  rollback_update || true
  exit 1
fi
BACKUP_COMPLETE=1
if ! cp -R "$PACKAGE_ROOT"/. "$TARGET_PATH"/; then
  rollback_update || true
  exit 1
fi
write_progress starting '程序文件已替换，正在重新构建并启动…' 99
if ! rm -rf "$TARGET_PATH/.next" "$ARCHIVE_PATH" "$EXTRACT_PATH"; then
  rollback_update || true
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ] && [ -f "$TARGET_PATH/scripts/start-macos.sh" ]; then
  if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
    (cd "$TARGET_PATH" && SANMAO_PORT="$RESTART_PORT" SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" nohup sh scripts/start-macos.sh --non-interactive --detach >/dev/null 2>&1 &)
  else
    (cd "$TARGET_PATH" && SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" nohup sh scripts/start-macos.sh --non-interactive --detach >/dev/null 2>&1 &)
  fi
elif [ -f "$TARGET_PATH/scripts/start-linux.sh" ]; then
  if [ "$RESTART_PORT" -ge 1024 ] 2>/dev/null && [ "$RESTART_PORT" -le 65525 ] 2>/dev/null; then
    (cd "$TARGET_PATH" && SANMAO_PORT="$RESTART_PORT" SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" nohup sh scripts/start-linux.sh --non-interactive --detach >/dev/null 2>&1 &)
  else
    (cd "$TARGET_PATH" && SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" nohup sh scripts/start-linux.sh --non-interactive --detach >/dev/null 2>&1 &)
  fi
else
  write_log '更新后找不到适用的启动器，准备回滚'
  rollback_update || true
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
  rollback_update || true
  printf '%s\n' '更新后服务未在 180 秒内就绪，请查看 .data/logs/launcher.log 与更新日志后重试。' >&2
  exit 1
fi

rm -rf "$BACKUP_DIR"
BACKUP_CREATED=0
BACKUP_COMPLETE=0
write_progress completed '更新完成，服务已恢复。' 100
write_log '更新流程完成，新服务已就绪'
