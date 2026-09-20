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
    '3. 不要填 ref=f5e14，不要整行抄「- generic [ref=f5e14]」，也不要自己写 CSS 选择器（如 input#app-search-int i.search-input）：这三种都会被当成选择器解析，然后报「找不到元素」。',
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

export type BrowserToolUse = { name?: unknown; ok?: unknown };

/**
 * 评论/回复是有明确副作用的连续动作，不能只相信模型的收尾文字。
 * 返回第一个缺失的环节，调用方据此要求模型补齐输入、发送和验证。
 */
export function browserTextSubmissionGap(instruction: unknown, uses: readonly BrowserToolUse[]) {
  const text = String(instruction ?? '').replace(/\s+/g, ' ').trim();
  if (!/(?:评论|回复|留言|comment|reply).{0,60}(?:["“「『]|发表|提交|发送|输入)/i.test(text)) return '';
  const successful = uses
    .map((use, index) => ({ name: String(use?.name || ''), ok: use?.ok === true, index }))
    .filter((use) => use.ok);
  const input = successful.find((use) => use.name === 'browser_type' || use.name === 'browser_fill_form');
  if (!input) return 'input';
  const submit = successful.find((use) => use.index > input.index && use.name === 'browser_click');
  if (!submit) return 'submit';
  const verify = successful.find((use) => use.index > submit.index && use.name === 'browser_snapshot');
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
  '3. 绝对不要把 ref=f5e14 连前缀一起填，不要整行抄快照文字，也不要自己编 CSS 选择器（如 input#app-search-int）——这三种都会报「找不到元素」，白白浪费一次调用。',
  '4. 每次导航、点击、回车之后 ref 会整批重新分配：下一步操作之前必须重新 browser_snapshot，不要凭记忆用旧 ref。',
  '5. 页面特别大时快照会被截断（末尾会说明）：给 browser_snapshot 传 depth 或 target 收窄范围重取，不要靠猜。',
  '6. 对输入、评论、回复或表单提交，不能只调用 browser_find：先 browser_snapshot 定位编辑框，再用 browser_type 或 browser_fill_form 写入完整文本；重新 browser_snapshot 确认文本确实出现后，定位并 browser_click 发送/提交；最后再次 browser_snapshot，确认评论出现在列表或页面给出成功提示。',
  '7. 多步骤任务必须一直执行到用户列出的全部目标完成；不能只打开网站、只完成搜索或只完成点赞就结束。每完成一步都重新 browser_snapshot，确认结果后再做下一步。',
  '8. 如果 browser_* 返回错误、空结果、操作被中断，或你说“现在继续/尚未/未能完成”，说明还有动作没做完：先重新 browser_snapshot 判断当前状态，未生效就按当前快照修正参数后继续，不能因为一次失败直接结束整段命令。',
  '9. 一轮里外部工具的次数和总时长都有上限。接近上限时仍须先核对用户命令；只有遇到登录、验证码等无法由助手解决的外部阻塞，才能停止并明确说明。不要用同一套参数反复重试。',
].join('\n');
