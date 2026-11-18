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
