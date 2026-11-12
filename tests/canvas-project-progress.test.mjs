import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const { canvasProjectDraftPrompt, deriveCanvasProjectProgress, seedCanvasProjectIntent } = load('./lib/canvas/project-progress');

function node(id, type, data = {}) {
  return {
    id,
    type,
    data,
    position: { x: 0, y: 0 },
  };
}

function input({ nodes = [], taskLogs = [], brief = null, versionCount = 0 } = {}) {
  return {
    document: { version: 'sanmao-canvas-3', nodes, edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } },
    taskLogs,
    brief,
    versionCount,
    projectId: 'project-current',
    canvasId: 'canvas-current',
  };
}

const configuredBrief = { style: '写实电影感', audience: '', constraints: '' };
const script = node('script', 'prompt', { text: '项目脚本' });

test('project intent seeds only a new empty prompt node', () => {
  const emptyPrompt = node('empty', 'prompt', { text: '' });
  const image = node('image', 'generator', { kind: 'image' });
  const document = input({ nodes: [emptyPrompt, script, image] }).document;
  const seeded = seedCanvasProjectIntent(document, 'empty', '  制作春季新品海报  ');
  assert.equal(seeded.nodes[0].data.text, '制作春季新品海报');
  assert.equal(seeded.nodes[1], script);
  assert.equal(seeded.nodes[2], image);
  assert.equal(seedCanvasProjectIntent(document, 'image', '忽略'), document);
  assert.equal(seedCanvasProjectIntent(document, 'missing', '忽略'), document);
  assert.equal(seedCanvasProjectIntent(document, 'empty', '  '), document);
});

test('empty project recommends saving project-level creative settings', () => {
  const progress = deriveCanvasProjectProgress(input());
  assert.equal(progress.nextAction.kind, 'edit-brief');
  assert.equal(progress.counts.nodes, 0);
  assert.equal(progress.stages.find((stage) => stage.id === 'brief').status, 'next');
});

test('configured video project recommends an editable AI script and storyboard draft', () => {
  const brief = { intent: '为户外品牌制作春季短片', style: '自然光、克制写实', audience: '年轻家庭', constraints: '产品外观保持一致', deliverable: 'video' };
  const progress = deriveCanvasProjectProgress(input({ brief }));
  assert.equal(progress.nextAction.kind, 'draft-content');
  assert.equal(progress.nextAction.label, '让 AI 起草脚本与分镜');
  const prompt = canvasProjectDraftPrompt(brief);
  assert.match(prompt, /6-8 个分镜/);
  assert.match(prompt, /不调用图像、视频或音频生成/);
  assert.match(prompt, /新的可编辑文本节点/);
});

test('project draft prompt adapts to copy and freeform deliverables', () => {
  assert.match(canvasProjectDraftPrompt({ deliverable: 'copy' }), /3 个标题备选/);
  assert.match(canvasProjectDraftPrompt({ deliverable: 'freeform' }), /最适合这个目标的内容形式/);
});

test('script draft becomes the source for the first image-generation step', () => {
  const progress = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    nodes: [node('script-old', 'prompt', { text: '旧草案', generation: { createdAt: 10 } }),
      node('script-new', 'prompt', { text: '新草案', generation: { createdAt: 20 } })],
  }));
  assert.deepEqual(progress.nextAction, {
    kind: 'create-node',
    nodeKind: 'workflowImage',
    sourceNodeIds: ['script-new'],
    label: '生成第一份视觉素材',
    detail: '已选中最近的脚本草案作为输入，创建图像节点后即可生成。',
  });
  assert.equal(progress.stages.find((stage) => stage.id === 'content').nodeId, 'script-new');
});

test('most recent completed image is selected as the next video source', () => {
  const progress = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    nodes: [
      node('script', 'prompt', { text: '脚本' }),
      node('image-old', 'media', { kind: 'image', url: '/old.png', status: 'completed', generation: { createdAt: 10 } }),
      node('image-new', 'media', { kind: 'image', url: '/new.png', status: 'completed', generation: { createdAt: 20 } }),
    ],
  }));
  assert.equal(progress.nextAction.kind, 'create-node');
  assert.equal(progress.nextAction.nodeKind, 'workflowVideo');
  assert.deepEqual(progress.nextAction.sourceNodeIds, ['image-new']);
  assert.equal(progress.counts.images, 2);
});

