import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/providers.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const agnes = await readFile(new URL('../lib/agnes.ts', import.meta.url), 'utf8');
const detectionUrl = new URL('../lib/native-search-detection.ts', import.meta.url);
const detection = await readFile(detectionUrl, 'utf8');
const bundledSource = `${detection.replace('export function inferNativeSearch', 'function inferNativeSearch')}\n${agnes.replace(/^import .+;\r?\n/gm, '')}\n${source.replace("import { inferNativeSearch } from './native-search-detection';", '').replace("import { agnesModelCatalog } from './agnes';", '')}`;
const compiled = ts.transpileModule(bundledSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const providers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const presetSource = await readFile(new URL('../lib/provider-presets.ts', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const presetCompiled = ts.transpileModule(presetSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: new URL('../lib/provider-presets.ts', import.meta.url).pathname,
}).outputText;
const presets = await import(`data:text/javascript;base64,${Buffer.from(presetCompiled).toString('base64')}`);

test('provider picker uses real local logos for visible providers', async () => {
  const visiblePresets = presets.providerPresets.filter((preset) => preset.showInPicker !== false && preset.value !== 'custom');
  assert.equal(visiblePresets.length, 11);
  assert.ok(visiblePresets.every((preset) => typeof preset.logo === 'string' && preset.logo.startsWith('/brand/providers/')) || visiblePresets.every((preset) => typeof preset.logo === 'string'));
  assert.match(pageSource, /className: preset\.logo \? 'platform-logo' : ''/);
  assert.match(pageSource, /children: preset\.logo \? .*src: preset\.logo/s);
  for (const preset of visiblePresets) {
    const logoFile = new URL(`../public${preset.logo}`, import.meta.url);
    const logo = await readFile(logoFile);
    assert.ok(logo.byteLength > 0, `${preset.value} logo should not be empty`);
  }
  const custom = presets.providerPresets.find((preset) => preset.value === 'custom');
  assert.equal(custom.logo, undefined);
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

test('detects native task transport from endpoint metadata', () => {
  const provider = { platform: 'custom', baseUrl: 'https://video.example', videoTransport: 'auto' };
  assert.equal(providers.inferVideoTransportFromMetadata({ endpoints: ['/v1/tasks', '/v1/tasks/{id}'] }, provider), 'native-task');
  assert.equal(provider.videoTransport, 'native-task');
});

test('uses the OpenAI video task status default for a custom compatible provider', () => {
  const config = presets.resolveProviderConfiguration({
    platform: 'custom',
    baseUrl: 'https://video.example/v1',
    videoTransport: 'openai-videos',
  });
  assert.equal(config.videoTaskStatusPath, '/v1/videos/{id}');
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

test('adds the standard v1 model endpoint for a provider website root', () => {
  const candidates = providers.modelEndpointCandidates({
    type: 'openai-compatible',
    baseUrl: 'https://api.apiqik.com',
    modelsPath: '/models',
    apiKey: 'test',
  });
  assert.deepEqual(candidates, [
    { url: 'https://api.apiqik.com/models' },
    { url: 'https://api.apiqik.com/v1/models', inferredBaseUrl: 'https://api.apiqik.com/v1' },
  ]);
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
