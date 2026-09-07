import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/theme.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;

const events = new EventTarget();
const values = new Map();
const documentElement = { dataset: {}, style: {} };
const themeMeta = { setAttribute: (name, value) => { themeMeta[name] = value; } };
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  },
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
};
globalThis.document = {
  documentElement,
  querySelector: () => themeMeta,
};

const theme = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test.after(() => {
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
});

test('theme changes update the document and notify same-page subscribers', () => {
  const changes = [];
  const unsubscribe = theme.subscribeToThemeChanges((value) => changes.push(value));

  theme.saveTheme('dark');

  assert.equal(theme.readStoredTheme(), 'dark');
  assert.equal(documentElement.dataset.theme, 'dark');
  assert.equal(documentElement.style.colorScheme, 'dark');
  assert.equal(themeMeta.content, '#0f1117');
  assert.deepEqual(changes, ['dark']);

  unsubscribe();
});

test('cross-document storage changes update subscribed pages', () => {
  const changes = [];
  const unsubscribe = theme.subscribeToThemeChanges((value) => changes.push(value));
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: 'sanmao-theme' },
    newValue: { value: 'light' },
  });

  events.dispatchEvent(event);

  assert.equal(documentElement.dataset.theme, 'light');
  assert.equal(themeMeta.content, '#f5f6f8');
  assert.deepEqual(changes, ['light']);
  unsubscribe();
});
