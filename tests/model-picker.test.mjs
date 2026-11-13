import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../components/ModelPicker.tsx', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .+;\r?\n/gm, ''), {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('model picker accepts an empty automatic recommendation', () => {
  const model = { id: 'chat-1' };
  assert.deepEqual(picker.uniqueModels([undefined, null, model, model]), [model]);
  assert.deepEqual(picker.uniqueModels([undefined]), []);
});

test('model picker keeps the full trigger label by default', () => {
  assert.equal(picker.resolveModelPickerTriggerValueLabel({
    mode: 'full',
    fullLabel: 'OpenAI / GPT-5',
    modelLabel: 'GPT-5',
    value: 'gpt-5',
  }), 'OpenAI / GPT-5');
});

test('model picker can show a compact model label', () => {
  assert.equal(picker.resolveModelPickerTriggerValueLabel({
    mode: 'model',
    fullLabel: 'OpenAI / GPT-5',
    modelLabel: 'GPT-5',
    value: 'gpt-5',
  }), 'GPT-5');
});

test('model picker uses the automatic recommendation and falls back when none exists', () => {
  assert.equal(picker.resolveModelPickerTriggerValueLabel({
    mode: 'model',
    fullLabel: 'Default provider',
    value: 'auto',
    automaticModelLabel: 'GPT-5',
  }), 'GPT-5');
  assert.equal(picker.resolveModelPickerTriggerValueLabel({
    mode: 'model',
    fullLabel: 'Automatic selection',
    value: 'auto',
  }), 'Automatic selection');
});

test('model picker preserves an unavailable model label in compact mode', () => {
  assert.equal(picker.resolveModelPickerTriggerValueLabel({
    mode: 'model',
    fullLabel: 'Selected model is unavailable',
    unavailableLabel: 'Model unavailable / GPT-5',
    value: 'gpt-5',
  }), 'Model unavailable / GPT-5');
});
