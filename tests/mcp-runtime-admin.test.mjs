import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMcpModule, buildToolsModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const tools = await buildToolsModule();

const GATING = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false, mcpAdmin: false };
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'sanmao-runtime-'));

test('本地运行时管理只接受显式动作，安装不在对话动作中', async () => {
  assert.equal(mcp.isMcpRuntimeAction('runtime_install'), false);
  assert.equal(mcp.isMcpRuntimeAction('runtime_status'), true);
  const dir = tempDir();
  await assert.rejects(() => mcp.runMcpRuntimeAction('runtime_install', { dataDir: dir }), /不支持的运行时动作/);
});

test('runtime_status 是只读的，能报出本机运行时的安装与运行状态', async () => {
  const dir = tempDir();
  try {
    const outcome = await mcp.runMcpRuntimeAction('runtime_status', { dataDir: dir });
    assert.equal(outcome.readOnly, true);
    assert.equal(outcome.result.ok, true);
    const [runtime] = outcome.result.runtimes;
    assert.equal(runtime.id, 'playwright');
    assert.equal(runtime.installed, false);
    assert.equal(runtime.running, false);
    assert.ok(String(outcome.result.note).includes('面板'), '要告诉用户安装只能去面板点');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('用户没明确要求时，启动和关闭本地运行时都被拒绝', async () => {
  const dir = tempDir();
  try {
    await assert.rejects(
      () => mcp.runMcpRuntimeAction('runtime_start', { dataDir: dir, instruction: '帮我用浏览器查一下今天的新闻' }),
      /没有明确要求启动/,
    );
    await assert.rejects(
      () => mcp.runMcpRuntimeAction('runtime_stop', { dataDir: dir, instruction: '看看我 github 上的仓库' }),
      /没有明确要求关闭/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已经明确要求、但还没安装时，让用户去面板点安装，而不是助手自己装', async () => {
  const dir = tempDir();
  try {
    await assert.rejects(
      () => mcp.runMcpRuntimeAction('runtime_start', { dataDir: dir, instruction: '帮我启动浏览器运行时' }),
      /还没安装/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('未知动作和未知条目都挡住，不给模型留拼错就执行的口子', async () => {
  await assert.rejects(() => mcp.runMcpRuntimeAction('runtime_install', {}), /不支持的运行时动作/);
  await assert.rejects(
    () => mcp.runMcpRuntimeAction('runtime_start', { id: 'not-a-real-entry', instruction: '启动浏览器运行时' }),
    /未知的本地服务/,
  );
  assert.equal(mcp.isMcpRuntimeAction('runtime_status'), true);
  assert.equal(mcp.isMcpRuntimeAction('install'), false);
});

test('「浏览器控制装了吗」这类问法会把管理工具下发给模型', () => {
  const names = (context) => tools.toolSchemasFor(context).map((tool) => tool.function.name);
  assert.equal(names(GATING).includes('mcp_manage'), false);
  assert.equal(names({ ...GATING, mcpAdmin: true }).includes('mcp_manage'), true);
});
