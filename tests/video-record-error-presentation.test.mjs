import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const Card = createTsRequire(process.cwd())('./components/VideoRecordCard').default;
const task = {
  id: 'video-error-fixture', providerId: 'fixture', modelId: 'fixture',
  operation: 'generate', status: 'failed', createdAt: '2026-11-22T00:00:00Z',
  input: { prompt: '保留原提示词' }, error: 'provider rejected prompt',
};
const render = (value) => renderToStaticMarkup(createElement(Card, {
  task: value, onNotify() {}, onDelete() {}, onRestore() {}, onSaveLocally() {},
}));

test('failed history cards show actionable copy while preserving the restore action', () => {
  const markup = render(task);
  assert.match(markup, /视频生成失败，可恢复参数后重新提交/u);
  assert.match(markup, /恢复这条任务的生成参数/u);
  assert.doesNotMatch(markup, /provider rejected prompt/u);
});

test('history cards distinguish an archive warning from a tracking interruption', () => {
  const archived = render({ ...task, status: 'done', remoteVideoUrls: ['/fixture.mp4'], error: 'EPERM: C:\\Users\\fixture\\manifest.json' });
  assert.match(archived, /视频已生成，但本机保存失败，可再次保存/u);
  assert.match(archived, /再次保存本地视频/u);
  assert.doesNotMatch(archived, /EPERM|C:\\Users/u);
  const tracking = render({ ...task, status: 'pending', error: '503 network error' });
  assert.match(tracking, /任务状态暂时无法更新，正在继续查询/u);
  assert.doesNotMatch(tracking, /视频生成失败|恢复参数后重新提交/u);
});
