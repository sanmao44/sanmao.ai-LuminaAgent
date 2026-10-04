/**
 * 待到确认操作的续跑（任务书 §13–§15）。
 *
 * 审批不能靠「一个 HTTP 请求挂着等用户点确认」：用户可能几分钟后才回来，也可能直接关掉窗口。
 * 所以 approve 是重新进一次请求：服务端把当时存下来的对话、模型和待执行调用读回来，
 * 只执行用户点过的那几个调用，再把结果交回模型收尾。
 *
 * 三条硬规则：
 * - 只执行审批记录里存的调用。请求体里只能带 approve / reject，前端伪造不出新调用。
 * - 认领记录用原子改名，连点两下「允许」也只会真的执行一次（重复下单撤不回来）。
 * - 续跑只继续给只读工具：确认一次只换来一次写入，写工具绝不在续跑里再下发；
 *   模型想「再看看结果」时可以继续读，不需要用户再补一句需求。
 */
import { chatCompletion, type ChatMessage } from '@/lib/providers';
import { getRuntimeModel } from '@/lib/store';
import { MCP_TOOL_MAX_CALLS_PER_TURN, MCP_TURN_TIME_BUDGET_MS, callMcpTool } from '@/lib/mcp/client';
import { noteRemoteCatalogCallFailure, noteRemoteCatalogCallSuccess } from '@/lib/mcp/catalog-remote';
import { lazyMcpGroupKeywords, loadMcpToolRuntime } from '@/lib/mcp/tools';
import { runToolLoop } from '@/packages/tool-runtime/tool-loop';
import { toModelToolSchema } from '@/lib/tools/registry';
import { selectToolsForTurn } from '@/lib/tools/selector';
import { resolveToolPolicy } from '@/lib/tools/policy';
import { claimApproval, toolApprovalPolicy, type PendingToolCall } from '@/lib/agent/approval';
import { guardMcpServerCall } from '@/lib/mcp/filesystem-policy';
import { listFilesystemRoots, listFilesystemWriteRoots } from '@/lib/mcp/filesystem-roots';
import { recordMcpCall, type McpAuditDecision } from '@/lib/mcp/audit';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { stripToolCallMarkup } from '@/lib/skills';
import { verifyFilesystemMove } from '@/lib/agent/filesystem-result';
import { toolOutcomeText } from '@/lib/agent/tool-outcome';
import { browserToolName, isBrowserMutationTool } from '@/lib/agent/browser-freshness';
import { isTabbitCliAvailable, runTabbitBrowserAction } from '@/lib/tabbit-cli';
import { tabbitBrowserTool } from '@/lib/tools';
import { executeMcpTool, executeTabbitTool } from '@/packages/tool-runtime/mcp-executor';

/** 续跑的整体上限：比一轮 MCP 预算再多一点拿来整理回答。 */
export const RESUME_TIMEOUT_MS = MCP_TURN_TIME_BUDGET_MS + 30_000;

export type AgentResumeOutcome = { status: number; body: Record<string, unknown> };

export type AgentResumeMcpToolUse = { server: string; name: string; readOnly: boolean; ok: boolean };

function toolFailure(call: PendingToolCall, error: string): ChatMessage {
  return { role: 'tool', tool_call_id: call.callId, content: JSON.stringify({ ok: false, error }) };
}

/**
 * 续跑执行的调用也要留痕：这些都是用户点过「允许」的操作，最需要事后能查到。
 * 同样只写摘要，不写完整参数（见 lib/mcp/audit.ts）。
 */
function auditResumeCall(
  meta: { serverId: string; serverName: string; toolName: string; readOnly: boolean },
  risk: string,
  input: { allowed: boolean; decision: McpAuditDecision; ok: boolean; durationMs: number; summary: unknown },
) {
  recordMcpCall({
    serverId: meta.serverId,
    serverName: meta.serverName,
    tool: meta.toolName,
    risk: risk || (meta.readOnly ? 'read' : 'external_side_effect'),
    allowed: input.allowed,
    decision: input.decision,
    ok: input.ok,
    durationMs: input.durationMs,
    summary: input.summary,
  });
}

/** 续跑时按用户原始那句话决定「按需下发」的服务这一轮算不算被提到。 */
function lastUserInstruction(messages: unknown) {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown } | null;
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  return '';
}

