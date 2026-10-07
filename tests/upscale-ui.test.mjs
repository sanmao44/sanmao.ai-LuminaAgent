import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const pageComponent = pageSource.slice(pageSource.indexOf('function Page()'), pageSource.indexOf('function AdminLogin'));

test('generate upscale panel resolves cloud model option in Page scope', () => {
  const modelIndex = pageComponent.indexOf('const selectedUpscaleModel =');
  const optionIndex = pageComponent.indexOf('const selectedUpscaleOption = selectedUpscaleModel;', modelIndex);
  const cloudIndex = pageComponent.indexOf('const selectedUpscaleIsCloud = isCloudUpscaleModel(selectedUpscaleModel);', optionIndex);

  assert.ok(modelIndex >= 0, 'Page should resolve the selected upscale model');
  assert.ok(optionIndex > modelIndex, 'Page should expose the selected model as the panel option');
  assert.ok(cloudIndex > optionIndex, 'Page should derive cloud-specific parameter visibility');
  assert.match(pageComponent, /selectedUpscaleOption\?\.outputFormats/);
  assert.match(pageComponent, /!selectedUpscaleIsCloud/);
});
