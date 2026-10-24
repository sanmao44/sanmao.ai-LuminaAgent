import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/video-download-platforms.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const platform = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('recognizes Douyin direct and short-share hosts for diagnostics', () => {
  assert.equal(platform.isDouyinVideoUrl('https://www.douyin.com/video/7126745726494821640'), true);
  assert.equal(platform.isDouyinVideoUrl('https://v.douyin.com/L4NpDJ6/'), true);
  assert.equal(platform.isDouyinVideoUrl('https://evil-douyin.com/video/1'), false);
});

test('recognizes WeChat Channels share pages but leaves direct media hosts alone', () => {
  assert.equal(platform.isWeixinChannelsShareUrl('https://channels.weixin.qq.com/web/pages/feed'), true);
  assert.equal(platform.isWeixinChannelsShareUrl('https://weixin.qq.com/sph/AbCdEf'), true);
  assert.equal(platform.isWeixinChannelsShareUrl('https://finder.video.qq.com/251/20302/stodownload?encfilekey=x'), false);
  assert.equal(platform.isWeixinChannelsShareUrl('https://evil-channels.weixin.qq.com.example/video/1'), false);
});
