#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

function versionParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function extractVersion(value) {
  const match = String(value || '').match(/(?:^|[\/_-])v?(\d+\.\d+\.\d+)(?=$|[\/_ .-])/i);
  return match ? match[1] : '';
}

function validHttpsUrl(value) {
  try {
    return new URL(String(value || '')).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '')) && !/^0{64}$/i.test(String(value || ''));
}

export function validateUpdateManifest(raw, { currentVersion = '', strict = false } = {}) {
  const manifest = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const latestVersion = String(manifest.latestVersion || '').trim();
  const packageUrl = String(manifest.packageUrl || '').trim();
  const hasUpdate = currentVersion && latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : true;

  if (manifest.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!latestVersion) errors.push('latestVersion 缺失');
  if (!validHttpsUrl(manifest.releaseUrl)) errors.push('releaseUrl 必须是 HTTPS 地址');
  if (packageUrl && !validHttpsUrl(packageUrl)) errors.push('packageUrl 必须是 HTTPS 地址');

  if (strict && currentVersion && latestVersion && compareVersions(latestVersion, currentVersion) !== 0) {
    errors.push(`latestVersion (${latestVersion}) 必须与 package.json (${currentVersion}) 一致`);
  }
  const releaseVersion = extractVersion(manifest.releaseUrl);
  const packageVersion = extractVersion(packageUrl);
  if (releaseVersion && latestVersion && releaseVersion !== latestVersion) errors.push('releaseUrl 的版本与 latestVersion 不一致');
  if (packageVersion && latestVersion && packageVersion !== latestVersion) errors.push('packageUrl 的版本与 latestVersion 不一致');

  const checksumRequired = strict || Boolean(packageUrl) || hasUpdate;
  if (checksumRequired && !packageUrl) errors.push('packageUrl 缺失');
  if (checksumRequired && !validSha256(manifest.sha256)) errors.push('sha256 必须是非全零的 64 位十六进制值');

  return errors;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifestArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const manifestPath = manifestArgument ? resolve(manifestArgument) : join(root, 'update.json');
  const packagePath = join(root, 'package.json');
  let manifest;
  let packageInfo;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    packageInfo = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    console.error(`无法读取更新清单或 package.json：${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    return;
  }

  const errors = validateUpdateManifest(manifest, {
    currentVersion: packageInfo.version,
    strict: process.argv.includes('--strict'),
  });
  if (errors.length) {
    console.error(`更新清单校验失败：${manifestPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`更新清单校验通过：v${manifest.latestVersion}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