export async function resumeAgentRun(input: { id: unknown; action: unknown; signal?: AbortSignal }): Promise<AgentResumeOutcome> {
  const action = input.action === 'approve' ? 'approve' : input.action === 'reject' ? 'reject' : null;
  if (!action) return { status: 400, body: { error: '未知操作，只支持 approve 或 reject。' } };

  // 认领即销毁：上面两条分支都先拿到「唯一执行权」，拿不到就说明这条已经用过或过期了。
  const record = claimApproval(input.id);
  if (!record) return { status: 404, body: { error: '这条待确认操作已失效（超过 10 分钟会作废），请重新发起。' } };

  if (action === 'reject') {
    // 拒绝也要留痕：用户明确说过「不做」，这和「从没发生过」不是一回事。
    for (const pending of record.pending) {
      recordMcpCall({
        serverId: pending.serverId,
        serverName: pending.serverName,
        tool: pending.toolName,
        risk: pending.risk,
        allowed: false,
        decision: 'rejected',
        ok: false,
        durationMs: 0,
        summary: pending.reason,
      });
    }
    return { status: 200, body: { ok: true, rejected: true, message: '已取消这一步操作，没有执行。' } };
  }

  const runtime = await getRuntimeModel(record.model, 'chat').catch(() => null);
  if (!runtime) return { status: 409, body: { error: '这轮用的模型已被移除或停用，请重新发一次请求。' } };

  // 等待期间用户可能改过 MCP 配置（地址、凭据、允许写入），所以这里重新读一次，按现在的配置判断。
  const mcpRuntime = await loadMcpToolRuntime({ signal: input.signal }).catch(() => ({ servers: [], tools: [] as const }));
  const servers = new Map(mcpRuntime.servers.map((server) => [server.id, server] as const));
  const mcpTools = isTabbitCliAvailable() ? [...mcpRuntime.tools, tabbitBrowserTool] : mcpRuntime.tools;

  // 续跑同样要过一遍路径策略：用户点了「允许」只代表他同意这一次操作，
  // 不代表授权目录在这中间被改过——所以按现在的授权清单重新判。
  // 写权限清单和读清单分开：用户点「允许」只代表同意这一次，不代表那个目录可以写。
  const guardOptions = { roots: listFilesystemRoots(), writeRoots: listFilesystemWriteRoots(), dataDir: resolveLocalDataDir() };
  const executed: ChatMessage[] = Array.isArray(record.executed) ? (record.executed as ChatMessage[]) : [];
  const usedMcpTools: AgentResumeMcpToolUse[] = [];
  let budget = MCP_TURN_TIME_BUDGET_MS;
  let callCount = 0;
  let browserMutationExecuted = false;

  const executeResumeMcp = async (pending: PendingToolCall, server: NonNullable<typeof mcpRuntime.servers[number]>, meta: { serverId: string; serverName: string; toolName: string; readOnly: boolean; blocked: boolean }, args: Record<string, unknown>) => {
    const startedAt = Date.now();
    const outcome = await executeMcpTool({
      callId: pending.callId, server, meta: meta!, args, signal: input.signal,
      timeoutMs: Math.max(5_000, budget), decision: 'approval', retry: meta.readOnly,
      dependencies: {
        call: callMcpTool,
        guard: (guardServer, guardMeta, guardArgs) => {
          const guard = guardMcpServerCall(guardServer, guardMeta.toolName, guardArgs, guardOptions);
          return guard.ok ? { ok: true, args: guard.args } : { ok: false, error: guard.error };
        },
        verifyFilesystemMove,
        onUsage: ({ meta: usageMeta, ok }) => {
          budget -= Math.max(0, Date.now() - startedAt);
          usedMcpTools.push({ server: usageMeta.serverName, name: usageMeta.toolName, readOnly: usageMeta.readOnly, ok });
        },
        onRemoteFailure: (failureServer, reason, options) => noteRemoteCatalogCallFailure(failureServer, reason, options),
        onRemoteSuccess: (successServer) => noteRemoteCatalogCallSuccess(successServer),
        onAudit: ({ meta: auditMeta, allowed, ok, durationMs, summary }) => auditResumeCall(auditMeta, pending.risk, { allowed, decision: 'approval', ok, durationMs, summary }),
      },
    });
    if (server.catalogId === 'playwright' && isBrowserMutationTool(browserToolName(meta.toolName)) && outcome.ok) browserMutationExecuted = true;
    return outcome.message;
  };

  for (const pending of record.pending) {
    const policy = resolveToolPolicy(pending.name, record.gating, mcpTools);
    const meta = policy.tool?.mcp;
    const server = meta ? servers.get(meta.serverId) : undefined;
    if (!policy.allowed || !meta || (!server && meta.serverId !== 'tabbit')) {
      executed.push(toolFailure(pending, '这一步已经不能执行了：服务被移除、停用，或者写入权限被改过。请重新发起。'));
      continue;
    }
    if (callCount >= MCP_TOOL_MAX_CALLS_PER_TURN || budget <= 0) {
      executed.push(toolFailure(pending, '本轮调用外部服务已达上限，这一步没有执行。'));
      continue;
    }
    callCount += 1;
    const args = pending.args && typeof pending.args === 'object' && !Array.isArray(pending.args) ? pending.args as Record<string, unknown> : {};
    if (meta.serverId === 'tabbit') {
      const tabbit = await executeTabbitTool({
        callId: pending.callId, args, signal: input.signal, decision: 'approval', run: runTabbitBrowserAction,
        onUsage: (ok) => usedMcpTools.push({ server: 'Tabbit Browser', name: String(args.action || 'browser'), readOnly: args.readOnly === true, ok }),
        onAudit: ({ ok, durationMs, summary }) => auditResumeCall({ serverId: 'tabbit', serverName: 'Tabbit Browser', toolName: 'browser', readOnly: args.readOnly === true }, pending.risk, { allowed: true, decision: 'approval', ok, durationMs, summary }),
      });
      executed.push(tabbit.message);
      continue;
    }
    if (!server) {
      executed.push(toolFailure(pending, 'MCP 服务不可用'));
      continue;
    }
    if (server.catalogId === 'playwright' && isBrowserMutationTool(browserToolName(meta.toolName)) && browserMutationExecuted) {
      executed.push(toolFailure(pending, '上一项浏览器动作可能已经改变页面，这一轮不会盲执行后续动作。请重新获取 browser_snapshot 后再继续。'));
      continue;
    }
    if (policy.tool?.id && toolApprovalPolicy(policy.tool.id) === 'block') {
      const reason = '这一步被设置为“直接拒绝”，没有执行。';
      executed.push(toolFailure(pending, reason));
      usedMcpTools.push({ server: meta.serverName, name: meta.toolName, readOnly: meta.readOnly, ok: false });
      auditResumeCall(meta, pending.risk, { allowed: false, decision: 'block', ok: false, durationMs: 0, summary: reason });
      continue;
    }
    executed.push(await executeResumeMcp(pending, server, meta!, args));
  }

  const messages: ChatMessage[] = [
    ...(Array.isArray(record.messages) ? (record.messages as ChatMessage[]) : []),
    {
      role: 'assistant',
      content: typeof record.assistant?.content === 'string' ? record.assistant.content : null,
      tool_calls: Array.isArray(record.assistant?.tool_calls) ? record.assistant.tool_calls : [],
      ...(record.assistant?.reasoning_content ? { reasoning_content: record.assistant.reasoning_content } : {}),
    },
    ...executed,
  ];

  // 用户点过「允许」之后，下一步常常是「再看看结果」：这一步不该逼他再补一句需求。
  // 所以续跑把只读的外部工具继续借给模型，让它把刚执行完的那一步读完、再写回答。
  const selectedContinuationTools = selectToolsForTurn({
    context: record.gating,
    availableTools: mcpTools,
    userText: lastUserInstruction(record.messages),
    groupKeywords: lazyMcpGroupKeywords(mcpRuntime.servers, mcpTools),
  });
  const continuationTools = [
    ...selectedContinuationTools.filter((tool) => tool.mcp?.readOnly === true && !tool.mcp.blocked),
    ...selectedContinuationTools.filter((tool) => tool.mcp?.serverId === 'tabbit' && !tool.mcp.blocked),
  ].map(toModelToolSchema);

  const runContinuationCall = async (call: { id?: string; function?: { name?: string; arguments?: string } }): Promise<ChatMessage> => {
    const callId = String(call?.id || '');
    const policy = resolveToolPolicy(call?.function?.name, record.gating, mcpTools);
    const meta = policy.tool?.mcp;
    const server = meta ? servers.get(meta.serverId) : undefined;
    if (!policy.allowed || !meta || (!server && meta.serverId !== 'tabbit') || meta.blocked || (!meta.readOnly && meta.serverId !== 'tabbit')) {
      return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ ok: false, error: '续跑只允许继续调用只读工具；需要写入请重新发起，让用户再确认一次。' }) };
    }
    if (callCount >= MCP_TOOL_MAX_CALLS_PER_TURN || budget <= 0) return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ ok: false, error: '本轮调用外部服务已达上限，这一步没有执行。' }) };
    callCount += 1;
    let parsed: unknown = {};
    try { parsed = JSON.parse(call?.function?.arguments || '{}'); } catch {}
    const args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    if (meta.serverId === 'tabbit') {
      if (args.readOnly !== true) return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ ok: false, error: '确认后的续读阶段只允许 Tabbit 的 readOnly=true 调用。' }) };
      const result = await executeTabbitTool({
        callId, args, signal: input.signal, decision: 'approval', run: runTabbitBrowserAction,
        onUsage: (ok) => usedMcpTools.push({ server: 'Tabbit Browser', name: String(args.action || 'browser'), readOnly: true, ok }),
        onAudit: ({ ok, durationMs, summary }) => auditResumeCall({ serverId: 'tabbit', serverName: 'Tabbit Browser', toolName: 'browser', readOnly: true }, 'read', { allowed: true, decision: 'approval', ok, durationMs, summary }),
      });
      return result.message;
    }
    if (!server) return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ ok: false, error: 'MCP 服务不可用' }) };
    const result = await executeMcpTool({
      callId, server, meta, args, signal: input.signal, timeoutMs: Math.max(5_000, budget), decision: 'approval', retry: true,
      dependencies: {
        call: callMcpTool,
        guard: (guardServer, guardMeta, guardArgs) => {
          const guard = guardMcpServerCall(guardServer, guardMeta.toolName, guardArgs, guardOptions);
          return guard.ok ? { ok: true, args: guard.args } : { ok: false, error: guard.error };
        },
        verifyFilesystemMove,
        onUsage: ({ meta: usageMeta, ok }) => usedMcpTools.push({ server: usageMeta.serverName, name: usageMeta.toolName, readOnly: usageMeta.readOnly, ok }),
        onRemoteFailure: (failureServer, reason, options) => noteRemoteCatalogCallFailure(failureServer, reason, options),
        onRemoteSuccess: (successServer) => noteRemoteCatalogCallSuccess(successServer),
        onAudit: ({ meta: auditMeta, allowed, ok, durationMs, summary }) => auditResumeCall(auditMeta, 'read', { allowed, decision: 'approval', ok, durationMs, summary }),
      },
    });
    return result.message;
  };

  let text = '';
  if (continuationTools.length && callCount < MCP_TOOL_MAX_CALLS_PER_TURN && budget > 5_000) {
    const loop = await runToolLoop({
      messages,
      // 只补一轮「读结果」，再多就该用户说话了。
      maxSteps: 2,
      maxCalls: MCP_TOOL_MAX_CALLS_PER_TURN - callCount,
      deadlineMs: Math.max(5_000, budget),
      signal: input.signal,
      callModel: async () => {
        const reply = await chatCompletion(runtime.provider, runtime.model.rawId, { messages, tools: continuationTools, tool_choice: 'auto' }, input.signal ?? AbortSignal.timeout(RESUME_TIMEOUT_MS));
        return reply?.choices?.[0]?.message ?? null;
      },
      runCalls: async (calls) => {
        const results: ChatMessage[] = [];
        for (const call of calls) results.push(await runContinuationCall(call));
        return results;
      },
      finalText: (reply) => stripToolCallMarkup(String(reply?.content || '')).trim(),
    }).catch((error) => {
      // 只读补读失败不影响已经执行完的那一步：下面还有一次不带工具的收尾。
      if (input.signal?.aborted) throw error;
      console.error('[Agent] 确认后续跑补读失败：', error);
      return null;
    });
    text = loop?.text || '';
  }

  if (!text) {
    try {
      const reply = await chatCompletion(runtime.provider, runtime.model.rawId, { messages, tool_choice: 'none' }, input.signal ?? AbortSignal.timeout(RESUME_TIMEOUT_MS));
      text = stripToolCallMarkup(String(reply?.choices?.[0]?.message?.content || '')).trim();
    } catch (error) {
      if (input.signal?.aborted) throw error;
      // 工具已经真的执行过了，这里只是没能写出说明文字：如实告诉用户，别让它看起来像没执行。
      console.error('[Agent] 确认后续跑整理回答失败：', error);
    }
  }

  const fallback = usedMcpTools.length ? '已按你的确认调用工具，请核对实际结果。' : '这一步没有执行。';
  const outcomes = executed.flatMap((message) => {
    try {
      const value = JSON.parse(String(message.content || '')) as { ok?: boolean; error?: string; content?: string };
      return typeof value.ok === 'boolean' ? [{ name: message.tool_call_id || '操作', ok: value.ok, error: value.error || (!value.ok ? value.content : undefined) }] : [];
    } catch { return []; }
  });
  return { status: 200, body: { ok: true, message: toolOutcomeText(text || `${fallback}（这轮没能整理出说明文字，可以继续追问细节。）`, outcomes), mcpTools: usedMcpTools } };
}