test('video projects recommend narration, then editing once audio exists', () => {
  const video = node('video', 'media', { kind: 'video', url: '/cut.mp4', status: 'completed' });
  const withoutAudio = deriveCanvasProjectProgress(input({ brief: configuredBrief, nodes: [script, video] }));
  assert.equal(withoutAudio.nextAction.nodeKind, 'audio');
  assert.equal(withoutAudio.nextAction.speechDraftText, '项目脚本');
  assert.deepEqual(withoutAudio.nextAction.sourceNodeIds, ['script']);
  assert.match(withoutAudio.nextAction.detail, /连接最近的内容草案/);

  const withAudio = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    nodes: [script, video, node('audio', 'media', { kind: 'audio', url: '/voice.mp3', status: 'completed' })],
  }));
  assert.equal(withAudio.nextAction.nodeKind, 'videoEditor');
  assert.deepEqual(withAudio.nextAction.sourceNodeIds, ['video', 'audio']);
  assert.equal(withAudio.stages.find((stage) => stage.id === 'audio').status, 'done');
});

test('audio recommendations stay blank when the project has no reusable script text', () => {
  const brief = { ...configuredBrief, deliverable: 'audio' };
  const progress = deriveCanvasProjectProgress(input({
    brief,
    nodes: [node('instruction-only', 'prompt', { agentPrompt: '请为项目起草旁白' })],
  }));

  assert.equal(progress.nextAction.kind, 'create-node');
  assert.equal(progress.nextAction.nodeKind, 'audio');
  assert.equal('speechDraftText' in progress.nextAction, false);
  assert.equal('sourceNodeIds' in progress.nextAction, false);
  assert.match(progress.nextAction.detail, /手动调用/);
});

test('saved edited output remains reviewable and unbuilt projects keep their next step', () => {
  const edited = node('editor', 'video-editor', { videoEditor: { clips: [{ enabled: true }] } });
  const withoutVersion = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    nodes: [script, edited],
  }));
  assert.equal(withoutVersion.nextAction.kind, 'save-version');

  const withVersion = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    versionCount: 1,
    nodes: [script, edited],
  }));
  assert.deepEqual(withVersion.nextAction, {
    kind: 'open-node',
    nodeId: 'editor',
    label: '检查最近的创作结果',
    detail: '预览结果后可继续调整，或导出项目包交接与备份。',
  });
  assert.equal(withVersion.stages.find((stage) => stage.id === 'visual').nodeId, 'editor');
  assert.match(withVersion.stages.find((stage) => stage.id === 'visual').detail, /1 条剪辑时间线/);

  const noOutput = deriveCanvasProjectProgress(input({ brief: configuredBrief, versionCount: 1, nodes: [script] }));
  assert.equal(noOutput.nextAction.kind, 'create-node');
  assert.equal(noOutput.nextAction.nodeKind, 'workflowImage');
});

test('active tasks take priority and old failures stop blocking after a newer success', () => {
  const failed = { id: 'failed', createdAt: '2026-11-06T10:00:00.000Z', status: 'error', mode: 'video', projectId: 'project-current', error: 'timeout' };
  const pending = { id: 'pending', createdAt: '2026-11-07T10:00:00.000Z', status: 'pending', mode: 'image', projectId: 'project-current' };
  const running = deriveCanvasProjectProgress(input({ brief: configuredBrief, taskLogs: [failed, pending] }));
  assert.equal(running.nextAction.kind, 'review-task');
  assert.equal(running.nextAction.taskId, 'pending');
  assert.equal(running.nextAction.taskStatus, 'pending');

  const latestFailure = deriveCanvasProjectProgress(input({ brief: configuredBrief, taskLogs: [failed] }));
  assert.equal(latestFailure.nextAction.taskStatus, 'error');

  const recovered = deriveCanvasProjectProgress(input({
    taskLogs: [failed, { id: 'success', createdAt: '2026-11-07T10:00:00.000Z', status: 'success', mode: 'image', projectId: 'project-current' }],
  }));
  assert.equal(recovered.nextAction.kind, 'edit-brief');
});

test('task scope excludes other projects and LLM errors do not hijack recommendations', () => {
  const progress = deriveCanvasProjectProgress(input({
    taskLogs: [
      { id: 'other-project', createdAt: '2026-11-07T11:00:00.000Z', status: 'error', mode: 'image', projectId: 'other-project', nodeId: 'other-node' },
      { id: 'llm', createdAt: '2026-11-07T12:00:00.000Z', status: 'error', mode: 'llm', taskKind: 'llm', projectId: 'project-current', error: 'conversation failed' },
    ],
  }));
  assert.equal(progress.counts.tasks, 1);
  assert.equal(progress.counts.failed, 1);
  assert.equal(progress.nextAction.kind, 'edit-brief');
});

