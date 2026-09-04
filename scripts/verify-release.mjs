#!/usr/bin/env node
// SANMAO.AI 发布校验脚本
// 用法：
//   node scripts/verify-release.mjs --file SANMAO.AI-0.7.26.zip --write
//   node scripts/verify-release.mjs --file SANMAO.AI-0.7.26.zip              # 只校验
//   node scripts/verify-release.mjs --file SANMAO.AI-0.7.26.zip --repo sanmao44/sanmao.ai-LuminaAgent --tag v0.7.26
//
// 作用：
//   1. 计算发布 zip 的 SHA-256。
//   2. 与 update.json 中记录的 sha256 对比，避免把“手抄错”的校验值发布出去。
//   3. 可选：通过 GitHub API 交叉核对 Release 资产 digest。
//   4. 可选：--write 把正确的 SHA-256 写回 update.json。
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

function usage() {
  console.log('用法: node scripts/verify-release.mjs --file <zip路径> [--write] [--repo <owner/repo>] [--tag <vX.Y.Z>]');
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const hasFlag = (name) => process.argv.includes(name);
const filePath = argValue('--file');
if (!filePath) { usage(); process.exit(1); }
if (!existsSync(filePath)) { console.error('找不到压缩包: ' + filePath); process.exit(1); }

const fileHash = createHash('sha256');
const stream = createReadStream(filePath);
await new Promise((resolve, reject) => {
  stream.on('data', (chunk) => fileHash.update(chunk));
  stream.on('end', resolve);
  stream.on('error', reject);
});
const actualSha256 = fileHash.digest('hex');
const size = statSync(filePath).size;

const manifestPath = join(process.cwd(), 'update.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedSha256 = (manifest.sha256 || '').toLowerCase();

console.log('---------------------------------------------------------------');
console.log('文件      : ' + basename(filePath));
console.log('大小      : ' + (size / (1024 * 1024)).toFixed(2) + ' MB');
console.log('实际 SHA-256: ' + actualSha256);
console.log('update.json: ' + (expectedSha256 || '(未填写)'));
console.log('---------------------------------------------------------------');

let mismatch = false;
if (!expectedSha256) {
  console.log('⚠ update.json 未记录 sha256，请确认版本号与文件名一致。');
  mismatch = true;
} else if (actualSha256 !== expectedSha256) {
  console.log('✗ 校验不通过：update.json 的 SHA-256 与实际压缩包不一致！');
  console.log('  发布前必须修正，否则用户端会一直提示“SHA-256 校验失败”。');
  mismatch = true;
} else {
  console.log('✓ update.json 的 SHA-256 与该压缩包一致。');
}

const repo = argValue('--repo');
const tag = argValue('--tag');
if (repo && tag) {
  try {
    const apiUrl = 'https://api.github.com/repos/' + repo + '/releases/tags/' + tag;
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'SANMAO.AI release verify' } });
    if (response.ok) {
      const release = await response.json();
      const asset = (release.assets || []).find((item) => item.name === basename(filePath));
      if (asset) {
        const digest = String(asset.digest || '');
        const githubHash = digest.startsWith('sha256:') ? digest.slice(7).toLowerCase() : digest.toLowerCase();
        console.log('GitHub digest : ' + githubHash);
        if (githubHash && githubHash !== actualSha256) {
          console.log('✗ GitHub Release 上的资产 digest 与本地压缩包不一致（请确认上传的是同一个文件）。');
          mismatch = true;
        } else if (githubHash) {
          console.log('✓ 与 GitHub Release 资产 digest 一致。');
        }
      } else {
        console.log('⚠ GitHub Release 未找到资产 ' + basename(filePath) + '（可能还没上传，需重新上传）。');
        mismatch = true;
      }
    } else {
      console.log('⚠ 无法读取 GitHub Release（HTTP ' + response.status + '），跳过 API 交叉核对。');
    }
  } catch {
    console.log('⚠ 网络异常，跳过 GitHub API 交叉核对。');
  }
}

if (hasFlag('--write')) {
  manifest.sha256 = actualSha256;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已把正确 SHA-256 写回 update.json。');
}

process.exitCode = mismatch ? 1 : 0;
