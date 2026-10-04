import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = String(process.env.SANMAO_SMOKE_BASE_URL || '').trim().replace(/\/$/, '');
const live = Boolean(baseUrl);

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test('product smoke matrix requires an explicit live base URL', { skip: live }, () => {
  assert.equal(live, false);
});

test('startup and relay status are reachable', { skip: !live }, async () => {
  const { response, body } = await getJson('/api/relay/status');
  assert.equal(response.status, 200);
  assert.equal(typeof body, 'object');
  assert.equal(typeof body?.mode, 'string');
});

test('workspace state is readable', { skip: !live }, async () => {
  const { response, body } = await getJson('/api/state');
  assert.equal(response.status, 200);
  assert.equal(typeof body, 'object');
});

test('provider and task smoke entries are represented by the public state', { skip: !live }, async () => {
  const { response, body } = await getJson('/api/state');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body?.providers) || Array.isArray(body?.models));
});
