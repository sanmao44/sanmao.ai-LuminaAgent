import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [videoStudio, parameterEditor] = await Promise.all([
  readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/CreationParameterEditor.tsx', import.meta.url), 'utf8'),
]);

test('hides the video operation selector when generation is the only supported operation', () => {
  assert.match(videoStudio, /const showOperationField = operationOptions\.length > 1/);
  assert.match(videoStudio, /\{showOperationField && <label className="video-field"><span>操作类型<\/span>/);
  assert.match(parameterEditor, /const showOperationField = operationOptions\.length > 1/);
  assert.match(parameterEditor, /\{showOperationField && \(\s*<label className="creation-field">/s);
});

test('keeps edit and extend operation options capability-driven', () => {
  assert.match(videoStudio, /supportsEdit/);
  assert.match(videoStudio, /supportsExtend/);
  assert.match(parameterEditor, /supportsOperationEdit/);
  assert.match(parameterEditor, /supportsOperationExtend/);
});

test('resets unsupported restored operations in the parameter editor', () => {
  assert.match(parameterEditor, /operationIsSupported/);
  assert.match(parameterEditor, /operation: "generate"/);
});
