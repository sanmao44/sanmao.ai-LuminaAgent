import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-task-store-'));
process.env.SANMAO_DATA_DIR = dataDir;
const { load } = await buildLibModules(
  ['lib/task-store', 'lib/video-task-store', 'lib/upscale-task-store'],
  'task-store',
);
const videoStore = await load('video-task-store');
const upscaleStore = await load('upscale-task-store');
// 测试结束前别删目录，保证失败时还能看到落盘内容；node --test 退出时由临时目录清理。
test.after(() => rm(dataDir, { recursive: true, force: true }));

const videoTask = (prompt, id) => ({
  providerId: 'provider-1',
  modelId: 'model-1',
  modelName: '测试视频模型',
  operation: 'generate',
  source: 'workspace',
  status: 'pending',
  idempotencyKey: `key-${id}`,
  input: { prompt },
});

test('任务落盘格式与幂等写入保持原样', async () => {
  const created = await videoStore.createVideoTask(videoTask('第一条', 1));
  assert.equal(created.created, true);
  const again = await videoStore.createVideoTask(videoTask('重复提交', 1));
  assert.equal(again.created, false, '同一个幂等键不能重复写入');
  assert.equal(again.task.id, created.task.id);

  const raw = await readFile(path.join(dataDir, 'video-tasks.json'), 'utf8');
  assert.ok(raw.endsWith('\n'), '文件以换行结尾');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, created.task.id);
  assert.match(raw, /\n  \{\n    "providerId":/, '仍然是缩进 2 的 JSON');

  assert.equal((await videoStore.listVideoTasks(10)).length, 1);
  assert.equal(await videoStore.findVideoTask(created.task.id) !== null, true);
  assert.equal(await videoStore.findVideoTask('missing'), null);
});

test('并发写入串行化，不会互相覆盖', async () => {
  await Promise.all(Array.from({ length: 6 }, (_, index) => videoStore.createVideoTask(videoTask(`并发-${index}`, 10 + index))));
  const all = await videoStore.listVideoTasks(100);
  for (let index = 0; index < 6; index += 1) {
    assert.ok(all.some((task) => task.input.prompt === `并发-${index}`), `并发-${index} 丢失了`);
  }
});

test('分页与过滤由存储层统一计算', async () => {
  const page = await videoStore.listVideoTasksPage({ page: 1, pageSize: 2 });
  assert.equal(page.tasks.length, 2);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, Math.ceil(page.total / 2));
  assert.ok(page.tasks.every((task) => task.status));

  const overflow = await videoStore.listVideoTasksPage({ page: 999, pageSize: 2 });
  assert.equal(overflow.page, overflow.totalPages, '页码越界时收敛到最后一页');

  const searched = await videoStore.listVideoTasksPage({ search: '并发-3' });
  assert.equal(searched.total, 1);
  assert.equal(searched.tasks[0].input.prompt, '并发-3');

  const canvasOnly = await videoStore.listVideoTasksPage({ source: 'canvas' });
  assert.equal(canvasOnly.total, 0, 'source 过滤仍然生效');
});

test('更新与删除保留 id，并支持取消/重试需要的字段', async () => {
  const created = await videoStore.createVideoTask(videoTask('待取消', 30));
  const cancelledAt = new Date().toISOString();
  const cancelled = await videoStore.updateVideoTask(created.task.id, { status: 'cancelled', cancelledAt, nextPollAt: undefined });
  assert.equal(cancelled.id, created.task.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelledAt, cancelledAt);
  assert.equal((await videoStore.findVideoTask(created.task.id)).status, 'cancelled');

  const retried = await videoStore.createVideoTask(videoTask('重试', 31));
  const linked = await videoStore.updateVideoTask(retried.task.id, { retryOf: created.task.id });
  assert.equal(linked.retryOf, created.task.id);

  assert.equal(await videoStore.updateVideoTask('missing', { status: 'done' }), null);
  assert.equal(await videoStore.updateVideoTask(created.task.id, { id: 'hacked' }).then((task) => task.id), created.task.id, 'id 不能被 patch 覆盖');
  assert.equal((await videoStore.removeVideoTask(created.task.id)).id, created.task.id);
  assert.equal(await videoStore.removeVideoTask(created.task.id), null);
});

test('高清任务沿用同一套存储，并额外维护 updatedAt', async () => {
  const created = await upscaleStore.createUpscaleTask({
    provider: 'tencent-ci',
    model: 'tencent-ci-super-resolution',
    scale: 2,
    sourceImageId: 'image-1',
    reference: '/api/storage/file?name=a.png',
    status: 'processing',
    idempotencyKey: 'upscale-1',
  });
  assert.equal(created.created, true);
  const updated = await upscaleStore.updateUpscaleTask(created.task.id, { status: 'failed', error: '上游超时' });
  assert.equal(updated.status, 'failed');
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.task.updatedAt), 'updatedAt 会自动刷新');
  assert.equal(updated.reference, '/api/storage/file?name=a.png', '原图引用要留着重试用');
  assert.equal(await upscaleStore.listUpscaleTasks(5).then((tasks) => tasks.length), 1);
});

