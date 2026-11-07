import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const packageApi = load('./lib/canvas/project-package');

function documentFixture() {
  return {
    version: 'sanmao-canvas-3',
    nodes: [
      {
        id: 'image-node',
        type: 'media',
        data: {
          kind: 'image',
          name: '主视觉',
          url: '/api/storage/images?id=image-1',
          storageKey: 'image-1',
          sourceAssetId: 'asset-1',
          generation: { prompt: '雨后的街道', params: { model: 'image-model' }, createdAt: 123 },
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'empty-node',
        type: 'prompt',
        data: { text: '仅供上下文' },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [],
    groups: [],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

test('project package carries brief and a bounded asset provenance index', () => {
  const value = packageApi.canvasProjectPackageFromDocument({
    name: '旅行短片',
    projectId: 'project-1',
    brief: { style: '写实', audience: '旅行者', constraints: '保持角色一致', deliverable: 'video' },
    document: documentFixture(),
    exportedAt: '2026-11-07T00:00:00.000Z',
  });
  assert.equal(value.schema, packageApi.CANVAS_PROJECT_PACKAGE_SCHEMA);
  assert.equal(value.version, 1);
  assert.deepEqual(value.project.brief, { style: '写实', audience: '旅行者', constraints: '保持角色一致', deliverable: 'video' });
  assert.deepEqual(value.assets, [{
    nodeId: 'image-node',
    name: '主视觉',
    kind: 'image',
    url: '/api/storage/images?id=image-1',
    storageKey: 'image-1',
    sourceAssetId: 'asset-1',
    prompt: '雨后的街道',
    modelName: 'image-model',
    createdAt: 123,
  }]);
});

test('project package preserves bounded version snapshots for portable rollback', () => {
  const document = documentFixture();
  const value = packageApi.canvasProjectPackageFromDocument({
    name: '版本项目',
    versions: Array.from({ length: 55 }, (_, index) => ({
      id: `v-${index}`,
      canvasId: 'canvas-old',
      label: `V${index + 1}`,
      createdAt: index + 1,
      brief: index === 54 ? { style: '统一风格' } : null,
      snapshot: { nodes: document.nodes, edges: document.edges, groups: document.groups, camera: document.camera },
    })),
    document,
  });
  assert.equal(value.project.versions.length, 50);
  assert.equal(value.project.versions[0].id, 'v-5');
  const parsed = packageApi.parseCanvasProjectPackage(JSON.parse(packageApi.serializeCanvasProjectPackage({
    name: '版本项目',
    versions: value.project.versions,
    document,
  })));
  assert.equal(parsed.project.versions.length, 50);
  assert.equal(parsed.project.versions.at(-1).brief.style, '统一风格');
  assert.equal(parsed.project.versions.at(-1).brief.deliverable, undefined);
});

test('project package round trips explicit project deliverable and target-only briefs', () => {
  const value = packageApi.parseCanvasProjectPackage(JSON.parse(packageApi.serializeCanvasProjectPackage({
    name: '图像项目',
    brief: { deliverable: 'image' },
    document: documentFixture(),
  })));
  assert.deepEqual(value.project.brief, { style: '', audience: '', constraints: '', deliverable: 'image' });
});

test('project package round trips through JSON and rejects legacy workflow payloads', () => {
  const serialized = packageApi.serializeCanvasProjectPackage({
    name: '项目',
    document: documentFixture(),
  });
  const parsed = packageApi.parseCanvasProjectPackage(JSON.parse(serialized));
  assert.equal(parsed.project.name, '项目');
  assert.equal(parsed.document.nodes[0].id, 'image-node');
  assert.equal(parsed.assets[0].storageKey, 'image-1');
  assert.equal(packageApi.parseCanvasProjectPackage(documentFixture()), null);
  assert.equal(packageApi.parseCanvasProjectPackage({ schema: packageApi.CANVAS_PROJECT_PACKAGE_SCHEMA, version: 99 }), null);
});
