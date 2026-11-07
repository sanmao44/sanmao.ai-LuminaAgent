import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const projects = load('./lib/creative-projects');

function canvas(id, name = id, projectId) {
  return { id, name, ...(projectId ? { projectId } : {}), createdAt: 10, updatedAt: 20 };
}

function snapshot(seed) {
  return {
    nodes: [{ id: seed, type: 'prompt', data: { text: seed } }],
    edges: [],
    groups: [],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

test('existing canvases receive one stable creative project identity', () => {
  const first = projects.reconcileCreativeProjects([canvas('canvas-a', '饮料广告')], []);
  assert.equal(first.canvasProjects[0].projectId, 'creative_canvas-a');
  assert.deepEqual(first.creativeProjects[0].canvasIds, ['canvas-a']);

  const second = projects.reconcileCreativeProjects(first.canvasProjects, first.creativeProjects);
  assert.deepEqual(second.canvasProjects, first.canvasProjects);
  assert.deepEqual(second.creativeProjects, first.creativeProjects);
});

test('project briefs normalize legacy data, update fields, and clear when empty', () => {
  const legacy = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  assert.equal(legacy.creativeProjects[0].brief, undefined);

  const projectId = legacy.creativeProjects[0].id;
  const updated = projects.updateCreativeProjectBrief(legacy.creativeProjects, projectId, {
    intent: '为户外品牌制作春季主视觉',
    style: '  纪实风格  ',
    audience: '户外用户',
    constraints: '保持产品外观',
    deliverable: 'image',
  }, 50);
  assert.deepEqual(updated[0].brief, {
    intent: '为户外品牌制作春季主视觉',
    style: '纪实风格',
    audience: '户外用户',
    constraints: '保持产品外观',
    deliverable: 'image',
  });
  assert.equal(updated[0].updatedAt, 50);
  const versioned = projects.appendCreativeProjectVersion(updated, projectId, {
    id: 'target-version', canvasId: 'canvas-a', label: '图像版本', createdAt: 55,
    brief: updated[0].brief, snapshot: snapshot('target'),
  });
  assert.equal(versioned[0].versions[0].brief.deliverable, 'image');

  const cleared = projects.updateCreativeProjectBrief(updated, projectId, {
    style: '', audience: '', constraints: '',
  }, 60);
  assert.equal(cleared[0].brief, undefined);
  assert.equal(projects.updateCreativeProjectBrief(updated, 'missing', {}), null);
});

test('project deliverables normalize explicit targets while legacy and auto remain automatic', () => {
  const { normalizeCreativeProjectBrief } = load('./packages/contracts/creative');
  assert.equal(normalizeCreativeProjectBrief({ style: '', audience: '', constraints: '' }), null);
  assert.equal(normalizeCreativeProjectBrief({ deliverable: 'auto' }), null);
  assert.deepEqual(normalizeCreativeProjectBrief({ deliverable: 'video' }), {
    style: '', audience: '', constraints: '', deliverable: 'video',
  });
  assert.equal(normalizeCreativeProjectBrief({ deliverable: 'unknown' }), null);
  assert.deepEqual(normalizeCreativeProjectBrief({ intent: '  做一张海报  ' }), {
    intent: '做一张海报', style: '', audience: '', constraints: '',
  });
});

test('reconciliation preserves projects and versions when a canvas is renamed', () => {
  const original = projects.reconcileCreativeProjects([canvas('canvas-a', '初版')], []);
  const withVersion = projects.appendCreativeProjectVersion(original.creativeProjects, original.canvasProjects[0].projectId, {
    id: 'version-1',
    canvasId: 'canvas-a',
    label: 'V1',
    createdAt: 30,
    snapshot: snapshot('source'),
  });
  const next = projects.reconcileCreativeProjects([
    canvas('canvas-a', '改名后的项目', original.canvasProjects[0].projectId),
  ], withVersion);
  assert.equal(next.creativeProjects[0].name, '改名后的项目');
  assert.equal(next.creativeProjects[0].versions[0].label, 'V1');
  assert.equal(next.creativeProjects[0].versions[0].snapshot.nodes[0].id, 'source');
});

test('version records form a bounded parent chain and remain queryable', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  let current = base.creativeProjects;
  let previousId;
  for (let index = 1; index <= 55; index += 1) {
    const id = `version-${index}`;
    current = projects.appendCreativeProjectVersion(current, base.canvasProjects[0].projectId, {
      id,
      canvasId: 'canvas-a',
      label: `V${index}`,
      createdAt: 30 + index,
      ...(previousId ? { parentVersionId: previousId } : {}),
      snapshot: snapshot(`node-${index}`),
    });
    previousId = id;
  }
  const project = current[0];
  assert.equal(project.versions.length, projects.CREATIVE_PROJECT_MAX_VERSIONS);
  assert.equal(project.versions[0].label, 'V6');
  assert.equal(projects.creativeProjectVersion(current, project.id, 'version-55').label, 'V55');
  assert.equal(projects.creativeProjectVersion(current, project.id, 'version-55').parentVersionId, 'version-54');
});

test('version snapshot equality distinguishes a safe restore from unsaved canvas changes', () => {
  const first = snapshot('same');
  assert.equal(projects.creativeProjectSnapshotsEqual(first, snapshot('same')), true);
  assert.equal(projects.creativeProjectSnapshotsEqual(first, snapshot('changed')), false);
});

test('version snapshots retain and explicitly clear project creative rules', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  const withBrief = projects.updateCreativeProjectBrief(base.creativeProjects, projectId, {
    style: '电影感', audience: '旅行者', constraints: '保持角色一致',
  }, 20);
  const withVersion = projects.appendCreativeProjectVersion(withBrief, projectId, {
    id: 'version-brief', canvasId: 'canvas-a', label: 'V1', createdAt: 30,
    brief: withBrief[0].brief,
    snapshot: snapshot('brief'),
  });
  assert.deepEqual(withVersion[0].versions[0].brief, withBrief[0].brief);
  const cleared = projects.appendCreativeProjectVersion(withVersion, projectId, {
    id: 'version-cleared', canvasId: 'canvas-a', label: 'V2', createdAt: 40,
    brief: null,
    snapshot: snapshot('cleared'),
  });
  assert.equal(cleared[0].versions[1].brief, null);
  assert.equal(projects.normalizeCreativeProjects(cleared)[0].versions[1].brief, null);
});