test('取消与重试接进了服务层和任务接口', async () => {
  const videoService = await readFile(new URL('../lib/video-task-service.ts', import.meta.url), 'utf8');
  const upscaleService = await readFile(new URL('../lib/upscale-service.ts', import.meta.url), 'utf8');
  const videoRoute = await readFile(new URL('../app/api/video/tasks/[id]/route.ts', import.meta.url), 'utf8');
  const upscaleRoute = await readFile(new URL('../app/api/upscale/tasks/[id]/route.ts', import.meta.url), 'utf8');

  assert.match(videoService, /export async function cancelVideoTask/);
  assert.match(videoService, /export async function retryVideoTask/);
  assert.match(videoService, /task\.status === 'done' \|\| task\.status === 'failed' \|\| task\.status === 'cancelled'/);
  assert.match(videoService, /errorCode: 'CANCELLED'/);

  assert.match(upscaleService, /export async function cancelUpscaleTask/);
  assert.match(upscaleService, /export async function retryUpscaleTask/);
  assert.match(upscaleService, /task\.status === 'succeeded' \|\| task\.status === 'failed' \|\| task\.status === 'cancelled'/);
  assert.match(upscaleService, /sourceImageId, reference, status: 'processing'/);

  for (const route of [videoRoute, upscaleRoute]) {
    assert.match(route, /export async function PATCH/);
    assert.match(route, /action !== 'cancel' && action !== 'retry'/);
    assert.match(route, /await request\.json\(\)/);
    assert.match(route, /await cancel\w+Task\(id\) : await retry\w+Task\(id\)/);
    assert.match(route, /isTrustedAppRequest\(request\)/);
  }
  assert.match(videoRoute, /先取消任务再删除/);
  assert.match(upscaleRoute, /先取消任务再删除/);
});
test('视频卡片给出停止跟踪与重试入口，取消状态也有对应文案', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const card = await readFile(new URL('../components/VideoRecordCard.tsx', import.meta.url), 'utf8');
  const studio = await readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.match(page, /method: 'PATCH'/);
  assert.match(page, /onCancel: \(\)=>patchVideoTask\(task, 'cancel'\), onRetry: \(\)=>patchVideoTask\(task, 'retry'\)/);
  assert.match(page, /setVideoTasks\(\(old\)=>old\.map\(\(item\)=>item\.id === task\.id \? data\.task : item\)\)/);
  assert.match(page, /先取消任务再删除/);

  assert.match(card, /const canCancel = task\.status === 'pending' \|\| task\.status === 'running';/);
  assert.match(card, /const canRetry = task\.status === 'failed' \|\| task\.status === 'cancelled';/);
  assert.match(card, /status === 'cancelled' \? '已取消'/);
  assert.match(card, /onCancel\?: \(\) => void \| Promise<void>;/);

  assert.match(studio, /status === 'cancelled' \? '已取消'/);
  assert.match(studio, /: task\.status === 'cancelled' \? <>/);
  assert.match(studio, /\(task\.status === 'pending' \|\| task\.status === 'running'\) && <span className="video-task-scan"/);

  assert.match(styles, /\.creative-status-pill\.cancelled\{/);
  assert.match(styles, /\.creative-video-actions \.creative-video-cancel\{/);
  assert.match(styles, /\.creative-video-actions \.creative-video-retry\{/);
});

test('生图任务卡支持停止跟踪高清放大，取消与失败分开记账', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.ok(page.includes("const UPSCALE_CANCELLED_MESSAGE = '高清任务已取消。';"));
  assert.ok(page.includes('async function cancelGenerateTask(task) {'));
  assert.ok(page.includes("if (task.mode !== 'upscale' || !task.upscaleTaskId) return notify('当前只有后台高清放大任务支持停止跟踪');"));
  assert.ok(page.includes("action: 'cancel'"), '取消请求要带 action');
  assert.ok(page.includes("if (lastData.status === 'cancelled') throw new Error(UPSCALE_CANCELLED_MESSAGE);"), '轮询遇到已取消要立刻退出');
  assert.ok(page.includes('const cancelled = message === UPSCALE_CANCELLED_MESSAGE;'));
  assert.ok(page.includes('...(cancelled ? { cancelled: true } : {})'));
  assert.ok(page.includes('if (!cancelled) registerGenerationFailure();'), '手动取消不该记成生成失败');
  assert.ok(page.includes('task.status === \'pending\' && task.mode === \'upscale\' && task.upscaleTaskId && /*#__PURE__*/ _jsx("button", {'));
  assert.ok(page.includes('className: "task-cancel-button",'));
  assert.ok(page.includes('onClick: ()=>void cancelGenerateTask(task),'));

  assert.match(styles, /\.task-cancel-button\{/);
  assert.match(styles, /\.task-cancel-button:hover\{/);
});
