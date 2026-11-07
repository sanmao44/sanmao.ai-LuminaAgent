import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const require = createRequire(import.meta.url);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const videoLog = { id: 'local-task', mode: 'video', providerTaskId: 'upstream-task' };
const task = { id: 'local-task', input: { prompt: 'synthetic video' } };

function find(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = find(child, predicate); if (found) return found; }
  } else if (tree && typeof tree === 'object') {
    if (predicate(tree)) return tree;
    return find(tree.props?.children, predicate);
  }
  return null;
}

function harness(getTask = async () => task, overrides = {}) {
  const values = [];
  const cleanups = [];
  let index = 0;
  let mounted = false;
  const react = {
    ...require('react'),
    useState(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], (value) => { values[slot] = value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = { current: initial };
      return values[slot];
    },
    useEffect(effect) { if (!mounted) cleanups.push(effect()); },
  };
  const requests = [];
  const restored = [];
  let imagesRestored = 0;
  const Action = createTsRequire(process.cwd(), {
    react,
    '@/lib/video-task-client': { getVideoTask: (id, options) => { requests.push({ id, options }); return getTask(id, options); } },
  })('./components/GenerationLogRestoreAction.tsx').default;
  const props = {
    log: videoLog, videoTasks: [], canRestoreImage: false,
    onRestoreVideo: (value) => restored.push(value), onRestoreImage: () => { imagesRestored++; },
    ...overrides,
  };
  const render = () => { index = 0; const tree = Action(props); mounted = true; return tree; };
  const button = () => find(render(), (node) => node.type === 'button');
  const alert = () => find(render(), (node) => node.props?.role === 'alert');
  return { render, button, alert, requests, restored, imageCount: () => imagesRestored, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test('historical video logs restore by local task ID even when the current page is empty', async () => {
  const ui = harness();
  assert.equal(ui.button().props.children, '恢复到视频工作台');
  ui.button().props.onClick();
  await nextTurn();
  assert.deepEqual(ui.requests.map((request) => request.id), ['local-task']);
  assert.ok(ui.requests[0].options.signal instanceof AbortSignal);
  assert.deepEqual(ui.restored, [task]);
  assert.equal(ui.imageCount(), 0);
});

test('an already loaded task is restored without another request', async () => {
  const ui = harness(undefined, { videoTasks: [task] });
  ui.button().props.onClick();
  await nextTurn();
  assert.deepEqual(ui.restored, [task]);
  assert.equal(ui.requests.length, 0);
});

test('pending restoration disables the action and deduplicates rapid clicks', async () => {
  let finish;
  const ui = harness(() => new Promise((resolve) => { finish = resolve; }));
  const button = ui.button();
  button.props.onClick();
  button.props.onClick();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.button().props.disabled, true);
  assert.equal(ui.button().props['aria-busy'], true);
  assert.equal(ui.button().props.children, '正在读取视频参数…');
  finish(task);
  await nextTurn();
  assert.deepEqual(ui.restored, [task]);
  assert.equal(ui.button().props.disabled, false);
});

test('closing or replacing the keyed detail cancels its request and ignores late results', async () => {
  let finish;
  const oldDetail = harness(() => new Promise((resolve) => { finish = resolve; }));
  oldDetail.button().props.onClick();
  oldDetail.unmount();
  const newDetail = harness();
  newDetail.button().props.onClick();
  finish(task);
  await nextTurn();
  assert.equal(oldDetail.requests[0].options.signal.aborted, true);
  assert.equal(oldDetail.restored.length, 0);
  assert.equal(oldDetail.alert(), null);
  assert.deepEqual(newDetail.restored, [task]);
});

test('a missing original task retains the detail and shows a recovery action', async () => {
  const ui = harness(async () => null);
  ui.button().props.onClick();
  await nextTurn();
  assert.match(ui.alert().props.children, /原视频任务记录已不存在.*复制提示词/);
  assert.equal(ui.restored.length, 0);
  assert.equal(ui.button().props.disabled, false);
});

test('a failed read exposes the error and allows a later retry', async () => {
  let attempts = 0;
  const ui = harness(async () => { if (++attempts === 1) throw new Error('需要管理员登录。'); return task; });
  ui.button().props.onClick();
  await nextTurn();
  assert.equal(ui.alert().props.children, '需要管理员登录。');
  assert.equal(ui.restored.length, 0);
  ui.button().props.onClick();
  await nextTurn();
  assert.equal(ui.alert(), null);
  assert.deepEqual(ui.restored, [task]);
});

test('image restore still delegates to the existing composer while unsupported logs stay hidden', () => {
  const image = harness(undefined, { log: { id: 'image', mode: 'generate' }, canRestoreImage: true });
  assert.equal(image.button().props.children, '恢复基础参数');
  image.button().props.onClick();
  assert.equal(image.imageCount(), 1);
  assert.equal(image.requests.length, 0);
  assert.equal(harness(undefined, { log: { id: 'llm', mode: 'llm' } }).render(), null);
});
