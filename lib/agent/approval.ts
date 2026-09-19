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

export type ApprovalAssessment = { required: boolean; risk: ToolRisk; reason: string };

export function resolveApprovalDir(options: { dataDir?: string } = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'agent', 'approvals');
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
}): ApprovalAssessment {
  const definition = input.definition;
  if (!definition || definition.source !== 'mcp') return { required: false, risk: definition?.risk || 'read', reason: '' };
  const risk = definition.risk;
  if (risk === 'read') return { required: false, risk, reason: '' };
  const toolName = String(definition.name || '').split('__').pop() || '';
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
  if (risk === 'dangerous') return { required: true, risk, reason: '这个操作可能造成不可逆的损失' };
  return { required: true, risk, reason: '这个工具会改动本机以外的数据' };
}

/**
 * 一句话说清这次要确认什么。原有请求与续跑接口共用同一句措辞，
 * 免得用户在流式消息里看到一句、在确认卡片上又看到另一句。
 */
export function approvalMessageFor(pending: readonly PendingToolCall[]) {
  if (!pending.length) return '这一步需要你确认。';
  if (pending.length === 1) return `这一步会改动外部数据，确认后我再继续：${pending[0].serverName} · ${pending[0].toolName}（${pending[0].reason}）。`;
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