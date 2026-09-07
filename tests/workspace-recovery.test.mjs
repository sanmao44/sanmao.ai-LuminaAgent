import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = fs.readFileSync(path.join(root, 'app/api/workspace/route.ts'), 'utf8');

test('workspace writes flush and validate before replacing the live snapshot', () => {
  assert.match(route, /writeFile\(temporary, content, \{ encoding: 'utf8', flush: true \}\)/);
  assert.match(route, /parseWorkspace\(await readFile\(temporary, 'utf8'\)\)/);
});

test('workspace reads can recover from a valid temporary snapshot after corruption', () => {
  assert.match(route, /workspaceTempPattern = \/\^workspace\\\.json\\\.\\d\+\\\.\\d\+\\\.tmp\$\//);
  assert.match(route, /readdir\(dataDir, \{ withFileTypes: true \}\)/);
  assert.match(route, /const recovered = await recoverWorkspace\(\)/);
  assert.match(route, /if \(recovered\) return recovered/);
});
