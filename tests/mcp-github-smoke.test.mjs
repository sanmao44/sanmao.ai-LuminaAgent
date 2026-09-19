import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

/**
 * 冒烟脚本（scripts/smoke-github.mjs）对着真实 GitHub 跑，这里用一个假服务顶替，
 * 验证脚本自己的判断逻辑：请求头有没有带上、只读泄漏能不能发现、写工具能不能对上写权限项。
 * 真服务连不上不在这测（那要凭据）。
 */

const GITHUB_TOOLS_READONLY = [{ name: 'get_me', annotations: { readOnlyHint: true } }];
const GITHUB_TOOLS_WRITE = [
  { name: 'get_me', annotations: { readOnlyHint: true } },
  { name: 'create_issue' },
  { name: 'some_new_write_tool' },
];

/** 假 GitHub：按 x-mcp-readonly 决定要不要过滤写工具，顺便记录收到的请求头。 */
function fakeGithub({ leakWriteTool = false } = {}) {
  const seen = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    seen.push({ method: payload.method, headers: request.headers, toolName: payload.params?.name || '' });
    const readonly = request.headers['x-mcp-readonly'] === 'true';
    const write = (result, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
    };
    if (payload.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (payload.method === 'tools/list') {
      const tools = readonly && !leakWriteTool ? GITHUB_TOOLS_READONLY : GITHUB_TOOLS_WRITE;
      return write({ tools });
    }
    if (payload.method === 'tools/call') return write({ content: [{ type: 'text', text: JSON.stringify({ login: 'sanmao-user' }) }] });
    return write({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake-github', version: '1' } });
  });
  return { server, seen };
}

async function withFakeGithub(run, options) {
  const { server, seen } = fakeGithub(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run({ url: `http://127.0.0.1:${port}/mcp`, seen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runSmoke(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/smoke-github.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_MCP_TOKEN: '', GITHUB_TOKEN: '', SANMAO_SMOKE_GITHUB_URL: '', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('没有凭据时冒烟脚本直接跳过，不算失败', async () => {
  const { code, output } = await runSmoke({});
  assert.equal(code, 0);
  assert.match(output, /跳过 GitHub 冒烟测试/);
});

test('对着假服务跑通：请求头齐全、账号读到、写工具对得上写权限项', async () => {
  await withFakeGithub(async ({ url, seen }) => {
    const { code, output } = await runSmoke({ GITHUB_MCP_TOKEN: 'fake-token-for-test', SANMAO_SMOKE_GITHUB_URL: url });
    assert.equal(code, 0, output);
    assert.match(output, /结论：通过/);
    assert.match(output, /当前账号 @sanmao-user/);
    assert.match(output, /create_issue → 创建 \/ 修改 Issue/);
    // 上游新增的写工具会被拒绝，也要在输出里点名，让人知道回去更新内置目录。
    assert.match(output, /some_new_write_tool：没有对应的写权限项/);
    // 三个官方请求头必须真的发出去：假服务就是靠 x-mcp-readonly 决定公布哪些工具。
    const toolsList = seen.filter((item) => item.method === 'tools/list');
    assert.ok(toolsList.length >= 2, '只读和放开写入各探测一次');
    for (const item of toolsList) {
      assert.equal(item.headers['x-mcp-lockdown'], 'true');
      assert.equal(item.headers['x-mcp-toolsets'], 'context,repos,issues,pull_requests');
      assert.equal(item.headers.authorization, 'Bearer fake-token-for-test');
    }
    assert.deepEqual([...new Set(toolsList.map((item) => item.headers['x-mcp-readonly']))].sort(), ['false', 'true']);
  });
});

test('只读模式下泄漏写工具要报失败', async () => {
  await withFakeGithub(async ({ url }) => {
    const { code, output } = await runSmoke({ GITHUB_MCP_TOKEN: 'fake-token-for-test', SANMAO_SMOKE_GITHUB_URL: url });
    assert.equal(code, 1);
    assert.match(output, /只读模式下仍公布了写工具/);
    assert.match(output, /结论：失败/);
  }, { leakWriteTool: true });
});