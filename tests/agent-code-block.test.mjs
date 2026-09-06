import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf("function codeDownloadExtension");
const end = page.indexOf("function AgentImageLoadingCard", start);
assert.ok(start >= 0 && end > start, "code block renderer should be present");
const codeBlock = page.slice(start, end);

test("code blocks expose a download action with language-aware filenames", () => {
  assert.match(codeBlock, /function codeDownloadExtension\(language\)/);
  assert.match(codeBlock, /'javascript'[\s\S]*?return 'js'/);
  assert.match(codeBlock, /'typescript'[\s\S]*?return 'ts'/);
  assert.match(codeBlock, /'markdown'[\s\S]*?return 'md'/);
  assert.match(codeBlock, /return 'txt'/);
  assert.match(codeBlock, /name: "download"/);
  assert.match(codeBlock, /anchor\.download = `sanmao-code\.\$\{codeDownloadExtension\(normalizedLanguage\)\}`/);
  assert.match(codeBlock, /代码已下载/);
});
