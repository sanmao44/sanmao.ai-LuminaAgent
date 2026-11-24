import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/providers.ts', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8'))
  .replace(
    "import { getCangyuanVideoModelCatalogEntry } from './cangyuan-video-model-catalog';",
    'const { getCangyuanVideoModelCatalogEntry } = globalThis.__providerCompatCangyuanVideoModelCatalog;',
  )
  .replace(
    "import { classifyAudioModelPurpose } from './audio-model-classification';",
    'const { classifyAudioModelPurpose } = globalThis.__providerCompatAudioModelClassification;',
  );
const agnes = await readFile(new URL('../lib/agnes.ts', import.meta.url), 'utf8');
const cangyuanCapabilities = await readFile(new URL('../lib/cangyuan-image-capabilities.ts', import.meta.url), 'utf8');
const cangyuanProvider = await readFile(new URL('../lib/cangyuan-provider.ts', import.meta.url), 'utf8');
const modelKind = await readFile(new URL('../lib/model-kind.ts', import.meta.url), 'utf8');
const svgImage = await readFile(new URL('../lib/svg-image.ts', import.meta.url), 'utf8');
const detectionUrl = new URL('../lib/native-search-detection.ts', import.meta.url);
const detection = await readFile(detectionUrl, 'utf8');
globalThis.__providerImageReferenceReaderModule = createTsRequire(process.cwd())('./lib/provider-image-reference-reader');
globalThis.__providerCompatSharp = sharp;
globalThis.__providerCompatCangyuanVideoModelCatalog = createTsRequire(process.cwd())('./lib/cangyuan-video-model-catalog');
globalThis.__providerCompatAudioModelClassification = createTsRequire(process.cwd())('./lib/audio-model-classification');
const bundledSource = `${detection.replace('export function inferNativeSearch', 'function inferNativeSearch')}\n${modelKind}\n${svgImage.replace('export function isSvgImageBytes', 'function isSvgImageBytes')}\n${agnes.replace(/^import .+;\r?\n/gm, '')}\n${cangyuanCapabilities}\n${cangyuanProvider}\n${source.replace("import { inferNativeSearch } from './native-search-detection';", '').replace("import { inferModelKind } from './model-kind';", '').replace("import { agnesModelCatalog } from './agnes';", '').replace("import { inspectJimengCli } from './jimeng-cli';", "const inspectJimengCli = async () => ({ installed: false, version: '', loginHint: 'stub' });").replace("import { getCangyuanImageModelProfile } from './cangyuan-image-capabilities';", '').replace("import type { CangyuanImageModelProfile } from './cangyuan-image-capabilities';", '').replace("import { isCangyuanProvider } from './cangyuan-provider';", '').replace("import { isSvgImageBytes } from './svg-image';", '').replace("import { isPublicImageAddress, providerImageReferenceReader, PROVIDER_IMAGE_REFERENCE_MAX_BYTES } from './provider-image-reference-reader';", 'const { isPublicImageAddress, providerImageReferenceReader, PROVIDER_IMAGE_REFERENCE_MAX_BYTES } = globalThis.__providerImageReferenceReaderModule;').replace("import { MAX_IMAGE_REFERENCES } from '@/packages/contracts/creative';", 'const MAX_IMAGE_REFERENCES = 16;').replace("import sharp from 'sharp';", 'const sharp = globalThis.__providerCompatSharp;')}`;
const compiled = ts.transpileModule(bundledSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const providers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
delete globalThis.__providerImageReferenceReaderModule;
delete globalThis.__providerCompatSharp;
delete globalThis.__providerCompatCangyuanVideoModelCatalog;
delete globalThis.__providerCompatAudioModelClassification;
const presetSource = await readFile(new URL('../lib/provider-presets.ts', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const providerPickerSource = await readFile(new URL('../components/ProviderPlatformPicker.tsx', import.meta.url), 'utf8');
const presetCompiled = ts.transpileModule(presetSource.replace(
  "import { isProviderCreativeTaskProtocol, type ProviderCreativeTaskProtocol } from '../packages/contracts/provider-creative-task';",
  "const isProviderCreativeTaskProtocol = (value) => value === 'cangyuan-creative-v1';",
), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: new URL('../lib/provider-presets.ts', import.meta.url).pathname,
}).outputText;
const presets = await import(`data:text/javascript;base64,${Buffer.from(presetCompiled).toString('base64')}`);

test('provider picker uses real local logos for visible providers', async () => {
  const visiblePresets = presets.providerPresets.filter((preset) => preset.showInPicker !== false && preset.value !== 'custom');
  assert.equal(visiblePresets.length, 15);
  assert.equal(visiblePresets.some((preset) => preset.value === '65535-claude-code'), false);
  const presetsWithLogo = visiblePresets;
  const a6api = presets.providerPresets.find((preset) => preset.value === 'a6api');
  assert.deepEqual({ baseUrl: a6api.baseUrl, apiKeyUrl: a6api.apiKeyUrl, type: a6api.type }, {
    baseUrl: 'https://api.a6api.vip/v1',
    apiKeyUrl: 'https://a6api.ai/?auth=register&aff=XIcW',
    type: 'openai-compatible',
  });
  const moark = presets.providerPresets.find((preset) => preset.value === 'gitee');
  assert.deepEqual({ baseUrl: moark.baseUrl, apiKeyUrl: moark.apiKeyUrl, type: moark.type }, {
    baseUrl: 'https://api.moark.com/v1',
    apiKeyUrl: 'https://moark.com/serverless-api',
    type: 'openai-compatible',
  });
  assert.equal(moark.notice, '免费体验令牌每日 100 次；常规 API 令牌需资源包授权');
  const moarkConfig = presets.resolveProviderConfiguration({ platform: 'gitee' });
  assert.deepEqual({ chatPath: moarkConfig.chatPath, authHeader: moarkConfig.authHeader, authPrefix: moarkConfig.authPrefix }, {
    chatPath: '/chat/completions',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  });
  assert.ok(presetsWithLogo.every((preset) => typeof preset.logo === 'string' && preset.logo.startsWith('/brand/providers/')) || presetsWithLogo.every((preset) => typeof preset.logo === 'string'));
  assert.match(providerPickerSource, /className=\{preset\.logo \? "platform-logo" : ""\}/);
  assert.match(providerPickerSource, /preset\.logo \? <img src=\{preset\.logo\} alt="" \/> : preset\.short\.slice\(0, 2\)/);
  for (const preset of presetsWithLogo) {
    const logoFile = new URL(`../public${preset.logo}`, import.meta.url);
    const logo = await readFile(logoFile);
    assert.ok(logo.byteLength > 0, `${preset.value} logo should not be empty`);
  }
  const cangyuan = presets.providerPresets.find((preset) => preset.value === 'cangyuan');
  assert.equal(cangyuan.logo, '/brand/providers/cangyuan.webp');
  assert.deepEqual({ baseUrl: cangyuan.baseUrl, apiKeyUrl: cangyuan.apiKeyUrl, type: cangyuan.type }, {
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
    apiKeyUrl: 'https://ai.cangyuansuanli.cn/keys',
    type: 'openai-compatible',
  });
  const cangyuanVideoConfig = presets.resolveProviderConfiguration({ platform: 'cangyuan' });
  assert.deepEqual({
    videoTransport: cangyuanVideoConfig.videoTransport,
    videoBaseUrl: cangyuanVideoConfig.videoBaseUrl,
    videoGenerationPath: cangyuanVideoConfig.videoGenerationPath,
    videoTaskPath: cangyuanVideoConfig.videoTaskPath,
    videoTaskStatusPath: cangyuanVideoConfig.videoTaskStatusPath,
  }, {
    videoTransport: 'cangyuan-videos',
    videoBaseUrl: 'https://direct-api.cangyuansuanli.cn',
    videoGenerationPath: '/v1/videos',
    videoTaskPath: '/v1/videos',
    videoTaskStatusPath: '/v1/videos/{id}',
  });
  const custom = presets.providerPresets.find((preset) => preset.value === 'custom');
  assert.equal(custom.logo, undefined);
  const claudeStd = presets.providerPresets.find((preset) => preset.value === '65535-claude-code');
  assert.deepEqual({ baseUrl: claudeStd.baseUrl, type: claudeStd.type, needsBaseUrl: claudeStd.needsBaseUrl }, {
    baseUrl: 'https://api2.65535.space',
    type: 'openai-compatible',
    needsBaseUrl: false,
  });
  assert.equal(claudeStd.showInPicker, false);
  const claudeModels = await providers.discoverModels({ platform: '65535-claude-code' });
  assert.deepEqual(claudeModels.map((model) => model.id), [
    'claude-haiku-5-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5',
    'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5',
  ]);
  assert.ok(claudeModels.every((model) => model.capabilities?.includes('chat') && model.capabilities.includes('vision')));
  assert.equal(providers.is65535ClaudeModelProvider({ platform: '65535', baseUrl: 'https://api2-cn.65535.space/v1' }, 'claude-sonnet-5-5'), true);
  assert.equal(providers.is65535ClaudeModelProvider({ platform: '65535', baseUrl: 'https://api2-cn.65535.space/v1' }, 'gpt-5.6-sol'), false);
  assert.equal(providers.is65535ClaudeModelProvider({ platform: '65535', baseUrl: 'https://task-api-1-cn.65535.space/v1' }, 'claude-sonnet-5-5'), false);
});

test('normalizes common model list response shapes', () => {
  assert.deepEqual(providers.normalizeDiscoveredModels({ data: [{ id: 'a' }, { id: 'b', name: '模型 B' }] }), [
    { id: 'a', name: 'a', capabilities: [] },
    { id: 'b', name: '模型 B', capabilities: [] },
  ]);
  assert.deepEqual(providers.normalizeDiscoveredModels({ models: ['c', 'd'] }), [
    { id: 'c', name: 'c' },
    { id: 'd', name: 'd' },
  ]);
  assert.deepEqual(providers.normalizeDiscoveredModels({ data: { models: [{ model: 'e' }] } }), [
    { id: 'e', name: 'e', capabilities: [] },
  ]);
});

test('detects native search protocols from model metadata', () => {
  const models = providers.normalizeDiscoveredModels({ data: [
    { id: 'gpt-search-preview', tools: [{ type: 'web_search' }] },
    { id: 'gemini-grounded', supported_tools: ['google_search'] },
    { id: 'sonar-pro' },
  ] }, { platform: 'openai' });
  assert.equal(models[0].nativeSearchProtocol, 'openai-responses');
  assert.equal(models[0].capabilities.includes('web-search'), true);
  assert.equal(models[1].nativeSearchProtocol, 'gemini-grounding');
  assert.equal(models[2].nativeSearchProtocol, 'native-chat');
  assert.equal(models[0].capabilities.includes('chat'), true);
});

test('detects video capability from endpoint and pricing metadata without using model names', () => {
  const models = providers.normalizeDiscoveredModels({ data: [
    { id: 'model-alpha', endpoints: ['/v1/videos'], pricing: { video_seconds: 0.08 } },
  ] });
  assert.equal(models[0].capabilities.includes('video-generate'), true);
});

test('detects distinct audio task capabilities from explicit provider metadata', () => {
  const models = providers.normalizeDiscoveredModels({ data: [
    { id: 'custom-voice', capabilities: ['text-to-speech'] },
    { id: 'custom-recognition', endpoints: ['/v1/audio/transcriptions'] },
    { id: 'custom-music', operations: ['music_generation'] },
    { id: 'custom-dual-audio', capabilities: ['text-to-speech'], endpoints: ['/v1/audio/transcriptions'] },
    { id: 'generic-audio', modalities: ['audio'] },
  ] });

  assert.equal(models[0].capabilities.includes('speech'), true);
  assert.equal(models[0].capabilities.includes('transcription'), false);
  assert.equal(models[1].capabilities.includes('transcription'), true);
  assert.equal(models[1].capabilities.includes('speech'), false);
  assert.equal(models[2].capabilities.includes('music-generate'), true);
  assert.equal(models[2].capabilities.includes('speech'), false);
  assert.equal(models[3].capabilities.includes('speech'), true);
  assert.equal(models[3].capabilities.includes('transcription'), true);
  assert.deepEqual(models[4].capabilities, []);
  assert.deepEqual(models[0].classification?.purposes, ['speech']);
  assert.equal(models[0].classification?.source, 'provider-metadata');
  assert.deepEqual(models[1].classification?.purposes, ['transcription']);
  assert.deepEqual(models[2].classification?.purposes, ['music']);
  assert.deepEqual(models[4].classification?.purposes, []);
  assert.equal(models[4].classification?.requiresReview, true);
});

test('detects native task transport from endpoint metadata', () => {
  const provider = { platform: 'custom', baseUrl: 'https://video.example', videoTransport: 'auto' };
  assert.equal(providers.inferVideoTransportFromMetadata({ endpoints: ['/v1/tasks', '/v1/tasks/{id}'] }, provider), 'native-task');
  assert.equal(provider.videoTransport, 'native-task');
});

test('Cangyuan model discovery does not persist the generic video protocol for official endpoints', () => {
  for (const videoTransport of [undefined, 'auto', 'openai-videos']) {
    const provider = { platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport };
    assert.equal(providers.inferVideoTransportFromMetadata({ endpoints: ['/v1/videos'] }, provider), 'cangyuan-videos');
    assert.equal(provider.videoTransport, 'cangyuan-videos');
  }
  const native = { platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport: 'native-task' };
  assert.equal(providers.inferVideoTransportFromMetadata({}, native), 'native-task');
});

test('prepares local chat media for every provider while preserving remote URLs', async () => {
  const calls = [];
  const prepared = await providers.prepareProviderChatMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe the image' },
        { type: 'image_url', image_url: { url: '/api/storage/file?name=reference.png' } },
        { type: 'image_url', image_url: { url: 'http://localhost:3210/api/storage/file?name=local.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,INLINE' } },
        { type: 'image_url', image_url: { url: 'https://cdn.example/reference.png' } },
      ],
    },
  ], (value, kind) => {
    calls.push({ value, kind });
    return `https://relay.example/${calls.length}`;
  });

  assert.deepEqual(calls, [
    { value: '/api/storage/file?name=reference.png', kind: 'image' },
    { value: 'http://localhost:3210/api/storage/file?name=local.png', kind: 'image' },
    { value: 'data:image/png;base64,INLINE', kind: 'image' },
  ]);
  assert.equal(prepared[0].content[1].image_url.url, 'https://relay.example/1');
  assert.equal(prepared[0].content[2].image_url.url, 'https://relay.example/2');
  assert.equal(prepared[0].content[3].image_url.url, 'https://relay.example/3');
  assert.equal(prepared[0].content[4].image_url.url, 'https://cdn.example/reference.png');
  const localOnly = await providers.prepareProviderChatMessages([
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,INLINE' } }] },
  ], (value) => `https://relay.example/${value}`, { prepareDataUrls: true });
  assert.equal(localOnly[0].content[0].image_url.url, 'https://relay.example/data:image/png;base64,INLINE');
});

