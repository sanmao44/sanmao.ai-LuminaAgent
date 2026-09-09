import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const editor = await loadTypeScript('../lib/canvas/video-editor.ts');
const modelSource = await readFile(new URL('../lib/canvas/model.ts', import.meta.url), 'utf8');
const componentSource = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');
const nodeSource = await readFile(new URL('../components/VideoEditorNode.tsx', import.meta.url), 'utf8');
const workbenchSource = await readFile(new URL('../components/VideoEditorWorkbench.tsx', import.meta.url), 'utf8');
const canvasCssSource = await readFile(new URL('../app/canvas.css', import.meta.url), 'utf8');

test('creates default video editor clips and keeps manual edits during input sync', () => {
  const initial = editor.createVideoEditorState([
    { nodeId: 'image-1', kind: 'image', name: '封面' },
    { nodeId: 'audio-1', kind: 'audio', name: '配乐' },
  ]);
  assert.equal(initial.clips.find((clip) => clip.sourceNodeId === 'image-1').duration, 3);
  assert.equal(initial.clips.find((clip) => clip.sourceNodeId === 'audio-1').duration, 20);

  const edited = editor.updateVideoEditorClip(initial, 'clip-image-1', { start: 4, duration: 7 });
  const synced = editor.syncVideoEditorInputs(edited, [
    { nodeId: 'image-1', kind: 'image', name: '封面' },
    { nodeId: 'audio-1', kind: 'audio', name: '配乐' },
    { nodeId: 'video-1', kind: 'video', name: '主视频', durationSeconds: 5.2 },
  ]);
  assert.deepEqual(
    synced.clips.find((clip) => clip.sourceNodeId === 'image-1'),
    edited.clips.find((clip) => clip.sourceNodeId === 'image-1'),
  );
  assert.equal(synced.clips.find((clip) => clip.sourceNodeId === 'video-1').duration, 5.2);
  assert.equal(synced.clips.find((clip) => clip.sourceNodeId === 'video-1').playbackRate, 1);
  assert.equal(synced.clips.find((clip) => clip.sourceNodeId === 'video-1').fit, 'contain');
});

test('removes disconnected source clips but preserves internal captions', () => {
  let state = editor.createVideoEditorState([{ nodeId: 'video-1', kind: 'video' }]);
  state = editor.addVideoEditorCaption(state, '标题', 1, 2);
  const synced = editor.syncVideoEditorInputs(state, []);
  assert.equal(synced.clips.some((clip) => clip.sourceNodeId === 'video-1'), false);
  assert.equal(synced.clips.some((clip) => clip.type === 'caption'), true);
});

test('places added captions after an occupied caption range', () => {
  let state = editor.createVideoEditorState([{ nodeId: 'video-1', kind: 'video' }]);
  state = editor.addVideoEditorCaption(state, '第一条', 0, 3);
  state = editor.addVideoEditorCaption(state, '第二条', 0, 3);
  const captions = state.clips.filter((clip) => clip.track === 'caption');
  assert.equal(captions.length, 2);
  assert.equal(captions[1].start, 3);
  assert.equal(editor.clipsAtTime(state, 1).filter((clip) => clip.track === 'caption').length, 1);
  assert.equal(editor.clipsAtTime(state, 3).filter((clip) => clip.track === 'caption').length, 1);
});

test('guards split and trim boundaries and supports track reorder', () => {
  const state = editor.createVideoEditorState([
    { nodeId: 'a', kind: 'video', durationSeconds: 8 },
    { nodeId: 'b', kind: 'image' },
  ]);
  assert.equal(editor.splitVideoEditorClip(state, 'clip-a', 0), state);
  const split = editor.splitVideoEditorClip(state, 'clip-a', 3);
  assert.equal(split.clips.filter((clip) => clip.sourceNodeId === 'a').length, 2);
  const trimmed = editor.trimVideoEditorClip(state, 'clip-a', 2, 5);
  assert.equal(trimmed.clips.find((clip) => clip.id === 'clip-a').start, 2);
  assert.equal(trimmed.clips.find((clip) => clip.id === 'clip-a').duration, 3);
  const reordered = editor.reorderVideoEditorClips(state, 'video', ['clip-b', 'clip-a']);
  assert.equal(reordered.clips.find((clip) => clip.id === 'clip-b').start, 0);
});

