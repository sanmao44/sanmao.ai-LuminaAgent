import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createRoute({ seen = false, writeError = null } = {}) {
  let writes = 0;
  const route = createTsRequire(process.cwd(), {
    '@/lib/onboarding': {
      hasSeenWelcome: async () => seen,
      markWelcomeSeen: async () => {
        writes += 1;
        if (writeError) throw writeError;
      },
    },
  })('./app/api/onboarding/route');
  return { route, get writes() { return writes; } };
}

function post(url = 'http://127.0.0.1:3210/api/onboarding', headers = {}) {
  return new Request(url, { method: 'POST', headers });
}

test('onboarding rejects cross-site browser metadata before writing the welcome marker', async () => {
  const fixture = createRoute();
  const response = await fixture.route.POST(post(undefined, { 'sec-fetch-site': 'cross-site' }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: '非法请求来源。' });
  assert.equal(fixture.writes, 0);
});

test('onboarding rejects an Origin that does not match the request host', async () => {
  const fixture = createRoute();
  const response = await fixture.route.POST(post(undefined, {
    origin: 'https://outside.example',
    'sec-fetch-site': 'same-site',
  }));

  assert.equal(response.status, 403);
  assert.equal(fixture.writes, 0);
});

test('onboarding accepts a same-origin local page and writes the welcome marker once', async () => {
  const fixture = createRoute();
  const response = await fixture.route.POST(post(undefined, {
    origin: 'http://127.0.0.1:3210',
    'sec-fetch-site': 'same-origin',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seen: true });
  assert.equal(fixture.writes, 1);
});

test('onboarding preserves same-origin LAN welcome access without requiring a login cookie', async () => {
  const fixture = createRoute();
  const response = await fixture.route.POST(post('http://0.0.0.0:3210/api/onboarding', {
    host: '192.168.1.20:3210',
    origin: 'http://192.168.1.20:3210',
    'sec-fetch-site': 'same-origin',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seen: true });
  assert.equal(fixture.writes, 1);
});

test('onboarding preserves CLI and custom desktop origins supported by the existing guard', async () => {
  for (const headers of [{}, { origin: 'null' }, { origin: 'tauri://localhost' }]) {
    const fixture = createRoute();
    const response = await fixture.route.POST(post(undefined, headers));

    assert.equal(response.status, 200);
    assert.equal(fixture.writes, 1);
  }
});

test('onboarding retains the existing failure response when marker persistence fails', async () => {
  const fixture = createRoute({ writeError: new Error('marker unavailable') });
  const response = await fixture.route.POST(post());

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'marker unavailable' });
  assert.equal(fixture.writes, 1);
});

test('onboarding reads the existing welcome state without writing it', async () => {
  const fixture = createRoute({ seen: true });
  const response = await fixture.route.GET();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seen: true });
  assert.equal(fixture.writes, 0);
});
