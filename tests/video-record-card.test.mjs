import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [card, studio, page] = await Promise.all([
  readFile(new URL('../components/VideoRecordCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
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
  assert.doesNotMatch(studio, /复制视频地址/);
  assert.doesNotMatch(studio, /复制地址/);
  assert.match(studio, /const thumbnailUrl = task\.videoUrls\?\.\[0\] \|\| task\.remoteVideoUrls\?\.\[0\] \|\| ''/);
  assert.match(studio, /className="video-task-thumbnail"[^>]*aria-hidden="true"><video src=\{thumbnailUrl\} muted playsInline preload="metadata"/);
  assert.match(studio, /taskPrefill\?: VideoTask \| null/);
  assert.match(studio, /onTaskPrefillConsumed\?: \(\) => void/);
  assert.match(studio, /restoreTask\(taskPrefill\)/);
  assert.match(studio, /setTasks\(\(current\) => current\.some\(\(item\) => item\.id === task\.id\)/);
  assert.match(page, /const \[videoTaskPrefill, setVideoTaskPrefill\] = useState\(null\)/);
  assert.match(page, /taskPrefill: videoTaskPrefill/);
  assert.match(page, /onRestore: \(\)=>restoreVideoTask\(task\)/);
});
