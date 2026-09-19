import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

/**
 * 审批档位（三档）：always 每次确认 / trusted 标准信任（默认）/ full 完全访问。
 * 这里是「打开网页要不要点允许」的回归护栏：Playwright 把 browser_navigate 标成写入类，
 * 按风险等级一刀切的话，用户每开一个页面都要点一次，而截图反而不问。
 */

test('标准信任档：导航、切标签这类只改变「看什么」的动作不再打扰用户', () => {
  const navigate = { definition: mcpTool('browser_navigate', 'external_side_effect'), args: { url: 'https://www.bilibili.com' } };
  assert.equal(approval.assessToolApproval({ ...navigate, policy: 'trusted' }).required, false);
  // 不传档位等于默认档：升级上来的老用户走的就是这条。
  assert.equal(approval.assessToolApproval(navigate).required, false);
  assert.equal(approval.assessToolApproval({ ...navigate, policy: 'always' }).required, true, '每次确认档下打开网页仍然要问');
  for (const toolName of ['browser_navigate_back', 'browser_reload', 'browser_tabs', 'browser_resize', 'browser_hover', 'browser_wait_for']) {
    const definition = mcpTool(toolName, 'external_side_effect');
    assert.equal(approval.assessToolApproval({ definition, args: {}, policy: 'trusted' }).required, false, `${toolName} 不改动外部数据，不该打扰用户`);
  }
});

test('标准信任档不放过不可逆操作：提交、删除、付款仍然要确认', () => {
  const click = (pageText, args = { element: '按钮' }) => approval.assessToolApproval({ definition: mcpTool('browser_click', 'external_side_effect'), args, pageText, policy: 'trusted' });
  assert.equal(click('搜索结果 第 2 页', { element: '下一页' }).required, false, '翻页不是不可逆操作');
  assert.equal(click('', { element: '提交订单' }).required, true);
  assert.equal(click('账户设置\n删除账户').required, true);
  assert.equal(click('结算页', { element: '立即购买' }).required, true);
});

test('标准信任档不放过非浏览器的写工具、dangerous 与页面内执行代码', () => {
  const assess = (definition) => approval.assessToolApproval({ definition, args: {}, policy: 'trusted' });
  assert.equal(assess(mcpTool('create_issue', 'external_side_effect')).required, true, '非浏览器的写工具照旧要问');
  assert.equal(assess(mcpTool('delete_repo', 'dangerous')).required, true);
  assert.equal(assess(mcpTool('browser_evaluate', 'external_side_effect')).required, true, '在页面里执行代码不能靠档位放行');
  assert.equal(assess(mcpTool('browser_run_code_unsafe', 'external_side_effect')).required, true);
});

test('读本机敏感文件在任何档位都要确认，只有完全访问不拦', () => {
  const read = (policy) => approval.assessToolApproval({ definition: mcpTool('read_text_file', 'read'), args: { path: '.env' }, sensitiveHint: '要读取敏感配置文件 .env', policy });
  assert.equal(read('always').required, true);
  assert.equal(read('trusted').required, true);
  assert.equal(read(undefined).required, true);
  assert.equal(read('full').required, false, '完全访问等价「不再询问」，连读凭据也一起放行');
});

test('完全访问档：提交、付款、删除与页面内执行代码都不再询问', () => {
  for (const name of ['browser_click', 'create_issue', 'delete_repo', 'browser_run_code_unsafe']) {
    const definition = mcpTool(name, name === 'delete_repo' || name === 'browser_run_code_unsafe' ? 'dangerous' : 'external_side_effect');
    const verdict = approval.assessToolApproval({ definition, args: {}, pageText: '确认支付', sensitiveHint: '要读取敏感配置文件 .env', policy: 'full' });
    assert.equal(verdict.required, false, `${name} 在完全访问档下不该再问`);
    assert.equal(verdict.reason, '');
  }
  // 完全访问只改 MCP 工具这一层：内置工具本来就不进审批。
  assert.equal(approval.assessToolApproval({ definition: nativeTool('document_generate', 'write'), args: {}, policy: 'always' }).required, false);
});

test('档位只认三个已知值，写坏了退回标准信任', () => {
  assert.equal(approval.DEFAULT_MCP_APPROVAL_POLICY, 'trusted');
  assert.equal(approval.normalizeMcpApprovalPolicy('always'), 'always');
  assert.equal(approval.normalizeMcpApprovalPolicy(' FULL '), 'full');
  assert.equal(approval.normalizeMcpApprovalPolicy('trusted'), 'trusted');
  for (const bad of ['', 'nope', null, undefined, 1, {}, 'every-time']) {
    assert.equal(approval.normalizeMcpApprovalPolicy(bad), 'trusted', `${JSON.stringify(bad)} 应该退回默认档`);
  }
});

