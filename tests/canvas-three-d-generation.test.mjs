import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const threeD = createTsRequire(process.cwd())('./lib/canvas/three-d-generation');

test('cancelled 3D task projection stays distinguishable from provider failures', () => {
  assert.deepEqual(threeD.canvasThreeDTaskNodeProjection({ status: 'cancelled' }), {
    status: 'failed',
    visualStatus: 'cancelled',
    statusLabel: '三维模型已取消',
    terminal: true,
    progress: undefined,
  });
  const failed = threeD.canvasThreeDTaskNodeProjection({ status: 'failed', error: '模型服务异常' });
  assert.equal(failed.statusLabel, '模型服务异常');
  assert.equal(failed.visualStatus, 'failed');
  const succeeded = threeD.canvasThreeDTaskNodeProjection({ status: 'succeeded' });
  assert.equal(succeeded.progress, 100);
  assert.equal(succeeded.visualStatus, 'completed');
});

test('3D preview output has an explicit same-origin GLB download action', () => {
  assert.deepEqual(threeD.canvasThreeDOutputDownload({
    taskId: '12345678-1234-1234-1234-123456789012',
    outputIndex: 0,
    output: { artifactType: 'glb', url: 'https://cdn.example.test/model.glb' },
  }), {
    href: '/api/media/model-preview/12345678-1234-1234-1234-123456789012/0',
    label: '下载 GLB',
    targetBlank: false,
  });
});

test('other 3D formats keep their direct download target and clear labels', () => {
  const fbx = threeD.canvasThreeDOutputDownload({
    taskId: '12345678-1234-1234-1234-123456789012',
    outputIndex: 1,
    output: { artifactType: 'fbx', url: 'https://cdn.example.test/model.fbx' },
  });
  assert.deepEqual(fbx, {
    href: 'https://cdn.example.test/model.fbx',
    label: '下载 FBX',
    targetBlank: true,
  });
});

test('GLB outputs with URL query strings or fragments remain previewable', () => {
  const queried = { url: 'https://cdn.example.test/model.glb?token=abc' };
  const fragmented = { url: 'https://cdn.example.test/model.glb#viewer' };
  const fbx = { url: 'https://cdn.example.test/model.fbx#download' };
  assert.equal(threeD.isCanvasThreeDPreviewOutput(queried), true);
  assert.equal(threeD.isCanvasThreeDPreviewOutput(fragmented), true);
  assert.equal(threeD.isCanvasThreeDModelOutput(fbx), true);
  assert.equal(threeD.isCanvasThreeDPreviewOutput(fbx), false);
});
