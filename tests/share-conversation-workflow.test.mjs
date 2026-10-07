import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../lib/share-conversation-workflow.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source
  .replace(/import \{[\s\S]*?\} from "\.\/share-conversation-renderer";/, "const renderShareConversationImage = async () => ({ blob: new Blob(), width: 320, height: 640 });")
  .replace(/export type ShareConversationRenderMessage = [\s\S]*?;/, ""), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const workflow = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("share workflow preserves renderer dimensions and stable date filename", async () => {
  const result = await workflow.createShareConversationPreview([], new Date("2026-10-07T12:00:00Z"));
  assert.equal(result.width, 320);
  assert.equal(result.height, 640);
  assert.equal(result.filename, "SANMAO-瀵硅瘽鍒嗕韩-2026-10-07.png");
  assert.ok(result.blob instanceof Blob);
});
