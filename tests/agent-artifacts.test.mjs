import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const clientTypes = await readFile(new URL('../lib/agent-client.ts', import.meta.url), 'utf8');
const historyTypes = await readFile(new URL('../lib/client-history.ts', import.meta.url), 'utf8');
const downloadRoute = await readFile(new URL('../app/api/artifacts/[id]/route.ts', import.meta.url), 'utf8');
const artifactTools = await readFile(new URL('../lib/tools/artifacts.ts', import.meta.url), 'utf8');
const fileTools = await readFile(new URL('../lib/tools/file.ts', import.meta.url), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('Agent 暴露四个 Office/ZIP 工具并保持 file_generate 只做文本', () => {
  for (const tool of ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'archive_generate']) {
    assert.match(artifactTools, new RegExp(`name: '${tool}'`));
  }
  assert.match(route, /import \{ isArchiveToolCall, isArtifactToolCall, isImageToolCall, isSkillToolCall, toolExecutionKind, toolSchemasFor \} from '@\/lib\/tools';/);
  assert.match(fileTools, /Word\/Excel\/PPT\/ZIP 必须用专用工具，不允许把 Office 或 ZIP 内容编码成 base64 塞进来/);
  assert.match(route, /绝对不要把 \.docx\/\.xlsx\/\.pptx\/\.zip 的内容编码成 base64 交给 file_generate/);
  assert.match(route, /当前不支持解析用户上传的 Word\/Excel\/PPT 内容/);
});

test('Office 工具按需下发，避免每次对话都带上工具 schema', () => {
  assert.match(route, /likelyArtifactGenerationRequest/);
  assert.match(route, /const artifactGenerationRequest = fileGenerationRequest/);
  assert.match(route, /const callableTools = toolSchemasFor\(gatingContext, mcpTools\);/);
  assert.match(route, /deliveryRequest: artifactGenerationRequest,/);
  assert.match(route, /const artifactToolsOnly = callableTools\.filter\(\(tool: any\) => isArtifactToolCall\(\{ function: \{ name: tool\?\.function\?\.name \} \}\)\);/);
});

test('archive_generate 排在最后执行，并能带上本轮生成的文件', () => {
  const sortIndex = route.indexOf('const executionCalls = [...toolCalls].sort');
  assert.notEqual(sortIndex, -1);
  const sortLine = route.slice(sortIndex, route.indexOf('\n', sortIndex));
  assert.match(sortLine, /Number\(isArchiveToolCall\(left\)\) - Number\(isArchiveToolCall\(right\)\)/);
  assert.match(route, /for \(const call of executionCalls\)/);
  assert.match(route, /args\.includeGeneratedThisTurn === false/);
  assert.match(route, /const collected = await collectArchiveEntries\(ids\);/);
});

test('Office/ZIP 结果只回传元数据，绝不带 content', () => {
  const helper = functionBody(route, 'generatedFileFromArtifact');
  assert.match(helper, /artifactId: artifact\.id/);
  assert.match(helper, /downloadUrl: artifact\.downloadUrl/);
  assert.doesNotMatch(helper, /content/);
  assert.match(route, /Round 最多生成|本轮最多生成/);
  assert.match(route, /ARTIFACT_MAX_PER_TURN/);
});

