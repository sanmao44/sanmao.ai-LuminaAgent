#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PORT=${1:-0}
OPERATION_ID=${2:?operation id is required}
OPERATION_TOKEN=${3:?operation token is required}
LOCK_PATH="$ROOT_DIR/.data/update-staging/update.lock"
DRAIN_PATH="$ROOT_DIR/.data/runtime-draining.json"
STATUS_PATH="$ROOT_DIR/.data/runtime-restart/status.json"
BACKUP_DIR="$ROOT_DIR/.data/runtime-restart/previous-$OPERATION_ID"

write_status() {
  STATE=$1
  ERROR_TEXT=${2:-}
  ROLLED_BACK=${3:-false}
  mkdir -p "$(dirname "$STATUS_PATH")"
  node - "$STATUS_PATH" "$OPERATION_ID" "$STATE" "$ERROR_TEXT" "$ROLLED_BACK" <<'NODE' >/dev/null 2>&1 || true
const fs = require('fs');
const [statusPath, operationId, state, error, rolledBack] = process.argv.slice(2);
const payload = { operationId, state, updatedAt: new Date().toISOString(), rolledBack: rolledBack === 'true' };
if (error) payload.error = error;
const temporary = `${statusPath}.${operationId}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
fs.renameSync(temporary, statusPath);
NODE
}

lock_matches() {
  node - "$LOCK_PATH" "$OPERATION_ID" "$OPERATION_TOKEN" <<'NODE' >/dev/null 2>&1
const fs = require('fs');
const [lockPath, operationId, token] = process.argv.slice(2);
try {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  process.exit(lock.operationId === operationId && lock.token === token ? 0 : 1);
} catch { process.exit(1); }
NODE
}

claim_lock() {
  lock_matches || { printf '%s\n' '重启任务锁校验失败，操作已取消。' >&2; return 1; }
  node - "$LOCK_PATH" "$OPERATION_TOKEN" "$$" <<'NODE' >/dev/null 2>&1
const fs = require('fs');
const [lockPath, token, pid] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (lock.token !== token) process.exit(1);
lock.pid = Number(pid);
const temporary = `${lockPath}.${pid}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(lock, null, 2));
fs.renameSync(temporary, lockPath);
NODE
}

remove_owned_markers() {
  if lock_matches; then rm -f "$LOCK_PATH"; fi
  node - "$DRAIN_PATH" "$OPERATION_ID" <<'NODE' >/dev/null 2>&1 || true
const fs = require('fs');
const [drainPath, operationId] = process.argv.slice(2);
try { if (JSON.parse(fs.readFileSync(drainPath, 'utf8')).operationId === operationId) fs.rmSync(drainPath, { force: true }); } catch {}
NODE
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

start_service() {
  START_SKIP_BUILD=${1:-0}
  START_FORCE_BUILD=1
  if [ "$START_SKIP_BUILD" = 1 ]; then START_FORCE_BUILD=0; fi
  if [ "$(uname -s 2>/dev/null || true)" = Darwin ] && [ -f "$SCRIPT_DIR/start-macos.sh" ]; then
    SANMAO_PORT="$PORT" SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" SANMAO_FORCE_BUILD="$START_FORCE_BUILD" SANMAO_SKIP_BUILD="$START_SKIP_BUILD" SANMAO_NONINTERACTIVE=1 SANMAO_DETACH_SERVER=1 sh "$SCRIPT_DIR/start-macos.sh" --non-interactive --detach --operation-token "$OPERATION_TOKEN"
    return $?
  fi
  if [ -f "$SCRIPT_DIR/start-linux.sh" ]; then
    SANMAO_PORT="$PORT" SANMAO_OPERATION_TOKEN="$OPERATION_TOKEN" SANMAO_FORCE_BUILD="$START_FORCE_BUILD" SANMAO_SKIP_BUILD="$START_SKIP_BUILD" SANMAO_NONINTERACTIVE=1 SANMAO_DETACH_SERVER=1 sh "$SCRIPT_DIR/start-linux.sh" --non-interactive --detach --operation-token "$OPERATION_TOKEN"
    return $?
  fi

  # Linux installations without a bundled launcher still get a safe local
  # restart: the verified build is started on the original port and readiness
  # is checked before the operation lock is released.
  if [ ! -x "$ROOT_DIR/node_modules/.bin/next" ]; then return 1; fi
  SERVER_STDOUT="$ROOT_DIR/.data/runtime-restart/server.out.log"
  SERVER_STDERR="$ROOT_DIR/.data/runtime-restart/server.err.log"
  mkdir -p "$(dirname "$SERVER_STDOUT")"
  SANMAO_RUNTIME_INSTANCE_ID=$(node -e "process.stdout.write(require('node:crypto').randomUUID())") SANMAO_NETWORK_MODE=local SANMAO_LIFECYCLE=1 nohup "$ROOT_DIR/node_modules/.bin/next" start -H 127.0.0.1 -p "$PORT" >"$SERVER_STDOUT" 2>"$SERVER_STDERR" </dev/null &
  SERVER_PID=$!
  for _ in $(seq 1 180); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 1; fi
    if curl --noproxy '*' -fsS --connect-timeout 0.3 --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      BUILD_ID_FILE="$ROOT_DIR/.next/BUILD_ID"
      [ -f "$BUILD_ID_FILE" ] && tr -d '\r\n' < "$BUILD_ID_FILE" > "$ROOT_DIR/.next/.sanmao-running-build-id"
      source_fingerprint > "$ROOT_DIR/.next/.sanmao-source-fingerprint"
      cp "$ROOT_DIR/.next/.sanmao-source-fingerprint" "$ROOT_DIR/.next/.sanmao-running-source-fingerprint"
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  ERROR_TEXT=$1
  write_status failed "$ERROR_TEXT" false
  if [ -d "$BACKUP_DIR" ]; then
    rm -rf "$ROOT_DIR/.next"
    mv "$BACKUP_DIR" "$ROOT_DIR/.next"
    write_status rolling-back "$ERROR_TEXT" true
    if start_service 1; then
      write_status failed-rolled-back "$ERROR_TEXT" true
    else
      write_status failed "$ERROR_TEXT" false
    fi
  fi
}

cleanup() {
  remove_owned_markers
}
trap cleanup EXIT HUP INT TERM

claim_lock
write_status stopping

if [ "$PORT" -lt 1024 ] 2>/dev/null || [ "$PORT" -gt 65525 ] 2>/dev/null; then PORT=3210; fi
export SANMAO_PORT="$PORT"
if ! sh "$SCRIPT_DIR/stop-macos.sh" --operation-token "$OPERATION_TOKEN"; then
  rollback '旧服务未能安全停止'
  exit 1
fi

BUILD_DIR="$ROOT_DIR/.next"
if [ -e "$BACKUP_DIR" ]; then rm -rf "$BACKUP_DIR"; fi
mkdir -p "$(dirname "$BACKUP_DIR")"
if [ -d "$BUILD_DIR" ]; then mv "$BUILD_DIR" "$BACKUP_DIR"; fi

write_status building
if ! (cd "$ROOT_DIR" && npm run build); then
  rollback '新版本构建失败'
  exit 1
fi
if [ -f "$BUILD_DIR/BUILD_ID" ]; then source_fingerprint > "$BUILD_DIR/.sanmao-source-fingerprint"; fi

if ! lock_matches; then
  rollback '重启任务锁在构建期间发生变化'
  exit 1
fi
write_status starting
if ! start_service; then
  rollback '新版本启动失败'
  exit 1
fi

rm -rf "$BACKUP_DIR"
write_status completed
exit 0
