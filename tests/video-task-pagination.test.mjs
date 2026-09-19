import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-pagination-'));
process.env.SANMAO_DATA_DIR = dataDir;
// 任务存储在 lib/task-store.ts 里，两个模块要一起转译后才能跑真实的读—改—写。
const { main: store } = await buildLibModules(['lib/task-store', 'lib/video-task-store'], 'video-task-store');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

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
  assert.match(page, /const DEFAULT_HISTORY_PAGE_SIZE = 12/);
  assert.match(page, /const videoTotalPages = Math\.max\(1, Math\.ceil\(videoTotal \/ pageSize\)\)/);
  assert.match(page, /pageSize: String\(pageSize\)/);
  assert.match(page, /每页 \$\{pageSize\} 项/);
  assert.match(page, /setVideoPage\(1\)/);
  assert.match(page, /className: "pagination creative-video-pagination"/);
  assert.match(page, /共 ", videoTotal, " 段 · 第 ", visibleVideoPage/);
});

test('并发轮询同一个视频任务只跑一次，避免重复下载同一段视频', async () => {
  const service = await readFile(new URL('../lib/video-task-service.ts', import.meta.url), 'utf8');
  const route = await readFile(new URL('../app/api/video/tasks/route.ts', import.meta.url), 'utf8');
  assert.match(service, /const refreshingVideoTasks = new Map<string, Promise<VideoTask \| null>>\(\);/);
  assert.match(service, /export async function refreshVideoTask\(id: string\) \{/);
  assert.match(service, /const inFlight = refreshingVideoTasks\.get\(id\);/);
  assert.match(service, /refreshingVideoTasks\.set\(id, running\);/);
  assert.match(service, /refreshingVideoTasks\.delete\(id\)/);
  assert.match(service, /async function refreshVideoTaskOnce\(id: string\) \{/, '真正干活的是内部实现');
  // 列表接口会并发刷新所有进行中的任务：单飞是它不重复下载的前提。
  assert.match(route, /result\.tasks\.map\(\(task\) => task\.status === 'pending' \|\| task\.status === 'running' \? refreshVideoTask\(task\.id\) : task\)/);
});
test('wide desktop video history uses six columns for complete 12-item rows', () => {
  assert.match(styles, /@media\(min-width:1600px\)\{\.creative-video-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}\}/);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*?\.creative-video-grid\{grid-template-columns:1fr 1fr\}/);
  assert.match(styles, /@media\(max-width:480px\)\{\.creative-video-grid\{grid-template-columns:1fr\}/);
});
