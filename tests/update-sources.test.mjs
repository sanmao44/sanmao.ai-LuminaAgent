import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import ts from 'typescript';

async function loadTs(fileUrl, replacements = []) {
  let source = await readFile(fileUrl, 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: fileUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const update = await loadTs(new URL('../lib/update.ts', import.meta.url), [
  ["import packageInfo from '../package.json';", "const packageInfo = { version: '0.7.0' };"],
]);
const local = await loadTs(new URL('../lib/local-update.ts', import.meta.url), [
  ["import type { UpdateStatus } from '@/lib/update';", ''],
]);

test('completed progress is stale after the app reaches the recorded version', () => {
  assert.equal(local.isCompletedUpdateProgressStale({ stage: 'completed', version: '0.7.0' }, '0.7.2'), true);
  assert.equal(local.isCompletedUpdateProgressStale({ stage: 'completed', version: '0.7.2' }, '0.7.2'), true);
  assert.equal(local.isCompletedUpdateProgressStale({ stage: 'completed', version: '0.7.3' }, '0.7.2'), false);
  assert.equal(local.isCompletedUpdateProgressStale({ stage: 'starting', version: '0.7.0' }, '0.7.2'), false);
});

test('any non-failed progress is stale after the app reaches the recorded version', () => {
  assert.equal(local.isUpdateProgressStale({ stage: 'starting', version: '0.7.14' }, '0.7.14'), true);
  assert.equal(local.isUpdateProgressStale({ stage: 'verifying', version: '0.7.13' }, '0.7.14'), true);
  assert.equal(local.isUpdateProgressStale({ stage: 'failed', version: '0.7.13' }, '0.7.14'), false);
  assert.equal(local.isUpdateProgressStale({ stage: 'starting', version: '0.7.15' }, '0.7.14'), false);
});

test('update archives remain the single source of installed updater code', async () => {
  const [localUpdate, windowsUpdater, windowsUpdaterCore, windowsUpdaterBootstrap, launcher, progressRoute] = await Promise.all([
    readFile(new URL('../lib/local-update.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/apply-update.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/apply-update-core.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/apply-update-bootstrap.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/start.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/update/progress/route.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(localUpdate, /local-update-runtime\.ts/);
  assert.doesNotMatch(windowsUpdater, /local-update-runtime\.ts/);
  assert.doesNotMatch(windowsUpdaterCore, /local-update-runtime\.ts/);
  assert.doesNotMatch(windowsUpdaterCore, /Copy-Item\s+-LiteralPath\s+\$PSCommandPath/);
  assert.match(windowsUpdaterCore, /\$_\.FullName -ne \$PSCommandPath/);
  assert.match(windowsUpdaterCore, /if \(\$destination -eq \$PSCommandPath\) \{ return \}/);
  assert.match(windowsUpdater, /apply-update-core\.ps1/);
  assert.match(windowsUpdaterBootstrap, /apply-update-core\.ps1/);
  assert.match(launcher, /apply-update-bootstrap\.ps1/);
  assert.match(progressRoute, /getLatestUpdateProgress\(jobId, currentVersion\)/);
});

const originalFetch = globalThis.fetch;
const originalManifestUrl = process.env.SANMAO_UPDATE_MANIFEST_URL;
const originalManifestMirrors = process.env.SANMAO_UPDATE_MANIFEST_MIRRORS;
const originalPackageMirrors = process.env.SANMAO_UPDATE_MIRRORS;
const originalGithubProxies = process.env.SANMAO_UPDATE_GITHUB_PROXIES;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalManifestUrl === undefined) delete process.env.SANMAO_UPDATE_MANIFEST_URL;
  else process.env.SANMAO_UPDATE_MANIFEST_URL = originalManifestUrl;
  if (originalManifestMirrors === undefined) delete process.env.SANMAO_UPDATE_MANIFEST_MIRRORS;
  else process.env.SANMAO_UPDATE_MANIFEST_MIRRORS = originalManifestMirrors;
  if (originalPackageMirrors === undefined) delete process.env.SANMAO_UPDATE_MIRRORS;
  else process.env.SANMAO_UPDATE_MIRRORS = originalPackageMirrors;
  if (originalGithubProxies === undefined) delete process.env.SANMAO_UPDATE_GITHUB_PROXIES;
  else process.env.SANMAO_UPDATE_GITHUB_PROXIES = originalGithubProxies;
});

test('manifest candidates use GitHub first and jsDelivr second by default', () => {
  delete process.env.SANMAO_UPDATE_MANIFEST_URL;
  delete process.env.SANMAO_UPDATE_MANIFEST_MIRRORS;
  assert.deepEqual(update.manifestUrlCandidates(), [
    'https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json',
    'https://cdn.jsdelivr.net/gh/sanmao44/sanmao.ai-LuminaAgent@main/update.json',
  ]);
});

test('custom manifest URL does not derive public mirrors and keeps configured mirrors', () => {
  process.env.SANMAO_UPDATE_MANIFEST_URL = 'https://example.com/sanmao/update.json';
  process.env.SANMAO_UPDATE_MANIFEST_MIRRORS = 'https://mirror.example.com/sanmao/update.json,https://cdn.example.com/sanmao/update.json';
  assert.deepEqual(update.manifestUrlCandidates(), [
    'https://example.com/sanmao/update.json',
    'https://mirror.example.com/sanmao/update.json',
    'https://cdn.example.com/sanmao/update.json',
  ]);
});

test('manifest check falls back from a failing GitHub URL to a mirror', async () => {
  process.env.SANMAO_UPDATE_MANIFEST_URL = 'https://raw.example.test/fail.json';
  process.env.SANMAO_UPDATE_MANIFEST_MIRRORS = 'https://cdn.example.test/ok.json';
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value === 'https://raw.example.test/fail.json') {
      return new Response('not found', { status: 404 });
    }
    if (value === 'https://cdn.example.test/ok.json') {
      return new Response(JSON.stringify({
        schemaVersion: 1,
        latestVersion: '9.9.9',
        releaseUrl: 'https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/tag/v9.9.9',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  };

  const status = await update.getUpdateStatus(true);
  assert.equal(status.latestVersion, '9.9.9');
  assert.equal(status.hasUpdate, true);
  assert.deepEqual(calls, ['https://raw.example.test/fail.json', 'https://cdn.example.test/ok.json']);
});

test('manifest check returns an error status when every source fails', async () => {
  delete process.env.SANMAO_UPDATE_MANIFEST_URL;
  delete process.env.SANMAO_UPDATE_MANIFEST_MIRRORS;
  globalThis.fetch = async () => new Response('', { status: 502 });

  const status = await update.getUpdateStatus(true);
  assert.equal(status.configured, true);
  assert.ok(status.error || typeof status.latestVersion === 'string');
});

test('package sources prefer declared mirrors and cap the candidate list', () => {
  process.env.SANMAO_UPDATE_MIRRORS = 'https://mirror.example.com/sanmao/releases/download/v1/app.zip';
  process.env.SANMAO_UPDATE_GITHUB_PROXIES = 'https://proxy.example/';
  const status = {
    packageUrl: 'https://codeload.github.com/o/r/zip/refs/tags/v1.zip',
    mirrorUrls: [
      'https://gitee.com/o/r/releases/download/v1/app.zip',
      'https://oss.example.com/sanmao-v1.zip',
      'http://insecure.example.com/app.zip',
      'https://user:pass@credential.example.com/app.zip',
    ],
  };

  assert.deepEqual(local.packageSourceCandidates(status), [
    'https://gitee.com/o/r/releases/download/v1/app.zip',
    'https://oss.example.com/sanmao-v1.zip',
    'https://mirror.example.com/sanmao/releases/download/v1/app.zip',
    'https://proxy.example/https://codeload.github.com/o/r/zip/refs/tags/v1.zip',
    'https://proxy.example/https://github.com/o/r/archive/refs/tags/v1.zip',
    'https://codeload.github.com/o/r/zip/refs/tags/v1.zip',
  ]);
});

test('package download falls back to the next source and still checks SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sanmao-update-test-'));
  const destination = join(directory, 'app.zip');
  const body = 'sanmao-package-body';
  const sha256 = createHash('sha256').update(body).digest('hex');
  const attempts = [];

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://bad.example.com/app.zip') return new Response('bad', { status: 403 });
    if (value === 'https://mirror.example.com/app.zip') {
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    }
    return new Response('', { status: 404 });
  };

  try {
    const result = await local.downloadFromSources(
      ['https://bad.example.com/app.zip', 'https://mirror.example.com/app.zip'],
      destination,
      sha256,
      (index, total) => attempts.push([index, total]),
    );
    assert.equal(result.bytes, body.length);
    assert.equal(result.sha256, sha256);
    assert.ok(attempts.length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('package download rejects a mirror whose bytes do not match SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sanmao-update-test-'));
  const destination = join(directory, 'app.zip');
  const sha256 = createHash('sha256').update('expected-body').digest('hex');

  globalThis.fetch = async () => new Response('unexpected-body', { status: 200 });
  try {
    await assert.rejects(
      () => local.downloadFromSources(['https://mirror.example.com/app.zip'], destination, sha256, () => {}),
      /SHA-256/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
