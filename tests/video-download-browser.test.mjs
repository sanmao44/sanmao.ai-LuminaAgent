import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const browser = createTsRequire(process.cwd())('./lib/video-download-browser');

test('默认浏览器授权会解析为 yt-dlp 支持的具体浏览器', async () => {
  assert.equal(browser.resolveVideoDownloadBrowser('default', {
    platform: 'win32',
    detectDefault: () => 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  }), 'firefox');
  assert.equal(browser.resolveVideoDownloadBrowser('default', {
    platform: 'win32',
    detectDefault: () => 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }), 'chrome');
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-default-browser-'));
  const localAppData = await mkdtemp(path.join(os.tmpdir(), 'sanmao-local-appdata-'));
  try {
    const userData = path.join(root, 'Tabbit Browser', 'User Data');
    const executable = path.join(root, 'Tabbit Browser', 'Application', 'Tabbit Browser.exe');
    await mkdir(userData, { recursive: true });
    await mkdir(path.dirname(executable), { recursive: true });
    assert.equal(browser.resolveVideoDownloadBrowser('default', {
      platform: 'win32',
      detectDefault: () => executable,
      localAppData,
    }), `chrome:${userData}`);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(localAppData, { recursive: true, force: true });
  }
});

test('安装目录之外的 Chromium profile 也能通过默认浏览器解析', async () => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), 'sanmao-custom-profile-'));
  try {
    const userData = path.join(localAppData, 'Tabbit Browser', 'User Data');
    await mkdir(userData, { recursive: true });
    assert.equal(browser.resolveVideoDownloadBrowser('default', {
      platform: 'win32',
      localAppData,
      detectDefault: () => 'E:\\软件\\Tabbit Browser\\Application\\Tabbit Browser.exe',
    }), `chrome:${userData}`);
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
});

test('无法识别默认浏览器时给出明确的浏览器选择错误', () => {
  assert.throws(
    () => browser.resolveVideoDownloadBrowser('default', { detectDefault: () => null }),
    /无法识别系统默认浏览器.*Chrome.*Edge.*Firefox/,
  );
});

test('明确浏览器名称保持原样，未知名称仍被拒绝', () => {
  assert.equal(browser.resolveVideoDownloadBrowser('edge', { detectDefault: () => null }), 'edge');
  assert.throws(() => browser.resolveVideoDownloadBrowser('unknown', { detectDefault: () => null }), /Unsupported browser session/);
});