test('chat, stream and Responses requests all receive provider-ready media', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (body.stream) return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const provider = {
    id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'custom',
    baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key',
  };
  const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/reference.png' } }] }];
  try {
    await providers.chatCompletion(provider, 'deepseek-chat', { messages });
    await providers.chatCompletionStream(provider, 'deepseek-chat', { messages });
    await providers.responsesCompletion(provider, 'deepseek-chat', messages);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://api.deepseek.com/v1/chat/completions',
    'https://api.deepseek.com/v1/chat/completions',
    'https://api.deepseek.com/v1/responses',
  ]);
  assert.ok(requests.every(({ body }) => body.messages?.[0]?.content[0].image_url.url === 'https://cdn.example/reference.png'
    || body.input?.[0]?.content[0].image_url.url === 'https://cdn.example/reference.png'));
});

test('DeepSeek Responses uses the official endpoint, model aliases, image input and top-level function tools', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      id: 'resp-1',
      model: 'deepseek-flash',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '看到了。' }] }],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const result = await providers.chatCompletion(provider, 'deepseek-v4-flash', {
      messages: [{ role: 'user', content: [
        { type: 'text', text: '描述图片' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ] }],
      tools: [{ type: 'function', function: { name: 'lookup', description: '查找', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'auto',
    });
    assert.equal(result.choices[0].message.content, '看到了。');
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/responses');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].body.model, 'deepseek-flash');
  assert.deepEqual(calls[0].body.input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,AAA' });
  assert.deepEqual(calls[0].body.tools, [{ type: 'function', name: 'lookup', description: '查找', parameters: { type: 'object', properties: {} } }]);
  assert.equal(calls[0].body.reasoning, undefined);
});

test('DeepSeek Responses preserves developer, input_file and server-side tool items', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      model: 'deepseek-v4-pro',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/beta', apiKey: 'test-key' };
  try {
    await providers.responsesCompletion(provider, 'deepseek-v4-pro', [
      { role: 'developer', content: '开发者约束' },
      { role: 'user', content: [
        { type: 'input_file', file_id: 'file-api-123' },
      ] },
      { type: 'web_search_call', id: 'ws-1', status: 'completed' },
    ], {
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(requests[0].url, 'https://api.deepseek.com/responses');
  assert.equal(requests[0].body.input[0].role, 'developer');
  assert.deepEqual(requests[0].body.input[1].content, [
    { type: 'input_file', file_id: 'file-api-123' },
  ]);
  assert.deepEqual(requests[0].body.input[2], { type: 'web_search_call', id: 'ws-1', status: 'completed' });
  assert.deepEqual(requests[0].body.tools, [{ type: 'web_search' }]);
});

test('DeepSeek Responses ignores unknown tools, validates Web Tools constraints and forwards user identifiers', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    await providers.responsesCompletion(provider, 'deepseek-flash', '问题', {
      tools: [{ type: 'vendor_extension' }],
      user: '用户-1',
    });
    await assert.rejects(providers.responsesCompletion(provider, 'deepseek-flash', '问题', {
      tools: [{ type: 'deepseek_web_search' }],
      topLogprobs: 1,
    }), /Web Tools 不支持 top_logprobs/);
    await assert.rejects(providers.responsesCompletion(provider, 'deepseek-flash', '问题', {
      user: '用户'.repeat(171),
    }), /512 UTF-8 字节/);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(calls[0].tools, undefined);
  assert.equal(calls[0].user, '用户-1');
  assert.equal(calls.length, 1);
});

test('DeepSeek Responses rejects an input ending in assistant or reasoning items', () => {
  assert.throws(() => providers.serializeDeepSeekResponsesInput([
    { role: 'user', content: '继续' },
    { role: 'assistant', content: '上轮回答' },
  ]), /不支持以 assistant 消息或 reasoning item 结尾/);
  assert.throws(() => providers.serializeDeepSeekResponsesInput([
    { role: 'user', content: '继续' },
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: '推理' }] },
  ]), /不支持以 assistant 消息或 reasoning item 结尾/);
});

test('DeepSeek v4-pro rejects image input while flash accepts it', () => {
  assert.throws(
    () => providers.serializeDeepSeekResponsesInput([
      { role: 'user', content: [{ type: 'input_image', file_id: 'file-api-image' }] },
    ], 'deepseek-v4-pro'),
    /deepseek-v4-pro 不支持 input_image/,
  );
});

test('DeepSeek Responses validates file roles and tool-output content according to the API contract', () => {
  assert.deepEqual(providers.serializeDeepSeekResponsesInput([
    { role: 'user', content: [{ type: 'input_file', file_id: 'file-user-1' }] },
  ]), [{ role: 'user', content: [{ type: 'input_file', file_id: 'file-user-1' }] }]);
  for (const role of ['system', 'developer', 'assistant']) {
    assert.throws(
      () => providers.serializeDeepSeekResponsesInput([{ role, content: [{ type: 'input_file', file_id: 'file-invalid' }] }]),
      /仅支持 user 消息/,
    );
  }
  assert.throws(
    () => providers.serializeDeepSeekResponsesInput([
      { role: 'tool', tool_call_id: 'call-1', content: [{ type: 'input_file', file_id: 'file-invalid' }] },
    ]),
    /工具输出不支持 input_file/,
  );
});

test('DeepSeek Responses maps native web-tool options and enforces incompatible tool combinations', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    await providers.responsesCompletion(provider, 'deepseek-flash', '联网查询', {
      tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }],
      tool_choice: 'required',
      reasoningEffort: 'max',
      maxOutputTokens: 4096,
      text: { format: { type: 'text' } },
      safetyCheck: { level: 'high' },
      title: { enabled: true },
    });
    await providers.responsesCompletion(provider, 'deepseek-flash', '联网查询', {
      tools: [{ type: 'deepseek_web_search' }, { type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    });
    await assert.rejects(providers.responsesCompletion(provider, 'deepseek-flash', '联网查询', {
      tools: [{ type: 'deepseek_web_search' }, { type: 'custom', name: 'apply_patch' }],
    }), /不能与 web_search、custom、namespace 或 tool_search 组合/);
    await assert.rejects(providers.responsesCompletion(provider, 'deepseek-flash', '联网查询', {
      tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_web_search' }],
    }), /只能声明一次/);
    await providers.responsesCompletion(provider, 'deepseek-flash', '联网查询', {
      tools: [{ type: 'web_search' }],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(calls[0].tools, [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }]);
  assert.equal(calls[0].tool_choice, 'auto');
  assert.equal(calls[0].reasoning.effort, 'max');
  assert.equal(calls[0].max_output_tokens, 4096);
  assert.deepEqual(calls[0].text, { format: { type: 'text' } });
  assert.deepEqual(calls[0].safety_check, { level: 'high' });
  assert.deepEqual(calls[0].title, { enabled: true });
  assert.deepEqual(calls[1].tools, [
    { type: 'deepseek_web_search' },
    { type: 'function', name: 'lookup', parameters: { type: 'object' } },
  ]);
  assert.equal(calls[2].tools, undefined);
});

test('DeepSeek Responses converts custom tool calls into the existing tool callback contract', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'custom_tool_call', id: 'item-apply', call_id: 'call-apply', name: 'apply_patch', input: '*** Begin Patch' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const result = await providers.chatCompletion(provider, 'deepseek-v4-pro', { messages: [{ role: 'user', content: '编辑文件' }] });
    assert.deepEqual(result.choices[0].message.tool_calls, [{
      id: 'call-apply',
      type: 'function',
      function: { name: 'apply_patch', arguments: '*** Begin Patch' },
    }]);
    assert.equal(result.choices[0].finish_reason, 'tool_calls');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses preserves reasoning and function-call replay items', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: 'deepseek-flash',
      status: 'completed',
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: '先查工具。' }] },
        { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, output_tokens_details: { reasoning_tokens: 2 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const first = await providers.chatCompletion(provider, 'deepseek-flash', {
      messages: [{ role: 'user', content: '查一下' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
    });
    assert.equal(first.choices[0].finish_reason, 'tool_calls');
    assert.equal(first.choices[0].message.reasoning_content, '先查工具。');
    await providers.chatCompletion(provider, 'deepseek-flash', {
      messages: [
        { role: 'user', content: '查一下' },
        first.choices[0].message,
        { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
      ],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(requests[1].input.slice(-3), [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: '先查工具。' }] },
    { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' },
    { type: 'function_call_output', call_id: 'call-1', output: '{"ok":true}' },
  ]);
  assert.equal(requests[0].reasoning, undefined);
});

test('DeepSeek Responses replays server tool history including URL-reading signatures', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  const serverToolCall = {
    type: 'web_search_call',
    id: 'srvtoolu_rl_1',
    status: 'completed',
    kind: 'read_link',
    action: { type: 'read_link', url: 'https://example.test/page' },
    page: { url: 'https://example.test/page', title: '页面' },
    signature: 'signed-page-context',
  };
  try {
    await providers.chatCompletion(provider, 'deepseek-flash', {
      messages: [
        { role: 'user', content: '请读网页' },
        { role: 'assistant', content: '页面摘要', server_tool_calls: [serverToolCall] },
        { role: 'user', content: '继续' },
      ],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(calls[0].input[1], { role: 'assistant', content: [{ type: 'output_text', text: '页面摘要' }] });
  assert.deepEqual(calls[0].input[2], serverToolCall);
  assert.deepEqual(calls[0].input[3], { role: 'user', content: [{ type: 'input_text', text: '继续' }] });
});

test('DeepSeek Chat server tool groups replay as unchanged Responses output items', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  const grouped = [{
    index: 0,
    reasoning_content: '',
    calls: [{
      index: 0,
      id: 'srvtoolu_rl_2',
      type: 'deepseek_read_url',
      kind: 'read_link',
      action: { type: 'read_link', url: 'https://example.test/page' },
      status: 'completed',
      page: { url: 'https://example.test/page', title: '页面', published_at: null },
      signature: 'signed-page-context',
    }],
  }];
  try {
    await providers.chatCompletion(provider, 'deepseek-flash', {
      messages: [
        { role: 'user', content: '请读网页' },
        { role: 'assistant', content: '页面摘要', server_tool_calls: grouped },
        { role: 'user', content: '继续' },
      ],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(calls[0].input[2], {
    type: 'web_search_call',
    id: 'srvtoolu_rl_2',
    status: 'completed',
    kind: 'read_link',
    action: { type: 'read_link', url: 'https://example.test/page' },
    page: { url: 'https://example.test/page', title: '页面', published_at: null },
    signature: 'signed-page-context',
  });
});

test('DeepSeek Responses replays apply_patch as a custom_tool_call', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: 'deepseek-v4-pro',
      status: 'completed',
      output: [{ type: 'custom_tool_call', call_id: 'call-patch', name: 'apply_patch', input: '*** Begin Patch' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const first = await providers.chatCompletion(provider, 'deepseek-v4-pro', {
      messages: [{ role: 'user', content: '编辑文件' }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });
    await providers.chatCompletion(provider, 'deepseek-v4-pro', {
      messages: [
        { role: 'user', content: '编辑文件' },
        first.choices[0].message,
        { role: 'tool', tool_call_id: 'call-patch', content: '已应用' },
      ],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(requests[1].input.slice(-2), [
    { type: 'custom_tool_call', call_id: 'call-patch', name: 'apply_patch', input: '*** Begin Patch' },
    { type: 'custom_tool_call_output', call_id: 'call-patch', output: '已应用' },
  ]);
});

test('chat payload limit errors preserve the upstream limit, error code and request id', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ error: { message: 'Request body exceeds 4 MiB', code: 'request_too_large' } }), {
      status: 413,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-payload-limit' },
    });
  };
  try {
    await assert.rejects(providers.chatCompletion({
      id: 'custom', name: 'Custom', type: 'openai-compatible', platform: 'custom',
      baseUrl: 'https://chat.example.test/v1', apiKey: 'test-key',
    }, 'test-chat', { messages: [{ role: 'user', content: '请生成 HTML 文件' }] }), (error) => {
      assert.equal(error.providerStatus, 413);
      assert.equal(error.providerFailureKind, 'http');
      assert.equal(error.providerErrorCode, 'request_too_large');
      assert.equal(error.providerRequestId, 'req-payload-limit');
      assert.match(error.message, /请求内容超过服务商限制/);
      assert.match(error.message, /Request body exceeds 4 MiB/);
      assert.match(error.message, /request id: req-payload-limit/);
      assert.doesNotMatch(error.message, /图片/);
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://chat.example.test/v1/chat/completions');
  assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: '请生成 HTML 文件' }]);
});

test('DeepSeek Responses normalizes effort aliases and preserves provider error code/request id', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'too long', request_id: 'req-42' } }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req-42' } });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    await assert.rejects(
      providers.responsesCompletion(provider, 'deepseek-v4-pro', '思考', {
        reasoningEffort: 'medium',
        temperature: 0.4,
        topP: 0.8,
        topLogprobs: 5,
      }),
      (error) => error?.providerErrorCode === 'context_length_exceeded' && /request id: req-42/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls[0].reasoning.effort, 'high');
  assert.equal(calls[0].temperature, 0.4);
  assert.equal(calls[0].top_p, 0.8);
  assert.equal(calls[0].top_logprobs, 5);
});

test('DeepSeek Responses failed responses preserve terminal error code and request id', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp-failed',
    status: 'failed',
    error: { code: 'content_filter', message: 'blocked' },
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-failed' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    await assert.rejects(
      providers.chatCompletion(provider, 'deepseek-flash', { messages: [{ role: 'user', content: '你好' }] }),
      (error) => error?.providerErrorCode === 'content_filter' && /request id: req-failed/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses preserves billable usage on failed non-streaming responses', () => {
  assert.throws(() => providers.normalizeDeepSeekResponsesResponse({
    status: 'failed',
    error: { code: 'server_error', message: 'partial generation failed' },
    usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10, server_tool_use: { tool_search: 1 } },
  }, 'deepseek-flash'), (error) => {
    assert.equal(error.providerErrorCode, 'server_error');
    assert.equal(error.providerUsage.prompt_tokens, 7);
    assert.equal(error.providerUsage.completion_tokens, 3);
    assert.deepEqual(error.providerUsage.server_tool_use, { tool_search: 1 });
    return true;
  });
});

