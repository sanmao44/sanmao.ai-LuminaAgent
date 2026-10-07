/**
 * 「浏览器工具怎么用」这件事得明确告诉模型——它拿到的只有上游那几句英文 schema。
 *
 * 背景（本机真实故障）：Playwright MCP 的元素定位参数叫 target，值必须是快照里
 * [ref=f5e14] 的那个 f5e14——上游源码就是拿 /^(f\d+)?e\d+$/ 判的，命中才走 aria-ref
 * 定位，否则整串当 CSS 选择器解析。模型看到英文报错后只会换个选择器再试，
 * 于是每次都「找不到元素」，用户看到的就是「浏览器打开了，然后就停住」。
 */

/**
 * 上游判断「元素定位参数写错了」的几种原话。
 * 只认这几句：别的报错另有原因，乱加解释只会把模型带偏。
 */
const LOCATOR_MISUSE: readonly RegExp[] = [
  /Unknown engine "ref" while parsing selector/i,
  /while parsing css selector/i,
  /does not match any elements/i,
  /not found in the current page snapshot/i,
];

/**
 * 定位参数写错时的中文纠错，直接补在工具结果后面给模型看。
 * 不是这类错就返回 null，调用方原样返回上游原文。
 */
export function browserTargetHint(text: unknown): string | null {
  const raw = String(text ?? '');
  if (!raw || !LOCATOR_MISUSE.some((pattern) => pattern.test(raw))) return null;
  return [
    'SANMAO：这次不是网页没打开，是元素定位参数写错了。按下面改一次就能继续：',
    '1. 先调用 browser_snapshot 取当前快照；每次导航、点击之后 ref 会整批换掉，上一步的 ref 一定失效。',
    '2. 快照里形如 [ref=f5e14] 的只是标记：把它的值 f5e14 填进该工具的 target 参数（旧版本叫 ref），例如 {"target":"f5e14","element":"搜索框"}。',
    '3. 不要填 ref=f5e14，不要整行抄「- generic [ref=f5e14]」，不要猜 CSS 选择器（如 input#app-search-int i.search-input）。快照附带的 SANMAO 当前页面可编辑控件 target 已经验证，可以直接用于输入。',
    '4. element 字段只写给人看的描述，不参与定位。目标元素确实不在快照里时，先看是否要滚动或展开，再重新快照，不要重复猜同一个选择器。',
  ].join('\n');
}

/**
 * 模型有时已经知道还有下一步，却先输出一句自然语言：
 * “现在继续提交评论”。这不是完成信号，路由层需要把它送回浏览器工具循环。
 */
