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
});

test('removes disconnected source clips but preserves internal captions', () => {
  let state = editor.createVideoEditorState([{ nodeId: 'video-1', kind: 'video' }]);
  state = editor.addVideoEditorCaption(state, '标题', 1, 2);
  const synced = editor.syncVideoEditorInputs(state, []);
  assert.equal(synced.clips.some((clip) => clip.sourceNodeId === 'video-1'), false);
  assert.equal(synced.clips.some((clip) => clip.type === 'caption'), true);
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

test('canvas recognizes the editor as a node but not as a rendered media source', () => {
  assert.match(modelSource, /value === "video-editor"/);
  assert.match(modelSource, /type: "video-editor"/);
  assert.match(componentSource, /<VideoEditorWorkbench/);
  assert.match(componentSource, /当前只保存编辑计划，暂不输出视频素材/);
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