test('DeepSeek Responses preserves server tool calls, annotations, title and server tool usage', () => {
  const result = providers.normalizeDeepSeekResponsesResponse({
    model: 'deepseek-flash',
    status: 'completed',
    title: '联网任务',
    output: [
      {
        type: 'web_search_call',
        id: 'ws-1',
        status: 'completed',
        kind: 'search',
        action: { query: 'DeepSeek' },
        page: { title: '官方文档', content: '正文' },
        signature: 'sig-1',
        error: null,
      },
      {
        type: 'tool_search_call',
        id: 'ts-1',
        status: 'completed',
        kind: 'fetch',
        action: { url: 'https://example.test' },
        page: { title: '页面', content: '内容' },
        signature: 'sig-2',
      },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: '答案',
          annotations: [{ type: 'url_citation', title: '官方文档', url: 'https://example.test/docs' }],
        }],
      },
    ],
    usage: {
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
      server_tool_use: { tool_search: 1, tool_fetch: 1, tool_image_search: 0 },
    },
  }, 'deepseek-flash');
  assert.equal(result.choices[0].message.content, '答案');
  assert.equal(result.choices[0].message.title, '联网任务');
  assert.equal(result.choices[0].message.server_tool_calls.length, 1);
  assert.equal(result.choices[0].message.server_tool_calls[0].calls.length, 2);
  assert.equal(result.choices[0].message.server_tool_calls[0].calls[0].page.content, '正文');
  assert.equal(result.choices[0].message.server_tool_calls[0].calls[0].type, 'deepseek_web_search');
  assert.equal(result.choices[0].message.server_tool_calls[0].calls[1].type, 'deepseek_read_url');
  assert.deepEqual(result.choices[0].message.annotations, [{ type: 'url_citation', title: '官方文档', url: 'https://example.test/docs' }]);
  assert.deepEqual(result.server_tool_calls, result.choices[0].message.server_tool_calls);
  assert.deepEqual(result.annotations, result.choices[0].message.annotations);
  assert.deepEqual(result.usage.server_tool_use, { tool_search: 1, tool_fetch: 1, tool_image_search: 0 });
});

