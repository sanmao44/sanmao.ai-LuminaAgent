/**
 * 危险操作审批（任务书 §9–§15）。
 *
 * 一条硬规则：会改动本机以外数据的动作，必须由用户在界面上点一次「允许」才能执行。
 * 判断依据是服务端自己算出来的风险等级和页面内容，不是 prompt 里的「请先征求同意」，
 * 前端也只能回答「同意 / 拒绝」，不能自己拼一个工具调用出来执行。
 *
 * 浏览器特别处理（§10）：点一下搜索按钮和点一下「提交订单」完全是两件事，
 * 所以浏览器动作按「最近看到的页面内容 + 参数」判风险，而不是按工具名一刀切。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import type { ToolDefinition, ToolGatingContext, ToolRisk } from '@/lib/tools/registry';

/** 审批有效期：过期就作废，免得几天后一个旧请求突然被执行。 */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** 审批记录里保存的对话上限，超过就直接拒绝这次调用（宁可少做一步，也不把长对话落盘）。 */
export const APPROVAL_MAX_STORED_CHARS = 512_000;
/** 判风险时参考的页面文本上限。 */
export const APPROVAL_PAGE_TEXT_CHARS = 4000;

/** 会真的在页面上按下去的浏览器工具。 */
const BROWSER_ACTION_TOOLS = new Set([
  'browser_click',
  'browser_drag',
  'browser_drop',
  'browser_fill_form',
  'browser_handle_dialog',
  'browser_file_upload',
  'browser_press_key',
  'browser_select_option',
  'browser_type',
]);

/**
 * 审批档位（任务书 §9–§15 的加档）：
 * - always  每次确认：非只读的 MCP 调用一律要用户点一次，v1 的老行为。
 * - trusted 标准信任（默认）：只读工具与非副作用的浏览器动作不打扰用户，
 *           提交、付款、删除这类不可逆操作仍然要确认。
 * - full    完全访问：连不可逆操作都不问，等价 Codex 的「完全访问」。
 */
export type McpApprovalPolicy = 'always' | 'trusted' | 'full';

/** 没设置过的用户走这一档：既不给不可逆操作开后门，也不为了「打开个网页」停两次。 */
export const DEFAULT_MCP_APPROVAL_POLICY: McpApprovalPolicy = 'trusted';

export function normalizeMcpApprovalPolicy(value: unknown): McpApprovalPolicy {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'always' || raw === 'full' || raw === 'trusted' ? (raw as McpApprovalPolicy) : DEFAULT_MCP_APPROVAL_POLICY;
}

/**
 * 标准信任档下可以静默执行的浏览器动作：它们只改变「看什么」，不改动外部数据。
 *
 * Playwright 把这些工具标成 action（写入类），只读标记拦不住它们——打开一个网页
 * 因此被当成「改动外部数据」，用户每开一个页面都要点一次允许。这里放行的是白名单，
 * 写操作（点击、填表、上传）不在里面，仍然按页面内容判风险。
 */
const BROWSER_SILENT_TOOLS = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_navigate_forward',
  'browser_reload',
  'browser_tabs',
  'browser_close',
  'browser_resize',
  'browser_hover',
  'browser_wait_for',
  'browser_emulate_media',
  'browser_highlight',
  'browser_hide_highlight',
  'browser_annotate',
]);

/**
 * 在页面里执行代码的浏览器工具：等于把整台浏览器（含登录态）交给模型。
 * 这一条不跟着档位走——标准信任档也要停下来问一句，免得「导航不问」被顺手扩成「跑代码也不问」。
 * 它同样不能被「以后直接允许」这种按工具的记忆免掉（见 isUnbypassableApprovalTool）：
 * 记忆记的是「这个工具平时能不能用」，跑代码是「这一次要拿整台浏览器做什么」。
 */
const BROWSER_CODE_TOOLS = new Set(['browser_evaluate', 'browser_run_code_unsafe']);

