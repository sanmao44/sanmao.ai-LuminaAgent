/**
 * 浏览器下载 → Artifact。
 *
 * 这一环决定「下载的文件能不能在聊天里点开」：二进制必须留在服务端（靠 artifactId 取件），
 * 只把文件卡片需要的元数据交给前端。测试跑真实的 artifact store，落到临时目录里。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactStoreModule, buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const { createArtifactStore } = await buildArtifactStoreModule();

async function withTemp(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-browser-dl-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 造一个下载目录 + 一次性 artifact store：store 落在临时目录，不碰真实数据目录。 */
async function withScene(run) {
  await withTemp(async (base) => {
    const dataDir = path.join(base, 'data');
    const dir = mcp.resolveBrowserDownloadDir({ dataDir });
    await mkdir(dir, { recursive: true });
    const store = createArtifactStore({ root: path.join(base, 'artifacts'), cleanup: false });
    mcp.resetBrowserArtifactImports();
    return run({ base, dataDir, dir, store });
  });
}

function touch(file, at) {
  return utimes(file, new Date(at), new Date(at));
}

test('收件目录必须和浏览器启动参数里的 --output-dir 是同一个', async () => {
  assert.equal(mcp.resolveBrowserDownloadDir({ dataDir: path.join('C:', 'x') }), path.join('C:', 'x', 'browser', 'downloads'));
});

test('新文件收成 artifact：旧文件、半成品、临时目录和超大文件都不收', async () => {
  await withScene(async ({ dataDir, dir, store }) => {
    const now = Date.now();
    await writeFile(path.join(dir, 'report.pdf'), 'PDF-BYTES');
    await writeFile(path.join(dir, 'old.pdf'), 'OLD');
    await writeFile(path.join(dir, 'partial.crdownload'), 'X');
    await writeFile(path.join(dir, 'huge.bin'), Buffer.alloc(33 * 1024 * 1024));
    await mkdir(path.join(dir, '.playwright-artifacts-abc'), { recursive: true });
    await writeFile(path.join(dir, '.playwright-artifacts-abc', 'tmp.bin'), 'X');
    for (const name of ['report.pdf', 'partial.crdownload', 'huge.bin']) await touch(path.join(dir, name), now);
    await touch(path.join(dir, 'old.pdf'), now - 60_000);
    await touch(path.join(dir, '.playwright-artifacts-abc', 'tmp.bin'), now);

    const imported = await mcp.importBrowserArtifacts({ dataDir, since: now - 1_000, store });
    assert.equal(imported.files.length, 1);
    assert.equal(imported.files[0].name, 'report.pdf');
    assert.equal(imported.files[0].mimeType, 'application/pdf');
    assert.equal(imported.skipped, 1, '超大文件算跳过，不算失败');
    assert.match(imported.files[0].downloadUrl, /^\/api\/artifacts\/[0-9a-f-]{36}$/);

    // 取件走 id：内容原样留在服务端。
    const stored = await store.read(imported.files[0].artifactId);
    assert.ok(stored, 'artifact 要真的落盘');
    assert.equal(stored.descriptor.kind, 'file');
    assert.equal(await readFile(stored.filePath, 'utf8'), 'PDF-BYTES');
    // 扩展名不认识的按原样收下，mimeType 兜底成二进制。
    await writeFile(path.join(dir, 'data.unknown-ext'), 'RAW');
    await touch(path.join(dir, 'data.unknown-ext'), now);
    const second = await mcp.importBrowserArtifacts({ dataDir, since: now - 1_000, store });
    assert.equal(second.files.length, 1);
    assert.equal(second.files[0].mimeType, 'application/octet-stream');
  });
});

test('同一份文件只收一次；上一轮的旧文件不会重复冒出来', async () => {
  await withScene(async ({ dataDir, dir, store }) => {
    const now = Date.now();
    await writeFile(path.join(dir, 'once.pdf'), 'ONCE');
    await touch(path.join(dir, 'once.pdf'), now);
    const first = await mcp.importBrowserArtifacts({ dataDir, since: now - 1_000, store });
    assert.equal(first.files.length, 1);
    const again = await mcp.importBrowserArtifacts({ dataDir, since: now - 1_000, store });
    assert.equal(again.files.length, 0, '同一轮里重复扫描不该产生第二份 artifact');
    // 下一轮：since 往后推，旧文件天然被排除。
    const nextTurn = await mcp.importBrowserArtifacts({ dataDir, since: now + 5_000, store });
    assert.equal(nextTurn.files.length, 0);
  });
});

test('浏览器条目被调用时才导入：其他服务与失败调用都不碰下载目录', () => {
  assert.match(
    agentRouteSource,
    /if \(!result\.isError && server\.catalogId === 'playwright'\) \{/,
  );
  assert.match(agentRouteSource, /generatedFiles\.push\(\.\.\.downloaded\.files\);/);
  assert.match(agentRouteSource, /importBrowserArtifacts\(\{ since: agentTurnStartedAt/);
});

test(`Playwright 自己的会话产物不算用户下载：快照与控制台日志都不收`, async () => {
  await withScene(async ({ dataDir, dir, store }) => {
    const now = Date.now();
    // 每开一个页面 Playwright MCP 就往 --output-dir 写一份 page-*.yml 与 console-*.log，
    // 和用户下载共用同一个目录；收进聊天会凭空多出两张卡片。
    for (const name of ["page-2026-09-19T16-39-03-417Z.yml", "console-2026-09-19T16-39-01-864Z.log"]) {
      await writeFile(path.join(dir, name), "SESSION");
      await touch(path.join(dir, name), now);
    }
    // 用户真下载的文件照收，别把过滤做成一刀切。
    await writeFile(path.join(dir, "user-report.pdf"), "PDF");
    await touch(path.join(dir, "user-report.pdf"), now);

    const imported = await mcp.importBrowserArtifacts({ dataDir, since: now - 1_000, store });
    assert.deepEqual(imported.files.map((file) => file.name), ["user-report.pdf"]);
    assert.equal(imported.skipped, 0, "会话产物是直接跳过，不算收失败");
  });
});

const agentRouteSource = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');