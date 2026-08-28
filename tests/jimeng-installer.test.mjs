import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const windowsInstaller = await read('scripts/install-jimeng.ps1');
const unixInstaller = await read('scripts/install-jimeng.sh');
const windowsLauncher = await read('一键安装即梦 CLI - Windows.cmd');
const macLauncher = await read('一键安装即梦 CLI - macOS.command');
const providerCard = await read('components/JimengProviderCard.tsx');

test('ships a native Windows Dreamina installer with official-source verification', () => {
  assert.match(windowsInstaller, /https:\/\/jimeng\.jianying\.com\/cli/);
  assert.match(windowsInstaller, /DOWNLOAD_BASE/);
  assert.match(windowsInstaller, /dreamina_cli_windows_amd64\.exe/);
  assert.match(windowsInstaller, /USERPROFILE.*bin/);
  assert.match(windowsInstaller, /SetEnvironmentVariable\('Path',/);
  assert.match(windowsInstaller, /--version/);
  assert.match(windowsInstaller, /Is64BitOperatingSystem/);
  assert.doesNotMatch(windowsInstaller, /Start-Process.*-Verb\s+RunAs/);
});

test('ships a macOS and Linux installer that delegates to the official platform-aware installer', () => {
  assert.match(unixInstaller, /https:\/\/jimeng\.jianying\.com\/cli/);
  assert.match(unixInstaller, /uname -s/);
  assert.match(unixInstaller, /uname -m/);
  assert.match(unixInstaller, /curl .* -o .*install\.sh/);
  assert.match(unixInstaller, /\/bin\/bash .*install\.sh/);
  assert.match(unixInstaller, /\.local\/bin\/dreamina/);
  assert.match(unixInstaller, /--version/);
  assert.match(windowsLauncher, /scripts\\install-jimeng\.ps1/);
  assert.match(macLauncher, /scripts\/install-jimeng\.sh/);
});

test('shows the bundled platform-specific installer command in the provider card', () => {
  assert.match(providerCard, /install-jimeng\.ps1/);
  assert.match(providerCard, /install-jimeng\.sh/);
  assert.match(providerCard, /navigator\.userAgent/);
  assert.match(providerCard, /一键安装即梦 CLI - Windows\.cmd/);
  assert.match(providerCard, /一键安装即梦 CLI - macOS\.command/);
  assert.match(providerCard, /复制安装命令/);
});