test('imported project versions are deduplicated and remapped to the current canvas', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  const existing = projects.appendCreativeProjectVersion(base.creativeProjects, projectId, {
    id: 'existing', canvasId: 'canvas-a', label: '旧版本', createdAt: 1, snapshot: snapshot('existing'),
  });
  const result = projects.appendImportedCreativeProjectVersions(existing, projectId, 'canvas-current', [
    { id: 'v1', label: '导入 V1', createdAt: 10, snapshot: snapshot('v1') },
    { id: 'v2', label: '导入 V2', createdAt: 11, parentVersionId: 'v1', snapshot: snapshot('v2') },
  ], 20);
  assert.equal(result.importedCount, 2);
  const versions = result.projects[0].versions;
  assert.equal(versions.at(-2).id, 'imported-v1');
  assert.equal(versions.at(-1).id, 'imported-v2');
  assert.equal(versions.at(-1).canvasId, 'canvas-current');
  assert.equal(versions.at(-1).parentVersionId, 'imported-v1');
});

test('a selected version can be removed without changing the project canvas identity', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const withVersions = projects.appendCreativeProjectVersion(base.creativeProjects, base.canvasProjects[0].projectId, {
    id: 'version-1',
    canvasId: 'canvas-a',
    label: 'V1',
    createdAt: 30,
    snapshot: snapshot('first'),
  });
  const next = projects.appendCreativeProjectVersion(withVersions, base.canvasProjects[0].projectId, {
    id: 'version-2',
    canvasId: 'canvas-a',
    label: 'V2',
    createdAt: 40,
    parentVersionId: 'version-1',
    snapshot: snapshot('second'),
  });
  const removed = projects.removeCreativeProjectVersion(next, base.canvasProjects[0].projectId, 'version-1');
  assert.equal(removed[0].canvasIds[0], 'canvas-a');
  assert.deepEqual(removed[0].versions.map((version) => version.id), ['version-2']);
  assert.equal(projects.removeCreativeProjectVersion(removed, base.canvasProjects[0].projectId, 'missing'), null);
});
