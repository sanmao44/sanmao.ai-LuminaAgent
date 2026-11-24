import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd(), {
  './CangyuanMediaUploadField.css': {},
});
const CangyuanMediaUploadField = load('./components/cangyuan/CangyuanMediaUploadField').default;

function render(maxFileBytes) {
  return renderToStaticMarkup(createElement(CangyuanMediaUploadField, {
    fieldId: 'video-reference-image',
    kind: 'image',
    label: '参考图片',
    value: '',
    onChange: () => undefined,
    maxFileBytes,
  }));
}

test('Cangyuan upload field shows a tighter model file limit when provided', () => {
  const markup = render(25 * 1024 * 1024);

  assert.match(markup, /最大 25 MiB/);
  assert.doesNotMatch(markup, /最大 30 MiB/);
});

test('Cangyuan upload field keeps the site limit when the model has no file cap', () => {
  const markup = render(undefined);

  assert.match(markup, /最大 30 MiB/);
});

test('canvas selection renders alongside upload and clear actions in the shared control row', () => {
  const markup = renderToStaticMarkup(createElement(CangyuanMediaUploadField, {
    fieldId: 'three-d-front', kind: 'image', label: '正面',
    value: 'https://cdn.example.test/front.png', onChange: () => undefined,
    extraAction: createElement('button', { type: 'button' }, '画布点选'),
  }));
  assert.match(markup, /class="cangyuan-media-upload-controls"[\s\S]*替换文件[\s\S]*清除[\s\S]*画布点选<\/button><\/div>/);
  assert.match(markup, /正面公网 URL/);
});