test('工具授权记忆：记一个工具、改它、删它，落盘的只有 id 和策略', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-tool-memory-'));
  try {
    const toolId = 'mcp:playwright:browser_click';
    assert.equal(approval.normalizeToolApprovalPolicy('ALWAYS_ALLOW'), 'always_allow');
    assert.equal(approval.normalizeToolApprovalPolicy('随便写的'), 'ask');
    assert.equal(approval.toolApprovalPolicy(toolId, { dataDir }), 'ask', '没记过就是每次都问');
    assert.equal(approval.toolApprovalPolicy('', { dataDir }), 'ask');
    assert.throws(() => approval.setToolApprovalPolicy('   ', 'block', { dataDir }), /缺少工具 id/);

    approval.setToolApprovalPolicy(toolId, 'always_allow', { dataDir });
    assert.equal(approval.toolApprovalPolicy(toolId, { dataDir }), 'always_allow');
    assert.deepEqual(JSON.parse(readFileSync(approval.resolveToolApprovalsFile({ dataDir }), 'utf8')), { [toolId]: 'always_allow' });

    approval.setToolApprovalPolicy(toolId, 'block', { dataDir });
    assert.equal(approval.toolApprovalPolicy(toolId, { dataDir }), 'block');

    approval.setToolApprovalPolicy(toolId, 'ask', { dataDir });
    assert.equal(approval.toolApprovalPolicy(toolId, { dataDir }), 'ask');
    assert.deepEqual(approval.readToolApprovalPolicies({ dataDir }), {}, 'ask 等于没记忆，不该留在文件里');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('工具授权记忆：block 直接拒绝，always_allow 也不越过敏感文件', () => {
  const risky = () => ({
    definition: mcpTool('create_issue', 'external_side_effect'),
    args: { title: '写工具' },
  });
  assert.equal(approval.assessToolApproval(risky()).required, true, '没记过时照旧要确认');

  const allowed = approval.assessToolApproval({ ...risky(), toolPolicy: 'always_allow' });
  assert.equal(allowed.required, false, '记住「以后直接允许」之后不该再弹卡片');
  // 但「这一次要读哪个文件」是另一个问题，记忆不该把它一起放过去。
  const sensitive = approval.assessToolApproval({
    definition: mcpTool('read_text_file', 'read'),
    args: { path: '.env' },
    sensitiveHint: '要读取敏感配置文件 .env',
    toolPolicy: 'always_allow',
  });
  assert.equal(sensitive.required, true);

  const blocked = approval.assessToolApproval({ ...risky(), toolPolicy: 'block' });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.required, false, 'block 不给确认入口');
  assert.equal(
    approval.assessToolApproval({ ...risky(), toolPolicy: 'block', policy: 'full' }).blocked,
    true,
    '用户对单个工具的决定比档位更优先',
  );

  // 内置工具不吃这套：它的副作用都在本机，有自己的门控。
  assert.equal(approval.assessToolApproval({ definition: nativeTool('document_generate', 'write'), args: {}, toolPolicy: 'block' }).blocked, undefined);
  assert.equal(approval.assessToolApproval({ definition: null, args: {}, toolPolicy: 'block' }).blocked, undefined);
});

test('工具授权记忆：执行代码类的工具不能记成「以后直接允许」', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-tool-memory-code-'));
  try {
    for (const name of ['browser_evaluate', 'browser_run_code_unsafe']) {
      assert.equal(approval.isUnbypassableApprovalTool(name), true);
      assert.equal(approval.isUnbypassableApprovalTool(`mcp:playwright:${name}`), true, '注册表 id 也要认出来');
      assert.equal(approval.isUnbypassableApprovalTool(`playwright__${name}`), true, '模型看到的名字也要认出来');
      const verdict = approval.assessToolApproval({
        definition: mcpTool(name, 'external_side_effect'),
        args: { code: 'await page.click("提交")' },
        toolPolicy: 'always_allow',
      });
      assert.equal(verdict.required, true, '在页面里执行代码这一步不能被「以后直接允许」免掉');
      assert.equal(verdict.unbypassable, true);
    }
    // 上传 / 拖入本机文件：页面文案看不出风险，但文件出门就收不回来。
    for (const name of ['browser_file_upload', 'browser_drop']) {
      assert.equal(approval.isUnbypassableApprovalTool(name), true);
      assert.match(approval.unbypassableApprovalReason(name), /本机文件/);
    }
    const upload = approval.assessToolApproval({
      definition: mcpTool('browser_file_upload', 'external_side_effect'),
      args: { paths: ['D:\\文档\\报价单.xlsx'] },
      pageText: '填写表单',
      toolPolicy: 'always_allow',
    });
    assert.equal(upload.required, true, '上传本机文件不该被「以后直接允许」静默放行');
    assert.equal(upload.unbypassable, true);
    assert.match(upload.reason, /本机文件/);
    const fileDrop = approval.assessToolApproval({
      definition: mcpTool('browser_drop', 'external_side_effect'),
      args: { element: '上传区', paths: ['D:\\文档\\报价单.xlsx'] },
      toolPolicy: 'always_allow',
    });
    assert.equal(fileDrop.required, true, '拖入本机文件同理');
    // 只拖页面里的数据时没有东西出门，照旧按页面文案判断，也别耽误用户放开记忆。
    const dataDrop = approval.assessToolApproval({
      definition: mcpTool('browser_drop', 'external_side_effect'),
      args: { element: '看板', data: 'card-1' },
      pageText: '把卡片拖到另一列',
    });
    assert.equal(dataDrop.required, false);
    assert.equal(approval.isUnbypassableApprovalTool('browser_click'), false, '普通写入类工具照旧可以记');
    assert.equal(approval.isUnbypassableApprovalTool('mcp:playwright:browser_click'), false);
    assert.equal(approval.isUnbypassableApprovalTool(''), false);
    assert.equal(approval.isUnbypassableApprovalTool(null), false);

    // 旧记忆留在盘上也不生效：读侧当它没记过，下一次写盘顺手清掉。
    approval.setToolApprovalPolicy('mcp:playwright:browser_click', 'always_allow', { dataDir });
    const file = approval.resolveToolApprovalsFile({ dataDir });
    writeFileSync(file, JSON.stringify({
      'mcp:playwright:browser_evaluate': 'always_allow',
      'mcp:playwright:browser_click': 'always_allow',
    }));
    assert.deepEqual(approval.readToolApprovalPolicies({ dataDir }), { 'mcp:playwright:browser_click': 'always_allow' });
    assert.equal(approval.toolApprovalPolicy('mcp:playwright:browser_evaluate', { dataDir }), 'ask');
    approval.setToolApprovalPolicy('mcp:playwright:browser_click', 'block', { dataDir });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'mcp:playwright:browser_click': 'block' }, '下一次写盘顺手清掉不生效的那条');

    assert.throws(
      () => approval.setToolApprovalPolicy('mcp:playwright:browser_evaluate', 'always_allow', { dataDir }),
      /不能记成「以后直接允许」/,
      '存储层也不接受这条记忆，别的调用方同样绕不过去',
    );

    // 「直接拒绝」不受影响：拒绝对谁都留得住。
    approval.setToolApprovalPolicy('mcp:playwright:browser_evaluate', 'block', { dataDir });
    assert.equal(approval.toolApprovalPolicy('mcp:playwright:browser_evaluate', { dataDir }), 'block');
    assert.equal(approval.assessToolApproval({
      definition: mcpTool('browser_evaluate', 'external_side_effect'),
      args: {},
      toolPolicy: 'block',
    }).blocked, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('工具授权记忆有上限：记满了只挡新增，改旧的照旧放行', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sanmao-tool-memory-cap-'));
  try {
    // 先记一条，把目录建出来；之后直接铺满整份文件，省掉 200 次写盘。
    approval.setToolApprovalPolicy('mcp:playwright:tool_0', 'always_allow', { dataDir });
    const many = {};
    for (let index = 0; index < approval.TOOL_APPROVAL_MAX_ENTRIES; index += 1) many[`mcp:playwright:tool_${index}`] = 'always_allow';
    writeFileSync(approval.resolveToolApprovalsFile({ dataDir }), `${JSON.stringify(many)}\n`, 'utf8');
    assert.equal(Object.keys(approval.readToolApprovalPolicies({ dataDir })).length, approval.TOOL_APPROVAL_MAX_ENTRIES);
    assert.throws(() => approval.setToolApprovalPolicy('mcp:playwright:brand_new', 'block', { dataDir }), /太多/);
    approval.setToolApprovalPolicy('mcp:playwright:tool_0', 'block', { dataDir });
    assert.equal(approval.toolApprovalPolicy('mcp:playwright:tool_0', { dataDir }), 'block');
    // 文件坏了不能把整个面板带崩：读不出来就当没记过。
    writeFileSync(approval.resolveToolApprovalsFile({ dataDir }), '这不是 JSON\n', 'utf8');
    assert.deepEqual(approval.readToolApprovalPolicies({ dataDir }), {});
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
