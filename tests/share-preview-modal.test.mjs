import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const SharePreviewModal = createTsRequire(new URL('../components', import.meta.url).pathname)('./SharePreviewModal').default;
const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

test('share preview modal renders the generated image and local download actions', () => {
  const markup = renderToStaticMarkup(createElement(SharePreviewModal, {
    preview: { url: 'blob:test-preview', width: 1200, height: 900, filename: 'share.png' },
    Icon,
    onClose: () => {},
    onDownload: () => {},
  }));
  assert.match(markup, /class="share-preview-backdrop"/);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /src="blob:test-preview"/);
  assert.match(markup, /1200 × 900 PNG/);
  assert.match(markup, /data-icon="download"/);
  assert.match(markup, />下载 PNG<\/button>/);
});

test('share preview modal keeps the close and continue-edit actions explicit', () => {
  const markup = renderToStaticMarkup(createElement(SharePreviewModal, {
    preview: { url: 'blob:test-preview', width: 10, height: 20, filename: 'share.png' },
    Icon,
    onClose: () => {},
    onDownload: () => {},
  }));
  assert.match(markup, /aria-label="关闭分享预览"/);
  assert.match(markup, />继续编辑<\/button>/);
});
