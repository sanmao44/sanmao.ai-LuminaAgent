import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8");

test("documents and text references are labelled as 引用 instead of 参考图", () => {
  assert.match(page, /label: agentRefs\.some\(\(ref\)=>ref\.kind === 'text'\) \? "本轮引用" : "本轮参考图"/);
  assert.match(page, /hint: "支持图片 \/ 视频 \/ 文档"/);
  assert.match(page, /children: references\.some\(\(reference\)=>reference\.kind !== 'text'\) \? "参考图" : "引用"/);
  assert.match(page, /name: refs\.length && refs\.every\(\(ref\)=>ref\.kind === 'text'\) \? 'file' : 'image'/);
});

test("text reference thumbnails show the file name and keep the body in the preview", () => {
  assert.match(page, /className: "reference-text-thumb", children: \/\*#__PURE__\*\/ _jsx\("small", \{ children: ref\.name \}\)/);
  assert.match(page, /className: "message-ref-text", children: \/\*#__PURE__\*\/ _jsx\("small", \{ children: ref\.name \}\)/);
  assert.match(page, /children: \/\*#__PURE__\*\/ _jsx\("b", \{ children: referenceTextBadge\(reference\) \}\)/);
  assert.match(page, /referencePreviewText\(ref, 160\)/);
  assert.doesNotMatch(page, /referencePreviewText\(ref, 42\)/);
  assert.doesNotMatch(page, /referencePreviewText\(ref, 28\)/);
  assert.doesNotMatch(page, /referencePreviewText\(reference, 24\)/);
});

test("document references keep an extension badge and the composer accepts office files", () => {
  const badge = page.slice(page.indexOf("function referenceTextBadge"));
  assert.notEqual(badge.indexOf("function referenceTextBadge"), -1);
  assert.match(badge.slice(0, 400), /extension\.toUpperCase\(\) : 'TXT'/);
  assert.match(page, /const agentReferenceAccept = `\$\{referenceAccept\},\.docx,\.xlsx,\.pptx,\.pdf`/);
  assert.match(page, /accept: agentReferenceAccept/);
  assert.match(page, /hint = '支持 PNG\/JPG\/WEBP', accept = referenceAccept/);
});

test("text thumbnail styles exist for both strips", () => {
  assert.match(styles, /\.reference-text-thumb,\.message-ref-text\{/);
  assert.match(styles, /\.reference-text-thumb>small,\.message-ref-text>small\{/);
  assert.match(styles, /\.reference-index,\.message-ref-index\{/);
  assert.doesNotMatch(styles, /\.message-ref-thumb>span\{/);
});

test("agent prompt counts only real image references and forbids invented attachment text", () => {
  assert.match(route, /const latestReferenceImageCount = latestRefs\.filter\(\(reference\) => reference\.kind !== 'text'\)\.length;/);
  assert.match(route, /本轮参考图数量：\$\{latestReferenceImageCount\}（只统计图片\/视频素材，引用文本与上传文档不计入）/);
  assert.match(route, /17\. \[引用文本：名称\] 和 \[用户上传文件：名称\] 里的正文就是用户给的文字内容，它们不是参考图/);
  assert.match(route, /绝对不要编造或猜测附件正文/);
});