/** 不可逆或涉及钱与数据的动作。命中就要用户确认。 */
const RISKY_ACTION_PATTERN = /(提交|下单|购买|付款|支付|转账|汇款|提现|充值|删除|注销|解绑|退订|发布|发送|授权|确认订单|确认支付|confirm\s+(order|payment)|submit|purchase|checkout|\bpay\b|transfer|delete|remove|publish|unsubscribe|authorize|revoke|deploy)/i;

export type PendingToolCall = {
  callId: string;
  /** 模型看到的名字（<serverId>__<tool>）。 */
  name: string;
  toolId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  readOnly: boolean;
  risk: ToolRisk;
  reason: string;
  args: unknown;
};

/**
 * 一次待审批的记录。存下来的东西刚好够「批准后把这一轮接着跑完」：
 * 发出去的对话、模型的工具调用消息、已经执行出来的结果、还没执行的调用。
 */
export type ToolApprovalRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  provider: string;
  model: string;
  messages: unknown[];
  assistant: { content: string | null; tool_calls: unknown[]; reasoning_content?: string };
  executed: unknown[];
  pending: PendingToolCall[];
  gating: ToolGatingContext;
};

/**
 * blocked 表示「不许执行、也不给确认入口」：只有用户设成「直接拒绝」的工具会走到这里。
 * unbypassable 表示「这次确认免不掉」：按工具记的「以后直接允许」不能把它跳过，
 * 因为要不要确认取决于「这一次要做什么」（读敏感文件、在页面里跑代码），不是这个工具平不平庸。
 */
export type ApprovalAssessment = { required: boolean; risk: ToolRisk; reason: string; blocked?: boolean; unbypassable?: true };

export function resolveApprovalDir(options: { dataDir?: string } = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'agent', 'approvals');
}

/**
 * 每个工具的记忆：`ask` 每次都问（默认）、`always_allow` 以后不再问、`block` 以后直接拒绝。
 *
 * 记的是「工具」这一层，不是「这一次调用」：同一个工具换个参数风险可能完全不同
 * （browser_click 翻页和 browser_click 提交订单），所以面板上的按钮要写清它记的是什么。
 * 存 `.data/agent/tool-approvals.json`（0600）：只存工具 id 和这三个值，不存参数。
 */
export type ToolApprovalPolicy = 'ask' | 'always_allow' | 'block';

export const DEFAULT_TOOL_APPROVAL_POLICY: ToolApprovalPolicy = 'ask';
/** 记忆条数上限：这是「常用工具白名单」，不是历史记录，攒再多也没用。 */
export const TOOL_APPROVAL_MAX_ENTRIES = 200;

export function normalizeToolApprovalPolicy(value: unknown): ToolApprovalPolicy {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'always_allow' || raw === 'block' || raw === 'ask' ? (raw as ToolApprovalPolicy) : DEFAULT_TOOL_APPROVAL_POLICY;
}

/**
 * 这个工具的确认能不能被「以后直接允许」免掉。入参接受注册表 id（mcp:服务:工具）、
 * 模型看到的名字（服务__工具）或裸工具名。
 *
 * 现在只有一类：在页面里执行代码的浏览器工具。放行它等于把整台浏览器连同登录态交出去，
 * 所以面板不给它记「以后直接允许」，判定和落盘也各挡一道，旧记忆不会因为存在就生效。
 */
export function isUnbypassableApprovalTool(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  if (raw.includes(':')) return BROWSER_CODE_TOOLS.has(raw.split(':').pop() || '');
  if (raw.includes('__')) return BROWSER_CODE_TOOLS.has(raw.split('__').pop() || '');
  return BROWSER_CODE_TOOLS.has(raw);
}

export function resolveToolApprovalsFile(options: { dataDir?: string } = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'agent', 'tool-approvals.json');
}

