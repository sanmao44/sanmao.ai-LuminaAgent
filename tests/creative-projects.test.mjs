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

test('project reference asset ids normalize, deduplicate, and are bounded', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  const { MAX_CREATIVE_PROJECT_REFERENCE_ASSETS } = load('./packages/contracts/creative');
  const input = ['  asset-1  ', 'asset-1', '', ...Array.from(
    { length: MAX_CREATIVE_PROJECT_REFERENCE_ASSETS + 2 },
    (_, index) => `asset-${index + 2}`,
  )];

  const updated = projects.updateCreativeProjectReferences(base.creativeProjects, projectId, input, 75);
  assert.equal(updated[0].updatedAt, 75);
  assert.equal(updated[0].referenceAssetIds.length, MAX_CREATIVE_PROJECT_REFERENCE_ASSETS);
  assert.equal(updated[0].referenceAssetIds[0], 'asset-1');
  assert.equal(new Set(updated[0].referenceAssetIds).size, updated[0].referenceAssetIds.length);

  const restored = projects.normalizeCreativeProjects(updated);
  assert.deepEqual(restored[0].referenceAssetIds, updated[0].referenceAssetIds);
  const cleared = projects.updateCreativeProjectReferences(updated, projectId, [], 80);
  assert.equal(cleared[0].referenceAssetIds, undefined);
});

test('project versions preserve the reference set at capture time', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  const withReferences = projects.updateCreativeProjectReferences(base.creativeProjects, projectId, ['asset-a', 'asset-b'], 20);
  const versioned = projects.appendCreativeProjectVersion(withReferences, projectId, {
    id: 'version-reference',
    canvasId: 'canvas-a',
    label: 'Reference set',
    createdAt: 30,
    referenceAssetIds: withReferences[0].referenceAssetIds,
    snapshot: snapshot('reference'),
  });

  assert.deepEqual(versioned[0].versions[0].referenceAssetIds, ['asset-a', 'asset-b']);
  const imported = projects.appendImportedCreativeProjectVersions(
    versioned,
    projectId,
    'canvas-current',
    [{ id: 'imported', label: 'Imported', createdAt: 40, referenceAssetIds: ['asset-c'], snapshot: snapshot('imported') }],
    50,
  );
  assert.deepEqual(imported.projects[0].versions.at(-1).referenceAssetIds, ['asset-c']);
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

test('automatic project checkpoints deduplicate tasks and stay within their own retention limit', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  let current = base.creativeProjects;
  for (let index = 1; index <= projects.CREATIVE_PROJECT_MAX_AUTOMATIC_VERSIONS + 2; index += 1) {
    current = projects.appendAutomaticCreativeProjectVersion(current, projectId, {
      canvasId: 'canvas-a', label: '自动检查点', createdAt: 100 + index, snapshot: snapshot(`auto-${index}`),
    }, [`task-${index}`]);
  }

  const versions = current[0].versions;
  assert.equal(versions.length, projects.CREATIVE_PROJECT_MAX_AUTOMATIC_VERSIONS);
  assert.equal(versions[0].id, 'auto_task-3');
  assert.equal(projects.appendAutomaticCreativeProjectVersion(current, projectId, {
    canvasId: 'canvas-a', label: '重复任务', createdAt: 999, snapshot: snapshot('duplicate'),
  }, ['task-10']), null);
  assert.equal(projects.appendAutomaticCreativeProjectVersion(current, projectId, {
    canvasId: 'canvas-a', label: '相同快照', createdAt: 1000, snapshot: snapshot('auto-10'),
  }, ['task-11']), null);
});

test('automatic checkpoints preserve manual versions and respect the shared version limit', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  let current = base.creativeProjects;
  for (let index = 1; index <= projects.CREATIVE_PROJECT_MAX_VERSIONS; index += 1) {
    current = projects.appendCreativeProjectVersion(current, projectId, {
      id: `version-${index}`, canvasId: 'canvas-a', label: `V${index}`, createdAt: index, snapshot: snapshot(`manual-${index}`),
    });
  }

  const unchanged = projects.appendAutomaticCreativeProjectVersion(current, projectId, {
    canvasId: 'canvas-a', label: '自动检查点', createdAt: 100, snapshot: snapshot('automatic'),
  }, ['task-1']);
  assert.equal(unchanged, null);
  assert.equal(current[0].versions.length, projects.CREATIVE_PROJECT_MAX_VERSIONS);
  assert.equal(current[0].versions[0].id, 'version-1');
});