test('DeepSeek Responses failed stream rejects with the upstream error code and request id', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"暂时失败","request_id":"req-stream"}}}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-stream' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const response = await providers.chatCompletionStream(provider, 'deepseek-flash', { messages: [{ role: 'user', content: '你好' }] });
    await assert.rejects(response.text(), (error) => error?.providerErrorCode === 'server_error' && /request id: req-stream/.test(error.message));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses failed streams emit usage before propagating the provider error', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"生成中断"},"usage":{"input_tokens":8,"output_tokens":2,"total_tokens":10}}}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const response = await providers.chatCompletionStream(provider, 'deepseek-flash', { messages: [{ role: 'user', content: '你好' }] });
    const reader = response.body.getReader();
    const first = await reader.read();
    const firstFrame = new TextDecoder().decode(first.value);
    assert.match(firstFrame, /"prompt_tokens":8/);
    assert.match(firstFrame, /"completion_tokens":2/);
    await assert.rejects(reader.read(), (error) => error?.providerErrorCode === 'server_error');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek v4-pro streaming rejects image input before opening the Responses stream', async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not be called');
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    await assert.rejects(providers.chatCompletionStream(provider, 'deepseek-v4-pro', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }],
    }), /deepseek-v4-pro 不支持图像输入/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses streaming bridges text, tool arguments and terminal usage', async () => {
  const previousFetch = globalThis.fetch;
  const events = [
    'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","delta":"先想一步"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好"}\n\n',
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"item-1","name":"lookup"}}\n\n',
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"item-1","delta":"{\\"q\\":"}\n\n',
    'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","output_index":1,"item_id":"item-1","arguments":"{\\"q\\":\\"x\\"}"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"model":"deepseek-flash","status":"completed","output":[{"type":"function_call","id":"item-1","call_id":"call-1","name":"lookup","arguments":"{\\"q\\":\\"x\\"}"}],"usage":{"input_tokens":2,"output_tokens":4,"total_tokens":6}}}\n\n',
  ];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const response = await providers.chatCompletionStream(provider, 'deepseek-flash', { messages: [{ role: 'user', content: '你好' }] });
    const text = await response.text();
    assert.match(text, /"reasoning_content":"先想一步"/);
    assert.match(text, /你好/);
    assert.match(text, /"name":"lookup"/);
    assert.match(text, /"total_tokens":6/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses streaming preserves server tool metadata on the terminal chunk', async () => {
  const previousFetch = globalThis.fetch;
  const events = [
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"web_search_call","id":"ws-1","status":"in_progress"}}\n\n',
    'event: response.output_text.annotation.added\ndata: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","title":"官方文档","url":"https://example.test/docs"}}\n\n',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"web_search_call","id":"ws-1","status":"completed","kind":"search","action":{"query":"DeepSeek"},"page":{"title":"官方文档","content":"正文"},"signature":"sig-1","error":null}}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"model":"deepseek-flash","status":"completed","title":"联网任务","output":[{"type":"web_search_call","id":"ws-1","status":"completed","kind":"search","action":{"query":"DeepSeek"},"page":{"title":"官方文档","content":"正文"},"signature":"sig-1","error":null},{"type":"message","content":[{"type":"output_text","text":"答案"}]}],"usage":{"input_tokens":2,"output_tokens":4,"total_tokens":6,"server_tool_use":{"tool_search":1,"tool_fetch":1,"tool_image_search":0}}}}\n\n',
  ];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const response = await providers.chatCompletionStream(provider, 'deepseek-flash', { messages: [{ role: 'user', content: '搜索' }] });
    const streamText = await response.text();
    const chunks = streamText.split(/\r?\n\r?\n/).filter((frame) => frame.startsWith('data: ')).map((frame) => frame.slice(6)).filter((value) => value !== '[DONE]').map((value) => JSON.parse(value));
    const terminal = chunks.at(-1);
    assert.equal(terminal.choices[0].finish_reason, 'stop');
    assert.equal(terminal.choices[0].delta.server_tool_calls[0].calls[0].page.content, '正文');
    assert.equal(terminal.choices[0].delta.server_tool_calls[0].calls[0].signature, 'sig-1');
    assert.equal(terminal.choices[0].delta.server_tool_calls[0].calls[0].type, 'deepseek_web_search');
    assert.deepEqual(terminal.choices[0].delta.annotations, [{ type: 'url_citation', title: '官方文档', url: 'https://example.test/docs' }]);
    assert.equal(terminal.choices[0].delta.title, '联网任务');
    assert.deepEqual(terminal.usage.server_tool_use, { tool_search: 1, tool_fetch: 1, tool_image_search: 0 });
    assert.deepEqual(chunks.slice(0, 3).map((entry) => entry.choices[0].server_tool_event.type), [
      'step_reasoning_done',
      'call_started',
      'call_completed',
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Responses streaming bridges custom tool callbacks without duplicating input', async () => {
  const previousFetch = globalThis.fetch;
  const events = [
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"custom_tool_call","id":"item-patch","call_id":"call-patch","name":"apply_patch"}}\n\n',
    'event: response.custom_tool_call_input.delta\ndata: {"type":"response.custom_tool_call_input.delta","output_index":0,"item_id":"item-patch","delta":"*** Begin Patch"}\n\n',
    'event: response.custom_tool_call_input.done\ndata: {"type":"response.custom_tool_call_input.done","output_index":0,"item_id":"item-patch","input":"*** Begin Patch"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"model":"deepseek-v4-pro","status":"completed","output":[{"type":"custom_tool_call","id":"item-patch","call_id":"call-patch","name":"apply_patch","input":"*** Begin Patch"}],"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3,"server_tool_use":{"web_search_requests":1}}}}\n\n',
  ];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const response = await providers.chatCompletionStream(provider, 'deepseek-v4-pro', { messages: [{ role: 'user', content: '编辑文件' }] });
    const text = await response.text();
    assert.match(text, /"name":"apply_patch"/);
    assert.match(text, /"arguments":"\*\*\* Begin Patch"/);
    assert.match(text, /"web_search_requests":1/);
    assert.match(text, /"finish_reason":"tool_calls"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('DeepSeek Search and Fetch use dedicated endpoints, auth and validated bodies', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (String(url).endsWith('/tools/search')) return new Response(JSON.stringify({ results: [{ title: '来源', url: 'https://example.test', summary: '摘要' }] }), { status: 200 });
    return new Response(JSON.stringify({ title: '页面', content: '正文' }), { status: 200 });
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key' };
  try {
    const search = await providers.deepSeekToolSearch(provider, { query: 'DeepSeek V4', count: 5, ori_question: '原问题', localization: '1.2.3.4', need_content: true });
    const fetched = await providers.deepSeekToolFetch(provider, 'https://example.test/page');
    assert.equal(search.results[0].title, '来源');
    assert.equal(fetched.content, '正文');
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[1].url, 'https://api.deepseek.com/v1/tools/fetch');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.deepEqual(calls[0].body, { query: 'DeepSeek V4', count: 5, ori_question: '原问题', localization: '1.2.3.4', need_content: true });
  assert.deepEqual(calls[1].body, { url: 'https://example.test/page' });
  await assert.rejects(providers.deepSeekToolSearch(provider, { query: '' }), /1 至 128/);
  await assert.rejects(providers.deepSeekToolFetch(provider, 'ftp://example.test/page'), /HTTP 或 HTTPS/);
});

test('DeepSeek Responses validates custom tool output pairing', () => {
  assert.throws(() => providers.serializeDeepSeekResponsesInput([
    { type: 'custom_tool_call_output', call_id: 'missing', output: '结果' },
  ]), /custom_tool_call_output 缺少对应的 custom_tool_call/);
  assert.throws(() => providers.serializeDeepSeekResponsesInput([
    { type: 'custom_tool_call', call_id: 'duplicate', name: 'apply_patch', input: 'a' },
    { type: 'custom_tool_call', call_id: 'duplicate', name: 'apply_patch', input: 'b' },
  ]), /工具调用 call_id 重复/);
});

