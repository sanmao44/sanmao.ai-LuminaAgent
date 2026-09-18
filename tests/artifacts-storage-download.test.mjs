import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(options, run) {
  const root = options.root || await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-store-'));
  const store = artifacts.createArtifactStore({ ...options, root });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('id 与文件名校验挡住路径穿越、Windows 保留名和控制字符', () => {
  for (const bad of ['../../etc/passwd', 'abc', '', '..', 'f62946c2-fea9-40fb-9102', 'f62946c2-fea9-40fb-9102-b896f8a8ea5b/../x']) {
    assert.equal(artifacts.isValidArtifactId(bad), false, `${bad} 不应通过校验`);
  }
  assert.equal(artifacts.isValidArtifactId('f62946c2-fea9-40fb-9102-b896f8a8ea5b'), true);

  assert.equal(artifacts.sanitizeArtifactFileName('../../evil.docx'), 'evil.docx');
  assert.equal(artifacts.sanitizeArtifactFileName('C:\\Windows\\win.ini'), 'win.ini');
  assert.equal(artifacts.sanitizeArtifactFileName('CON.docx'), '_CON.docx');
  assert.equal(artifacts.sanitizeArtifactFileName('report\u0000\u001f.docx'), 'report.docx');
  assert.equal(artifacts.sanitizeArtifactFileName('..'), 'artifact');
  assert.ok(artifacts.sanitizeArtifactFileName(`${'长'.repeat(300)}.docx`).length <= 120);
});

test('保存后可以按 id 读回，usage 反映文件数与体积', async () => {
  await withStore({ cleanup: false }, async (store) => {
    const saved = await store.save({ kind: 'document', name: '报告.docx', data: Buffer.from('hello') });
    assert.equal(saved.size, 5);

    const stored = await store.read(saved.id);
    assert.equal(stored.descriptor.name, '报告.docx');
    assert.ok(stored.filePath.startsWith(store.root));

    assert.equal(await store.read('not-a-uuid'), null);
    assert.equal(await store.read('f62946c2-fea9-40fb-9102-b896f8a8ea5b'), null);

    const usage = await store.usage();
    assert.equal(usage.files, 1);
    assert.equal(usage.bytes, 5);
  });
});

test('超过 TTL 的 artifact 会被清理，受保护的文件不会', async () => {
  let clock = Date.parse('2026-09-19T00:00:00Z');
  await withStore({ cleanup: false, now: () => clock }, async (store) => {
    const old = await store.save({ kind: 'document', name: '旧.docx', data: Buffer.from('old') });
    clock += 8 * 24 * 60 * 60 * 1000;
    const fresh = await store.save({ kind: 'document', name: '新.docx', data: Buffer.from('new') });

    const result = await store.cleanup({ protect: [fresh.id] });
    assert.equal(result.removed, 1);
    assert.equal(await store.read(old.id), null);
    assert.ok(await store.read(fresh.id));
  });
});

test('超过容量上限时按时间从旧到新清理', async () => {
  let clock = Date.parse('2026-09-19T00:00:00Z');
  await withStore({ cleanup: false, now: () => clock }, async (store) => {
    const first = await store.save({ kind: 'document', name: 'a.docx', data: Buffer.alloc(10) });
    clock += 1000;
    const second = await store.save({ kind: 'document', name: 'b.docx', data: Buffer.alloc(10) });
    clock += 1000;
    const third = await store.save({ kind: 'document', name: 'c.docx', data: Buffer.alloc(10) });

    const result = await store.cleanup({ maxTotalBytes: 25, protect: [third.id] });
    assert.equal(result.bytes, 20);
    assert.equal(await store.read(first.id), null);
    assert.ok(await store.read(second.id));
    assert.ok(await store.read(third.id));
  });
});

test('下载接口：非法 id 400、缺失 404、命中时返回正确响应头', async () => {
  await withStore({ cleanup: false }, async (store) => {
    assert.equal((await artifacts.buildArtifactResponse('../../etc/passwd', store)).status, 400);
    assert.equal((await artifacts.buildArtifactResponse('f62946c2-fea9-40fb-9102-b896f8a8ea5b', store)).status, 404);

    const saved = await store.save({
      kind: 'document',
      name: '季度报告.docx',
      data: Buffer.from('内容'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const response = await artifacts.buildArtifactResponse(saved.id, store);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(response.headers.get('Content-Length'), '6');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const disposition = response.headers.get('Content-Disposition');
    assert.ok(disposition.startsWith('attachment;'));
    assert.ok(disposition.includes(`filename*=UTF-8''${encodeURIComponent('季度报告.docx')}`), disposition);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'), '内容');
  });
});
