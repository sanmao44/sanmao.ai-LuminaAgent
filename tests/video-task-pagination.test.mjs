import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const storeUrl = new URL('../lib/video-task-store.ts', import.meta.url);
const storeSource = await readFile(storeUrl, 'utf8');
const storeCompiled = ts.transpileModule(storeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: storeUrl.pathname,
}).outputText;
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-pagination-'));
process.env.SANMAO_DATA_DIR = dataDir;
const store = await import(`data:text/javascript;base64,${Buffer.from(storeCompiled).toString('base64')}`);

function task(prompt, source, id) {
  return {
    providerId: 'provider-1',
    modelId: 'model-1',
    modelName: '测试视频模型',
    operation: 'generate',
    source,
    status: 'done',
    idempotencyKey: `pagination-${id}`,
    input: { prompt },
  };
}

test('video task pagination returns accurate totals and source-filtered pages', async (t) => {
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await store.createVideoTask(task('Alpha workspace', 'workspace', 1));
  await store.createVideoTask(task('Beta canvas', 'canvas', 2));
  await store.createVideoTask(task('Gamma agent', 'agent', 3));
  await store.createVideoTask(task('Delta workspace', undefined, 4));
  await store.createVideoTask(task('Epsilon canvas', 'canvas', 5));

  const firstPage = await store.listVideoTasksPage({ page: 1, pageSize: 2 });
  assert.equal(firstPage.total, 5);
  assert.equal(firstPage.totalPages, 3);
  assert.equal(firstPage.page, 1);
  assert.deepEqual(firstPage.tasks.map((item) => item.input.prompt), ['Epsilon canvas', 'Delta workspace']);

  const lastPage = await store.listVideoTasksPage({ page: 99, pageSize: 2 });
  assert.equal(lastPage.page, 3);
  assert.deepEqual(lastPage.tasks.map((item) => item.input.prompt), ['Alpha workspace']);

  const canvasPage = await store.listVideoTasksPage({ page: 1, pageSize: 12, source: 'canvas' });
  assert.equal(canvasPage.total, 2);
  assert.deepEqual(canvasPage.tasks.map((item) => item.input.prompt), ['Epsilon canvas', 'Beta canvas']);

  const workspacePage = await store.listVideoTasksPage({ page: 1, pageSize: 12, source: 'workspace' });
  assert.equal(workspacePage.total, 2);
  assert.deepEqual(workspacePage.tasks.map((item) => item.input.prompt), ['Delta workspace', 'Alpha workspace']);

  const searchedPage = await store.listVideoTasksPage({ page: 1, pageSize: 1, search: 'gamma' });
  assert.equal(searchedPage.total, 1);
  assert.equal(searchedPage.tasks[0].input.prompt, 'Gamma agent');
});

test('video task API exposes page metadata and filter parameters', async () => {
  const route = await readFile(new URL('../app/api/video/tasks/route.ts', import.meta.url), 'utf8');
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /params\.get\('page'\)/);
  assert.match(route, /params\.get\('pageSize'\) \|\| params\.get\('limit'\)/);
  assert.match(route, /search: params\.get\('search'\)/);
  assert.match(route, /source,/);
  assert.match(route, /media,/);
  assert.match(route, /return Response\.json\(\{ \.\.\.result, tasks:/);
  assert.match(page, /const videoPageSize = 14/);
  assert.match(page, /setVideoPage\(1\)/);
  assert.match(page, /className: "pagination creative-video-pagination"/);
  assert.match(page, /共 ", videoTotal, " 段 · 第 ", visibleVideoPage/);
});
