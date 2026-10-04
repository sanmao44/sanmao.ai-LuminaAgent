import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildToolRuntimeModule } from './tools-build.mjs';
import { createTsRequire } from './ts-require.mjs';

const route = await readFile(new URL('../apps/api/agent-application.ts', import.meta.url), 'utf8');
const resume = await readFile(new URL('../lib/agent/resume.ts', import.meta.url), 'utf8');
const runRoute = await readFile(new URL('../app/api/agent/runs/[id]/route.ts', import.meta.url), 'utf8');
const client = await readFile(new URL('../lib/agent-client.ts', import.meta.url), 'utf8');
const card = await readFile(new URL('../components/AgentApprovalCard.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const { ToolRuntime } = await buildToolRuntimeModule();
const { streamAgentResult } = createTsRequire(process.cwd())('./apps/api/agent-stream');

test('风险调用不当场执行，而是整批延后等确认', async () => {
  assert.match(route, /import \{[^}]*assessToolApproval[^}]*\} from '@\/lib\/agent\/approval';/, '审批判定只能来自共享模块，不能各写一套');
  // MCP 调用先过本机一侧的路径检查（Filesystem、上传来源），再进审批判定。
  const runtime = new ToolRuntime({
    context: { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false, mcpAdmin: false, canvas: false },
    extraTools: [{ id: 'mcp:github:create_issue', name: 'github__create_issue', description: 'create', schema: { type: 'object' }, permissions: ['network'], tags: ['mcp'], source: 'mcp', risk: 'write', gating: () => true, mcp: { serverId: 'github', serverName: 'GitHub', toolName: 'create_issue', readOnly: false, blocked: false } }],
    authorize: () => 'defer',
    execute: async () => { throw new Error('must not execute'); },
  });
  const result = await runtime.execute({ id: 'approval-call', function: { name: 'github__create_issue', arguments: '{}' } });
  assert.equal(result.deferred, true);
  assert.deepEqual(result.results, []);
  assert.match(route, /const toolRuntime = new ToolRuntime\(/);
  assert.match(route, /assessment\.required/);
});

test('待确认的调用必须整轮返回，绝不能写进下一轮对话历史', () => {
  const recordIndex = route.indexOf('const approvalRecord = createApproval({');
  const secondMessagesIndex = route.indexOf('const secondMessages: ChatMessage[] =');
  assert.notEqual(recordIndex, -1);
  assert.notEqual(secondMessagesIndex, -1);
  assert.ok(recordIndex < secondMessagesIndex, '审批记录必须在构造 secondMessages 之前拦下来，否则历史里会出现没有结果的 tool_calls');
  assert.match(route, /approval: approvalPayload/);
  assert.match(route, /needsApproval: true/);
  assert.match(route, /step 存不下|没能保存下来/);
});

test('流式与非流式都带上待确认信息，前端两种路径都能渲染', async () => {
  const approval = { id: 'approval-1', expiresAt: Date.now() + 60_000, message: 'needs confirmation', calls: [{ name: 'github__create_issue' }] };
  const response = await streamAgentResult(null, {
    fallback: 'waiting for approval', images: [], files: [], generations: [], model: 'test-model', deliverable: 'TEXT', approval,
  });
  const events = (await response.text()).trim().split('\n\n').map((frame) => JSON.parse(frame.slice(6)));
  const approvalEvent = events.find((event) => event.type === 'approval_required');
  const finalEvent = events.find((event) => event.type === 'final');
  assert.equal(approvalEvent?.approvalId, approval.id);
  assert.equal(finalEvent?.needsApproval, true);
  assert.equal(finalEvent?.approval?.id, approval.id);
});

test('续跑接口只认 approve / reject，执行哪个调用由服务端记录决定', () => {
  assert.match(resume, /const action = input\.action === 'approve' \? 'approve' : input\.action === 'reject' \? 'reject' : null;/);
  assert.match(resume, /const record = claimApproval\(input\.id\);/);
  assert.match(resume, /for \(const pending of record\.pending\)/);
  // 请求体里没有任何字段能影响「执行什么」：前端伪造不出一个调用。
  assert.doesNotMatch(resume, /input\.calls|input\.tool|input\.args/);
  assert.match(runRoute, /action: \(body as \{ action\?: unknown \}\)\?\.action/);
  assert.match(runRoute, /isTrustedAppRequest\(request\)/);
  assert.match(runRoute, /beginRuntimeRequest\('agent'\)/);
});

test('续跑只继续下发只读工具，写工具一次确认只换来一次执行', () => {
  // 「再看看结果」不该逼用户再补一句需求：只读工具继续给，写工具绝不再下发。
  assert.match(resume, /\.filter\(\(tool\) => tool\.mcp\?\.readOnly === true && !tool\.mcp\.blocked\)/);
  assert.match(resume, /tools: continuationTools, tool_choice: 'auto'/);
  assert.match(resume, /续跑只允许继续调用只读工具/);
  // 模型在续跑里点名写工具时，结果里只会得到一句拒绝，而不是真的执行。
  assert.match(resume, /executeMcpTool\(/);
  assert.match(resume, /executeTabbitTool\(/);
  // 续跑仍然保留一次「不带工具」的收尾，只读补读失败也能把话说清楚。
  assert.match(resume, /const reply = await chatCompletion\(runtime\.provider, runtime\.model\.rawId, \{ messages, tool_choice: 'none' \}/);
  assert.match(resume, /retry: meta\.readOnly/);
  assert.match(resume, /MCP_TOOL_MAX_CALLS_PER_TURN/);
});

test('续跑时重新校验配置：服务被移除、停用或写入权限被改过就不执行', () => {
  assert.match(resume, /const policy = resolveToolPolicy\(pending\.name, record\.gating, mcpTools\);/);
  assert.match(resume, /if \(!policy\.allowed \|\| !meta \|\| \(!server && meta\.serverId !== 'tabbit'\)\) \{/);
  assert.match(resume, /这一步已经不能执行了/);
});

test('拒绝路径什么都不执行，也不需要模型再跑一轮', () => {
  const rejectIndex = resume.indexOf("if (action === 'reject')");
  const executeIndex = resume.indexOf('for (const pending of record.pending)');
  assert.notEqual(rejectIndex, -1);
  assert.ok(rejectIndex < executeIndex, '拒绝必须在执行之前返回');
  assert.match(resume, /rejected: true/);
});

test('前端只能回答允许或取消，卡片说清「将要发生什么」', () => {
  assert.match(card, /resumeAgentRun/);
  assert.match(card, /允许本次/);
  assert.match(card, /拒绝/);
  assert.match(card, /RISK_LABELS\[call\.risk\]/);
  assert.match(card, /agent-approval-args/);
  // 第一版不提供「永远允许危险操作」：卡片上只该有允许本次与拒绝两个动作。
  assert.equal((card.match(/<button/g) || []).length, 2);
  assert.match(client, /body: JSON\.stringify\(\{ action \}\),/);
  assert.match(client, /export async function resumeAgentRun\(/);
});

test('消息上的待确认卡片会随结果定稿，刷新后不再重复弹按钮', () => {
  assert.match(page, /import AgentApprovalCard from '@\/components\/AgentApprovalCard';/);
  assert.match(page, /approval: data\.approval \|\| undefined,/);
  assert.match(page, /_jsx\(AgentApprovalCard, \{/);
  assert.match(page, /async function resolveAgentApprovalMessage\(messageId, outcome\)/);
  assert.match(page, /approvalResult: String\(/);
  assert.match(page, /import AgentApprovalResult from '@\/components\/AgentApprovalResult';/);
});

test('审批记录本身带有效期与体积上限，不会长期驻留对话内容', () => {
  assert.match(runRoute, /RESUME_TIMEOUT_MS/);
  assert.match(resume, /export const RESUME_TIMEOUT_MS = MCP_TURN_TIME_BUDGET_MS \+ 30_000;/);
  assert.match(card, /10 分钟后作废/);
});
