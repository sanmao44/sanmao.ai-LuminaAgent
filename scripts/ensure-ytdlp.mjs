#!/usr/bin/env node
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function flag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveDataDir() {
  const explicit = argument('--data-dir') || String(process.env.SANMAO_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  if (flag(process.env.SANMAO_PORTABLE) || String(process.env.SANMAO_DATA_MODE || '').trim().toLowerCase() === 'portable') return path.resolve('data');
  if (String(process.env.SANMAO_INSTALL_MODE || '').trim().toLowerCase() === 'installed' || flag(process.env.SANMAO_INSTALLED)) {
    if (process.platform === 'win32') {
      return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SANMAO.AI');
    }
    // Keep the bootstrapper aligned with launcher-common.sh and
    // lib/data-paths.ts. XDG_DATA_HOME is commonly customized on Linux;
    // ignoring it would make the launcher download yt-dlp into one directory
    // while the server later searches another one.
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'SANMAO.AI');
  }
  return path.resolve('.data');
}

function asset() {
  if (process.platform === 'win32') return { name: 'yt-dlp.exe', asset: 'yt-dlp.exe' };
  if (process.platform === 'darwin') return { name: 'yt-dlp', asset: 'yt-dlp_macos' };
  // The upstream Linux release publishes separate x64 and ARM64 binaries.
  // Keep the generic Linux asset for other architectures; yt-dlp's release
  // will return a useful error instead of silently installing the wrong binary.
  const assetName = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return { name: 'yt-dlp', asset: assetName };
}

function downloadUrls() {
  const selected = asset();
  const explicit = String(process.env.SANMAO_YTDLP_DOWNLOAD_URL || '').trim();
  const official = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${selected.asset}`;
  const configuredMirror = String(process.env.SANMAO_YTDLP_MIRROR_URL || '').trim();
  const urls = [];
  if (explicit) urls.push(explicit);
  if (configuredMirror) urls.push(`${configuredMirror.replace(/\/$/, '')}/${selected.asset}`);
  urls.push(official);
  urls.push(`https://ghfast.top/${official}`);
  urls.push(`https://gh-proxy.com/${official}`);
  return [...new Set(urls)];
}

