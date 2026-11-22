import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { nodeStatus } = createTsRequire(process.cwd())('./lib/canvas/node-card');

function node(data) {
  return { id: 'status-fixture', type: 'media', x: 0, y: 0, data: { kind: 'image', ...data } };
}

test('legacy nodes without status labels show readable lifecycle fallbacks', () => {
  for (const [status, expected] of [
    ['queued', '排队中'],
    ['running', '生成中'],
    ['failed', '生成失败'],
    ['draft', '等待生成'],
  ]) {
    assert.equal(nodeStatus(node({ status })), expected);
  }
});

test('explicit generation and draft status labels remain authoritative', () => {
  for (const status of ['queued', 'running', 'failed', 'draft']) {
    assert.equal(nodeStatus(node({ status, statusLabel: '服务商已接收，等待结果', role: '参考素材' })), '服务商已接收，等待结果');
  }
});

test('media with a stored URL and no role uses neutral copy without claiming file availability', () => {
  assert.equal(nodeStatus(node({ status: 'completed', url: '/missing-image.png' })), '素材');
  assert.equal(nodeStatus(node({ url: '/legacy-image.png' })), '素材');
  assert.equal(nodeStatus(node({ status: 'draft', url: '/existing-image.png' })), '素材');
});

test('ready media preserves its authored role and generic empty nodes remain readable', () => {
  assert.equal(nodeStatus(node({ status: 'completed', url: '/image.png', role: '图片生成结果' })), '图片生成结果');
  assert.equal(nodeStatus(node({ status: 'completed', url: '/image.png', role: '参考素材' })), '参考素材');
  assert.equal(nodeStatus(node({})), '素材');
});
