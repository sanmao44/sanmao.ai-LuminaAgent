import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const readSource = (name) => readFile(new URL(name, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const informationModule = { exports: {} };
new Function('require', 'module', 'exports', compile(await readSource('../packages/agent-core/information-routing.ts')))(
  (id) => { if (id === '../contracts/planning') return {}; throw new Error(id); }, informationModule, informationModule.exports,
);
const snapshotModule = { exports: {} };
new Function('require', 'module', 'exports', compile(await readSource('../packages/agent-core/capability-snapshot.ts')))(
  () => { throw new Error('unexpected dependency'); }, snapshotModule, snapshotModule.exports,
);

test('information source routing separates product capability from external facts', () => {
  const classify = informationModule.exports.classifyAgentInformationSource;
  assert.equal(classify('你目前PPT创作能力如何？', {
    capabilityQuestion: true, browserAutomation: false, filesystem: false, externalAction: false, webShouldSearch: true,
  }).source, 'internal-capability');
  assert.equal(classify('今天 AI 行业有什么新闻？', {
    capabilityQuestion: false, browserAutomation: false, filesystem: false, externalAction: false, webShouldSearch: true,
  }).source, 'external-web');
  assert.equal(classify('什么是 MCP？', {
    capabilityQuestion: true, browserAutomation: false, filesystem: false, externalAction: false, webShouldSearch: false,
  }).source, 'model-knowledge');
});

test('capability snapshot is read-only runtime context', () => {
  const text = snapshotModule.exports.formatAgentCapabilitySnapshot({
    currentModel: { displayName: 'Test Chat', providerName: 'Test Provider', nativeWebSearch: true },
    web: { mode: 'auto', externalSearchConfigured: false },
    tools: { word: true, excel: true, ppt: true, archive: false, file: true },
    images: { generateModels: 2, editModels: 1 },
  });
  assert.match(text, /Test Chat/);
  assert.match(text, /PPT/);
  assert.match(text, /ZIP 压缩包：当前不可用/);
  assert.match(text, /不要调用生成、搜索或文件工具/);
});
