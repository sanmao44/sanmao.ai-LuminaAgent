import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const { projectWorkflowScaffold } = load('./lib/canvas/project-workflow');

test('project workflow scaffolds match the selected deliverable', () => {
  assert.deepEqual(
    projectWorkflowScaffold('copy').map((step) => step.kind),
    ['text'],
  );
  assert.deepEqual(
    projectWorkflowScaffold('image').map((step) => step.kind),
    ['text', 'workflowImage'],
  );
  assert.deepEqual(
    projectWorkflowScaffold('audio').map((step) => step.kind),
    ['text', 'audio'],
  );
  assert.deepEqual(
    projectWorkflowScaffold('video').map((step) => step.kind),
    ['text', 'workflowImage', 'workflowVideo', 'audio', 'videoEditor'],
  );
});

test('automatic workflow scaffolding stays usable without an existing image input', () => {
  const steps = projectWorkflowScaffold('auto');
  assert.equal(steps.some((step) => step.kind === 'upscale'), false);
  assert.deepEqual(steps.map((step) => step.label), [
    '内容草案',
    '图片生成',
    '视频生成',
    '配音生成',
    '剪辑预览',
  ]);
});
