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
  [/import \{ readFile \} from ['"]node:fs\/promises['"];\r?\n/, ''],
  [/import \{ resolveStoredImageReference \} from ['"]\.\/image-storage['"];\r?\n/, 'const resolveStoredImageReference = async () => { throw new Error(\'missing storage fixture\'); };\n'],
]);
const catalogSource = await readFile(new URL('../lib/upscale-catalog.ts', import.meta.url), 'utf8');
const guideSource = await readFile(new URL('../components/UpscaleConnectionGuide.tsx', import.meta.url), 'utf8');
const tencentLogo = await readFile(new URL('../public/brand/tencent-cloud.svg', import.meta.url), 'utf8');
const aliyunLogo = await readFile(new URL('../public/brand/aliyun-cloud.ico', import.meta.url));
const connectionRouteSource = await readFile(new URL('../app/api/upscale/connections/route.ts', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
const taskStoreSource = await readFile(new URL('../lib/upscale-task-store.ts', import.meta.url), 'utf8');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');

test('upscale connection cards use the supplied Tencent and Alibaba logos', () => {
  assert.match(guideSource, /upscale-connection-logo \$\{tencent \? 'tencent' : 'aliyun'\}/);
  assert.match(guideSource, /\/brand\/tencent-cloud\.svg/);
  assert.match(guideSource, /\/brand\/aliyun-cloud\.ico/);
  assert.doesNotMatch(guideSource, /upscale-connection-logo">\{tencent \? '腾' : '阿'\}/);
  assert.match(tencentLogo, /<svg[^>]*viewBox=/);
  assert.ok(aliyunLogo.byteLength > 0);
});

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

test('Tencent AISuperResolution processes an uploaded COS object and never needs detect-url', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png', 'x-cos-request-id': 'cos-1' } });
  };
  const client = provider.createUpscaleProvider('tencent-ci', { provider: 'tencent-ci', secretId: 'AKID', secretKey: 'SECRET', bucket: 'demo-1250000000', region: 'ap-shanghai' });
  const sourceUrl = 'https://demo-1250000000.cos.ap-shanghai.myqcloud.com/super-resolution-input/AKID/uuid/upload-1.jpg';
  const result = await client.upscale({ modelId: 'tencent-super-resolution', imageUrl: sourceUrl, scale: 4, outputFormat: 'jpg', outputQuality: 72 });
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, sourceUrl);
  assert.equal(requestUrl.searchParams.get('ci-process'), 'AISuperResolution');
  assert.equal(requestUrl.searchParams.has('detect-url'), false);
  assert.equal(requestUrl.searchParams.get('magnify'), '4');
  assert.equal(requestUrl.searchParams.has('OutputFormat'), false);
  assert.equal(requestUrl.searchParams.has('OutputQuality'), false);
  assert.equal(calls[0].init.headers.Authorization.includes('SECRET'), false);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.mime, 'image/png');
});

test('Tencent COS authorization signs extra headers such as content-type', () => {
  const url = 'https://demo-1250000000.cos.ap-shanghai.myqcloud.com/super-resolution-input/AKID/uuid/upload-1.jpg';
  const actual = provider.buildTencentCosAuthorization({ method: 'PUT', url, secretId: 'AKIDEXAMPLE', secretKey: 'secret-example', nowSeconds: 1700000000, headers: [['content-type', 'image/jpeg']] });
  assert.match(actual, /q-header-list=content-type;host/);
  assert.match(actual, /q-signature=/);
  assert.equal(actual.includes('secret-example'), false);
});

test('Tencent upload goes to the user COS bucket with content-type signed and a private object key', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('', { status: 200, headers: { 'x-cos-request-id': 'cos-put' } });
  };
  const credentials = { provider: 'tencent-ci', secretId: 'AKID', secretKey: 'SECRET', bucket: 'demo-1250000000', region: 'ap-shanghai' };
  const uploaded = await provider.uploadTencentImageToCos(credentials, pngBytes, 'image/png');
  assert.equal(calls.length, 1);
  const put = new URL(calls[0].url);
  assert.equal(put.origin, 'https://demo-1250000000.cos.ap-shanghai.myqcloud.com');
  assert.match(put.pathname, /^\/super-resolution-input\/AKID\/[^/]+\/upload-\d+\.png$/);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers['Content-Type'], 'image/png');
  assert.equal(calls[0].init.headers.Authorization.includes('SECRET'), false);
  assert.match(calls[0].init.headers.Authorization, /q-header-list=content-type;host/);
  assert.equal(uploaded, calls[0].url);
});

