type DesktopIntentMatch = RegExpMatchArray & { index: number };

export type DesktopInstructionPolicy = {
  inputRequested: boolean;
  inputExplicitlyForbidden: boolean;
  requestedInputText: string | null;
  screenshotRequested: boolean;
  screenshotExplicitlyForbidden: boolean;
};

export type DesktopCompletionGap = 'input' | 'input-mismatch' | 'action-failed' | 'verify' | 'observation-mismatch' | '';

export type DesktopExecutionEvidence = {
  name: string;
  readOnly: boolean;
  ok: boolean;
  inputMatchesRequestedText?: boolean;
  observationShowsRequestedText?: boolean;
};

const DESKTOP_INPUT_PATTERN = /(?:输入(?!法|设置)|键入|打字|录入|填写|(?:^|[^a-z0-9_])(?:type(?:\s+in)?|typing|enter(?:ing)?\s+(?:(?:any|some|the|a)\s+)?(?:text|anything|content|a\s+message)|input(?:ting)?\s+(?:(?:any|some)\s+)?(?:text|anything|content|a\s+message))(?=$|[^a-z0-9_]))/ig;
const DESKTOP_CAPTURE_PATTERN = /(?:屏幕截图|截图|截屏|screenshot|screen\s*shot|screen\s*capture|capture\s+(?:the\s+)?screen)/ig;
const INTENT_CLAUSE_BOUNDARY = /[\n。！？；，,.!?;:]|\b(?:but|however|yet)\b|但是|不过|但/i;
const COORDINATED_INTENT = /^\s*[,，]?\s*(?:and|or|nor|and\/or|和|或|或者|以及|并且|及|、)\s*$/i;
const CHINESE_INTENT_NEGATION = /(?:请)?(?:不要|请勿|切勿|禁止|严禁|不准|避免|无需|不需要|不必|不用|不想|不|别)(?:任何|再|给我|帮我|去|进行|获取|拍|制作|截取|做)?\s*$/i;
const ENGLISH_INTENT_NEGATION = /(?:\b(?:please\s+)?(?:do\s+not|don['’]t|dont|must\s+not|mustn['’]t|should\s+not|shouldn['’]t|never|avoid)|\bnot|\bno(?:\s+(?:(?:need|reason)\s+to))?|\bwithout)\s*(?:(?:ever|need(?:\s+to)?|take|taking|type|typing|enter(?:ing)?|input(?:ting)?|capture|capturing|get|getting|make|making|snap|snapping)\s+)*(?:(?:a|the|any|some)\s+)?$/i;

function classifyLatestIntent(instruction: string, pattern: RegExp) {
  const matches = [...instruction.matchAll(pattern)] as DesktopIntentMatch[];
  let previousEnd = -1;
  let previousWasNegated: boolean = false;
  let latestWasNegated: boolean = false;

  for (const match of matches) {
    const prefix = instruction.slice(0, match.index);
    const clause = prefix.split(INTENT_CLAUSE_BOUNDARY).at(-1) || '';
    const betweenMatches = instruction.slice(previousEnd, match.index);
    const coordinatedNegation: boolean = previousWasNegated && COORDINATED_INTENT.test(betweenMatches);
    latestWasNegated = CHINESE_INTENT_NEGATION.test(clause) || ENGLISH_INTENT_NEGATION.test(clause) || coordinatedNegation;
    previousEnd = match.index + match[0].length;
    previousWasNegated = latestWasNegated;
  }

  return {
    requested: matches.length > 0 && !latestWasNegated,
    explicitlyForbidden: matches.length > 0 && latestWasNegated,
  };
}

export function classifyDesktopInstruction(instruction: string): DesktopInstructionPolicy {
  const input = classifyLatestIntent(instruction, DESKTOP_INPUT_PATTERN);
  const screenshot = classifyLatestIntent(instruction, DESKTOP_CAPTURE_PATTERN);
  return {
    inputRequested: input.requested,
    inputExplicitlyForbidden: input.explicitlyForbidden,
    requestedInputText: input.requested ? extractDesktopRequestedInputText(instruction) : null,
    screenshotRequested: screenshot.requested,
    screenshotExplicitlyForbidden: screenshot.explicitlyForbidden,
  };
}

export function desktopCompletionGap(input: {
  active: boolean;
  inputRequested: boolean;
  requestedInputText: string | null;
  screenshotRequested: boolean;
  screenshotExplicitlyForbidden: boolean;
  evidence: readonly DesktopExecutionEvidence[];
}): DesktopCompletionGap {
  if (!input.active) return '';
  const normalizeToolName = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
  if (input.evidence.some((tool) => !tool.readOnly && !tool.ok)) return 'action-failed';
  const typingUses = input.evidence.filter((tool) => tool.ok && /^(?:type|sendkeys|keyboardtype|keyboardinput)$/.test(normalizeToolName(tool.name)));
  if (input.inputRequested && !typingUses.length) return 'input';
  if (input.requestedInputText !== null && typingUses.at(-1)?.inputMatchesRequestedText !== true) return 'input-mismatch';

  const lastActionIndex = input.evidence.findLastIndex((tool) => !tool.readOnly);
  const observationPattern = input.screenshotRequested
    ? /^(?:screenshot)$/
    : input.screenshotExplicitlyForbidden ? /^(?:snapshot|waitfor)$/ : /^(?:snapshot|screenshot|waitfor)$/;
  const freshObservations = input.evidence.filter((tool, index) => tool.ok
    && tool.readOnly
    && observationPattern.test(normalizeToolName(tool.name))
    && (lastActionIndex < 0 || index > lastActionIndex));
  if (!freshObservations.length) return 'verify';
  if (input.requestedInputText !== null && !freshObservations.some((tool) => tool.observationShowsRequestedText === true)) return 'observation-mismatch';
  return '';
}

function extractDesktopRequestedInputText(instruction: string): string | null {
  const matches = [...instruction.matchAll(DESKTOP_INPUT_PATTERN)] as DesktopIntentMatch[];
  const latest = matches.at(-1);
  if (!latest || classifyLatestIntent(instruction, DESKTOP_INPUT_PATTERN).requested !== true) return null;

  const remainder = instruction.slice(latest.index + latest[0].length);
  const quoted = /["']([^"']+)["']|“([^”]+)”|‘([^’]+)’|「([^」]+)」|『([^』]+)』/.exec(remainder);
  const quotedText = quoted?.slice(1).find((part) => typeof part === 'string');
  if (quotedText) return quotedText;

  const candidate = remainder
    .trimStart()
    .replace(/^(?:\s|[,，:：=])+/u, '')
    .replace(/^(?:(?:the\s+)?(?:following\s+)?(?:text|content|message)|(?:以下|这段|這段)?(?:文字|文本|内容|內容)|如下)(?:\s|[:：，,])*/iu, '');
  const continuation = candidate.search(/[\n,，。；;!?！？]|(?:然后|接着|之後|之后|并截图|再截图)|\s+(?:and\s+then|then|afterwards)\b/iu);
  const text = (continuation >= 0 ? candidate.slice(0, continuation) : candidate).trim();
  return text && text.length <= 2_000 ? text : null;
}

export function isDesktopTextInputTool(toolName: string, args: unknown): boolean {
  const normalizedName = toolName.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(?:type|sendkeys|keyboardtype|keyboardinput|keyboardwrite|multiedit|clipboard)$/.test(normalizedName)) return true;
  if (normalizedName !== 'shortcut') return false;

  const shortcut = JSON.stringify(args ?? {}).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(?:ctrl|control|cmd|meta|win|windows)(?:\s+(?:ctrl|control|cmd|meta|shift|win|windows))*\s+v\b|\bshift\s+insert\b|\bpaste\b/.test(shortcut);
}

export function isDesktopScreenshotTool(toolName: string): boolean {
  const normalizedName = toolName.toLowerCase().replace(/[^a-z]/g, '');
  return /^(?:screenshot|takescreenshot|capturescreenshot|screencapture|capturescreen)$/.test(normalizedName);
}

/** Re-checks explicit desktop restrictions at every execution boundary. */
export function desktopInstructionToolDenial(input: {
  instruction: string;
  catalogId: string | undefined;
  toolName: string;
  args: unknown;
}): string | null {
  if (input.catalogId !== 'windows-mcp') return null;

  const policy = classifyDesktopInstruction(input.instruction);
  if (policy.inputExplicitlyForbidden && isDesktopTextInputTool(input.toolName, input.args)) {
    return '用户明确禁止输入文字，因此桌面输入工具没有执行。请勿改用其他工具输入或粘贴文字。';
  }
  if (policy.screenshotExplicitlyForbidden && isDesktopScreenshotTool(input.toolName)) {
    return '用户明确禁止截图，因此 Screenshot 工具没有执行。请用 Snapshot 或 WaitFor 核验桌面操作。';
  }
  return null;
}
