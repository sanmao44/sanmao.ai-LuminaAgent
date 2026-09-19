/**
 * 本地工具运行时的查看与启停（curated 目录里的 stdio 服务）。
 *
 * 三条边界，都来自任务书：
 * - 安装只能由用户在 MCP 面板点「安装」：安装会跑 npm 下载依赖、写本机目录，
 *   §37 明确「不得自动 spawn」，所以这里没有 install。
 * - 启动/停止只针对代码里写死的受控条目（命令、参数、工作目录都不可改），
 *   并且必须能在用户这一轮的原话里找到依据——模型自己说「用户同意了」不算。
 * - 任务本身不需要时不要碰运行时：这个动作只在用户明确要求时才被调用。
 */
import { MCP_CATALOG_ENTRIES, findCatalogEntry } from './catalog';
import { catalogRuntimeStatus, startCatalogServer, stopCatalogServer } from './catalog-runtime';
import type { McpCatalogRuntimeStatus } from './catalog-runtime';

export const MCP_RUNTIME_ACTIONS = ['runtime_status', 'runtime_start', 'runtime_stop'] as const;
export type McpRuntimeAction = (typeof MCP_RUNTIME_ACTIONS)[number];

/** 起停都要在用户原话里找到依据：动词写全，避免「用浏览器查一下」被当成同意启动。 */
const START_GRANT_PATTERN = /(?:启动|开启|打开|拉起来|运行起来|装上|装好|安装)(?:一下|这个|那个|本地)?[^，。！？]{0,6}(?:运行时|浏览器|browser|playwright|组件|服务)/i;
const STOP_GRANT_PATTERN = /(?:停止|关闭|关掉|结束|退出|不用|别用|不要用)[^，。！？]{0,6}(?:运行时|浏览器|browser|playwright|组件|服务)?/i;

export function isMcpRuntimeAction(value: unknown): value is McpRuntimeAction {
  return (MCP_RUNTIME_ACTIONS as readonly string[]).includes(String(value || '').trim().toLowerCase());
}

export type McpRuntimeOutcome = { readOnly: boolean; result: Record<string, unknown> };

/** 面板与对话共用同一份状态快照：字段口径统一，用户在两处看到的是同一件事。 */
function snapshot(statuses: readonly McpCatalogRuntimeStatus[]) {
  return statuses.map((status) => ({
    id: status.id,
    name: status.name,
    state: status.state,
    installed: status.installed,
    running: status.running,
    needsBrowser: status.needsBrowser,
    browser: status.browser?.channel || null,
    summary: status.summary,
    installNote: status.installNote,
    error: status.error,
  }));
}

function statuses(options: { dataDir?: string } = {}) {
  const list: McpCatalogRuntimeStatus[] = [];
  for (const entry of MCP_CATALOG_ENTRIES) {
    try {
      list.push(catalogRuntimeStatus(entry.id, options));
    } catch {
      // 单个条目取不到状态不该让整个动作失败。
    }
  }
  return list;
}

const INSTALL_HINT = '安装只能由用户在 MCP 面板的「本地工具运行时」里点「安装」，你不能自己装；先告诉用户去点，再重试。';

export async function runMcpRuntimeAction(
  action: unknown,
  options: { id?: unknown; instruction?: string; dataDir?: string } = {},
): Promise<McpRuntimeOutcome> {
  const name = String(action || '').trim().toLowerCase() as McpRuntimeAction;
  if (!isMcpRuntimeAction(name)) throw new Error(`不支持的运行时动作「${String(action || '')}」。`);
  const instruction = String(options.instruction || '');

  if (name === 'runtime_status') {
    return {
      readOnly: true,
      result: {
        ok: true,
        action: name,
        runtimes: snapshot(statuses(options)),
        note: `${INSTALL_HINT} 状态里的 running 表示进程已经起来、工具可以调用。`,
      },
    };
  }

  const entry = findCatalogEntry(options.id || MCP_CATALOG_ENTRIES[0]?.id);
  if (!entry) throw new Error(`未知的本地服务：${String(options.id || '')}。先用 runtime_status 看有哪些。`);

  if (name === 'runtime_start') {
    if (!START_GRANT_PATTERN.test(instruction)) {
      throw new Error('用户这一轮没有明确要求启动本地运行时，先向用户确认再执行。');
    }
    const before = catalogRuntimeStatus(entry.id, options);
    if (!before.installed) throw new Error(`「${entry.name}」还没安装。${INSTALL_HINT}`);
    const status = await startCatalogServer(entry.id, options);
    return {
      readOnly: false,
      result: {
        ok: true,
        action: name,
        runtime: snapshot([status])[0],
        note: status.running ? '运行时已启动，下一轮对话就能调用它的工具了。' : '运行时没有起来，把失败原因如实告诉用户。',
      },
    };
  }

  if (!STOP_GRANT_PATTERN.test(instruction)) {
    throw new Error('用户这一轮没有明确要求关闭本地运行时，先向用户确认再执行。');
  }
  const status = stopCatalogServer(entry.id, options);
  return {
    readOnly: false,
    result: { ok: true, action: name, runtime: snapshot([status])[0], note: '运行时已关闭，它的工具不会再下发给模型。' },
  };
}