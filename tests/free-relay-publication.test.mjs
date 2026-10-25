import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const relayHelper = fileURLToPath(new URL('../scripts/free-relay-common.ps1', import.meta.url));

test('Windows launcher publishes a quick tunnel only after the health probe passes', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-relay-publish-'));
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:SANMAO_DATA_DIR = Join-Path $env:SANMAO_RELAY_TEST_ROOT 'data'
. $env:SANMAO_RELAY_TEST_HELPER
function Get-SanmaoCloudflaredExecutable { param([string]$Root) return 'cloudflared.exe' }
function Get-Process { [CmdletBinding()] param([int]$Id) return $null }
function Start-Process {
  [CmdletBinding()]
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [string]$WindowStyle, [string]$RedirectStandardOutput, [string]$RedirectStandardError, [switch]$PassThru)
  Set-Content -LiteralPath $RedirectStandardOutput -Value '' -Encoding ASCII
  Set-Content -LiteralPath $RedirectStandardError -Value 'https://relay-candidate.trycloudflare.com' -Encoding ASCII
  return [pscustomobject]@{ Id = 765432; HasExited = $false }
}
$script:probeCount = 0
function Test-SanmaoFreeRelayReachable {
  [CmdletBinding()]
  param([string]$Root, [string]$PublicUrl = '')
  $published = Join-Path (Join-Path $env:SANMAO_DATA_DIR 'free-relay') 'public-url.txt'
  if (Test-Path -LiteralPath $published) { throw 'unhealthy tunnel was published before probing' }
  if ($PublicUrl -ne 'https://relay-candidate.trycloudflare.com') { throw 'health probe did not receive the candidate URL' }
  $script:probeCount++
  return $script:probeCount -ge 2
}
$result = Start-SanmaoFreeRelayTunnel -Root $env:SANMAO_RELAY_TEST_ROOT -OriginPort 3210
$published = Join-Path (Join-Path $env:SANMAO_DATA_DIR 'free-relay') 'public-url.txt'
if ($script:probeCount -ne 2) { throw 'expected one failed and one successful health probe' }
if ($result.PublicUrl -ne 'https://relay-candidate.trycloudflare.com') { throw 'unexpected returned tunnel URL' }
if ((Get-Content -LiteralPath $published -Raw).Trim() -ne $result.PublicUrl) { throw 'healthy tunnel URL was not published' }
Write-Output 'PASS'
`;
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        SANMAO_RELAY_TEST_HELPER: relayHelper,
        SANMAO_RELAY_TEST_ROOT: root,
      },
    });
    assert.match(output, /PASS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS and Linux launchers publish a quick tunnel only after the health probe passes', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-relay-publish-'));
  const script = `
set -eu
DATA_ROOT="$SANMAO_RELAY_TEST_ROOT/data"
sanmao_data_dir() { printf '%s' "$DATA_ROOT"; }
. "$SANMAO_RELAY_TEST_HELPER"
free_relay_stop() { rm -f "$DATA_ROOT/free-relay/cloudflared.pid" "$DATA_ROOT/free-relay/public-url.txt"; }
free_relay_download() { printf 'cloudflared'; }
cloudflared() { printf '%s\\n' 'https://relay-candidate.trycloudflare.com'; exec sleep 30; }
free_relay_pid_is_cloudflared() { kill -0 "$1" 2>/dev/null; }
PROBE_COUNT=0
free_relay_probe() {
  candidate=$2
  if [ -f "$DATA_ROOT/free-relay/public-url.txt" ]; then
    printf '%s\\n' 'unhealthy tunnel was published before probing' >&2
    return 1
  fi
  [ "$candidate" = 'https://relay-candidate.trycloudflare.com' ] || return 1
  PROBE_COUNT=$((PROBE_COUNT + 1))
  [ "$PROBE_COUNT" -ge 2 ]
}
mkdir -p "$SANMAO_RELAY_TEST_ROOT"
free_relay_start "$SANMAO_RELAY_TEST_ROOT" 3210 > "$SANMAO_RELAY_TEST_ROOT/result.txt"
test "$PROBE_COUNT" -eq 2
test "$(cat "$DATA_ROOT/free-relay/public-url.txt")" = 'https://relay-candidate.trycloudflare.com'
test "$(cat "$SANMAO_RELAY_TEST_ROOT/result.txt")" = 'https://relay-candidate.trycloudflare.com'
kill "$CLOUDFLARED_PID" 2>/dev/null || true
wait "$CLOUDFLARED_PID" 2>/dev/null || true
printf '%s\\n' PASS
`;
  try {
    const output = execFileSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        SANMAO_RELAY_TEST_HELPER: fileURLToPath(new URL('../scripts/free-relay-common.sh', import.meta.url)),
        SANMAO_RELAY_TEST_ROOT: root,
      },
    });
    assert.match(output, /PASS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