test('quota pruning removes the oldest automatic checkpoint and preserves manual and latest versions', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  let current = projects.appendCreativeProjectVersion(base.creativeProjects, projectId, {
    id: 'manual-1', canvasId: 'canvas-a', label: '手动版本', createdAt: 10, snapshot: snapshot('manual'),
  });
  for (let index = 1; index <= 3; index += 1) {
    current = projects.appendAutomaticCreativeProjectVersion(current, projectId, {
      canvasId: 'canvas-a', label: `自动 ${index}`, createdAt: 20 + index, snapshot: snapshot(`auto-${index}`),
    }, [`task-${index}`]);
  }

  const result = projects.pruneOldestAutomaticCreativeProjectVersion(current);
  const versions = result.projects[0].versions;
  assert.equal(result.removed.versionId, 'auto_task-1');
  assert.equal(versions.some((version) => version.id === 'manual-1'), true);
  assert.equal(versions.some((version) => version.id === 'auto_task-1'), false);
  assert.equal(versions.some((version) => version.id === 'auto_task-3'), true);
  assert.equal(versions.find((version) => version.id === 'auto_task-2').parentVersionId, 'manual-1');
});

test('quota recovery retries with fewer automatic snapshots and keeps the newest checkpoint', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  let current = projects.appendCreativeProjectVersion(base.creativeProjects, projectId, {
    id: 'manual-1', canvasId: 'canvas-a', label: '手动版本', createdAt: 10, snapshot: snapshot('manual'),
  });
  for (let index = 1; index <= 3; index += 1) {
    current = projects.appendAutomaticCreativeProjectVersion(current, projectId, {
      canvasId: 'canvas-a', label: `自动 ${index}`, createdAt: 20 + index, snapshot: snapshot(`auto-${index}`),
    }, [`task-${index}`]);
  }
  const previousWindow = globalThis.window;
  const savedValues = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => savedValues.get(key) ?? null,
    setItem: (key, value) => {
      const normalized = projects.normalizeCreativeProjects(JSON.parse(value));
      const automaticCount = normalized[0]?.versions?.filter((version) => version.id.startsWith('auto_')).length || 0;
      if (key === projects.CREATIVE_PROJECTS_KEY && automaticCount > 2) {
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      }
      savedValues.set(key, String(value));
    },
  } };

  try {
    const result = projects.saveCreativeProjectsWithQuotaRecovery(current);
    assert.equal(result.saved, true);
    assert.equal(result.prunedAutomaticVersions, 1);
    const versions = result.projects[0].versions;
    assert.equal(versions.some((version) => version.id === 'manual-1'), true);
    assert.equal(versions.some((version) => version.id === 'auto_task-1'), false);
    assert.equal(versions.at(-1).id, 'auto_task-3');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('failed quota recovery restores the original version history after pruning attempts', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  let stored = projects.appendCreativeProjectVersion(base.creativeProjects, projectId, {
    id: 'manual-1', canvasId: 'canvas-a', label: '手动版本', createdAt: 10, snapshot: snapshot('manual'),
  });
  for (let index = 1; index <= 2; index += 1) {
    stored = projects.appendAutomaticCreativeProjectVersion(stored, projectId, {
      canvasId: 'canvas-a', label: `自动 ${index}`, createdAt: 20 + index, snapshot: snapshot(`auto-${index}`),
    }, [`task-${index}`]);
  }
  const originalRaw = JSON.stringify(stored);
  const current = projects.appendAutomaticCreativeProjectVersion(stored, projectId, {
    canvasId: 'canvas-a', label: '较大的新快照', createdAt: 30, snapshot: snapshot('cannot-fit'),
  }, ['task-3']);
  const previousWindow = globalThis.window;
  const savedValues = new Map([[projects.CREATIVE_PROJECTS_KEY, originalRaw]]);
  globalThis.window = { localStorage: {
    getItem: (key) => savedValues.get(key) ?? null,
    setItem: (key, value) => {
      if (key === projects.CREATIVE_PROJECTS_KEY && String(value).includes('cannot-fit')) {
        throw Object.assign(new Error('still full'), { name: 'QuotaExceededError' });
      }
      savedValues.set(key, String(value));
    },
    removeItem: (key) => savedValues.delete(key),
  } };

  try {
    const result = projects.saveCreativeProjectsWithQuotaRecovery(current);
    assert.equal(result.saved, false);
    assert.equal(result.prunedAutomaticVersions, 0);
    assert.equal(savedValues.get(projects.CREATIVE_PROJECTS_KEY), originalRaw);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('project package import keeps automatic checkpoints eligible for automatic retention', () => {
  const base = projects.reconcileCreativeProjects([canvas('canvas-a')], []);
  const projectId = base.canvasProjects[0].projectId;
  const automatic = projects.appendAutomaticCreativeProjectVersion(base.creativeProjects, projectId, {
    canvasId: 'canvas-a', label: '自动检查点', createdAt: 30, snapshot: snapshot('automatic'),
  }, ['task-1']);
  const imported = projects.appendImportedCreativeProjectVersions(
    automatic,
    projectId,
    'canvas-current',
    [{ id: automatic[0].versions[0].id, label: '自动检查点', createdAt: 40, snapshot: snapshot('automatic') }],
    50,
  );

  assert.match(imported.projects[0].versions.at(-1).id, /^auto_imported_/);
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
