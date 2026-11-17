import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { cangyuanMediaBaseUrl, isCangyuanProvider } = createTsRequire(process.cwd())('./lib/cangyuan-provider');

test('recognizes Cangyuan preset and exact official API hosts', () => {
  assert.equal(isCangyuanProvider({ platform: 'cangyuan' }), true);
  assert.equal(isCangyuanProvider({ platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1' }), true);
  assert.equal(isCangyuanProvider({ platform: 'custom', videoBaseUrl: 'https://direct-api.cangyuansuanli.cn' }), true);
});

test('does not classify lookalike or unrelated provider hosts as Cangyuan', () => {
  assert.equal(isCangyuanProvider({ platform: 'custom', baseUrl: 'https://cangyuansuanli.cn.example.com/v1' }), false);
  assert.equal(isCangyuanProvider({ platform: 'custom', baseUrl: 'https://other.cangyuansuanli.cn/v1' }), false);
  assert.equal(isCangyuanProvider({ platform: 'custom', baseUrl: 'not-a-url' }), false);
});

test('Cangyuan media requests select the official Cangyuan base across separate video endpoints', () => {
  assert.equal(cangyuanMediaBaseUrl({
    platform: 'custom', baseUrl: 'https://compatible.example.test/v1', videoBaseUrl: 'https://direct-api.cangyuansuanli.cn/v1/',
  }), 'https://direct-api.cangyuansuanli.cn/v1');
  assert.equal(cangyuanMediaBaseUrl({
    platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1/', videoBaseUrl: 'https://video-proxy.example.test',
  }), 'https://ai.cangyuansuanli.cn/v1');
  assert.equal(cangyuanMediaBaseUrl({ platform: 'cangyuan', baseUrl: 'https://proxy.example.test/v1' }), 'https://proxy.example.test/v1');
});
