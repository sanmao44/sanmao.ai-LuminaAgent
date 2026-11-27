import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { searchFilesystemText } = createTsRequire(process.cwd())('./lib/mcp/filesystem-search');

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanmao-filesystem-search-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, scope: { roots: [root], dataDir: path.join(root, 'application-data') } };
}

const search = (pathName, query, scope, options) => searchFilesystemText({ path: pathName, query }, scope, options);

test('search returns verifiable relative paths, 1-based line numbers, and source excerpts', async (t) => {
  const { root, scope } = fixture(t);
  const file = path.join(root, 'src', 'agent.ts');
  mkdirSync(path.dirname(file));
  writeFileSync(file, 'export function run() {\n  return false;\n}\nrun();\n');

  const result = await search(root, 'return false', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /src[\\/]agent\.ts:2:\s+return false;/);
  assert.match(result.text, /已检查 1 个文件/);
});

test('search enforces authorized roots and does not expose protected file contents', async (t) => {
  const { root, scope } = fixture(t);
  const outside = mkdtempSync(path.join(os.tmpdir(), 'sanmao-search-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const secret = 'SYNTHETIC_SECRET_DO_NOT_RETURN';
  const outsideFile = path.join(outside, 'outside.txt');
  writeFileSync(outsideFile, secret);
  writeFileSync(path.join(root, '.env'), secret);
  writeFileSync(path.join(root, 'id_rsa'), secret);

  const denied = await search(outsideFile, secret, scope);
  assert.equal(denied.isError, true);
  assert.match(denied.text, /不在授权文件夹里/);
  assert.doesNotMatch(denied.text, new RegExp(secret));

  const sensitive = await search(path.join(root, '.env'), secret, scope);
  assert.equal(sensitive.isError, true);
  assert.match(sensitive.text, /敏感配置文件/);
  assert.doesNotMatch(sensitive.text, new RegExp(secret));

  const scanned = await search(root, secret, scope);
  assert.equal(scanned.isError, false);
  assert.doesNotMatch(scanned.text, new RegExp(secret));
  assert.match(scanned.text, /没有找到指定文本/);
});

test('search ignores file and directory links that point outside the authorized root', async (t) => {
  const { root, scope } = fixture(t);
  const outside = mkdtempSync(path.join(os.tmpdir(), 'sanmao-search-link-target-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, 'outside.txt'), 'OUTSIDE_LINK_SENTINEL');
  try {
    symlinkSync(path.join(outside, 'outside.txt'), path.join(root, 'linked-file.txt'), 'file');
    symlinkSync(outside, path.join(root, 'linked-folder'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symbolic links are unavailable in this environment: ${error.code || error.message}`);
    return;
  }

  const result = await search(root, 'OUTSIDE_LINK_SENTINEL', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /没有找到指定文本/);
  assert.doesNotMatch(result.text, /OUTSIDE_LINK_SENTINEL/);
});

test('search stops at its file-count budget and marks the result incomplete', async (t) => {
  const { root, scope } = fixture(t);
  for (let index = 0; index < 251; index += 1) {
    writeFileSync(path.join(root, `file-${String(index).padStart(3, '0')}.txt`), 'no match here\n');
  }

  const result = await search(root, 'not-present', scope, { now: () => 0 });
  assert.equal(result.isError, false);
  assert.match(result.text, /文件数量已到搜索上限/);
  assert.match(result.text, /结果可能不完整/);
  assert.match(result.text, /已检查 250 个文件/);
});

test('search visits files in the requested folder before descending into child folders', async (t) => {
  const { root, scope } = fixture(t);
  const nested = path.join(root, 'a-sources');
  mkdirSync(nested);
  for (let index = 0; index < 250; index += 1) {
    writeFileSync(path.join(nested, `file-${index}.txt`), 'unrelated content\n');
  }
  writeFileSync(path.join(root, 'update.json'), '{\n  "search-target": true\n}\n');

  const result = await search(root, 'search-target', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /update\.json:2:\s+"search-target": true/);
  assert.match(result.text, /结果可能不完整/);
  assert.match(result.text, /缩小搜索范围/);
});

test('recursive search skips Next build output while keeping source folders and explicit build searches', async (t) => {
  const { root, scope } = fixture(t);
  const build = path.join(root, '.next-qa');
  const devBuild = path.join(root, '.next-workspace', 'dev');
  const source = path.join(root, '.next-notes');
  mkdirSync(build);
  mkdirSync(devBuild, { recursive: true });
  mkdirSync(source);
  writeFileSync(path.join(build, 'BUILD_ID'), 'sample-build\n');
  writeFileSync(path.join(build, 'build-manifest.json'), '{}\n');
  writeFileSync(path.join(devBuild, 'build-manifest.json'), '{}\n');
  writeFileSync(path.join(build, 'bundle.js'), 'SEARCH_TARGET production output\n');
  writeFileSync(path.join(devBuild, 'bundle.js'), 'SEARCH_TARGET development output\n');
  writeFileSync(path.join(source, 'BUILD_ID'), 'project source contains a similarly named file\n');
  writeFileSync(path.join(source, 'notes.md'), 'SEARCH_TARGET source note\n');
  writeFileSync(path.join(root, '.next-letter.txt'), 'SEARCH_TARGET ordinary file\n');

  const result = await search(root, 'SEARCH_TARGET', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /\.next-notes[\\/]notes\.md:1: SEARCH_TARGET source note/);
  assert.match(result.text, /\.next-letter\.txt:1: SEARCH_TARGET ordinary file/);
  assert.doesNotMatch(result.text, /bundle\.js|production output|development output/);
  assert.match(result.text, /已检查 3 个文件/);
  assert.match(result.text, /跳过 2 个 Next\.js 构建目录/);

  for (const output of [build, path.dirname(devBuild)]) {
    const explicit = await search(output, 'SEARCH_TARGET', scope);
    assert.equal(explicit.isError, false);
    assert.match(explicit.text, /bundle\.js:1: SEARCH_TARGET/);
  }
});

test('search bounds result count and identifies a partial result', async (t) => {
  const { root, scope } = fixture(t);
  writeFileSync(path.join(root, 'repeated.txt'), `${Array.from({ length: 100 }, (_, index) => `match-${index} NEEDLE`).join('\n')}\n`);

  const result = await search(root, 'NEEDLE', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /找到 80 个命中/);
  assert.match(result.text, /命中结果已到返回上限/);
  assert.match(result.text, /结果可能不完整/);
});

test('search observes cancellation and skips oversized, binary, and invalid UTF-8 files', async (t) => {
  const { root, scope } = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await search(root, 'needle', scope, { signal: controller.signal });
  assert.equal(cancelled.isError, true);
  assert.match(cancelled.text, /搜索已取消/);

  writeFileSync(path.join(root, 'oversized.txt'), Buffer.alloc(512 * 1024 + 1, 0x61));
  writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]));
  writeFileSync(path.join(root, 'invalid-utf8.txt'), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xff]));

  const result = await search(root, 'needle', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /超出大小限制/);
  assert.doesNotMatch(result.text, /binary\.dat|invalid-utf8\.txt/);
});

test('search escapes control characters in paths so they cannot forge evidence lines', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows file names cannot contain newline characters');
    return;
  }
  const { root, scope } = fixture(t);
  const file = path.join(root, 'bad\nname.txt');
  writeFileSync(file, 'MATCH_ME\n');

  const result = await search(root, 'MATCH_ME', scope);
  assert.equal(result.isError, false);
  assert.match(result.text, /bad\\u000Aname\.txt:1: MATCH_ME/);
  assert.doesNotMatch(result.text, /bad\nname\.txt:1:/);
});
