import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { buildToolsModule } from './tools-build.mjs';

const outputFile = path.join(process.cwd(), '.data', `claude-code-tool-schema-test-${process.pid}.mjs`);
await mkdir(path.dirname(outputFile), { recursive: true });
const source = await readFile(path.join(process.cwd(), 'lib/claude-code-tool-schema.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'lib/claude-code-tool-schema.ts',
}).outputText;
await writeFile(outputFile, compiled);
const { createSdkToolSchema } = await import(pathToFileURL(outputFile).href);
const { TOOL_REGISTRY } = await buildToolsModule();

after(async () => rm(outputFile, { force: true }));

const cases = {
  document_generate: [{ sections: [{ heading: 'Overview', tables: [{ rows: [['Name', 3, null]] }], images: [{ ref: '/image.png' }] }] }, { sections: [{ tables: [{}] }] }],
  spreadsheet_generate: [{ sheets: [{ columns: [{ key: 'name', header: 'Name', width: 20 }], rows: [{ name: 'Ada' }, ['Grace', null, 7]] }] }, { sheets: [{ columns: [{ key: 'name' }] }] }],
  presentation_generate: [{ slides: [{ layout: 'chart', chart: { series: [{ values: [2, null, 5] }], categories: ['A', 2] }, rows: [['A', 1]] }] }, { slides: [{ layout: 'unknown' }] }],
  image_generate: [{ prompts: ['A mountain at dawn', 'A lake at dusk'], count: 2 }, { prompts: [''], count: 2 }],
  image_edit: [{ prompt: 'Remove the background' }, { prompts: [], count: 1 }],
  file_generate: [{ files: [{ filename: 'notes.txt', content: 'hello', encoding: 'utf8' }] }, { files: [{ filename: 'notes.txt' }] }],
  archive_generate: [{ artifactIds: ['artifact-1'], includeGeneratedThisTurn: true }, { artifactIds: 'artifact-1' }],
  web_search: [{ query: 'recent model runtime changes' }, { query: 42 }],
  skill_search: [{ query: 'video download' }, { query: false }],
  skill_read: [{ id: 'video-download', offset: 10, file: 'references/guide.md' }, { id: 'video-download', offset: '10' }],
  skill_install: [{ name: 'helper', body: '# Steps', tags: 'tools, setup' }, { name: 3 }],
  mcp_manage: [{ action: 'add', headers: { Authorization: 'Bearer token', 'X-Trace': 'abc' } }, { action: 'unknown' }],
  canvas_patch: [{ version: 1, operations: [{ op: 'connect', source: 'a', target: 'b', sourcePort: 'left', order: 2 }] }, { version: 2, operations: [{ op: 'connect' }] }],
  video_download: [{ url: 'https://example.com/video.mp4', format: 'best' }, { url: 'not a uri' }],
};

test('all fourteen built-in tool schemas convert and validate representative inputs', () => {
  assert.equal(TOOL_REGISTRY.length, 14);
  assert.deepEqual(Object.keys(cases).sort(), TOOL_REGISTRY.map((tool) => tool.name).sort());

  for (const definition of TOOL_REGISTRY) {
    const converted = createSdkToolSchema(definition.schema);
    assert.equal(converted.supported, true, `${definition.name}: ${converted.reason || ''}`);
    const [valid, invalid] = cases[definition.name];
    assert.equal(converted.validate(valid), true, `${definition.name} should accept representative input`);
    assert.equal(converted.validate(invalid), false, `${definition.name} should reject representative invalid input`);
    assert.deepEqual(Object.keys(converted.shape).sort(), Object.keys(definition.schema.properties || {}).sort());
  }
});

test('image prompt and prompts anyOf requires at least one branch while accepting either', () => {
  const image = TOOL_REGISTRY.find((tool) => tool.name === 'image_generate');
  const converted = createSdkToolSchema(image.schema);
  assert.equal(converted.supported, true);
  assert.equal(converted.validate({ prompt: 'A red bicycle' }), true);
  assert.equal(converted.validate({ prompts: ['A red bicycle'] }), true);
  assert.equal(converted.validate({ prompt: 'A red bicycle', prompts: ['A blue bicycle'] }), true);
  assert.equal(converted.validate({}), false);
});

test('legacy file_generate array maximum remains enforced as an item limit', () => {
  const file = TOOL_REGISTRY.find((tool) => tool.name === 'file_generate');
  const converted = createSdkToolSchema(file.schema);
  const files = Array.from({ length: 9 }, (_, index) => ({ filename: `${index}.txt`, content: 'x' }));
  assert.equal(converted.supported, true);
  assert.equal(converted.validate({ files: files.slice(0, 8) }), true);
  assert.equal(converted.validate({ files }), false);
});

test('nullable unions preserve null and recursively validate array contents', () => {
  const converted = createSdkToolSchema({
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: ['string', 'number', 'null'] } },
      maybe: { type: ['string', 'null'] },
    },
    required: ['values', 'maybe'],
  });
  assert.equal(converted.supported, true);
  assert.equal(converted.validate({ values: ['x', 2, null], maybe: null }), true);
  assert.equal(converted.validate({ values: ['x', false], maybe: null }), false);
  assert.equal(converted.validate({ values: [], maybe: undefined }), false);
});

test('open objects pass through unknown fields and explicit false rejects them', () => {
  const open = createSdkToolSchema({ type: 'object', properties: { known: { type: 'string' } } });
  const strict = createSdkToolSchema({ type: 'object', properties: { known: { type: 'string' } }, additionalProperties: false });
  const input = { known: 'value', extra: { nested: true } };

  assert.equal(open.supported, true);
  assert.equal(strict.supported, true);
  assert.equal(open.validate(input), true);
  assert.equal(strict.validate(input), false);
  assert.deepEqual(input, { known: 'value', extra: { nested: true } });
});

test('additionalProperties true explicitly preserves open-object acceptance', () => {
  const converted = createSdkToolSchema({
    type: 'object',
    properties: { headers: { type: 'object', additionalProperties: true } },
  });
  assert.equal(converted.supported, true);
  assert.equal(converted.validate({ headers: { Authorization: 'token', 'X-Trace': 'abc' } }), true);
});

test('complex MCP references return an unsupported result with a reason', () => {
  const converted = createSdkToolSchema({
    type: 'object',
    properties: { query: { $ref: '#/$defs/query' } },
    required: ['query'],
  });
  assert.equal(converted.supported, false);
  assert.match(converted.reason, /\$defs|\$ref/);
});

test('unknown constraints and unsupported anyOf variants fail explicitly', () => {
  const pattern = createSdkToolSchema({ type: 'object', properties: { value: { type: 'string', pattern: '^x' } } });
  const nestedAnyOf = createSdkToolSchema({ type: 'object', properties: { value: { type: 'string' } }, anyOf: [{ required: ['value'] }, { required: ['other'] }] });
  assert.equal(pattern.supported, false);
  assert.match(pattern.reason, /pattern/);
  assert.equal(nestedAnyOf.supported, false);
  assert.match(nestedAnyOf.reason, /anyOf/);
});
