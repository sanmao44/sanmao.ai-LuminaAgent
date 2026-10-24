import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const previousDataDir = process.env.SANMAO_DATA_DIR;
const dataDir = await mkdtemp(path.join(os.tmpdir(), "sanmao-generation-log-recovery-"));
process.env.SANMAO_DATA_DIR = dataDir;
const { findGenerationLog, listGenerationLogs } = createTsRequire(process.cwd())("./lib/generation-log");

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

test("orphaned edit logs retain an explicit provider-acceptance warning", async () => {
  const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const logs = [
    { id: "stale-edit-log", taskId: "edit-client-task", createdAt: staleDate, status: "pending", mode: "edit", prompt: "synthetic edit" },
    { id: "stale-generate-log", createdAt: staleDate, status: "pending", mode: "generate", prompt: "synthetic generation" },
  ];
  await appendFile(path.join(dataDir, "generation-logs.jsonl"), `${logs.map((log) => JSON.stringify(log)).join("\n")}\n`, "utf8");

  const listed = await listGenerationLogs(10);
  const edit = listed.find((log) => log.id === "stale-edit-log");
  const generate = listed.find((log) => log.id === "stale-generate-log");
  assert.equal(edit.status, "error");
  assert.equal(edit.errorCode, "provider_result_unconfirmed");
  assert.equal(generate.status, "error");
  assert.equal(generate.errorCode, undefined);

  const recovered = await findGenerationLog("edit-client-task");
  assert.equal(recovered.errorCode, "provider_result_unconfirmed");
});