export function readToolApprovalPolicies(options: { dataDir?: string } = {}): Record<string, ToolApprovalPolicy> {
  const file = resolveToolApprovalsFile(options);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const policies: Record<string, ToolApprovalPolicy> = {};
    for (const [toolId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const policy = normalizeToolApprovalPolicy(value);
      // 'ask' 就是「没记忆」，落盘时不再保留这一条。
      if (policy === 'ask' || !toolId.trim()) continue;
      // 免不掉确认的工具也不留记忆：留着只会让面板显示一个其实不生效的状态。
      if (policy === 'always_allow' && isUnbypassableApprovalTool(toolId)) continue;
      policies[toolId] = policy;
    }
    return policies;
  } catch {
    return {};
  }
}

/** 这个工具记住的是什么；没记过就是 ask（每次都问）。 */
export function toolApprovalPolicy(toolId: unknown, options: { dataDir?: string } = {}): ToolApprovalPolicy {
  const key = String(toolId ?? '').trim();
  if (!key) return DEFAULT_TOOL_APPROVAL_POLICY;
  return readToolApprovalPolicies(options)[key] || DEFAULT_TOOL_APPROVAL_POLICY;
}

/** 改一条记忆；传 ask 等于删掉它（回到默认行为）。超过上限就不再记新的，避免文件无限涨。 */
export function setToolApprovalPolicy(toolId: unknown, policy: unknown, options: { dataDir?: string } = {}) {
  const key = String(toolId ?? '').trim();
  if (!key) throw new Error('缺少工具 id');
  const next = normalizeToolApprovalPolicy(policy);
  // 免不掉确认的工具不留 always_allow：存下来也不生效，只会让状态对不上。
  if (next === 'always_allow' && isUnbypassableApprovalTool(key)) {
    throw new Error('这个工具每次都要问：它会在页面里执行代码，不能记成「以后直接允许」');
  }
  const policies = readToolApprovalPolicies(options);
  if (next === 'ask') delete policies[key];
  else if (policies[key] !== next) {
    if (!policies[key] && Object.keys(policies).length >= TOOL_APPROVAL_MAX_ENTRIES) throw new Error('记住的工具太多了，先清掉几条再记新的');
    policies[key] = next;
  }
  const file = resolveToolApprovalsFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(policies, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return policies;
}

function approvalFile(id: string, options: { dataDir?: string } = {}) {
  return path.join(resolveApprovalDir(options), `${id}.json`);
}

/** 待审批记录里有整段对话，权限按 0600 落盘，删掉就真的删掉。 */
export function createApproval(record: Omit<ToolApprovalRecord, 'id' | 'createdAt' | 'expiresAt'>, options: { dataDir?: string } = {}) {
  const serialized = JSON.stringify(record);
  if (serialized.length > APPROVAL_MAX_STORED_CHARS) {
    throw new Error('这一轮对话太长，无法安全地保存待确认的操作');
  }
  const now = Date.now();
  const full: ToolApprovalRecord = { ...record, id: `apv_${randomUUID().replace(/-/g, '')}`, createdAt: now, expiresAt: now + APPROVAL_TTL_MS };
  mkdirSync(resolveApprovalDir(options), { recursive: true });
  writeFileSync(approvalFile(full.id, options), `${JSON.stringify(full)}\n`, { encoding: 'utf8', mode: 0o600 });
  return full;
}

export function readApproval(id: unknown, options: { dataDir?: string } = {}): ToolApprovalRecord | null {
  const target = String(id || '').trim();
  if (!/^apv_[a-f0-9]{32}$/.test(target)) return null;
  const file = approvalFile(target, options);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ToolApprovalRecord;
    if (!parsed || parsed.id !== target) return null;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
      deleteApproval(target, options);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function deleteApproval(id: unknown, options: { dataDir?: string } = {}) {
  const target = String(id || '').trim();
  if (!/^apv_[a-f0-9]{32}$/.test(target)) return false;
  try {
    rmSync(approvalFile(target, options), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 认领一条待确认记录：改名成功才算拿到执行权。
 *
 * 用 rename 而不是「读一次再删一次」：用户在界面上连点两下「允许」时，
 * 两个请求会同时进来，普通读+删会让两个请求都以为自己是第一个，
 * 写操作就被执行了两遍（重复下单、重复发帖都撤不回来）。
 * 改名是原子的，只有一个请求能成功，另一个拿到 null，什么都不会执行。
 */
export function claimApproval(id: unknown, options: { dataDir?: string } = {}): ToolApprovalRecord | null {
  const target = String(id || '').trim();
  if (!/^apv_[a-f0-9]{32}$/.test(target)) return null;
  const file = approvalFile(target, options);
  const claimed = `${file}.claimed`;
  try {
    if (!existsSync(file)) return null;
    renameSync(file, claimed);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(claimed, 'utf8')) as ToolApprovalRecord;
    if (!parsed || parsed.id !== target || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
      rmSync(claimed, { force: true });
      return null;
    }
    // 认领即销毁：执行权只有一份，落盘的那份必须当场消失。
    rmSync(claimed, { force: true });
    return parsed;
  } catch {
    rmSync(claimed, { force: true });
    return null;
  }
}/** 顺手清理过期记录：审批记录里带着对话内容，不该长期留在磁盘上。 */
export function pruneApprovals(options: { dataDir?: string } = {}) {
  const dir = resolveApprovalDir(options);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  try {
    for (const name of readdirSync(dir)) {
      // 认领后进程被杀会留下 .claimed 残留；超过有效期一并清掉。
      if (name.endsWith('.claimed')) {
        const leftover = path.join(dir, name);
        try {
          if (Date.now() - statSync(leftover).mtimeMs > APPROVAL_TTL_MS) { rmSync(leftover, { force: true }); removed += 1; }
        } catch {}
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!readApproval(id, options)) removed += 1;
    }
  } catch {}
  return removed;
}

/**
 * 把工具结果里的页面文本攒起来，供下一步判风险。
 * 只留尾部：用户关心的「提交 / 删除」按钮通常在最近看到的这一屏里。
 */
export function appendPageContext(current: string, toolName: string, text: string) {
  if (!/^browser_(snapshot|navigate|find|take_screenshot|console_messages)$/.test(toolName)) return current;
  const next = `${current}\n${text}`.trim();
  return next.slice(-APPROVAL_PAGE_TEXT_CHARS);
}

/**
 * 这次调用要不要用户确认。
 * v1 只管 MCP 工具：内置工具（生成文件、写技能）的副作用都在本机，且已有各自的门控。
 */
export function assessToolApproval(input: {
  definition: Pick<ToolDefinition, 'id' | 'name' | 'risk' | 'source'> | null;
  args: unknown;
  /** 最近看到的页面内容（浏览器动作按内容判风险）。 */
  pageText?: string;
  /**
   * 本机一侧（lib/mcp/filesystem-policy.ts）判出来的敏感文件理由，例如「要读取敏感配置文件 .env」。
   * 只读工具平时不需要确认，但读凭据类配置会把秘密带进对话上下文，所以要停下来问一次。
   */
  sensitiveHint?: string;
  /** 审批档位：没传按默认档（标准信任）走，等价于旧行为的只有 'always'。 */
  policy?: McpApprovalPolicy | string | null;
  /**
   * 用户给这个工具记下的策略：ask 每次都问、always_allow 以后不再问、block 直接拒绝。
   * 没传按 ask 走。block 比档位更优先——它是用户对「这一个工具」的明确决定。
   */
  toolPolicy?: ToolApprovalPolicy | string | null;
}): ApprovalAssessment {
  const definition = input.definition;
  if (!definition || definition.source !== 'mcp') return { required: false, risk: definition?.risk || 'read', reason: '' };
  const risk = definition.risk;
  const remembered = normalizeToolApprovalPolicy(input.toolPolicy);
  if (remembered === 'block') {
    return { blocked: true, required: false, risk, reason: '你已经把这一步设成「直接拒绝」，它不会再被调用。' };
  }
  const assessment = assessMcpToolCall(definition, risk, input);
  // 「以后直接允许」只跳过按风险要的确认：读敏感文件那一次、在页面里执行代码那一次仍然要问，
  // 因为那是「这一次要做什么」，和「这个工具平时能不能用」是两件事。
  if (remembered === 'always_allow' && assessment.required && !assessment.unbypassable && !String(input.sensitiveHint || '').trim()) {
    return { ...assessment, required: false };
  }
  return assessment;
}

/** 纯内容判断：只按风险等级、工具名和页面文本决定要不要确认。 */
function assessMcpToolCall(
  definition: Pick<ToolDefinition, 'id' | 'name' | 'risk' | 'source'>,
  risk: ToolRisk,
  input: { args: unknown; pageText?: string; sensitiveHint?: string; policy?: McpApprovalPolicy | string | null },
): ApprovalAssessment {
  const policy = normalizeMcpApprovalPolicy(input.policy);
  // 完全访问：连不可逆的操作也不问。切到这一档要在面板上再确认一次，并写清后果。
  if (policy === 'full') return { required: false, risk, reason: '' };
  const sensitive = String(input.sensitiveHint || '').trim();
  if (risk === 'read') {
    if (sensitive) return { required: true, risk, reason: sensitive, unbypassable: true };
    return { required: false, risk, reason: '' };
  }
  const toolName = String(definition.name || '').split('__').pop() || '';
  // 在页面里执行代码等于把那台浏览器（含登录态）交给模型：标准信任档也要停下来问。
  // 只有用户明确切到「完全访问」才不问；按工具记的「以后直接允许」不顶用（unbypassable）。
  if (BROWSER_CODE_TOOLS.has(toolName)) {
    return { required: true, risk, reason: '这一步会在页面里执行代码，风险等同改动外部数据', unbypassable: true };
  }
  if (BROWSER_ACTION_TOOLS.has(toolName)) {
    let argsText = '';
    try {
      argsText = JSON.stringify(input.args ?? {});
    } catch {}
    const haystack = `${input.pageText || ''}\n${argsText}`;
    if (RISKY_ACTION_PATTERN.test(haystack)) {
      return { required: true, risk, reason: '这一步看起来是提交、删除或付款这类不可逆操作' };
    }
    return { required: false, risk, reason: '' };
  }
  // 标准信任：导航、切标签这类只改变「看什么」的动作不再逐个打扰用户。
  if (policy === 'trusted' && BROWSER_SILENT_TOOLS.has(toolName)) return { required: false, risk, reason: '' };
  if (risk === 'dangerous') return { required: true, risk, reason: '这个操作可能造成不可逆的损失' };
  return { required: true, risk, reason: '这个工具会改动本机以外的数据' };
}

/**
 * 一句话说清这次要确认什么。原有请求与续跑接口共用同一句措辞，
 * 免得用户在流式消息里看到一句、在确认卡片上又看到另一句。
 */
export function approvalMessageFor(pending: readonly PendingToolCall[]) {
  if (!pending.length) return '这一步需要你确认。';
  // 只读调用进审批只有一种原因：它要读本机上的敏感文件。措辞不能写成「改动外部数据」，
  // 否则用户会以为点下去是在做一件有副作用的事。
  if (pending.length === 1) {
    const lead = pending[0].readOnly ? '这一步要读取本机文件，确认后我再继续' : '这一步会改动外部数据，确认后我再继续';
    return `${lead}：${pending[0].serverName} · ${pending[0].toolName}（${pending[0].reason}）。`;
  }
  if (pending.every((call) => call.readOnly)) return `有 ${pending.length} 个调用要读取本机文件，确认后我再继续。`;
  return `有 ${pending.length} 个调用会改动外部数据，确认后我再继续。`;
}/** 面板上给用户看的一句话摘要：谁、要做什么、参数长什么样。 */
export function describePendingCall(call: PendingToolCall) {
  let argsPreview = '';
  try {
    argsPreview = JSON.stringify(call.args ?? {}).slice(0, 200);
  } catch {}
  return {
    id: call.callId,
    server: call.serverName,
    tool: call.toolName,
    risk: call.risk,
    reason: call.reason,
    argsPreview: argsPreview === '{}' ? '' : argsPreview,
  };
}