test('stream transport releases the header timeout after response headers arrive', async () => {
  const previousFetch = globalThis.fetch;
  let requestSignal;
  globalThis.fetch = async (_url, init) => {
    requestSignal = init.signal;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'));
        requestSignal.addEventListener('abort', () => controller.error(requestSignal.reason), { once: true });
        setTimeout(() => {
          if (requestSignal.aborted) return;
          controller.enqueue(new TextEncoder().encode('second'));
          controller.close();
        }, 30);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const response = await providers.fetchStreamingResponse('https://provider.example/v1/chat/completions', { method: 'POST' }, 10);
    assert.equal(await response.text(), 'firstsecond');
    assert.equal(requestSignal.aborted, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('OpenAI-compatible chat keeps inline data URLs without a relay conversion', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const provider = {
    id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible', platform: 'custom',
    baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key',
  };
  const inline = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA';
  try {
    await providers.chatCompletion(provider, 'deepseek-v4-flash', {
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: inline } },
      ] }],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content[1].image_url.url, inline);
});

test('normalizes assistant tool calls before replaying a tool follow-up', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const provider = {
    id: '65535', name: '65535', type: 'openai-compatible', platform: '65535',
    baseUrl: 'https://api2.65535.space/v1', apiKey: 'test-key',
  };
  try {
    await providers.chatCompletion(provider, 'deepseek-v4-flash', {
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'video_download', arguments: { url: 'https://example.test/video' } } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
      ],
      tool_choice: 'none',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  const call = requests[0].body.messages[0].tool_calls[0];
  assert.equal(call.id, 'call-1');
  assert.equal(call.type, 'function');
  assert.equal(call.function.name, 'video_download');
  assert.equal(call.function.arguments, '{"url":"https://example.test/video"}');
});

