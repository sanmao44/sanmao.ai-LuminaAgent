import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [videoStudio, parameterEditor] = await Promise.all([
  readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/CreationParameterEditor.tsx', import.meta.url), 'utf8'),
]);

test('video studio uses the shared model library picker', () => {
  assert.match(videoStudio, /import ModelPicker from '@\/components\/ModelPicker'/);
  assert.match(videoStudio, /<ModelPicker\s+models=\{models\}[\s\S]*?capability="video-generate"/);
  assert.doesNotMatch(videoStudio, /const modelOptions = \[\{ value: 'auto'/);
});

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
  assert.match(parameterEditor, /const nextOperation = operationIsSupported \? settings\.operation : "generate"/);
  assert.match(parameterEditor, /const model = operationModel/);
  assert.match(parameterEditor, /const allowedDurations = useMemo/);
  assert.match(parameterEditor, /selectedResolution/);
});

test('treats coarse video-generate metadata as image-input capable', () => {
  assert.match(parameterEditor, /const supportsImageInput =/);
  assert.match(parameterEditor, /model\.capabilities\.includes\("video-generate"\)/);
  assert.match(parameterEditor, /const supportsReferenceImages =/);
  assert.match(parameterEditor, /\.\.\.\(supportsImageInput/);
  assert.match(parameterEditor, /\.\.\.\(supportsReferenceImages/);
  assert.match(parameterEditor, /const supportsAudio|supports\("video-audio"\)/);
});
