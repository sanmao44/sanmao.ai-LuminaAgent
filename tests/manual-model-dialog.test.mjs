import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const ManualModelDialog = createTsRequire(new URL('../components', import.meta.url).pathname)('./ManualModelDialog').default;

const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

test('manual model dialog keeps the controlled registration contract', () => {
  const markup = renderToStaticMarkup(createElement(ManualModelDialog, {
    providerName: 'APIKL',
    form: { rawId: 'gpt-image-2-pro', displayName: '', kind: 'image' },
    busy: false,
    Icon,
    onChange: () => {},
    onClose: () => {},
    onSubmit: () => {},
  }));
  assert.match(markup, /class="dialog-backdrop manual-model-dialog-backdrop"/);
  assert.match(markup, /为 APIKL 添加模型/);
  assert.match(markup, /value="gpt-image-2-pro"/);
  assert.match(markup, /class="active"[^>]*>图片<\/button>/);
  assert.match(markup, /data-icon="agent"/);
  assert.match(markup, />登记模型<\/button>/);
  assert.doesNotMatch(markup, /onClick/);
});

test('manual model dialog exposes the busy submit state', () => {
  const markup = renderToStaticMarkup(createElement(ManualModelDialog, {
    providerName: 'Custom',
    form: { rawId: '', displayName: '', kind: 'auto' },
    busy: true,
    Icon,
    onChange: () => {},
    onClose: () => {},
    onSubmit: () => {},
  }));
  assert.match(markup, /disabled=""/);
  assert.match(markup, />登记中…<\/button>/);
});