test('JEV intent classification uses System One and normalizes its choice answers', async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: 'jev-1.14.0',
      answers: {
        mode: { type: 'choice', choice: 'follow_up', confidence: 0.97 },
        deliverable: { type: 'choice', choice: 'image', confidence: 0.93 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await providers.intentClassificationCompletion({
      id: 'jev', name: '65535', type: 'openai-compatible', platform: '65535',
      baseUrl: 'https://api2-cn.65535.space/v1', apiKey: 'test-key',
    }, 'jev-1.14', { messages: [{ role: 'user', content: '按刚才的做' }] });
    assert.equal(requestUrl, 'https://api2.65535.space/v1/systemone');
    assert.equal(requestBody.model, 'jev-1.14');
    assert.match(requestBody.state, /user: 按刚才的做/);
    assert.equal(response.choices[0].message.content, JSON.stringify({
      mode: 'follow_up', deliverable: 'IMAGE', confidence: 'high', reason: 'JEV System One 判定：mode=follow_up，deliverable=IMAGE',
    }));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('JEV image-intent classification sends prompt metadata only and normalizes reference generation', async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: 'jev-1.14.0',
      answers: { imageOperation: { type: 'choice', choice: 'reference_generate', confidence: 0.96 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await providers.canvasImageIntentCompletion({
      id: 'jev', name: '65535', type: 'openai-compatible', platform: '65535',
      baseUrl: 'https://api2-cn.65535.space/v1', apiKey: 'test-key',
    }, 'jev-1.14', { prompt: 'Use the connected image as a visual reference', imageReferenceCount: 2 });
    assert.equal(requestUrl, 'https://api2.65535.space/v1/systemone');
    assert.equal(requestBody.model, 'jev-1.14');
    assert.deepEqual(JSON.parse(requestBody.state), {
      prompt: 'Use the connected image as a visual reference',
      connectedImageReferenceCount: 2,
      task: 'Canvas creates a new output node; no input image is mutated in place.',
    });
    assert.equal(JSON.stringify(requestBody).includes('data:image'), false);
    assert.deepEqual(response, { operation: 'reference-generate', confidence: 'high', model: 'jev-1.14.0' });
    assert.equal(requestBody.questions.imageOperation.criteria.reference_generate.length > 0, true);
    assert.equal(requestBody.questions.imageOperation.criteria.edit.length > 0, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('JEV image-intent classification normalizes edit and treats low confidence as uncertain', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    answers: { imageOperation: { type: 'choice', choice: 'edit', confidence: 0.45 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await providers.canvasImageIntentCompletion({
      id: 'jev', name: 'JEV', type: 'openai-compatible', platform: 'openai',
      baseUrl: 'https://jev.example/v1', apiKey: 'test-key',
    }, 'jev-1.14', { prompt: 'Edit the source image', imageReferenceCount: 1 });
    assert.deepEqual(response, { operation: 'edit', confidence: 'low', model: 'jev-1.14' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('uses the OpenAI video task status default for a custom compatible provider', () => {
  const config = presets.resolveProviderConfiguration({
    platform: 'custom',
    baseUrl: 'https://video.example/v1',
    videoTransport: 'openai-videos',
  });
  assert.equal(config.videoTaskStatusPath, '/v1/videos/{id}');
});

test('creative task protocol defaults for its preset and is explicit for other providers', () => {
  const cangyuan = presets.resolveProviderConfiguration({ platform: 'cangyuan' });
  assert.equal(cangyuan.creativeTaskProtocol, 'cangyuan-creative-v1');

  const custom = presets.resolveProviderConfiguration({ platform: 'custom', baseUrl: 'https://custom.example/v1' });
  assert.equal(custom.creativeTaskProtocol, undefined);

  const optedIn = presets.resolveProviderConfiguration({
    platform: 'custom',
    baseUrl: 'https://custom.example/v1',
    creativeTaskProtocol: 'cangyuan-creative-v1',
  });
  assert.equal(optedIn.creativeTaskProtocol, 'cangyuan-creative-v1');
  assert.equal(presets.resolveProviderConfiguration({ platform: 'custom' }, optedIn).creativeTaskProtocol, 'cangyuan-creative-v1');
  assert.equal(presets.resolveProviderConfiguration({ platform: 'custom', creativeTaskProtocol: '' }, optedIn).creativeTaskProtocol, undefined);
  assert.throws(() => presets.resolveProviderConfiguration({ platform: 'custom', creativeTaskProtocol: 'unknown-protocol' }), /协议无效/);
});

test('keeps Agnes text and video gateways in the same selected region', () => {
  const international = presets.resolveProviderConfiguration({
    platform: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
  });
  assert.equal(international.baseUrl, 'https://apihub.agnes-ai.com/v1');
  assert.equal(international.videoBaseUrl, 'https://apihub.agnes-ai.com');

  const domestic = presets.resolveProviderConfiguration({
    platform: 'agnes',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    videoBaseUrl: 'https://apihub.agnes-ai.com',
  });
  assert.equal(domestic.baseUrl, 'https://api.agnes-ai.cn/v1');
  assert.equal(domestic.videoBaseUrl, 'https://api.agnes-ai.cn');

  const fresh = presets.resolveProviderConfiguration({ platform: 'agnes' });
  assert.equal(fresh.baseUrl, 'https://api.agnes-ai.cn/v1');
  assert.equal(fresh.videoBaseUrl, 'https://api.agnes-ai.cn');
});

test('recognizes provider-native search for standard OpenAI and Gemini model ids', () => {
  const openAiModels = providers.normalizeDiscoveredModels({ data: [{ id: 'gpt-5' }] }, { platform: 'openai' });
  const geminiModels = providers.normalizeDiscoveredModels({ data: [{ id: 'gemini-2.5-pro' }] }, { platform: 'google-gemini' });
  const browserModels = providers.normalizeDiscoveredModels({ data: [{ id: 'custom-browser-model', metadata: { browser: true } }] }, { platform: 'custom' });
  assert.equal(openAiModels[0].nativeSearchProtocol, 'openai-responses');
  assert.equal(geminiModels[0].nativeSearchProtocol, 'gemini-grounding');
  assert.equal(browserModels[0].nativeSearchProtocol, 'openai-responses');
});

test('prefers the standard v1 model endpoint for a provider website root', () => {
  const candidates = providers.modelEndpointCandidates({
    type: 'openai-compatible',
    baseUrl: 'https://api.apiqik.com',
    modelsPath: '/models',
    apiKey: 'test',
  });
  assert.deepEqual(candidates, [
    { url: 'https://api.apiqik.com/v1/models', inferredBaseUrl: 'https://api.apiqik.com/v1' },
    { url: 'https://api.apiqik.com/models' },
  ]);
});

test('falls back to the unversioned model endpoint when /v1/models is unavailable', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/v1/models')) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(JSON.stringify({ data: [{ id: 'root-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = {
    type: 'openai-compatible',
    platform: 'custom',
    baseUrl: 'https://root.example.test',
    modelsPath: '/models',
    apiKey: 'test',
  };
  try {
    const models = await providers.discoverModels(provider);
    assert.deepEqual(models.map((model) => model.id), ['root-model']);
    assert.deepEqual(calls, ['https://root.example.test/v1/models', 'https://root.example.test/models']);
    assert.equal(provider.baseUrl, 'https://root.example.test');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('persists the inferred /v1 base when a versioned model endpoint succeeds', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: [{ id: 'versioned-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = {
    type: 'openai-compatible',
    platform: 'custom',
    baseUrl: 'https://versioned.example.test',
    modelsPath: '/models',
    apiKey: 'test',
  };
  try {
    const models = await providers.discoverModels(provider);
    assert.deepEqual(models.map((model) => model.id), ['versioned-model']);
    assert.deepEqual(calls, ['https://versioned.example.test/v1/models']);
    assert.equal(provider.baseUrl, 'https://versioned.example.test/v1');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('does not override an explicitly versioned base URL', () => {
  const candidates = providers.modelEndpointCandidates({
    type: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    modelsPath: '/models',
    apiKey: 'test',
  });
  assert.deepEqual(candidates, [{ url: 'https://example.com/v1/models' }]);
});

test('normalizes image responses from common provider protocols', () => {
  const b64 = 'iVBORw0KGgoAAAAAAAAAAAAA';
  assert.deepEqual(providers.normalizeProviderImages({ data: [{ b64_json: b64, revised_prompt: 'updated' }] }), [
    { url: `data:image/png;base64,${b64}`, revisedPrompt: 'updated' },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ output: [{ type: 'image_generation_call', result: b64 }] }), [
    { url: `data:image/png;base64,${b64}` },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] } }] }), [
    { url: `data:image/jpeg;base64,${b64}` },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'https://cdn.example.test/result.png' } }] } }] }), [
    { url: 'https://cdn.example.test/result.png' },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ content: '![result](https://cdn.example.test/result.png)' }), [
    { url: 'https://cdn.example.test/result.png' },
  ]);
});

test('rejects inline image fields whose bytes are not an image', () => {
  const invalid = Buffer.from('not an image').toString('base64');
  assert.throws(
    () => providers.normalizeProviderImages({ data: [{ b64_json: invalid }] }),
    /不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片/,
  );
});

test('does not submit a second edit job after malformed JSON image output', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const invalid = Buffer.from('not an image').toString('base64');
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: invalid }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(
      providers.editImage({
        type: 'openai-compatible',
        platform: 'custom',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'test-key',
      }, 'gpt-image-2', {
        prompt: 'camera edit',
        references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
        count: 1,
      }),
      (error) => {
        assert.match(error.message, /不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片/);
        assert.equal(error.providerPossiblyAccepted, true);
        assert.equal(error.providerStatus, 200);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("successful empty and server-error image responses are marked unsafe for resubmission", async () => {
  const previousFetch = globalThis.fetch;
  const cases = [
    { status: 200, body: {}, expectedStatus: 200 },
    { status: 202, body: { status: "accepted" }, expectedStatus: 202 },
    { status: 500, body: { error: { message: "provider interrupted" } }, expectedStatus: 500 },
  ];
  try {
    for (const scenario of cases) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify(scenario.body), {
          status: scenario.status,
          headers: { "content-type": "application/json" },
        });
      };
      await assert.rejects(
        providers.editImage({
          type: "openai-compatible",
          platform: "custom",
          baseUrl: "https://images.example.test/v1",
          apiKey: "test-key",
        }, "gpt-image-2.5", {
          prompt: "camera edit",
          references: ["data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA"],
          count: 1,
        }),
        (error) => {
          assert.equal(error.providerPossiblyAccepted, true);
          assert.equal(error.providerStatus, scenario.expectedStatus);
          return true;
        },
      );
      assert.equal(calls, 1, `HTTP ${scenario.status} must not cause a second provider request`);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('image edits return only the requested number when one provider request contains extra results', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [
      { url: 'https://cdn.example.test/first.png' },
      { url: 'https://cdn.example.test/second.png' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = {
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    };
    const input = {
      prompt: 'change the color',
      references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
    };
    assert.deepEqual(await providers.editImage(provider, 'gpt-image-2.5', { ...input, count: 1 }), [
      { url: 'https://cdn.example.test/first.png' },
    ]);
    assert.deepEqual(await providers.editImage(provider, 'gpt-image-2.5', { ...input, count: 2 }), [
      { url: 'https://cdn.example.test/first.png' },
      { url: 'https://cdn.example.test/second.png' },
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => JSON.parse(call.init.body).n), [1, 2]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('rejects a binary-looking image response before local persistence', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('not an image'), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  try {
    await assert.rejects(
      providers.generateImage({
        type: 'openai-compatible',
        platform: 'custom',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'test-key',
      }, 'gpt-image-2', { prompt: 'space', count: 1 }),
      /没有找到可显示的图片|不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('keeps a plain image URL when a gateway mislabels its content type', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('cdn.example.test')
    ? new Response(Buffer.from('not fetched in this provider-layer test'), { status: 200, headers: { 'content-type': 'image/png' } })
    : new Response('https://cdn.example.test/result.png', { status: 200, headers: { 'content-type': 'image/png' } });
  try {
    const images = await providers.generateImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2', { prompt: 'space', count: 1 });
    assert.deepEqual(images, [{ url: 'https://cdn.example.test/result.png' }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('does not mistake an asynchronous task id for an image', () => {
  assert.throws(
    () => providers.normalizeProviderImages({ id: 'task_0123456789abcdef0123456789abcdef', status: 'processing' }),
    /没有找到可显示的图片/,
  );
  assert.throws(
    () => providers.normalizeProviderImages({ data: { task_id: '0123456789abcdef0123456789abcdef', state: 'processing' } }),
    /没有找到可显示的图片/,
  );
});

test('does not retry image requests after ambiguous upstream failures', () => {
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'transport', providerStatus: 0 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'timeout', providerStatus: 0 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 500 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 422 }), true);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 422, providerAcceptedTask: true }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 422, providerPossiblyAccepted: true }), false);
});

test('does not submit multipart edit after an ambiguous JSON provider failure', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: { message: 'provider temporarily failed' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(
      providers.editImage({
        type: 'openai-compatible',
        platform: 'custom',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'test-key',
      }, 'gpt-image-2', {
        prompt: 'camera edit',
        references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
      }),
      /provider temporarily failed/,
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('falls back to multipart edit only after an explicit compatibility rejection', async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(init);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'JSON payload is not supported' } }), {
        status: 415,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/edited.png' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const images = await providers.editImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2', {
      prompt: 'camera edit',
      references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
    });
    assert.deepEqual(images, [{ url: 'https://cdn.example.test/edited.png' }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers['Content-Type'], 'application/json');
    assert.equal(requests[1].body instanceof FormData, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('keeps a provider HTTP 500 terminal and marks delivery status uncertain', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'provider interrupted' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(
      () => providers.generateImage({
        type: 'openai-compatible',
        platform: 'custom',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-key',
      }, 'image-model', { prompt: 'terminal provider error' }),
      (error) => {
        assert.match(error.message, /provider interrupted/);
        assert.equal(error.providerPossiblyAccepted, true);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('polls ModelScope image tasks and normalizes output_images', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/images/generations')) {
      return new Response(JSON.stringify({ task_id: 'modelscope-task-1', task_status: 'PENDING' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      task_id: 'modelscope-task-1',
      task_status: 'SUCCEED',
      output_images: ['https://cdn.example.test/modelscope-result.png', 'https://cdn.example.test/extra-result.png'],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const images = await providers.editImage({
      type: 'openai-compatible',
      platform: 'modelscope',
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      apiKey: 'test-key',
    }, 'Qwen/Qwen-Image-Edit', {
      prompt: 'camera edit',
      references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
      count: 1,
    });
    assert.deepEqual(images, [{ url: 'https://cdn.example.test/modelscope-result.png' }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api-inference.modelscope.cn/v1/images/generations');
    assert.equal(calls[0].init.headers['X-ModelScope-Async-Mode'], 'true');
    const requestBody = JSON.parse(calls[0].init.body);
    assert.equal(requestBody.model, 'Qwen/Qwen-Image-Edit');
    assert.equal(requestBody.image_url, 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA');
    assert.equal(calls[1].url, 'https://api-inference.modelscope.cn/v1/tasks/modelscope-task-1');
    assert.equal(calls[1].init.headers['X-ModelScope-Task-Type'], 'image_generation');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('keeps an explicit ModelScope image task failure terminal', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/images/generations')) {
      return new Response(JSON.stringify({ task_id: 'modelscope-failed-1', task_status: 'PENDING' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ task_id: 'modelscope-failed-1', task_status: 'FAILED', error: { message: 'quota exceeded' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(
      () => providers.editImage({
        type: 'openai-compatible',
        platform: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        apiKey: 'test-key',
      }, 'Qwen/Qwen-Image-Edit', {
        prompt: 'failed edit',
        references: ['data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA'],
        count: 1,
      }),
      (error) => {
        assert.match(error.message, /quota exceeded/);
        assert.equal(error.providerAcceptedTask, undefined);
        assert.equal(error.providerPossiblyAccepted, undefined);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('distinguishes a missing image-edit route from a missing model', () => {
  assert.equal(providers.isProviderEndpointNotFound({
    providerFailureKind: 'http',
    providerStatus: 404,
    message: '服务商接口返回 HTTP 404：404 page not found',
  }), true);
  assert.equal(providers.isProviderEndpointNotFound({
    providerFailureKind: 'http',
    providerStatus: 404,
    message: 'model not found',
  }), false);
  assert.equal(providers.isProviderEndpointNotFound({
    providerFailureKind: 'http',
    providerStatus: 422,
    message: 'endpoint validation failed',
  }), false);
});

test('omits legacy input_fidelity for GPT Image 2 while preserving it for other edit models', () => {
  const provider = {
    type: 'openai-compatible',
    name: 'OpenAI compatible',
    platform: 'openai',
    baseUrl: 'https://images.example.test/v1',
  };
  const input = { prompt: 'camera edit', references: ['data:image/png;base64,source'], fidelity: 'low', aspectRatio: '1:1', count: 1 };
  const gptImageBody = providers.buildImageEditRequestBody(provider, 'gpt-image-2', input, input.references, 1, '1024x1024');
  const gptImageLiteBody = providers.buildImageEditRequestBody(provider, 'gpt-image-2-lite', input, input.references, 1, '1024x1024');
  const otherBody = providers.buildImageEditRequestBody(provider, 'vendor-image-edit', input, input.references, 1, '1024x1024');
  assert.equal('input_fidelity' in gptImageBody, false);
  assert.equal('input_fidelity' in gptImageLiteBody, false);
  assert.equal(otherBody.input_fidelity, 'low');
  assert.deepEqual(gptImageBody.images, [{ image_url: input.references[0] }]);
});

test('custom image dimensions take precedence over the resolution tier for edit requests', () => {
  const provider = {
    type: 'openai-compatible',
    name: '65535',
    platform: '65535',
    baseUrl: 'https://api.example.test/v1',
  };
  const input = {
    prompt: 'long image edit',
    references: ['https://cdn.example.test/source.png'],
    aspectRatio: '自动',
    sizeMode: 'custom',
    width: 2429,
    height: 432,
    resolution: '4K',
    count: 1,
  };
  const body = providers.buildImageEditRequestBody(provider, 'gemini-3.1-flash-image', input, input.references, 1, '2432x432');
  assert.equal(body.size, '2432x432');
  assert.equal('resolution' in body, false);
});

test('image edit payload preserves all selected Canvas references', async () => {
  const previousFetch = globalThis.fetch;
  const references = [1, 2, 3, 4].map((index) => `data:image/png;base64,REF${index}`);
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/poster.png' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const images = await providers.editImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2.5', { prompt: '将四个角色合成 16:9 海报', references, count: 1 });
    assert.deepEqual(images, [{ url: 'https://cdn.example.test/poster.png' }]);
    assert.deepEqual(requestBody.images, references.map((image_url) => ({ image_url })));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('uses StarAPI native image sizes only for its gpt-image-2 model', () => {
  const starApi = {
    type: 'openai-compatible',
    name: 'sanmao.ai-OpenAI',
    platform: 'openai',
    baseUrl: 'https://www.starapi.cc/v1',
  };
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '16:9', 4096, 2304), '1536x1024');
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '16:9', 1024, 1536), '1536x1024');
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '2:1', 4096, 2048), '1536x1024');
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '9:16', 2304, 4096), '1024x1536');
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '1:1', 4096, 4096), '1024x1024');
  assert.equal(providers.mapImageRequestSize(starApi, 'gpt-image-2', '自定义', 1536, 1024), '1536x1024');
  assert.equal(providers.mapImageRequestSize({ ...starApi, baseUrl: 'https://proxy.example.test', name: 'star api-OpenAI' }, 'gpt-image-2', '16:9', 4096, 2304), '1536x1024');
});

test('does not change generic image size mapping for other models and providers', () => {
  const provider = {
    type: 'openai-compatible',
    name: 'OpenAI compatible',
    platform: 'openai',
    baseUrl: 'https://images.example.test/v1',
  };
  assert.equal(providers.mapImageRequestSize(provider, 'gpt-image-2', '16:9', 4096, 2304), '3840x2304');
  assert.equal(providers.mapImageRequestSize(provider, 'gpt-image-2-lite', '16:9', 4096, 2304), '3840x2304');
});

test('requests inline image bytes for GPT Image 2.5 responses', async () => {
  let requestBody;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const images = await providers.generateImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2.5', { prompt: 'test', count: 1 });
    assert.equal(requestBody.response_format, 'b64_json');
    assert.match(images[0].url, /^data:image\/png;base64,/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('honors an explicit image response format and preserves the manually registered model ID', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const images = await providers.generateImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2-4K', { prompt: 'test', count: 1, aspectRatio: '1:1', responseFormat: 'url' });
    assert.equal(images.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).model, 'gpt-image-2-4K');
    assert.equal(JSON.parse(calls[0].init.body).response_format, 'url');
    assert.match(calls[0].url, /\/images\/generations$/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('custom image dimensions take precedence over the resolution tier for generation requests', async () => {
  let requestBody;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await providers.generateImage({
      type: 'openai-compatible',
      platform: '65535',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
    }, 'gemini-3.1-flash-image', {
      prompt: 'long image',
      count: 1,
      aspectRatio: '自动',
      sizeMode: 'custom',
      width: 2429,
      height: 432,
      resolution: '4K',
    });
    assert.equal(requestBody.size, '2432x432');
    assert.equal('resolution' in requestBody, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('passes shared reference images through the generation request', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await providers.generateImage({
      type: 'openai-compatible',
      platform: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'test-key',
    }, 'gpt-image-2', {
      prompt: '商品详情图',
      count: 1,
      aspectRatio: '1:1',
      references: ['data:image/png;base64,REF'],
    });
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,REF' }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('provider image adapters reject excess references instead of silently truncating', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const references = Array.from({ length: 17 }, (_, index) => `data:image/png;base64,REF${index + 1}`);
  try {
    await assert.rejects(providers.generateImage({
      type: 'openai-compatible', platform: 'custom', baseUrl: 'https://images.example.test/v1', apiKey: 'test-key',
    }, 'gpt-image-2', { prompt: 'too many references', references }), /最多 16 张/);
    await assert.rejects(providers.editImage({
      type: 'openai-compatible', platform: 'custom', baseUrl: 'https://images.example.test/v1', apiKey: 'test-key',
    }, 'gpt-image-2', { prompt: 'too many references', references }), /最多 16 张/);
    await assert.rejects(providers.generateImage({
      type: 'openai-compatible', platform: 'custom', baseUrl: 'https://images.example.test/v1', apiKey: 'test-key',
    }, 'gpt-image-2', { prompt: 'invalid reference', references: ['data:image/png;base64,REF', ''] }), /参考图数据格式无效/);
    await assert.rejects(providers.editImage({
      type: 'openai-compatible', platform: 'custom', baseUrl: 'https://images.example.test/v1', apiKey: 'test-key',
    }, 'gpt-image-2', { prompt: 'invalid reference', references: ['data:image/png;base64,REF', ''] }), /参考图数据格式无效/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('uses the inferred v1 base when a manually registered image model is generated after sync', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2-4K' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAAAAAAAAAA' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const provider = {
    type: 'openai-compatible',
    platform: 'custom',
    baseUrl: 'https://images.example.test',
    apiKey: 'test-key',
  };
  try {
    await providers.discoverModels(provider);
    const images = await providers.generateImage(provider, 'gpt-image-2-4K', { prompt: 'test', count: 1, aspectRatio: '1:1' });
    assert.equal(images.length, 1);
    assert.equal(provider.baseUrl, 'https://images.example.test/v1');
    assert.equal(calls[1].url, 'https://images.example.test/v1/images/generations');
    assert.equal(JSON.parse(calls[1].init.body).model, 'gpt-image-2-4K');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan image generation and edits upload signed reference bytes and poll the matching task route', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const pollDelays = [];
  globalThis.setTimeout = (handler, timeout, ...args) => {
    if (timeout === 5000) {
      pollDelays.push(timeout);
      return previousSetTimeout(handler, 0, ...args);
    }
    return previousSetTimeout(handler, timeout, ...args);
  };
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });
    if (requestUrl.endsWith('/v1/images/uploads')) {
      const index = calls.filter((call) => call.url.endsWith('/v1/images/uploads')).length;
      return new Response(JSON.stringify({
        upload_url: `https://upload.example.test/signed/${index}`,
        url: `https://cdn.example.test/reference-${index}.png`,
        headers: { 'Content-Type': 'image/png', 'x-signed-token': `signed-${index}` },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.startsWith('https://upload.example.test/')) return new Response(null, { status: 200 });
    if (requestUrl.endsWith('/v1/images/generations')) {
      return new Response(JSON.stringify({ task_id: 'generation-task', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.endsWith('/v1/images/edits')) {
      return new Response(JSON.stringify({ task_id: 'edit-task', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.endsWith('/v1/images/generations/generation-task')) {
      return new Response(JSON.stringify({ status: 'completed', data: [{ url: 'https://cdn.example.test/generated.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.endsWith('/v1/images/edits/edit-task')) {
      return new Response(JSON.stringify({ status: 'completed', data: [{ url: 'https://cdn.example.test/edited.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected Cangyuan test request: ${requestUrl}`);
  };
  const provider = {
    type: 'openai-compatible',
    platform: 'cangyuan',
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
    apiKey: 'cangyuan-test-key',
  };
  const reference = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA';
  try {
    const generated = await providers.generateImage(provider, 'ax-gpt-image-2.6-flare', {
      prompt: '雾中群山', count: 1, aspectRatio: '16:9', resolution: '2K', quality: 'xhigh', outputFormat: 'gif', background: 'transparent', references: [reference],
      seed: '42', frameCount: 8, frameDurationMs: 120,
    });
    const edited = await providers.editImage(provider, 'ax-gpt-image-2.6-flare', {
      prompt: '给主体增加柔和的轮廓光', references: [reference], mask: reference, count: 1, aspectRatio: '1:1', resolution: '1K', quality: 'max', outputFormat: 'webp', background: 'auto',
    });
    assert.deepEqual(generated, [{ url: 'https://cdn.example.test/generated.png' }]);
    assert.deepEqual(edited, [{ url: 'https://cdn.example.test/edited.png' }]);

    const uploadCalls = calls.filter((call) => call.url.endsWith('/v1/images/uploads'));
    assert.equal(uploadCalls.length, 3);
    for (const uploadCall of uploadCalls) {
      const body = JSON.parse(uploadCall.init.body);
      assert.deepEqual(Object.keys(body).sort(), ['bytes', 'content_md5', 'content_type']);
      assert.equal(body.bytes, Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64').byteLength);
      assert.equal(body.content_type, 'image/png');
      assert.match(body.content_md5, /^[A-Za-z0-9+/]{22}==$/);
      assert.equal(uploadCall.init.headers.Authorization, 'Bearer cangyuan-test-key');
    }
    const putCalls = calls.filter((call) => call.init.method === 'PUT');
    assert.equal(putCalls.length, 3);
    assert.ok(putCalls.every((call) => call.init.headers.get('x-signed-token') && !call.init.headers.has('Authorization')));
    const referenceByteLength = Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64').byteLength;
    assert.ok(putCalls.every((call) => Buffer.from(call.init.body).byteLength === referenceByteLength));

    const generationCall = calls.find((call) => call.url.endsWith('/v1/images/generations'));
    assert.deepEqual(JSON.parse(generationCall.init.body), {
      model: 'ax-gpt-image-2.6-flare', prompt: '雾中群山', async: true,
      size: '2K', aspect_ratio: '16:9', quality: 'xhigh', output_format: 'gif', background: 'transparent',
      seed: '42', frame_count: 8, frame_duration_ms: 120,
      images: ['https://cdn.example.test/reference-1.png'],
    });
    const editCall = calls.find((call) => call.url.endsWith('/v1/images/edits'));
    assert.deepEqual(JSON.parse(editCall.init.body), {
      model: 'ax-gpt-image-2.6-flare', prompt: '给主体增加柔和的轮廓光', async: true,
      size: '1K', quality: 'max', output_format: 'webp', background: 'auto',
      images: ['https://cdn.example.test/reference-2.png'], mask: 'https://cdn.example.test/reference-3.png',
    });
    assert.ok(calls.some((call) => call.url.endsWith('/v1/images/generations/generation-task')));
    assert.ok(calls.some((call) => call.url.endsWith('/v1/images/edits/edit-task')));
    assert.deepEqual(pollDelays, [5000, 5000]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
  }
});

test('Cangyuan image requests reject unconfirmed batch count without submitting a task', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('should not submit'); };
  try {
    await assert.rejects(providers.generateImage({
      type: 'openai-compatible', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    }, 'model-without-verified-n', { prompt: 'test', count: 2 }), /未确认该模型支持批量 n 参数/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('MiniMax H3 image requests forward documented quality, variant, count, and reference limits', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/h3.png' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const provider = {
    type: 'openai-compatible', platform: 'cangyuan',
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
  };
  try {
    const images = await providers.generateImage(provider, 'minimax-h3-image', {
      prompt: '湖边晨雾', count: 4, quality: '2k', variant: 'highspeed', aspectRatio: '16:9',
    });
    assert.deepEqual(images, [{ url: 'https://cdn.example.test/h3.png' }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: 'minimax-h3-image', prompt: '湖边晨雾', async: true,
      n: 4, quality: '2k', variant: 'highspeed', size: '16:9',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('MiniMax H3 image requests reject undocumented values before network submission', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('should not submit'); };
  const provider = {
    type: 'openai-compatible', platform: 'cangyuan',
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
  };
  try {
    await assert.rejects(providers.generateImage(provider, 'minimax-h3-image', {
      prompt: 'scene', count: 5,
    }), /n 最大值为 4/);
    await assert.rejects(providers.generateImage(provider, 'minimax-h3-image', {
      prompt: 'scene', references: Array(17).fill('https://cdn.example.test/ref.png'),
    }), /图片参考最多 16 张/);
    await assert.rejects(providers.generateImage(provider, 'minimax-h3-image', {
      prompt: 'x'.repeat(8001),
    }), /提示词最多 8000 个字符/);
    await assert.rejects(providers.generateImage(provider, 'minimax-h3-image', {
      prompt: 'scene', sizeMode: 'custom', width: 1920, height: 1080,
    }), /不支持图片尺寸/);
    await assert.rejects(providers.generateImage(provider, 'minimax-h3-image', {
      prompt: 'scene', variant: 'turbo',
    }), /不支持生成模式/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan rejects SVG batch generation before submitting a task', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('should not submit'); };
  try {
    const provider = {
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    };
    await assert.rejects(providers.generateImage(provider, 'gpt-image-2.6-flare-o', {
      prompt: '未来城市', count: 2, aspectRatio: '16:9', resolution: '1K',
      quality: 'max', outputFormat: 'svg', background: 'auto',
    }), /SVG 生成每次只能输出 1 张/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan SVG generation normalizes nested base64 output for one image', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#123456"/></svg>';
  const encodedSvg = Buffer.from(svg).toString('base64');
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: encodedSvg }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provider = {
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    };
    const images = await providers.generateImage(provider, 'gpt-image-2.6-flare-o', {
      prompt: '未来城市', count: 1, aspectRatio: '16:9', resolution: '1K',
      quality: 'max', outputFormat: 'svg', background: 'auto',
    });
    assert.deepEqual(images, [{ url: `data:image/svg+xml;base64,${encodedSvg}` }]);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: 'gpt-image-2.6-flare-o', prompt: '未来城市', async: true,
      size: '16:9', quality: 'max', output_format: 'svg', background: 'auto',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan rejects SVG response bytes for a raster output request', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const encodedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>').toString('base64');
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: encodedSvg }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(providers.generateImage({
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    }, 'gpt-image-2.6-flare-o', {
      prompt: '未来城市', count: 1, outputFormat: 'png',
    }), /不是有效的 PNG、JPEG、WebP、GIF 或 BMP 图片/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan rejects SVG reference input before uploading it', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  const encodedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>').toString('base64');
  globalThis.fetch = async () => { requests += 1; throw new Error('should not upload'); };
  try {
    await assert.rejects(providers.generateImage({
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    }, 'ax-gpt-image-2.6-flare', {
      prompt: '使用参考图', count: 1,
      references: [`data:image/svg+xml;base64,${encodedSvg}`],
    }), /沧元参考图仅支持 PNG、JPEG、WebP/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan image sizing keeps documented size and ratio fields separate and treats suggestions as hints', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/image.png' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provider = {
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    };
    await providers.generateImage(provider, 'ax-gpt-image-2.5-flare', {
      prompt: 'wide image', aspectRatio: '5:4', resolution: '1K',
    });
    await providers.generateImage(provider, 'ax-gpt-image-2.5-flare', {
      prompt: 'custom square', sizeMode: 'custom', width: 1280, height: 1280, aspectRatio: '自定义',
    });
    await providers.generateImage(provider, 'gpt-image-2.6-flare-o', {
      prompt: 'wide image', aspectRatio: '5:4',
    });

    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: 'ax-gpt-image-2.5-flare', prompt: 'wide image', async: true,
      size: '1K', aspect_ratio: '5:4',
    });
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      model: 'ax-gpt-image-2.5-flare', prompt: 'custom square', async: true,
      size: '1280x1280',
    });
    assert.deepEqual(JSON.parse(calls[2].init.body), {
      model: 'gpt-image-2.6-flare-o', prompt: 'wide image', async: true,
      size: '5:4',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan image generation forwards independent resolution, tier, and required series fields', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ url: `https://cdn.example.test/${calls.length}.png` }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provider = {
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    };
    await providers.generateImage(provider, 'flux-3-image', {
      prompt: '夜色中的城市', aspectRatio: '自动', resolution: '2K',
    });
    await providers.generateImage(provider, 'gpt-image-2.5-x', {
      prompt: '一张产品海报', tier: '2k', series: 'sunburst',
    });
    await providers.generateImage(provider, 'gpt-image-2.5-x', {
      prompt: '默认系列海报',
    });
    await providers.generateImage(provider, 'flux-3-klein', {
      prompt: '可复现的产品草图', resolution: '4K', seed: 'seed-42', enablePromptExpansion: false,
    });

    const resolutionPayload = JSON.parse(calls[0].init.body);
    assert.equal(resolutionPayload.resolution, '2K');
    assert.notEqual(resolutionPayload.size, '2K');

    const tierPayload = JSON.parse(calls[1].init.body);
    assert.equal(tierPayload.tier, '2k');
    assert.equal(tierPayload.series, 'sunburst');
    assert.equal(Object.hasOwn(tierPayload, 'resolution'), false);

    const defaultSeriesPayload = JSON.parse(calls[2].init.body);
    assert.equal(defaultSeriesPayload.series, 'flare');

    const kleinPayload = JSON.parse(calls[3].init.body);
    assert.equal(kleinPayload.resolution, '4K');
    assert.equal(kleinPayload.seed, 'seed-42');
    assert.equal(kleinPayload.enable_prompt_expansion, false);
    assert.notEqual(kleinPayload.size, '4K');

    await assert.rejects(() => providers.generateImage(provider, 'gpt-image-2.5-x', {
      prompt: '无效档位', tier: '8k',
    }), /不支持生成档位“8k”/);
    await assert.rejects(() => providers.generateImage(provider, 'flux-3-image', {
      prompt: '不支持的选项', seed: 'seed-42',
    }), /不支持随机种子.*seed-42/);
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan image count honors documented maxima above eight and rejects values beyond them', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: Array.from({ length: 10 }, (_, index) => ({ url: `https://cdn.example.test/${index}.png` })) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provider = {
      type: 'openai-compatible', platform: 'cangyuan',
      baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
    };
    const images = await providers.generateImage(provider, 'gpt-image-2-az', {
      prompt: 'ten images', count: 10,
    });
    assert.equal(images.length, 10);
    assert.equal(JSON.parse(calls[0].init.body).n, 10);

    await assert.rejects(() => providers.generateImage(provider, 'gpt-image-2-az', {
      prompt: 'too many images', count: 11,
    }), /n 最大值为 10/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Cangyuan rejects unsupported profile parameters and masks before uploading references', async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('should not upload or submit'); };
  const provider = {
    type: 'openai-compatible', platform: 'cangyuan',
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key',
  };
  const reference = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA';
  try {
    await assert.rejects(
      providers.generateImage(provider, 'ax-gpt-image-2.5-flare', { prompt: 'test', count: 2, references: [reference] }),
      /n 最大值为 1/,
    );
    await assert.rejects(
      providers.editImage(provider, 'mj2-midjourney-describe', { prompt: 'test', references: [reference], mask: reference }),
      /未声明支持蒙版/,
    );
    await assert.rejects(
      providers.generateImage(provider, 'mj2-midjourney-describe', { prompt: 'test', quality: 'high' }),
      /不支持图片质量“high”/,
    );
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('manual model dialog does not close from backdrop clicks', () => {
  const start = pageSource.indexOf('manualModelProvider &&');
  const end = pageSource.indexOf('confirmState &&', start);
  const dialog = pageSource.slice(start, end);
  assert.doesNotMatch(dialog, /className: "dialog-backdrop manual-model-dialog-backdrop",\s*onClick:/);
});