function run(command, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function binaryVersion(target, runProcess = run) {
  try {
    const details = await stat(target);
    if (!details.isFile() || details.size <= 1024 * 1024) return '';
    const result = await runProcess(target, ['--version'], 10000);
    return result.exitCode === 0 ? result.stdout.match(/^\d{4}\.\d+(?:\.\d+)?/m)?.[0] || '' : '';
  } catch {
    return '';
  }
}

async function readUpdateCheckTime(filePath) {
  try {
    const metadata = JSON.parse(await readFile(filePath, 'utf8'));
    return Number.isFinite(metadata.checkedAt) ? metadata.checkedAt : 0;
  } catch {
    return 0;
  }
}

async function recordUpdateCheck(filePath, checkedAt) {
  try {
    await writeFile(filePath, JSON.stringify({ checkedAt }), 'utf8');
  } catch {
    // A cache write must not make an existing downloader unavailable.
  }
}

async function updateInstalledBinary(target, toolsDirectory, currentVersion, options) {
  const checkFile = path.join(toolsDirectory, 'yt-dlp-update-check.json');
  const now = options.now();
  const lastCheckedAt = await readUpdateCheckTime(checkFile);
  const checkIsRecent = Number.isFinite(lastCheckedAt)
    && lastCheckedAt <= now
    && now - lastCheckedAt < options.updateIntervalMs;
  if (checkIsRecent && !options.forceUpdate) return currentVersion;

  try {
    await options.runProcess(target, ['-U'], 30000);
  } catch {
    // A network or updater failure should leave a working local binary usable.
  }
  await recordUpdateCheck(checkFile, now);

  const updatedVersion = await binaryVersion(target, options.runProcess);
  if (!updatedVersion) return '';
  if (updatedVersion !== currentVersion && !options.quiet) {
    console.log(`yt-dlp 已从 ${currentVersion} 更新到 ${updatedVersion}`);
  }
  return updatedVersion;
}

async function installFromPython(runProcess = run) {
  // A Python installation is optional, but using it as a last-resort fallback
  // makes first launch work on networks that block GitHub. The adapter already
  // knows the per-user Scripts/bin locations used by these commands.
  const candidates = process.platform === 'win32'
    ? [['py', ['-3', '-m', 'pip', 'install', '--user', '--disable-pip-version-check', '-U', 'yt-dlp']], ['python', ['-m', 'pip', 'install', '--user', '--disable-pip-version-check', '-U', 'yt-dlp']]]
    : [['python3', ['-m', 'pip', 'install', '--user', '--disable-pip-version-check', '-U', 'yt-dlp']], ['python', ['-m', 'pip', 'install', '--user', '--disable-pip-version-check', '-U', 'yt-dlp']]];
  for (const [command, args] of candidates) {
    try {
      const result = await runProcess(command, args, 120000);
      if (result.exitCode === 0) {
        const versionArgs = command === 'py' ? ['-3', '-m', 'yt_dlp', '--version'] : ['-m', 'yt_dlp', '--version'];
        const version = await runProcess(command, versionArgs, 15000).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
        if (version.exitCode === 0 && /^\d{4}\.\d+/m.test(version.stdout)) return true;
      }
    } catch {
      // Python is optional. Try the next launcher and leave the final error to
      // the caller, which reports the network/manual recovery path.
    }
  }
  return false;
}

export async function ensureYtDlp(options = {}) {
  const dataDir = options.dataDir || resolveDataDir();
  const quiet = options.quiet ?? process.argv.includes('--quiet');
  const target = path.join(dataDir, 'tools', asset().name);
  const toolsDirectory = path.dirname(target);
  const runProcess = options.runProcess || run;
  const now = options.now || Date.now;
  const updateIntervalMs = options.updateIntervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  const forceUpdate = options.forceUpdate ?? process.argv.includes('--force-update');
  const currentVersion = await binaryVersion(target, runProcess);
  if (currentVersion) {
    const readyVersion = await updateInstalledBinary(target, toolsDirectory, currentVersion, {
      forceUpdate,
      now,
      quiet,
      runProcess,
      updateIntervalMs,
    });
    if (readyVersion) {
      if (!quiet) console.log(`yt-dlp 已就绪：${target}`);
      return true;
    }
  }
  // Remove a stale or truncated app-owned binary before trying to replace it;
  // otherwise a failed bootstrap could make the adapter select the bad file on
  // the next request instead of retrying the download.
  if (existsSync(target)) await rm(target, { force: true }).catch(() => undefined);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const partial = `${target}.partial-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`;
  let lastError = new Error('没有可用的 yt-dlp 下载源');
  try {
    for (const url of downloadUrls()) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(45000),
            headers: { 'user-agent': 'SANMAO.AI yt-dlp bootstrap' },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 1024 * 1024) throw new Error('下载文件过小');
          await writeFile(partial, bytes, { flag: 'w' });
          if (process.platform !== 'win32') await chmod(partial, 0o755);
          if (!(await binaryVersion(partial, runProcess))) throw new Error('下载的 yt-dlp 文件无法运行');
          // Replace a stale/corrupt file only after the new artifact has passed
          // its version probe. This also avoids Windows rename failures when a
          // previous interrupted launch left the destination behind.
          await rm(target, { force: true });
          await rename(partial, target);
          if (!quiet) console.log(`yt-dlp 已自动准备：${target}`);
          return true;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          await rm(partial, { force: true }).catch(() => undefined);
          if (attempt < 3) await sleep(attempt * 1000);
        }
      }
    }
    if (await installFromPython(runProcess)) {
      if (!quiet) console.log('yt-dlp 已通过 Python 用户环境准备。');
      return true;
    }
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
  }
  await rm(partial, { force: true }).catch(() => undefined);
  if (!quiet) console.error(`yt-dlp 自动准备失败：${lastError.message}`);
  process.exitCode = 1;
  return false;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && import.meta.url === invokedPath) await ensureYtDlp();