test('speed changes preserve the source range while timeline trim and split stay in sync', () => {
  const state = editor.createVideoEditorState([{ nodeId: 'video-1', kind: 'video', durationSeconds: 8 }]);
  const doubled = editor.updateVideoEditorClip(state, 'clip-video-1', { playbackRate: 2 });
  const doubledClip = doubled.clips.find((clip) => clip.id === 'clip-video-1');
  assert.equal(doubledClip.duration, 4);

  const split = editor.splitVideoEditorClip(doubled, doubledClip.id, 1.5);
  const second = split.clips.find((clip) => clip.id.endsWith('-split-1500'));
  assert.equal(second.sourceOffset, 3);
  assert.equal(second.duration, 2.5);

  const trimmed = editor.trimVideoEditorClip(doubled, doubledClip.id, 1, 3);
  const trimmedClip = trimmed.clips.find((clip) => clip.id === doubledClip.id);
  assert.equal(trimmedClip.sourceOffset, 2);
  assert.equal(trimmedClip.duration, 2);
});

test('moves clips to timeline zero and normalizes project output settings and transforms', () => {
  let state = editor.createVideoEditorState([{ nodeId: 'video-1', kind: 'video', durationSeconds: 8 }]);
  state = editor.updateVideoEditorClip(state, 'clip-video-1', { start: 4, scale: 2.25, x: 0.4, y: -0.2, opacity: 0.75 });
  state = editor.moveVideoEditorClip(state, 'clip-video-1', 0);
  const clip = state.clips.find((item) => item.id === 'clip-video-1');
  assert.equal(clip.start, 0);
  assert.equal(clip.scale, 2.25);
  assert.equal(clip.x, 0.4);
  assert.equal(clip.y, -0.2);
  assert.equal(clip.opacity, 0.75);
  const normalized = editor.normalizeVideoEditorState({ ...state, aspect: '9:16', resolution: '4K' });
  assert.equal(normalized.aspect, '9:16');
  assert.equal(normalized.resolution, '4K');
});

test('canvas recognizes the editor as a node but not as a rendered media source', () => {
  assert.match(modelSource, /value === "video-editor"/);
  assert.match(modelSource, /type: "video-editor"/);
  assert.match(componentSource, /<VideoEditorWorkbench/);
  assert.match(componentSource, /当前只保存编辑计划，暂不输出视频素材/);
  assert.match(componentSource, /if \(node\.type === "video-editor"\) onOpenVideoEditor\(\)/);
  assert.match(nodeSource, /多轨剪辑、裁剪、分割和字幕/);
});

