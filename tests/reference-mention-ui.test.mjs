import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const editor = await readFile(
  new URL("../components/ReferenceMentionEditor.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.match(styles, /\.agent-composer \.reference-mention-editor-content/);
});
