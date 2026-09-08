import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [card, studio, page, videoStudioCss] = await Promise.all([
  readFile(new URL('../components/VideoRecordCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/video-studio.css', import.meta.url), 'utf8'),
]);

test('connects completed and failed video cards to workbench parameter restore', () => {
  assert.match(card, /onRestore\?: \(\) => void \| Promise<void>/);
  assert.match(card, /const canRestore = task\.status === 'done' \|\| task\.status === 'failed'/);
  assert.match(card, /canRestore && onRestore && <button[^>]+className="creative-video-restore"/);
  assert.match(card, /恢复参数/);
  assert.match(card, /parametersOpen/);
  assert.match(card, /className="creative-video-view-parameters"/);
  assert.match(card, /查看参数/);
  assert.doesNotMatch(card, /复制视频地址/);
  assert.match(card, /className="creative-video-download"/);
  assert.doesNotMatch(studio, /复制视频地址/);
  assert.doesNotMatch(studio, /复制地址/);
  assert.match(studio, /const thumbnailUrl = task\.videoUrls\?\.\[0\] \|\| task\.remoteVideoUrls\?\.\[0\] \|\| ''/);
  assert.match(studio, /className="video-task-thumbnail"[^>]*aria-hidden="true"><video src=\{thumbnailUrl\} muted playsInline preload="metadata"/);
  assert.match(videoStudioCss, /\.video-task-card\{grid-template-columns:minmax\(0,1fr\) 94px;grid-auto-rows:max-content/);
  assert.match(videoStudioCss, /\.video-task-card>\.video-task-thumbnail\{position:relative;grid-column:2;grid-row:1;width:94px;height:66px/);
  assert.match(studio, /className="video-task-card-content"/);
  assert.match(studio, /type VideoTaskStatusFilter = 'all' \| 'done' \| 'failed'/);
  assert.match(studio, /筛选视频任务状态/);
  assert.match(studio, /taskStatusFilter === value/);
  assert.match(studio, /className="video-task-download"/);
  assert.match(studio, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(videoStudioCss, /\.video-task-card-content\{grid-column:1;min-width:0;display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(videoStudioCss, /\.video-task-thumbnail\{pointer-events:none\}/);
  assert.match(videoStudioCss, /\.video-task-status-filter/);
  assert.match(videoStudioCss, /\.video-task-status-filter\{[^}]*background:linear-gradient\(/);
  assert.match(videoStudioCss, /button\[data-status="done"\]\.active\{[^}]*var\(--success-soft\)/);
  assert.match(videoStudioCss, /\.video-task-card\.done\{background:linear-gradient\(135deg,var\(--success-soft\),var\(--panel\)\)\}/);
  assert.match(videoStudioCss, /html\[data-theme="light"\] \.video-task-card\.done\{background:var\(--success-soft\)\}/);
  assert.match(videoStudioCss, /\.video-task-list-heading\{position:relative;z-index:1;display:flex/);
  assert.match(studio, /<strong>\{task\.input\?\.prompt \|\| '未命名视频任务'\}<\/strong>/);
  assert.doesNotMatch(studio, /<strong title=\{task\.input\?\.prompt/);
  assert.match(videoStudioCss, /\.video-task-title-row strong\{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
  assert.match(videoStudioCss, /\.video-task-details\{display:flex;align-items:center;flex-wrap:nowrap/);
  assert.match(videoStudioCss, /\.video-task-actions\{gap:5px;margin-top:0;padding-top:4px;flex-wrap:nowrap;overflow-x:auto/);
  assert.match(studio, /: <small className="video-task-waiting">正在等待服务商完成…<\/small>\}/);
  assert.match(studio, /taskPrefill\?: VideoTask \| null/);
  assert.match(studio, /onTaskPrefillConsumed\?: \(\) => void/);
  assert.match(studio, /restoreTask\(taskPrefill\)/);
  assert.doesNotMatch(studio, /window\.confirm\(/);
  assert.match(studio, /restoreCandidate/);
  assert.match(videoStudioCss, /\.video-restore-confirm-dialog/);
  assert.match(studio, /setTasks\(\(current\) => current\.some\(\(item\) => item\.id === task\.id\)/);
  assert.match(page, /const \[videoTaskPrefill, setVideoTaskPrefill\] = useState\(null\)/);
  assert.match(page, /taskPrefill: videoTaskPrefill/);
  assert.match(page, /onRestore: \(\)=>restoreVideoTask\(task\)/);
});
