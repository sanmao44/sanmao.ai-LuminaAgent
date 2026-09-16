import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/storage/video/route.ts", import.meta.url), "utf8");

test("stored videos implement byte ranges instead of only advertising them", () => {
  assert.match(route, /request\.headers\.get\('range'\)/);
  assert.match(route, /status: 206/);
  assert.match(route, /'Content-Range'/);
  assert.match(route, /status: 416/);
});
