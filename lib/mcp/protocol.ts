/**
 * MCP 协议层里与传输无关的部分：版本、超时、错误类型、结果文本化。
 *
 * 抽出来的原因很实际：远程 HTTP 和本地 stdio 两条传输要共用同一套超时口径和同一份
 * 结果裁剪规则，否则同样是 MCP 工具，走 HTTP 和走 stdio 拿到的行为会不一样。
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_INIT_TIMEOUT_MS = 10_000;
export const MCP_LIST_TIMEOUT_MS = 15_000;
export const MCP_CALL_TIMEOUT_MS = 120_000;
export const MCP_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MCP_MAX_TOOL_RESULT_CHARS = 8000;
/**
 * 页面快照这类「元素索引就是内容」的结果单独给一份更大的预算。
 *
 * 实测（本机真实故障）：Playwright 的 browser_snapshot 在普通网页上就有 20~40 KB，
 * 而 ref 散在这段 YAML 里。按 8000 截断等于把元素索引切掉大半，模型找不到目标元素，
 * 只能自己编 CSS 选择器，于是每次点击都报「找不到元素」——用户看到的就是
 * 「浏览器打开了，然后就停住」。放宽的额度配合 resultText 里的 ref 索引保留一起用。
 */
export const MCP_MAX_PAGE_RESULT_CHARS = 16_000;
/** 截断页面快照时，额外留给「被截掉那段里的 ref 索引」的预算。 */
export const MCP_MAX_REF_INDEX_CHARS = 4_000;
/** 页面快照的元素标记，例如 [ref=f5e14]。出现它才说明这段结果是「可操作的页面结构」。 */
export const MCP_PAGE_REF_MARKER = /\[ref=[^\]\s]+\]/;

/** 各阶段超时；默认值见上面三个常量，调用方（含测试）可以单独覆盖。 */
export type McpTimeouts = { init?: number; list?: number; call?: number };

/** 两种传输共用的调用参数。 */
export type McpRequestOptions = {
  signal?: AbortSignal;
  /** 失败后是否允许重来一次；默认不允许，写类工具重复执行的代价太高。 */
  retry?: boolean;
  timeouts?: McpTimeouts;
  /** 请求的协议版本；默认 MCP_PROTOCOL_VERSION，服务端只支持别的版本时由调用方指定。 */
  protocolVersion?: string;
};

/**
 * 协议版本协商的结果。
 *
 * initialize 的返回值里带服务端实际支持的 protocolVersion。按规范，两边对不上时
 * 应该由服务端决定后续用什么版本；我们只记录、只在面板上标注，不因此断开连接——
 * 拿一个能用的版本继续干活，比因为一个日期字符串连不上强。
 */
export type McpProtocolNegotiation = {
  /** 我们请求的版本。 */
  requested: string;
  /** 服务端回复的版本；它没报就用请求版本顶上。 */
  negotiated: string;
  /** 两边是否一致。 */
  matched: boolean;
  /** 服务端报的版本比我们请求的还新：下次可以上调请求版本。 */
  newerServerVersion: boolean;
};

/** 版本号就是 YYYY-MM-DD，按日期比较即可，用不上语义化版本那套规则。 */
export function compareMcpProtocolVersion(left: unknown, right: unknown): number {
  const toTime = (value: unknown) => {
    const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const time = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  };
  const a = toTime(left);
  const b = toTime(right);
  if (a === null || b === null) return 0;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 把 initialize 的结果折成一条协商记录；服务端没报版本时按「一致」处理。 */
export function negotiateMcpProtocolVersion(serverVersion: unknown, requested: string = MCP_PROTOCOL_VERSION): McpProtocolNegotiation {
  const settled = String(serverVersion ?? '').trim() || requested;
  const diff = compareMcpProtocolVersion(settled, requested);
  return { requested, negotiated: settled, matched: diff === 0, newerServerVersion: diff > 0 };
}

export class McpError extends Error {
  readonly server: string;

  constructor(server: string, message: string) {
    super(message);
    this.name = 'McpError';
    this.server = server;
  }
}

/**
 * 把 MCP 的 content 数组压成一段文本。
 * 图片/音频这类二进制内容不进上下文，只留一个类型标记，避免把 base64 灌进模型。
 */
export function resultText(result: any) {
  const parts: string[] = [];
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (typeof item?.resource?.text === 'string') parts.push(item.resource.text);
    else if (typeof item?.type === 'string') parts.push(`[${item.type}]`);
  }
  if (result?.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {}
  }
  const text = parts.join('\n').trim();
  // 页面快照走另一套预算：普通结果按 8000 截没问题，快照不行——它的「内容」就是元素索引。
  const page = MCP_PAGE_REF_MARKER.test(text);
  const maxChars = page ? MCP_MAX_PAGE_RESULT_CHARS : MCP_MAX_TOOL_RESULT_CHARS;
  if (text.length <= maxChars) return text;
  // 截断必须说出来：否则模型会以为拿到的是完整内容，基于残缺数据下结论。
  if (!page) return `${text.slice(0, maxChars)}\n…（结果过长已截断，以上只是前 ${maxChars} 个字符；如需完整内容请让用户在服务端分页或缩小查询范围。）`;
  const head = text.slice(0, maxChars);
  // 快照被截断时把剩下的 ref 行捡回来：它们是继续操作的前提，比页面文案重要得多。
  const index = refIndexLines(text.slice(maxChars));
  const notice = `…（页面快照过长已截断：以上是前 ${maxChars} 个字符，全文共 ${text.length} 个字符${index ? '；紧接着是被截断部分里带 ref 的元素' : ''}。要操作的元素两处都没有时，用 depth 或 target 收窄范围重新快照；不要凭记忆猜 ref，也不要自己写 CSS 选择器。）`;
  return index ? `${head}\n${index}\n${notice}` : `${head}\n${notice}`;
}

/**
 * 从被截断的那一段里挑出带 ref 的行，拼成元素索引。
 *
 * 只留 ref 行：文本量可控（每行十几个字），而模型点得动的东西一个不少。
 * 缩进会丢掉，但定位一个元素只要「角色 + 名字 + ref」这三样。
 */
function refIndexLines(text: string) {
  const lines: string[] = [];
  let used = 0;
  for (const line of text.split('\n')) {
    if (!MCP_PAGE_REF_MARKER.test(line)) continue;
    const trimmed = line.trim();
    if (used + trimmed.length + 1 > MCP_MAX_REF_INDEX_CHARS) break;
    used += trimmed.length + 1;
    lines.push(trimmed);
  }
  if (!lines.length) return '';
  return `[被截断部分里带 ref 的元素]\n${lines.join('\n')}`;
}