test('unfinished creation steps reuse existing nodes instead of recommending duplicates', () => {
  const image = node('image-ready', 'media', { kind: 'image', url: '/image.png', status: 'completed' });
  const video = node('video-ready', 'media', { kind: 'video', url: '/video.mp4', status: 'completed' });
  const audio = node('audio-ready', 'media', { kind: 'audio', url: '/audio.mp3', status: 'completed' });
  const cases = [
    { nodes: [node('draft', 'prompt')], expectedId: 'draft' },
    { nodes: [script, node('image-draft', 'generator', { kind: 'image' })], expectedId: 'image-draft' },
    { nodes: [script, image, node('video-draft', 'generator', { kind: 'video' })], expectedId: 'video-draft' },
    { nodes: [script, video, node('audio-draft', 'media', { kind: 'audio', url: '' })], expectedId: 'audio-draft' },
    { nodes: [script, video, audio, node('editor-draft', 'video-editor', { videoEditor: { clips: [] } })], expectedId: 'editor-draft' },
  ];
  for (const { nodes, expectedId } of cases) {
    const progress = deriveCanvasProjectProgress(input({ brief: configuredBrief, nodes }));
    assert.equal(progress.nextAction.kind, 'open-node', expectedId);
    assert.equal(progress.nextAction.nodeId, expectedId);
  }
});

test('a draft for a different medium does not displace the required next step', () => {
  const progress = deriveCanvasProjectProgress(input({
    brief: configuredBrief,
    nodes: [script, node('video-draft', 'generator', { kind: 'video' })],
  }));
  assert.equal(progress.nextAction.kind, 'create-node');
  assert.equal(progress.nextAction.nodeKind, 'workflowImage');
});

test('image deliverable stops at visual output and does not force video or audio', () => {
  const progress = deriveCanvasProjectProgress(input({
    brief: { ...configuredBrief, deliverable: 'image' },
    versionCount: 1,
    nodes: [script, node('image', 'media', { kind: 'image', url: '/poster.png', status: 'completed' })],
  }));
  assert.equal(progress.deliverable, 'image');
  assert.deepEqual(progress.nextAction, {
    kind: 'open-node', nodeId: 'image', label: '检查最近的创作结果', detail: '预览结果后可继续调整，或导出项目包交接与备份。',
  });
  assert.equal(progress.stages.find((stage) => stage.id === 'visual').status, 'done');
  assert.equal(progress.stages.find((stage) => stage.id === 'audio').status, 'optional');
  assert.equal(progress.stages.find((stage) => stage.id === 'edit').status, 'optional');
});

test('audio deliverable recommends speech directly and then a checkpoint', () => {
  const brief = { ...configuredBrief, deliverable: 'audio' };
  const empty = deriveCanvasProjectProgress(input({ brief }));
  assert.equal(empty.nextAction.nodeKind, 'audio');
  assert.equal(empty.nextAction.label, '生成第一条音频');
  const finished = deriveCanvasProjectProgress(input({
    brief,
    nodes: [node('audio', 'media', { kind: 'audio', url: '/voice.mp3', status: 'completed' })],
  }));
  assert.equal(finished.nextAction.kind, 'save-version');
  assert.equal(finished.stages.find((stage) => stage.id === 'visual').status, 'optional');
});

test('copy deliverable keeps the recommendation on content and versioning', () => {
  const brief = { ...configuredBrief, deliverable: 'copy' };
  const empty = deriveCanvasProjectProgress(input({ brief }));
  assert.equal(empty.nextAction.kind, 'draft-content');
  assert.equal(empty.nextAction.label, '让 AI 起草第一版内容');
  const withScript = deriveCanvasProjectProgress(input({ brief, nodes: [script] }));
  assert.equal(withScript.nextAction.kind, 'save-version');
  assert.equal(withScript.stages.find((stage) => stage.id === 'visual').status, 'optional');
});

test('freeform deliverable avoids a fixed media chain after the first content draft', () => {
  const progress = deriveCanvasProjectProgress(input({
    brief: { ...configuredBrief, deliverable: 'freeform' },
    nodes: [script],
  }));
  assert.equal(progress.nextAction.kind, 'save-version');
  assert.equal(progress.stages.find((stage) => stage.id === 'visual').status, 'optional');
  assert.equal(progress.stages.find((stage) => stage.id === 'audio').status, 'optional');
});
