import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const artifactTools = await readFile(new URL('../lib/tools/artifacts.ts', import.meta.url), 'utf8');
const fileTools = await readFile(new URL('../lib/tools/file.ts', import.meta.url), 'utf8');
const downloadRoute = await readFile(new URL('../app/api/artifacts/[id]/route.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const clientTypes = await readFile(new URL('../lib/agent-client.ts', import.meta.url), 'utf8');
const historyTypes = await readFile(new URL('../lib/client-history.ts', import.meta.url), 'utf8');

const load = createTsRequire(process.cwd());
const { historyArtifactFiles } = load('./lib/agent/artifact-references');
const artifacts = load('./lib/artifacts/index');
const artifactLimits = load('./lib/artifacts/limits');
const imageStorage = load('./lib/image-storage');
const artifactInfrastructure = {
  maxPerTurn: artifactLimits.ARTIFACT_MAX_PER_TURN,
  isValidArtifactId: artifacts.isValidArtifactId,
  getStorageRoots: imageStorage.getStorageRoots,
  generateDocumentArtifact: (input, options) => artifacts.generateDocumentArtifact(input, undefined, options),
  generateSpreadsheetArtifact: artifacts.generateSpreadsheetArtifact,
  generatePresentationArtifact: (input, options) => artifacts.generatePresentationArtifact(input, undefined, options),
  collectArchiveEntries: artifacts.collectArchiveEntries,
  generateArchiveArtifact: artifacts.generateArchiveArtifact,
};

test('artifact capability exposes dedicated Office and archive tools', () => {
  for (const tool of ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'archive_generate']) {
    assert.match(artifactTools, new RegExp(`name: '${tool}'`));
  }
  assert.match(fileTools, /Word\/Excel\/PPT\/ZIP/);
});

test('artifact execution returns metadata and keeps binary content out of messages', async () => {
  const message = await load('./packages/tool-runtime/artifact-capability').executeArtifactCapability({
    state: { generatedFiles: [], generatedArtifactCount: 0 },
    call: { id: 'artifact-contract', function: { name: 'document_generate' } },
    args: { filename: 'contract.docx', markdown: '# contract' },
    signal: new AbortController().signal,
    infrastructure: artifactInfrastructure,
  });
  const payload = JSON.parse(String(message.content));
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.file.artifactId, 'string');
  assert.equal(typeof payload.file.downloadUrl, 'string');
  assert.equal('content' in payload.file, false);
});

test('artifact download is authenticated and addressed by artifact id', () => {
  assert.match(downloadRoute, /isTrustedAppRequest\(request\)/);
  assert.match(downloadRoute, /buildArtifactResponse\(String\(id \|\| ''\)\)/);
  assert.doesNotMatch(downloadRoute, /searchParams\.get\('path'\)/);
});

test('client and history contracts preserve artifact references for later turns', () => {
  assert.match(clientTypes, /artifactId\?: string/);
  assert.match(historyTypes, /artifactId\?: string/);
  assert.match(historyTypes, /downloadUrl\?: string/);
  const result = historyArtifactFiles({
    role: 'assistant',
    files: [
      { name: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', artifactId: 'artifact-1', size: 42 },
      { name: 'inline.txt', mimeType: 'text/plain', content: 'inline' },
    ],
  });
  assert.deepEqual(result, [{
    name: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    artifactId: 'artifact-1',
    size: 42,
  }]);
  assert.doesNotMatch(page, /function historyArtifactFiles\(message\)/);
});
