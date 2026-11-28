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
  assert.equal(value.version, packageApi.CANVAS_PROJECT_PACKAGE_VERSION);
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

test('portable project packages embed each current and historical image once and restore destination URLs', () => {
  const document = documentFixture();
  document.nodes[0].data.assetId = 'source-asset-id';
  const version = {
    id: 'version-1',
    label: '导入前版本',
    createdAt: 1,
    snapshot: { nodes: structuredClone(document.nodes), edges: [], groups: [], camera: document.camera },
  };
  const base = packageApi.canvasProjectPackageFromDocument({ name: '便携项目', document, versions: [version] });
  const urls = packageApi.canvasProjectPackageImageUrls(base);
  assert.deepEqual(urls, ['/api/storage/images?id=image-1']);

  const portable = packageApi.embedCanvasProjectPackageImages(base, [{
    id: 'image-1',
    name: '主视觉',
    sourceUrl: urls[0],
    dataUrl: 'data:image/png;base64,UE5H',
  }]);
  assert.equal(portable.version, 2);
  assert.equal(portable.embeddedImages.length, 1);
  assert.equal(portable.document.nodes[0].data.url, 'sanmao-project-image:image-1');
  assert.equal(portable.assets[0].url, 'sanmao-project-image:image-1');
  assert.equal(portable.assets[0].storageKey, undefined);
  assert.equal(portable.assets[0].sourceAssetId, undefined);
  assert.equal(portable.document.nodes[0].data.name, '主视觉');
  assert.equal(portable.document.nodes[0].data.generation.prompt, '雨后的街道');
  assert.equal(portable.project.versions[0].snapshot.nodes[0].data.url, 'sanmao-project-image:image-1');

  const parsed = packageApi.parseCanvasProjectPackage(JSON.parse(JSON.stringify(portable)));
  const restored = packageApi.restoreCanvasProjectPackageImages(parsed, new Map([
    ['image-1', { url: '/api/storage/file?name=destination.png', storageKey: 'images/destination.png' }],
  ]));
  assert.equal(restored.document.nodes[0].data.url, '/api/storage/file?name=destination.png');
  assert.equal(restored.document.nodes[0].data.storageKey, 'images/destination.png');
  assert.equal(restored.document.nodes[0].data.assetId, undefined);
  assert.equal(restored.document.nodes[0].data.sourceAssetId, undefined);
  assert.equal(restored.project.versions[0].snapshot.nodes[0].data.url, '/api/storage/file?name=destination.png');
  assert.equal(restored.assets[0].url, '/api/storage/file?name=destination.png');
  assert.equal(restored.assets[0].storageKey, 'images/destination.png');
  assert.equal(document.nodes[0].data.url, '/api/storage/images?id=image-1', 'export and import never mutate the source document');
});

test('project package captures nested SVG data URLs and rejects broken embedded image references', () => {
  const document = documentFixture();
  document.nodes[1].data.mask = { sourceImageDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' };
  const value = packageApi.canvasProjectPackageFromDocument({ name: 'SVG', document });
  assert.deepEqual(packageApi.canvasProjectPackageImageUrls(value), [
    '/api/storage/images?id=image-1',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ]);
  const portable = packageApi.embedCanvasProjectPackageImages(value, [
    { id: 'image-1', name: '主视觉', sourceUrl: '/api/storage/images?id=image-1', dataUrl: 'data:image/png;base64,UE5H' },
    { id: 'image-2', name: 'SVG蒙版', sourceUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
  ]);
  assert.ok(packageApi.parseCanvasProjectPackage(portable));
  assert.equal(packageApi.parseCanvasProjectPackage({
    ...portable,
    embeddedImages: [{ ...portable.embeddedImages[0], dataUrl: 'data:image/png;base64,!!!!' }, portable.embeddedImages[1]],
  }), null, 'invalid image bytes are not silently dropped');
  assert.equal(packageApi.parseCanvasProjectPackage({
    ...portable,
    embeddedImages: [portable.embeddedImages[0]],
  }), null, 'an image reference without embedded bytes invalidates the package');
});

test('portable project packages do not overflow on circular runtime metadata', () => {
  const document = documentFixture();
  const runtimeMetadata = { label: 'runtime-only' };
  runtimeMetadata.self = runtimeMetadata;
  document.nodes[0].data.runtimeMetadata = runtimeMetadata;
  const base = packageApi.canvasProjectPackageFromDocument({ name: '循环引用项目', document });

  const portable = packageApi.embedCanvasProjectPackageImages(base, [{
    id: 'image-1',
    name: '主视觉',
    sourceUrl: '/api/storage/images?id=image-1',
    dataUrl: 'data:image/png;base64,UE5H',
  }]);

  assert.equal(portable.document.nodes[0].data.runtimeMetadata.label, 'runtime-only');
  assert.equal(portable.document.nodes[0].data.runtimeMetadata.self, undefined);
  assert.doesNotThrow(() => JSON.stringify(portable));
  assert.equal(document.nodes[0].data.runtimeMetadata.self, runtimeMetadata, 'export does not mutate the source document');
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

test('project package export normalizes reference asset ids before serialization', () => {
  const value = packageApi.canvasProjectPackageFromDocument({
    name: 'Reference package',
    referenceAssetIds: ['  asset-a  ', '', 'asset-a', 'asset-b'],
    document: documentFixture(),
  });
  assert.deepEqual(value.project.referenceAssetIds, ['asset-a', 'asset-b']);
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
  assert.equal(packageApi.parseCanvasProjectPackage({ ...parsed, version: 1 }).version, 1, 'older project packages remain importable');
  assert.equal(packageApi.parseCanvasProjectPackage(documentFixture()), null);
  assert.equal(packageApi.parseCanvasProjectPackage({ schema: packageApi.CANVAS_PROJECT_PACKAGE_SCHEMA, version: 99 }), null);
});