test('workbench keeps edits as a draft and creates a separate video clip node', () => {
  assert.match(workbenchSource, /onCreate: \(state: CanvasVideoEditorState, selectedClipId: string \| null\) => void/);
  assert.doesNotMatch(workbenchSource, /onChange:\s*\(state: CanvasVideoEditorState/);
  assert.match(workbenchSource, /trimVideoEditorClip/);
  assert.match(workbenchSource, /canvas-video-editor-trim start/);
  assert.match(workbenchSource, /创建剪辑/);
  assert.match(workbenchSource, /<audio ref=\{audioRef\}/);
  assert.match(workbenchSource, /setFuture/);
  assert.match(workbenchSource, /Ctrl\+Z/);
  assert.match(componentSource, /const createVideoEditorClip = useCallback/);
  assert.match(componentSource, /videoClip: clip/);
  assert.match(componentSource, /onCreate=\{\(draft, selectedClipId\) => createVideoEditorClip/);
  assert.match(componentSource, /setVideoEditorNodeId\(null\)/);
});

test('fit mode keeps the project viewport ratio and contains the source media', () => {
  assert.match(workbenchSource, /const projectAspect = aspectRatioFromText\(draft\.aspect\) \|\| 16 \/ 9/);
  assert.match(workbenchSource, /const previewAspect = projectAspect/);
  assert.match(workbenchSource, /previewContainsSource/);
  assert.match(workbenchSource, /translate\(0px, 0px\) scale\(1\)/);
  assert.match(workbenchSource, /objectFit: activeVideo\?\.fit \|\| "contain"/);
  assert.match(workbenchSource, /\(currentTime - activeVideo\.start\) \* playbackRate/);
  assert.match(workbenchSource, /\(event\.currentTarget\.currentTime - activeVideo\.sourceOffset\) \/ playbackRate/);
  assert.match(componentSource, /sourceClip\.duration \* \(sourceClip\.playbackRate \?\? 1\)/);
  assert.match(canvasCssSource, /canvas-workbench-head-actions>button:not\(\.canvas-video-editor-create\)/);
  assert.match(canvasCssSource, /canvas-video-editor-create\{width:auto!important;min-width:82px/);
  assert.match(canvasCssSource, /canvas-video-editor-preview\{[^}]*box-sizing:border-box/);
  assert.match(canvasCssSource, /canvas-video-editor-preview img,\.canvas-video-editor-preview video\{[^}]*min-width:0;min-height:0/);
  assert.match(workbenchSource, /项目比例/);
  assert.match(workbenchSource, /项目分辨率/);
  assert.match(workbenchSource, /素材缩放/);
  assert.match(workbenchSource, /素材 X 位置/);
  assert.match(workbenchSource, /beginMove/);
});

test('workbench follows direct-manipulation editing shortcuts and project tokens', () => {
  assert.match(workbenchSource, /timeFromClientX/);
  assert.match(workbenchSource, /beginScrub/);
  assert.match(workbenchSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(workbenchSource, /event\.key\.toLowerCase\(\) === "s"/);
  assert.match(workbenchSource, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(workbenchSource, /canvas-video-editor-timeline-actions/);
  assert.match(workbenchSource, /timelineLabelWidth/);
  assert.match(canvasCssSource, /canvas-video-editor-workbench\{--node-color:var\(--accent\)/);
  assert.match(canvasCssSource, /canvas-video-editor-timeline-actions/);
});

test('node context menu handles each exact node type once and closes the editor action', () => {
  const source = ts.createSourceFile(
    'SuperCanvas.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );
  let menu;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'contextMenuGroups') {
      menu = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(menu && ts.isCallExpression(menu), 'node context menu memo must exist');
  const [builder, dependencies] = menu.arguments;
  assert.ok(ts.isArrowFunction(builder) && ts.isBlock(builder.body));
  const branches = builder.body.statements.filter((statement) => {
    if (!ts.isIfStatement(statement)) return false;
    const condition = statement.expression;
    return ts.isBinaryExpression(condition)
      && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isPropertyAccessExpression(condition.left)
      && condition.left.expression.getText(source) === 'node'
      && condition.left.name.text === 'type'
      && ts.isStringLiteral(condition.right);
  });
  const types = branches.map((branch) => branch.expression.right.text);
  assert.equal(new Set(types).size, types.length, 'duplicate type branches can become unreachable');
  const editorBranches = branches.filter((branch) => branch.expression.right.text === 'video-editor');
  assert.equal(editorBranches.length, 1, 'video editor must have exactly one menu branch');
  const actions = editorBranches[0].thenStatement.getText(source);
  assert.match(actions, /id: "open-video-editor"/);
  assert.match(actions, /onClick: close\(\(\) => openCanvasVideoEditor\(node\.id\)\)/);
  assert.ok(ts.isArrayLiteralExpression(dependencies));
  const names = dependencies.elements.map((element) => element.getText(source));
  assert.equal(names.filter((name) => name === 'openCanvasVideoEditor').length, 1);
  assert.ok(names.includes('deleteSelection'), 'menu must track the current selection handler');
});