test('Alibaba standard VIAPI signs RPC, sends Url and downloads ImageURL', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return new Response(JSON.stringify({ RequestId: 'ali-1', Data: { ImageURL: 'https://result.example/out.png' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const client = provider.createUpscaleProvider('aliyun-viapi', { provider: 'aliyun-viapi', accessKeyId: 'LTAIexample', accessKeySecret: 'SECRET' });
  const result = await client.upscale({ modelId: 'aliyun-standard-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 2, outputFormat: 'jpg', outputQuality: 72 });
  const requestUrl = new URL(calls[0].url);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(requestUrl.searchParams.get('Action'), 'MakeSuperResolutionImage');
  assert.equal(requestUrl.searchParams.get('Url'), 'https://cdn.example/in.png');
  assert.equal(requestUrl.searchParams.get('UpscaleFactor'), '2');
  assert.equal(requestUrl.searchParams.get('OutputFormat'), 'jpg');
  assert.equal(requestUrl.searchParams.get('OutputQuality'), '72');
  assert.ok(requestUrl.searchParams.get('Signature'));
  assert.equal(requestUrl.searchParams.get('Signature').includes('SECRET'), false);
  assert.equal(calls[1].url, 'https://result.example/out.png');
  assert.equal(result.status, 'succeeded');
});

test('Alibaba connection probe validates credentials via GetOssStsToken using POST', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ RequestId: 'sts-1', Data: { AccessKeyId: 'STS.example', AccessKeySecret: 'STS_SECRET', SecurityToken: 'STS_TOKEN' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = provider.createUpscaleProvider('aliyun-viapi', { provider: 'aliyun-viapi', accessKeyId: 'LTAIexample', accessKeySecret: 'SECRET' });
  const result = await client.testConnection();
  assert.equal(result.ok, true);
  assert.equal(calls[0].init.method, 'POST');
  const url = new URL(calls[0].url);
  assert.equal(url.hostname, 'viapiutils.cn-shanghai.aliyuncs.com');
  assert.equal(url.searchParams.get('Action'), 'GetOssStsToken');
  assert.equal(url.searchParams.get('Version'), '2020-04-01');
});

test('Alibaba unsupported HTTP method is not reported as missing service permission', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ Code: 'UnsupportedHTTPMethod' }), { status: 403, headers: { 'content-type': 'application/json' } });
  const client = provider.createUpscaleProvider('aliyun-viapi', { provider: 'aliyun-viapi', accessKeyId: 'LTAIexample', accessKeySecret: 'SECRET' });
  await assert.rejects(() => client.upscale({ modelId: 'aliyun-standard-super-resolution', imageUrl: 'https://cdn.example/in.png', scale: 2 }), (error) => {
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.match(error.message, /请求方式不兼容/);
    return true;
  });
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
    assert.match(error.message, /暂无处理权限|没有调用此功能的权限/);
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

test('cloud connection guide points beginners to key pages and warns against user creation', () => {
  assert.match(catalogSource, /console\.cloud\.tencent\.com\/cam\/capi/);
  assert.match(catalogSource, /console\.cloud\.tencent\.com\/cos\/bucket/);
  assert.match(catalogSource, /buy\.cloud\.tencent\.com\/price\/ci\/calculator/);
  assert.match(catalogSource, /ram\.console\.aliyun\.com\/profile\/access-keys/);
  assert.match(guideSource, /照着下面做就行/);
  assert.match(guideSource, /勾选“我已知晓风险”/);
  assert.match(guideSource, /切换使用子账号密钥”不用点/);
  assert.match(guideSource, /不用进入“用户”或创建 RAM 用户/);
  assert.match(guideSource, /腾讯云还需要一个 COS 存储桶/);
  assert.match(guideSource, /费用说明/);
  assert.match(connectionRouteSource, /requiresBucketSetup/);
  assert.match(guideSource, /更多官方信息（可跳过）/);
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
