import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { afterEach } from 'node:test';
import ts from 'typescript';

async function compileModule(url, replacements = []) {
  let source = await readFile(url, 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: url.pathname }).outputText;
  const file = path.join(process.cwd(), 'tests', `.sanmao-upscale-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(file, compiled, 'utf8');
  try { return await import(pathToFileURL(file).href); } finally { await unlink(file).catch(() => undefined); }
}

const provider = await compileModule(new URL('../lib/upscale-providers.ts', import.meta.url));
const imageModule = await compileModule(new URL('../lib/upscale-image.ts', import.meta.url), [
  ["import { readFile } from 'node:fs/promises';\n", ''],
  ["import { resolveStoredImageReference } from './image-storage';\n", 'const resolveStoredImageReference = async () => { throw new Error(\'missing storage fixture\'); };\n'],
]);
const catalogSource = await readFile(new URL('../lib/upscale-catalog.ts', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
const taskStoreSource = await readFile(new URL('../lib/upscale-task-store.ts', import.meta.url), 'utf8');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');

test('Tencent COS authorization is deterministic and does not contain SecretKey', () => {
  const url = 'https://demo-1250000000.cos.ap-shanghai.myqcloud.com/?ci-process=AISuperResolution&detect-url=https%3A%2F%2Fcdn.example%2Finput.png&magnify=4';
  const actual = provider.buildTencentCosAuthorization({ method: 'GET', url, secretId: 'AKIDEXAMPLE', secretKey: 'secret-example', nowSeconds: 1700000000 });
  const signTime = '1700000000;1700000600';
  const canonicalQuery = 'ci-process=AISuperResolution&detect-url=https%3A%2F%2Fcdn.example%2Finput.png&magnify=4';
  const httpString = `get\n/\n${canonicalQuery}\nhost=demo-1250000000.cos.ap-shanghai.myqcloud.com\n`;
  const signKey = createHmac('sha1', 'secret-example').update(signTime).digest('hex');
  const expected = createHmac('sha1', signKey).update(`sha1\n${signTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`).digest('hex');
  assert.match(actual, /q-ak=AKIDEXAMPLE/);
  assert.match(actual, /q-url-param-list=ci-process;detect-url;magnify/);
  assert.match(actual, new RegExp(`q-signature=${expected}`));
  assert.equal(actual.includes('secret-example'), false);
});

test('Tencent AISuperResolution sends detect-url, official action and magnify', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png', 'x-cos-request-id': 'cos-1' } });
  };
  const client = provider.createUpscaleProvider('tencent-ci', { provider: 'tencent-ci', secretId: 'AKID', secretKey: 'SECRET', bucket: 'demo-1250000000', region: 'ap-shanghai' });
  const result = await client.upscale({ modelId: 'tencent-super-resolution', imageUrl: 'https://cdn.example/input.png', scale: 4 });
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.searchParams.get('ci-process'), 'AISuperResolution');
  assert.equal(requestUrl.searchParams.get('detect-url'), 'https://cdn.example/input.png');
  assert.equal(requestUrl.searchParams.get('magnify'), '4');
  assert.equal(calls[0].init.headers.Authorization.includes('SECRET'), false);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.mime, 'image/png');
});

test('Alibaba standard VIAPI signs RPC, sends Url and downloads ImageURL', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(JSON.stringify({ RequestId: 'ali-1', Data: { ImageURL: 'https://result.example/out.png' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const client = provider.createUpscaleProvider('aliyun-viapi', { provider: 'aliyun-viapi', accessKeyId: 'LTAIexample', accessKeySecret: 'SECRET' });
  const result = await client.upscale({ modelId: 'aliyun-standard-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 2 });
  const requestUrl = new URL(calls[0]);
  assert.equal(requestUrl.searchParams.get('Action'), 'MakeSuperResolutionImage');
  assert.equal(requestUrl.searchParams.get('Url'), 'https://cdn.example/in.png');
  assert.equal(requestUrl.searchParams.get('UpscaleFactor'), '2');
  assert.ok(requestUrl.searchParams.get('Signature'));
  assert.equal(requestUrl.searchParams.get('Signature').includes('SECRET'), false);
  assert.equal(calls[1], 'https://result.example/out.png');
  assert.equal(result.status, 'succeeded');
});

test('Alibaba generative VIAPI maps queued, processing and succeeded results', async () => {
  const actions = [];
  let poll = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    actions.push(parsed.searchParams.get('Action'));
    if (parsed.searchParams.get('Action') === 'GenerateSuperResolutionImage') return new Response(JSON.stringify({ Data: { JobId: 'job-1', Status: 'PROCESSING' } }), { status: 200 });
    poll += 1;
    if (poll === 1) return new Response(JSON.stringify({ Data: { JobId: 'job-1', Status: 'RUNNING' } }), { status: 200 });
    if (poll === 2) return new Response(JSON.stringify({ Data: { JobId: 'job-1', Status: 'SUCCESS', ResultUrl: 'https://result.example/generated.png' } }), { status: 200 });
    return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const client = provider.createUpscaleProvider('aliyun-viapi', { provider: 'aliyun-viapi', accessKeyId: 'LTAIexample', accessKeySecret: 'SECRET' });
  const queued = await client.upscale({ modelId: 'aliyun-generative-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 3 });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.providerTaskId, 'job-1');
  const processing = await client.poll('job-1', { modelId: 'aliyun-generative-super-resolution' });
  assert.equal(processing.status, 'processing');
  const succeeded = await client.poll('job-1', { modelId: 'aliyun-generative-super-resolution' });
  assert.equal(succeeded.status, 'succeeded');
  assert.deepEqual(actions.slice(0, 3), ['GenerateSuperResolutionImage', 'GetAsyncJobResult', 'GetAsyncJobResult']);
  assert.equal(actions[3], null);
});

test('cloud failures are mapped to actionable Chinese messages', async () => {
  globalThis.fetch = async () => new Response('<Error><Code>SignatureDoesNotMatch</Code><Message>secret</Message></Error>', { status: 403, headers: { 'content-type': 'application/xml' } });
  const client = provider.createUpscaleProvider('tencent-ci', { provider: 'tencent-ci', secretId: 'AKID', secretKey: 'SECRET', bucket: 'demo', region: 'ap-shanghai' });
  await assert.rejects(() => client.upscale({ modelId: 'tencent-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 2 }), (error) => {
    assert.equal(error.code, 'SIGNATURE_INVALID');
    assert.match(error.message, /密钥验证失败/);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
});

test('permission failures are not misreported as invalid credentials', async () => {
  globalThis.fetch = async () => new Response('<Error><Code>AccessDenied</Code><Message>permission</Message></Error>', { status: 403, headers: { 'content-type': 'application/xml' } });
  const client = provider.createUpscaleProvider('tencent-ci', { provider: 'tencent-ci', secretId: 'AKID', secretKey: 'SECRET', bucket: 'demo', region: 'ap-shanghai' });
  await assert.rejects(() => client.upscale({ modelId: 'tencent-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 2 }), (error) => {
    assert.equal(error.code, 'PERMISSION_DENIED');
    assert.match(error.message, /没有调用此功能的权限/);
    return true;
  });
});

test('VIAPI preprocessing keeps the documented dimensions, byte limit and transparency preference', async () => {
  const sharp = (await import('sharp')).default;
  const large = await sharp({ create: { width: 2400, height: 1400, channels: 3, background: { r: 120, g: 130, b: 140 } } }).png().toBuffer();
  const result = await imageModule.prepareAliyunUpscaleImage(`data:image/png;base64,${large.toString('base64')}`);
  assert.ok(result.bytes.byteLength <= 5 * 1024 * 1024);
  assert.ok(result.width <= 1920 && result.height <= 1080);
  const transparent = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const transparentResult = await imageModule.prepareAliyunUpscaleImage(`data:image/png;base64,${transparent.toString('base64')}`);
  assert.equal(transparentResult.mime, 'image/png');
  assert.match(transparentResult.dataUrl, /^data:image\/png;base64,/);
});

test('catalog keeps fixed cloud models outside the generic model discovery flow', () => {
  assert.match(catalogSource, /tencent-super-resolution/);
  assert.match(catalogSource, /aliyun-standard-super-resolution/);
  assert.match(catalogSource, /aliyun-generative-super-resolution/);
  assert.match(catalogSource, /MakeSuperResolutionImage/);
  assert.match(catalogSource, /GenerateSuperResolutionImage/);
  assert.equal(catalogSource.includes('fetch('), false);
});

test('cloud credentials are represented publicly only by masked state and tasks are minimal', () => {
  assert.match(storeSource, /encryptedSecretId/);
  assert.match(storeSource, /encryptedSecretKey/);
  assert.match(storeSource, /encryptedAccessKeyId/);
  assert.match(storeSource, /encryptedAccessKeySecret/);
  assert.match(storeSource, /maskedCredential/);
  assert.equal(taskStoreSource.includes('providerResponse'), false);
  assert.equal(taskStoreSource.includes('sourceUrl'), false);
});