const BROWSER_INCOMPLETE_TEXT = /(?:未(?:完成|提交|执行|处理)|尚未|仍在|暂时(?:无法|不能)|无法(?:提交|完成|执行)|未能|待(?:加载|处理)|失败|not\s+(?:done|completed|submitted)|still\s+(?:loading|pending)|unable\s+to|could(?:n't| not))/i;
const BROWSER_PENDING_ACTION_TEXT = /(?:现在|接下来|下一步|然后|继续).{0,32}(?:提交|发送|评论|回复|输入|点击|点赞|收藏|关注|登录|播放)/i;

export function browserTextNeedsContinuation(text: unknown) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return Boolean(value) && (BROWSER_INCOMPLETE_TEXT.test(value) || BROWSER_PENDING_ACTION_TEXT.test(value));
}

/** Only retained in this request; arguments and page text are not sent to the UI/audit log. */
export type BrowserToolUse = { name?: unknown; ok?: unknown; args?: Record<string, unknown>; result?: string };

export const BROWSER_EXECUTION_LIMITS = {
  maxCalls: 32,
  recoveryPrompts: 8,
  // One tool per model turn, plus recovery turns and a final verification reply.
  maxSteps: 41,
  toolTimeMs: 300_000,
  deadlineMs: 600_000,
} as const;

function requestedComment(instruction: unknown) {
  return String(instruction ?? '').match(/(?:评论|回复|留言|comment|reply)[：:\s]*(?:["“「『‘'])([\s\S]+?)["”」』’']/i)?.[1] || '';
}

/** Use page evidence, not the model's assertion, to recognize a user-only blocker. */
export function browserExternalBlocker(uses: readonly BrowserToolUse[]) {
  const page = [...uses].reverse().find((use) => use.ok && use.name === 'browser_snapshot');
  const text = page?.result || '';
  if (/(?:请先登录|登录后(?:才能|才可|可)(?:评论|回复|点赞)|log in to (?:comment|reply|like))/i.test(text)) return '页面要求先登录';
  if (/(?:请完成(?:安全|人机|滑块)验证|拖动滑块完成验证|verify you are human)/i.test(text)) return '页面要求完成人机验证';
  return '';
}

/**
 * 评论/回复是有明确副作用的连续动作，不能只相信模型的收尾文字。
 * 返回第一个缺失的环节，调用方据此要求模型补齐输入、发送和验证。
 */
export function browserTextSubmissionGap(instruction: unknown, uses: readonly BrowserToolUse[]) {
  const expected = requestedComment(instruction);
  if (!expected) return '';
  const inputIndex = uses.findIndex((use) => {
    if (!use.ok) return false;
    if (use.name === 'browser_type') return use.args?.text === expected;
    return use.name === 'browser_fill_form' && Array.isArray(use.args?.fields)
      && use.args.fields.some((field) => field?.value === expected);
  });
  if (inputIndex < 0) return 'input';
  // A failed send may still have taken effect. Require verification before any replay.
  const submitIndex = uses.findIndex((use, index) => index >= inputIndex && (
    (index === inputIndex && use.args?.submit === true)
    || (use.name === 'browser_click' && /发送|发表|提交|发布|send|submit|post/i.test(String(use.args?.element || '')))
    || (use.name === 'browser_press_key' && /^(?:Control\+|Meta\+)?Enter$/.test(String(use.args?.key || '')))
  ));
  if (submitIndex < 0) return 'submit';
  const evidence = (use: BrowserToolUse) => {
    // Only inspect the rendered snapshot, excluding executed code and editable values.
    const snapshot = (use.result || '').split('### Snapshot')[1] || '';
    const lines = snapshot.split('\n');
    let editableIndent = -1;
    return lines.filter((line) => {
      const indent = line.search(/\S/);
      if (editableIndent >= 0 && indent > editableIndent) return false;
      editableIndent = -1;
      if (/\b(?:textbox|searchbox)\b/.test(line)) { editableIndent = indent; return false; }
      return /(?:评论|回复|发表|发送)(?:已)?成功|successfully posted/i.test(line)
        || (/^\s*- (?:paragraph|text|article|listitem)(?:\s|:)/.test(line) && line.includes(expected));
    }).map((line) => line.replace(/\[ref=[^\]]+\]/g, '').trim());
  };
  const before = [...uses.slice(0, submitIndex)].reverse().find((use) => use.ok && use.name === 'browser_snapshot');
  const previousEvidence = before ? evidence(before) : [];
  const verify = uses.slice(submitIndex + 1).some((use) => use.ok && use.name === 'browser_snapshot'
    && evidence(use).some((line) => !previousEvidence.includes(line)));
  if (!verify) return 'verify';
  return '';
}

/**
 * 这一轮接了浏览器控制时，追加到系统提示里的使用约定。
 * 上游 schema 只有一句 "Exact target element reference from the page snapshot"，
 * 很容易被理解成「把快照里那串 ref=… 抄进来」——实测就是这么错的。
 */
export const BROWSER_TOOL_GUIDE = [
  '浏览器操作约定（这一轮接了浏览器控制，请照做）：',
  '1. 定位元素只认快照里的 ref：先调用 browser_snapshot，结果里 [ref=f5e14] 这种标记，要用的值是 f5e14。',
  '2. 点击、输入、选择时把这个值填进 target 参数（旧版本叫 ref），例如 {"target":"f5e14","element":"搜索框"}；element 字段只写给人看的描述。',
  '3. 不要把 ref=f5e14 连前缀或整行快照填进 target，也不要猜 CSS 选择器。优先使用最新 ref；只有该工具 schema 支持选择器、且已通过当前页面 DOM 检查确认唯一目标时，才可使用实际存在的选择器。',
  '4. 每次导航、点击、回车之后 ref 会整批重新分配：下一步操作之前必须重新 browser_snapshot，不要凭记忆用旧 ref。',
  '5. 页面特别大时快照会被截断（末尾会说明）：给 browser_snapshot 传 depth 或 target 收窄范围重取，不要靠猜。',
  '6. 对输入、评论、回复或表单提交，不能只调用 browser_find：先 browser_snapshot 定位编辑框，再用 browser_type 或 browser_fill_form 写入完整文本；重新 browser_snapshot 确认文本确实出现后，定位并 browser_click 发送/提交；最后再次 browser_snapshot，确认评论出现在列表或页面给出成功提示。',
  '7. 多步骤任务必须一直执行到用户列出的全部目标完成；不能只打开网站、只完成搜索或只完成点赞就结束。每完成一步都重新 browser_snapshot，确认结果后再做下一步。',
  '8. 如果 browser_* 返回错误、空结果、操作被中断，或你说“现在继续/尚未/未能完成”，说明还有动作没做完：先重新 browser_snapshot 判断当前状态，未生效就按当前快照修正参数后继续，不能因为一次失败直接结束整段命令。',
  '9. 一轮里外部工具的次数和总时长都有上限。接近上限时仍须先核对用户命令；只有遇到登录、验证码等无法由助手解决的外部阻塞，才能停止并明确说明。不要用同一套参数反复重试。',
  '10. 评论区显示加载中时，先滚动到评论区触发懒加载，再等待并取快照；不要在页面顶部反复等待。可用 browser_press_key 的 PageDown，或已提供的 browser_evaluate 对已确认评论区域调用 scrollIntoView。',
  '11. 富文本编辑器可能是 contenteditable，在快照中只是 generic 而不是 textbox。占位提示可能被编辑器覆盖；点击超时提示 intercepts pointer events 时，检查实际编辑器，不要反复点占位文字。必要时用已提供的 browser_evaluate 只读检查 DOM（包括开放的 shadowRoot），确认可见编辑器，再用 browser_type 输入；不要用脚本直接调用网站发评论接口。',
  '12. 评论输入框里的文字不代表发表成功。提交后核验评论列表中的完整文字或明确成功提示；结果不确定时先核验，不能重复发送。点赞也要先确认是否已经点亮，避免再次点击取消点赞。',
  '13. 快照附带 SANMAO 当前页面可编辑控件时，优先从中选与目标相符的编辑器，把完整 target 原样交给 browser_type。shadowHost 表明控件在 Shadow DOM 内，document.querySelector/getElementById 找不到它不代表不存在；不要反复使用只查询 document 的脚本。',
  '14. 搜索词必须与用户原话逐字一致。优先在搜索框输入原文；使用搜索 URL 后必须检查页面搜索词，不能手写错误的百分号编码。发现搜索词不同应先更正，再选择结果及执行点赞评论。',
].join('\n');

/** Instructions for the native Tabbit backend. It intentionally does not
 * mention the Playwright Extension MCP tool names. */
export const TABBIT_BROWSER_TOOL_GUIDE = [
  'Tabbit 浏览器操作约定：本轮使用 tabbit_browser，不使用 Playwright Extension。',
  '1. 先用 tabs 或 diagnose 发现当前页面；浏览器任务选一个简短稳定的 task 名称，并在后续所有调用中复用它。',
  '2. 用 nodejs 在 Tabbit 自有 Browser-owned Playwright 运行时执行 JavaScript。每次脚本都要 return 有界、JSON 可序列化的结果；不要返回 Page、Locator、DOM、JSHandle 或无限文本。',
  '3. 只读脚本才设置 readOnly=true；导航、点击、输入、聚焦、滚动、选择和其他会改变页面状态的操作必须设置 readOnly=false。',
  '4. 先观察再操作；导航或页面变化后重新获取页面状态。需要输入时使用原生 Playwright locator/action，不要调用网站私有 API。',
  '5. 登录、验证码、付款、发布、删除和其他不可逆动作在最后确认前停止；工具没有返回成功证据时不要声称完成。',
].join('\n');
