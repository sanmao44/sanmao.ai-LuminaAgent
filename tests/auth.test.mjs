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
