import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const editor = await readFile(
  new URL("../components/ReferenceMentionEditor.tsx", import.meta.url),
  "utf8",
);
const menu = await readFile(
  new URL("../components/ReferenceMentionMenu.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const canvasStyles = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");
const video = await readFile(new URL("../components/VideoStudio.tsx", import.meta.url), "utf8");

test("main Agent and image prompts render numbered references with inline thumbnails", () => {
  assert.match(page, /import ReferenceMentionEditor from ['"]@\/components\/ReferenceMentionEditor['"]/);
  assert.equal((page.match(/_jsx\(ReferenceMentionEditor/g) || []).length, 2);
  assert.match(page, /references: referenceMentionOptions\(agentRefs\)/);
  assert.match(page, /references: referenceMentionOptions\(generateRefs\)/);
  assert.match(page, /className: "agent-prompt-mention-editor"/);
  assert.match(page, /className: "generate-prompt-mention-editor"/);
});

test("resolved mentions retain plain numbered values while displaying their thumbnail", () => {
  assert.match(editor, /data-mention-index=\"\$\{index\}\"/);
  assert.match(editor, /reference-inline-mention-thumb/);
  assert.match(editor, /contentEditable=\{!readOnly\}/);
  assert.match(editor, /return `@\$\{index \+ 1\}`/);
  assert.match(editor, /title=\"\$\{escapeHtml\(`引用 @\$\{index \+ 1\}`\)\}\"/);
  assert.doesNotMatch(editor, /reference-inline-mention-label.*<small>/);
  assert.match(styles, /\.agent-composer \.reference-mention-editor-content/);
});

test("mention menus are not collapsed by conflicting top and bottom offsets", () => {
  assert.match(styles, /\.agent-mention-menu\{[^}]*top:auto;bottom:calc\(100% \+ 8px\)[^}]*transform:none/);
  assert.match(styles, /\.generate-mention-menu\{[^}]*top:calc\(100% - 3px\);bottom:auto;transform:none/);
  assert.match(
    canvasStyles,
    /\.reference-mention-editor \.reference-mention-menu\{max-width:calc\(100vw - 24px\)\}/,
  );
});

test("mention menus show only thumbnails and numbered references", () => {
  assert.match(editor, /latestValueRef = useRef\(value\)/);
  assert.match(editor, /if \(node\.nodeType === Node\.TEXT_NODE\) \{\s*total \+= node\.textContent\?\.length \|\| 0;/);
  assert.match(editor, /referenceMentionRange\(current\.value, current\.cursor\)/);
  assert.match(editor, /if \(event\.key === \"@\"\) scheduleMentionStateUpdate\(\)/);
  assert.match(editor, /setMentionState\(null\)/);
  assert.match(menu, /className=\"reference-mention-index\"/);
  assert.match(menu, /aria-label=\{`引用 @\$\{index \+ 1\}`\}/);
  assert.doesNotMatch(menu, /getLabel|getDescription|<strong>/);
  assert.match(styles, /\.reference-mention-index\{[^}]*color:var\(--accent-text\)/);
});

test("selected mention chips do not reopen the picker without a fresh @", () => {
  assert.match(editor, /function isMentionTriggerAtCaret\(/);
  assert.match(editor, /dataset\.mentionIndex !== undefined/);
  assert.match(editor, /isMentionTriggerAtCaret\(editor, range\.startContainer, range\.startOffset\)/);
});

test("Agent reference tray stays compact and keeps the picker above it", () => {
  assert.match(styles, /\.agent-composer \.reference-block\{[^}]*margin:0 0 6px;padding:7px 9px/);
  assert.match(styles, /\.agent-composer \.reference-thumb,\.agent-composer \.add-reference\{height:52px\}/);
  assert.match(styles, /\.agent-composer \.agent-textarea-wrap:has\(\.reference-mention-menu\)\{z-index:4\}/);
  assert.match(styles, /\.agent-composer \.reference-mention-menu\{z-index:130\}/);
});

test("image prompt actions do not sit inside a label that steals editor clicks", () => {
  assert.match(page, /_jsxs\("div", \{\s*className: "field-block prompt-field"/);
  assert.doesNotMatch(page, /_jsxs\("label", \{\s*className: "field-block prompt-field"/);
});

test("video prompt uses the same blur-safe inline mention editor", () => {
  assert.match(video, /import ReferenceMentionEditor from ['"]@\/components\/ReferenceMentionEditor['"]/);
  assert.match(video, /references=\{supportsReferenceMentions \? referenceCandidates : \[\]\}/);
  assert.match(video, /className=\"video-prompt-mention-editor\"/);
  assert.doesNotMatch(video, /referenceMentionOpen|referenceMentionQuery/);
  assert.doesNotMatch(video, /<textarea ref=\{promptRef\}/);
});
