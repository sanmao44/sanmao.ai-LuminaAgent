import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApprovalModule } from './tools-build.mjs';

const approval = await buildApprovalModule();

const GATING = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false, mcpAdmin: false };

function mcpTool(name, risk, serverName = 'Playwright') {
  return {
    id: `mcp:playwright:${name}`,
    name,
    description: '假的 MCP 工具',
    schema: { type: 'object', properties: {} },
    permissions: ['network'],
    tags: ['mcp'],
    source: 'mcp',
    risk,
    gating: () => true,
    mcp: { serverId: 'playwright', serverName, toolName: name, readOnly: risk === 'read', blocked: false },
  };
}

function nativeTool(name, risk) {
  return { ...mcpTool(name, risk), id: `native:${name}`, source: 'native', mcp: undefined };
}

function pendingCall(overrides = {}) {
  return {
    callId: 'call_1',
    name: 'playwright__browser_click',
    toolId: 'mcp:playwright:browser_click',
    serverId: 'playwright',
    serverName: 'Playwright',
    toolName: 'browser_click',
    readOnly: false,
    risk: 'external_side_effect',
    reason: '这个工具会改动本机以外的数据',
    args: { element: '提交' },
    ...overrides,
  };
}

function approvalRecord(overrides = {}) {
  return {
    provider: 'deepseek',
    model: 'chat-1',
    messages: [{ role: 'user', content: '帮我提交一下' }],
    assistant: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'playwright__browser_click', arguments: '{}' } }] },
    executed: [],
    pending: [pendingCall()],
    gating: GATING,
    ...overrides,
  };
}

test('只读 MCP 工具直接执行，不需要用户确认', () => {
  const verdict = approval.assessToolApproval({ definition: mcpTool('browser_snapshot', 'read'), args: {} });
  assert.equal(verdict.required, false);
  assert.equal(verdict.risk, 'read');
});

test('内置工具的副作用都在本机，不进审批（各有各的门控）', () => {
  assert.equal(approval.assessToolApproval({ definition: nativeTool('document_generate', 'write'), args: {} }).required, false);
  assert.equal(approval.assessToolApproval({ definition: nativeTool('mcp_manage', 'dangerous'), args: {} }).required, false);
  assert.equal(approval.assessToolApproval({ definition: null, args: {} }).required, false);
});

test('浏览器点击按页面内容判风险：翻页放行，提交/删除/付款要确认', () => {
  const click = (pageText, args = { element: '按钮' }) => approval.assessToolApproval({ definition: mcpTool('browser_click', 'external_side_effect'), args, pageText });
  assert.equal(click('搜索结果 第 2 页').required, false);
  assert.equal(click('账户设置\n删除账户').required, true);
  assert.equal(click('结算页', { element: '立即付款' }).required, true);
  assert.equal(click('欢迎回来', { element: 'Sign in' }).required, false);
  assert.equal(click('', { element: 'Submit order' }).required, true);
});

test('页面文本里的英文关键词同样算数，避免只盯中文漏掉英文站点', () => {
  const verdict = approval.assessToolApproval({ definition: mcpTool('browser_type', 'external_side_effect'), args: { text: 'hi' }, pageText: 'Confirm payment' });
  assert.equal(verdict.required, true);
});

test('非浏览器动作的 MCP 写工具一律要确认，dangerous 给更重的理由', () => {
  const write = approval.assessToolApproval({ definition: mcpTool('create_issue', 'external_side_effect'), args: {}, pageText: '普通页面文本' });
  assert.equal(write.required, true);
  const dangerous = approval.assessToolApproval({ definition: mcpTool('delete_repo', 'dangerous'), args: {} });
  assert.equal(dangerous.required, true);
  assert.match(dangerous.reason, /不可逆/);
});

test('页面文本只认浏览器工具，并且只留尾部', () => {
  let text = approval.appendPageContext('', 'browser_navigate', '首页');
  text = approval.appendPageContext(text, 'create_issue', '不该进来的内容');
  assert.doesNotMatch(text, /不该进来的内容/);
  text = approval.appendPageContext(text, 'browser_snapshot', 'x'.repeat(approval.APPROVAL_PAGE_TEXT_CHARS * 2));
  assert.equal(text.length, approval.APPROVAL_PAGE_TEXT_CHARS);
});

