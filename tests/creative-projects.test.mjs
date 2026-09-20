import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: projects } = await buildLibModules(['lib/creative-projects'], 'creative-projects');

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
