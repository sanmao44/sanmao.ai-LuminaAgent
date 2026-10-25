import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTabbitCliModule, buildToolsModule } from './tools-build.mjs';

const cli = await buildTabbitCliModule();
const { tabbitBrowserTool } = await buildToolsModule();

test('已知新网址直接以 nodejs 创建任务并运行导航程序', () => {
  const invocation = cli.buildTabbitCliInvocation({
    action: 'nodejs',
    task: 'bilibili-nav',
    requestId: 'open-bilibili',
    code: 'await page.goto("https://www.bilibili.com/"); return {url: page.url()};',
  });

  assert.deepEqual(invocation.args, [
    'nodejs', '--task', 'bilibili-nav', '--request-id', 'open-bilibili',
    '--timeout-ms', '60000',
  ]);
  assert.equal(invocation.stdin, 'await page.goto("https://www.bilibili.com/"); return {url: page.url()};');
});

test('已有标签页流程可先创建 task 再查询标签页', () => {
  const create = cli.buildTabbitCliInvocation({ action: 'create', task: 'Bilibili navigation' });
  const tabs = cli.buildTabbitCliInvocation({ action: 'tabs', task: 'Bilibili navigation' });

  assert.deepEqual(create.args, ['create', '--task', 'Bilibili navigation']);
  assert.deepEqual(tabs.args, ['tabs', '--task', 'Bilibili navigation', '--limit', '50']);
});

test('暴露给模型的 Tabbit schema 接受 create task 动作', () => {
  assert.ok(tabbitBrowserTool.schema.properties.action.enum.includes('create'));
  assert.match(tabbitBrowserTool.description, /新网址时直接用 nodejs/);
  assert.match(tabbitBrowserTool.schema.properties.requestId.description, /每个新的 nodejs 程序使用唯一 ID/);
});

test('创建任务和执行程序都拒绝缺少 task 的调用', () => {
  assert.throws(() => cli.buildTabbitCliInvocation({ action: 'create' }), /create 需要 task/);
  assert.throws(() => cli.buildTabbitCliInvocation({ action: 'nodejs', requestId: 'open-bilibili', code: 'return true;' }), /nodejs 需要 task 和 requestId/);
  assert.throws(() => cli.buildTabbitCliInvocation({ action: 'create', task: 'bad\ntask' }), /task 格式无效/);
});
