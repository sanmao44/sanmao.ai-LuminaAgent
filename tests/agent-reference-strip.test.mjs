import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from './ts-require.mjs';

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const referenceStripSource = await readFile(new URL("../components/CreativeReferenceStrip.tsx", import.meta.url), "utf8");
const imageCardSource = await readFile(new URL("../components/ImageCard.tsx", import.meta.url), "utf8");
const referenceStrip = createTsRequire(process.cwd())('./components/CreativeReferenceStrip').default;
const Icon = ({ name }) => createElement('i', { 'data-icon': name });
const referencePresentation = await readFile(new URL("../lib/creative-references.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const planning = createTsRequire(process.cwd())('./packages/agent-core/request-planning');
const planningPorts = {
  ...createTsRequire(process.cwd())('./lib/agent-web'),
  ...createTsRequire(process.cwd())('./lib/agent-intent'),
  ...createTsRequire(process.cwd())('./lib/agent-context'),
  ...createTsRequire(process.cwd())('./lib/agent-routing'),
  ...createTsRequire(process.cwd())('./lib/creative-references'),
};
const messageReferences = await readFile(new URL("../components/AgentMessageReferences.tsx", import.meta.url), "utf8");

test("documents and text references are labelled as 引用 instead of 参考图", () => {
  assert.match(page, /label: agentRefs\.some\(\(ref\)=>ref\.kind === 'text'\) \? "本轮引用" : "本轮参考图"/);
  assert.match(page, /hint: "支持图片 \/ 视频 \/ 文档"/);
  assert.match(imageCardSource, /references\.some\(\(reference\) => reference\.kind !== "text"\) \? "参考图" : "引用"/);
  const markup = renderToStaticMarkup(createElement(referenceStrip, {
    refs: [{ id: 'text', kind: 'text', name: 'brief', text: 'caption' }],
    Icon,
    onAdd: () => {},
    onRemove: () => {},
    onReorder: () => {},
    label: '本轮引用',
    hint: '支持图片 / 视频 / 文档',
    accept: '.txt',
  }));
  assert.match(markup, /data-icon="file"/);
  assert.match(markup, /reference-text-thumb/);
});

test("text reference thumbnails show the file name and keep the body in the preview", () => {
  const markup = renderToStaticMarkup(createElement(referenceStrip, {
    refs: [{ id: 'text', kind: 'text', name: 'brief', text: 'full body' }],
    Icon,
    onAdd: () => {},
    onRemove: () => {},
    onReorder: () => {},
    label: '本轮引用',
    hint: '支持图片 / 视频 / 文档',
    accept: '.txt',
  }));
  assert.match(markup, /reference-text-thumb/);
  assert.match(markup, /brief/);
  assert.match(messageReferences, /className="message-ref-text"><small>\{reference\.name\}<\/small>/);
  assert.match(imageCardSource, /referenceTextBadge\(reference\)/);
  assert.match(referenceStripSource, /referencePreviewText\(ref, 160\)/);
});

test("document references keep an extension badge and the composer accepts office files", () => {
  assert.match(referencePresentation, /export function referenceTextBadge/);
  assert.match(referencePresentation, /extension\.toUpperCase\(\) : "TXT"/);
  assert.match(page, /const agentReferenceAccept = `\$\{referenceAccept\},\.docx,\.xlsx,\.pptx,\.pdf`/);
  assert.match(page, /accept: agentReferenceAccept/);
  assert.match(referenceStripSource, /accept: string/);
});

test("text thumbnail styles exist for both strips", () => {
  assert.match(styles, /\.reference-text-thumb,\.message-ref-text\{/);
  assert.match(styles, /\.reference-text-thumb>small,\.message-ref-text>small\{/);
  assert.match(styles, /\.reference-index,\.message-ref-index\{/);
  assert.doesNotMatch(styles, /\.message-ref-thumb>span\{/);
});

test("agent prompt counts only real image references and preserves text references", () => {
  const plan = planning.planAgentRequest({ body: { webMode: 'off' }, messages: [{ role: 'user', content: '????', references: [
    { id: 'image', kind: 'image', name: 'img', url: 'data:image/png;base64,x' },
    { id: 'text', kind: 'text', name: 'brief', text: 'caption' },
  ] }], isCanvasSource: false, isCanvasNodeExecution: false, canvasTargetNodeIds: [], canvasTargetKind: 'none', canvasTargetOperation: 'generate', ports: planningPorts });
  assert.equal(plan.latestReferenceImageCount, 1);
  assert.equal(plan.latestRefs.find((reference) => reference.kind === 'text')?.text, 'caption');
});