test('待确认记录落盘后能读回，过期会被清掉', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-approval-'));
  try {
    const record = approval.createApproval(approvalRecord(), { dataDir });
    assert.match(record.id, /^apv_[a-f0-9]{32}$/);
    assert.equal(record.expiresAt - record.createdAt, approval.APPROVAL_TTL_MS);
    const read = approval.readApproval(record.id, { dataDir });
    assert.equal(read.id, record.id);
    assert.equal(read.pending[0].toolName, 'browser_click');

    // 反复读取不应该消耗记录：只有用户点了「允许」才销毁。
    assert.equal(approval.readApproval(record.id, { dataDir }).id, record.id);

    const file = path.join(dataDir, 'agent', 'approvals', `${record.id}.json`);
    writeFileSync(file, `${JSON.stringify({ ...record, expiresAt: Date.now() - 1 })}\n`, 'utf8');
    assert.equal(approval.readApproval(record.id, { dataDir }), null);
    assert.equal(existsSync(file), false, '过期记录要被删掉，不能留在磁盘上');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('认领是原子的：连点两下「允许」只会拿到一次执行权', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-claim-'));
  try {
    const record = approval.createApproval(approvalRecord(), { dataDir });
    const first = approval.claimApproval(record.id, { dataDir });
    assert.equal(first.id, record.id);
    assert.equal(approval.claimApproval(record.id, { dataDir }), null, '第二次认领必须失败，否则写操作会被执行两遍');
    assert.equal(approval.readApproval(record.id, { dataDir }), null);
    const leftovers = readdirSync(path.join(dataDir, 'agent', 'approvals'));
    assert.deepEqual(leftovers, [], '认领即销毁，磁盘上不该留下可复用的记录');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('伪造或过期的 approval id 一律拿不到执行权', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-forged-'));
  try {
    assert.equal(approval.claimApproval('apv_ffffffffffffffffffffffffffffffff', { dataDir }), null);
    assert.equal(approval.claimApproval('../../etc/passwd', { dataDir }), null);
    assert.equal(approval.claimApproval('', { dataDir }), null);
    assert.equal(approval.readApproval('apv_ffffffffffffffffffffffffffffffff', { dataDir }), null);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('超长对话不进磁盘：宁可拒绝这次调用', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-long-'));
  try {
    assert.throws(() => approval.createApproval(approvalRecord({ messages: [{ role: 'user', content: 'y'.repeat(approval.APPROVAL_MAX_STORED_CHARS) }] }), { dataDir }), /太长/);
    const dir = path.join(dataDir, 'agent', 'approvals');
    assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pruneApprovals 清掉过期记录和认领残留', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-prune-'));
  try {
    const record = approval.createApproval(approvalRecord(), { dataDir });
    const dir = path.join(dataDir, 'agent', 'approvals');
    const file = path.join(dir, `${record.id}.json`);
    writeFileSync(file, `${JSON.stringify({ ...record, expiresAt: Date.now() - 1 })}\n`, 'utf8');
    const stale = path.join(dir, 'apv_deadbeefdeadbeefdeadbeefdeadbeef.json.claimed');
    writeFileSync(stale, '{}\n', 'utf8');
    const aged = (Date.now() - approval.APPROVAL_TTL_MS * 2) / 1000;
    utimesSync(stale, aged, aged);
    const before = readdirSync(dir).length;
    assert.equal(before, 2);
    assert.ok(approval.pruneApprovals({ dataDir }) >= 1);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('面板摘要说清谁、做什么、参数长什么样', () => {
  assert.deepEqual(approval.describePendingCall(pendingCall()), {
    id: 'call_1',
    server: 'Playwright',
    tool: 'browser_click',
    risk: 'external_side_effect',
    reason: '这个工具会改动本机以外的数据',
    argsPreview: '{"element":"提交"}',
  });
  assert.equal(approval.describePendingCall(pendingCall({ args: {} })).argsPreview, '');
  const longArgs = approval.describePendingCall(pendingCall({ args: { text: 'x'.repeat(400) } }));
  assert.ok(longArgs.argsPreview.length <= 200);
});

test('一句确认说明覆盖单条与多条，措辞前后一致', () => {
  const single = approval.approvalMessageFor([pendingCall()]);
  assert.match(single, /Playwright · browser_click/);
  const many = approval.approvalMessageFor([pendingCall(), pendingCall({ callId: 'call_2' })]);
  assert.match(many, /2 个调用/);
  assert.match(approval.approvalMessageFor([]), /需要你确认/);
});

test('删除记录后读不到，也不会碰到别的记录', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-delete-'));
  try {
    const record = approval.createApproval(approvalRecord(), { dataDir });
    const other = approval.createApproval(approvalRecord(), { dataDir });
    assert.equal(approval.deleteApproval(record.id, { dataDir }), true);
    assert.equal(approval.readApproval(record.id, { dataDir }), null);
    assert.equal(approval.readApproval(other.id, { dataDir }).id, other.id, '删一条不能影响别的记录');
    assert.equal(approval.deleteApproval('apv_00000000000000000000000000000000', { dataDir }), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});