test('历史文件保留 artifact 元数据，且只给模型摘要', () => {
  assert.match(route, /typeof file\.content === 'string' \|\| isValidArtifactId\(file\.artifactId\)/);
  const normalizer = functionBody(route, 'normalizeHistoryFile');
  assert.match(normalizer, /artifactId/);
  assert.match(normalizer, /downloadUrl: artifactDownloadUrl\(artifactId\)/);
  assert.match(route, /\[上一条回复已生成文件：/);
});

test('下载路由要求本机可信请求，并且只按 id 取件', () => {
  assert.match(downloadRoute, /export const runtime = 'nodejs';/);
  assert.match(downloadRoute, /isTrustedAppRequest\(request\)/);
  assert.match(downloadRoute, /buildArtifactResponse\(String\(id \|\| ''\)\)/);
  assert.doesNotMatch(downloadRoute, /searchParams\.get\('path'\)/);
});

test('前端：artifact 文件走服务端下载地址，失败给出提示，旧文件继续内联下载', () => {
  const download = functionBody(page, 'downloadChatFile');
  assert.match(download, /if \(file\.downloadUrl\)/);
  assert.match(download, /fetch\(file\.downloadUrl, \{ cache: 'no-store' \}\)/);
  assert.match(download, /文件已过期或被清理/);
  assert.match(download, /file\.encoding === 'base64'/, '旧的内联文本文件下载逻辑必须保留');
  assert.match(page, /chatFileTypeLabel/);
});

test('前端 payload 与历史都保留 artifactId，避免二次对话丢失文件', () => {
  const filterMatches = page.match(/typeof file\.content === 'string' \|\| typeof file\.artifactId === 'string'/g) || [];
  assert.equal(filterMatches.length, 2);
  const payloadMatches = page.match(/\.\.\.\(file\.artifactId \? \{ artifactId: file\.artifactId \} : \{\}\),/g) || [];
  assert.equal(payloadMatches.length, 2);
});

test('共享类型把 content 变成可选并新增 artifact 字段', () => {
  assert.match(clientTypes, /export type AgentGeneratedFile = \{[\s\S]*content\?: string;/);
  assert.match(clientTypes, /artifactId\?: string;/);
  assert.match(clientTypes, /export type AgentClientFile = \{[\s\S]*content\?: string;/);
  assert.match(historyTypes, /export type ChatFile = \{[\s\S]*content\?: string;/);
  assert.match(historyTypes, /downloadUrl\?: string;/);
});

test('文件交付意图在“1/好/可以”这种追问里也要保留，而且不能走直连流式', () => {
  assert.match(route, /isArtifactFollowUpRequest\(previousAssistantText, latestInstruction\)/);
  assert.match(route, /const artifactFollowUpRequest = /);
  assert.match(route, /\|\| artifactFollowUpRequest/);
  assert.match(route, /const nativeNeedsContinuation = imageGenerationRequest \|\| fileGenerationRequest \|\| artifactGenerationRequest;/);
  const directIndex = route.indexOf('const directStream = ');
  assert.notEqual(directIndex, -1);
  assert.match(route.slice(directIndex, route.indexOf(';', directIndex)), /&& !artifactGenerationRequest$/);
  const searchedIndex = route.indexOf('const searchedStream = ');
  assert.notEqual(searchedIndex, -1);
  assert.match(route.slice(searchedIndex, route.indexOf(';', searchedIndex)), /&& !artifactGenerationRequest$/);
  assert.match(route, /只要工具没有真正返回成功，就绝对不要说“已生成…文件”/);
  assert.match(route, /本轮是上文交付选项的确认/);
});

test('同轮“先生成再打包”会补一轮交付物工具，而不是把调用写成文本标记', () => {
  assert.match(route, /const ARTIFACT_TOOL_MAX_ROUNDS = 2;/);
  assert.match(route, /const artifactToolsOnly = callableTools\.filter\(\(tool: any\) => isArtifactToolCall\(\{ function: \{ name: tool\?\.function\?\.name \} \}\)\);/);
  assert.match(route, /const runArtifactToolCall = async \(call: any\): Promise<ChatMessage> => \{/);
  assert.match(route, /if \(kind === 'artifact'\) \{/);
  assert.match(route, /toolResults\.push\(await runArtifactToolCall\(call\)\);/);
  assert.match(route, /if \(artifactGenerationRequest && artifactToolsOnly\.length && toolCalls\.some\(isArtifactToolCall\)/);
  assert.match(route, /followupResults\.push\(await runArtifactToolCall\(followupCall\)\);/);
  assert.match(route, /if \(followupText \|\| artifactFollowupText\) finalText = followupText \|\| artifactFollowupText;/);
  assert.match(route, /必须真的调用 archive_generate 打包/);
});

test('模型把工具调用写成文本标记时，交付物请求会补一次原生工具轮', () => {
  assert.match(route, /if \(!toolCalls\.length && artifactGenerationRequest && artifactToolsOnly\.length\) \{/);
  assert.match(route, /不要把工具调用写成文本标记/);
  assert.match(route, /toolCallMessage = message;/);
  assert.match(route, /toolCallMessage = retryMessage;/);
  assert.match(route, /content: toolCallMessage\?\.content \|\| null, tool_calls: toolCalls/);
});

test('历史里助手生成的文件回传 artifact 元数据，跨轮打包才拿得到 id', () => {
  assert.match(page, /function historyArtifactFiles\(message\) \{/);
  assert.match(page, /message\.role !== 'assistant'/);
  const payloadMatches = page.match(/\)\) : historyArtifactFiles\((m|item)\)/g) || [];
  assert.equal(payloadMatches.length, 2);
});

test('document_generate 的 sections 暴露生成器已支持的有序列表与代码块', () => {
  const sectionStart = artifactTools.indexOf("description: '结构化章节；与 markdown 二选一或同时使用。'");
  assert.notEqual(sectionStart, -1);
  const schema = artifactTools.slice(sectionStart, artifactTools.indexOf('required: [],', sectionStart));
  assert.match(schema, /orderedBullets: \{ type: 'array', items: \{ type: 'string' \}, description: '有序列表，按 1\. 2\. 3\. 编号排版。' \}/);
  assert.match(schema, /code: \{ type: 'array', items: \{ type: 'string' \}, description: '代码块，每项一段，用等宽字体加底纹排版。' \}/);
});
