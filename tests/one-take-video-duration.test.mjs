import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(relativePath, replacements = []) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  let source = await readFile(sourceUrl, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const duration = await importTypeScript("../lib/one-take-video-duration.ts");
const prompt = await importTypeScript("../lib/one-take-video-prompt.ts", [[
  'import { normalizeOneTakeDuration } from "./one-take-video-duration";',
  `const ONE_TAKE_MIN_DURATION = 1;\nconst ONE_TAKE_MAX_DURATION = 60;\nconst ONE_TAKE_DEFAULT_DURATION = 15;\nconst isValidOneTakeDuration = ${duration.isValidOneTakeDuration.toString()};\nconst normalizeOneTakeDuration = ${duration.normalizeOneTakeDuration.toString()};`,
]]);

test("accepts only integer seconds from 1 through 60", () => {
  for (const value of [1, 5, 15, 20, 60]) assert.equal(duration.isValidOneTakeDuration(value), true);
  for (const value of [undefined, null, "", "15", true, false, 0, -1, 1.5, 61, Number.NaN]) {
    assert.equal(duration.isValidOneTakeDuration(value), false, String(value));
  }
});

test("normalizes missing or invalid optional values to 15 seconds", () => {
  assert.equal(duration.normalizeOneTakeDuration(undefined), 15);
  assert.equal(duration.normalizeOneTakeDuration("20"), 15);
  assert.equal(duration.normalizeOneTakeDuration(20), 20);
});

test("builds one-take requests and prompts with the selected duration", () => {
  for (const seconds of [1, 5, 15, 20, 60]) {
    assert.match(duration.buildOneTakeVideoRequest(seconds), new RegExp(`${seconds} 秒`));
    const instructions = prompt.buildOneTakeVideoPromptInstructions(seconds);
    assert.match(instructions, new RegExp(`${seconds} 秒`));
    assert.match(instructions, new RegExp(`${seconds} 秒|${seconds} seconds|0-to-${seconds}-second|0[–-]${seconds}s`));
  }
  assert.doesNotMatch(prompt.buildOneTakeVideoPromptInstructions(5), /15 秒|15 seconds/);
});

test("chooses the nearest duration supported by a video model", () => {
  assert.equal(duration.nearestOneTakeVideoDuration(20, { minSeconds: 5, maxSeconds: 15 }), 15);
  assert.equal(duration.nearestOneTakeVideoDuration(7, { allowedSeconds: [4, 8, 12] }), 8);
  assert.equal(duration.nearestOneTakeVideoDuration(20, { fixedSeconds: 8 }), 8);
  assert.equal(duration.nearestOneTakeVideoDuration(20), 20);
});

test("wires duration selection through both one-take entry points", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8");
  const agent = await readFile(new URL("../lib/creation/agent.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/agent-client.ts", import.meta.url), "utf8");
  assert.match(page, /OneTakeDurationPicker/);
  assert.match(page, /durationSeconds/);
  assert.match(page, /pushTextToVideo\(message\.content, true, message\.durationSeconds\)/);
  assert.match(canvas, /OneTakeDurationPicker/);
  assert.match(canvas, /params: nextParams/);
  assert.match(route, /isValidOneTakeDuration\(body\.durationSeconds\)/);
  assert.match(agent, /durationSeconds/);
  assert.match(client, /durationSeconds\?: number/);
});
