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
  if (text.length <= MCP_MAX_TOOL_RESULT_CHARS) return text;
  // 截断必须说出来：否则模型会以为拿到的是完整内容，基于残缺数据下结论。
  return `${text.slice(0, MCP_MAX_TOOL_RESULT_CHARS)}\n…（结果过长已截断，以上只是前 ${MCP_MAX_TOOL_RESULT_CHARS} 个字符；如需完整内容请让用户在服务端分页或缩小查询范围。）`;
}
