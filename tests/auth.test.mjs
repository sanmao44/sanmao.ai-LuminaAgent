import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const auth = await loadTypeScript('../lib/auth.ts');
const originalMode = process.env.SANMAO_NETWORK_MODE;
const originalPassword = process.env.SANMAO_ADMIN_PASSWORD;

function request(url, cookie = '') {
  return new Request(url, { headers: cookie ? { cookie } : undefined });
}

test.after(() => {
  if (originalMode === undefined) delete process.env.SANMAO_NETWORK_MODE;
  else process.env.SANMAO_NETWORK_MODE = originalMode;
  if (originalPassword === undefined) delete process.env.SANMAO_ADMIN_PASSWORD;
  else process.env.SANMAO_ADMIN_PASSWORD = originalPassword;
});

test('local mode trusts only loopback requests when no password is configured', () => {
  delete process.env.SANMAO_NETWORK_MODE;
  delete process.env.SANMAO_ADMIN_PASSWORD;
  assert.equal(auth.networkMode(), 'local');
  assert.equal(auth.adminProtectionEnabled(), false);
  assert.equal(auth.isAdminRequest(request('http://127.0.0.1:3210/api/admin/session')), true);
  assert.equal(auth.isTrustedAppRequest(request('http://192.168.1.20:3210/api/workspace')), false);
});

test('lan mode requires a password for remote requests', () => {
  process.env.SANMAO_NETWORK_MODE = 'lan';
  delete process.env.SANMAO_ADMIN_PASSWORD;
  assert.equal(auth.networkMode(), 'lan');
  assert.equal(auth.adminProtectionEnabled(), true);
  assert.equal(auth.isTrustedAppRequest(request('http://192.168.1.20:3210/api/workspace')), false);
});

test('lan mode accepts only the configured admin cookie remotely', () => {
  process.env.SANMAO_NETWORK_MODE = 'lan';
  process.env.SANMAO_ADMIN_PASSWORD = 'lan-test-password';
  const remote = request('http://192.168.1.20:3210/api/workspace');
  assert.equal(auth.verifyAdminPassword('wrong-password'), false);
  assert.equal(auth.verifyAdminPassword('lan-test-password'), true);
  const cookie = auth.adminCookie(remote).split(';', 1)[0];
  assert.equal(auth.isTrustedAppRequest(request(remote.url, cookie)), true);
  assert.equal(auth.isTrustedAppRequest(request(remote.url, 'sanmao_admin=invalid')), false);
});

test('本机模式下也拦跨站请求，命令行与同源页面不受影响', () => {
  delete process.env.SANMAO_NETWORK_MODE;
  delete process.env.SANMAO_ADMIN_PASSWORD;

  const crossSite = new Request('http://127.0.0.1:3210/api/mcp', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(auth.isAdminRequest(crossSite), false, '别的网页不能往本机 API 塞配置');
  assert.equal(auth.isTrustedAppRequest(crossSite), false);

  // 跨站页面用 <img>/<script> 发 GET 时不带 Origin，只有 sec-fetch-site 能识别。
  const crossSiteRead = new Request('http://127.0.0.1:3210/api/mcp', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(auth.isAdminRequest(crossSiteRead), false);

  const sameOrigin = new Request('http://127.0.0.1:3210/api/mcp', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3210', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(auth.isAdminRequest(sameOrigin), true, '应用自己的页面必须照常可用');

  // 命令行、脚本、桌面外壳都不带 http(s) 的 Origin，不能被拦。
  assert.equal(auth.isAdminRequest(request('http://127.0.0.1:3210/api/mcp')), true);
  assert.equal(auth.isAdminRequest(new Request('http://127.0.0.1:3210/api/mcp', { headers: { origin: 'null' } })), true);
  assert.equal(auth.isAdminRequest(new Request('http://127.0.0.1:3210/api/mcp', { headers: { origin: 'tauri://localhost' } })), true);

  // 反代把 Host 改写成本机地址时，靠 X-Forwarded-Host 认出同源页面。
  const proxied = new Request('http://127.0.0.1:3210/api/mcp', {
    headers: { origin: 'https://sanmao.example.com', 'x-forwarded-host': 'sanmao.example.com' },
  });
  assert.equal(auth.isAdminRequest(proxied), true);
  const proxiedAttack = new Request('http://127.0.0.1:3210/api/mcp', {
    headers: { origin: 'https://evil.example', 'x-forwarded-host': 'sanmao.example.com' },
  });
  assert.equal(auth.isAdminRequest(proxiedAttack), false, '转发头对不上照样拦');
});

test('跨站请求在局域网模式同样拿不到管理员权限', () => {
  process.env.SANMAO_NETWORK_MODE = 'lan';
  process.env.SANMAO_ADMIN_PASSWORD = 'lan-test-password';
  const remote = request('http://192.168.1.20:3210/api/workspace');
  const cookie = auth.adminCookie(remote).split(';', 1)[0];
  const crossSite = new Request(remote.url, { headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(auth.isTrustedAppRequest(crossSite), false, '带着有效 cookie 的跨站请求也要拦住');
});
