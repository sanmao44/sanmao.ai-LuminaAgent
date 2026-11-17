import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const imagePresets = createTsRequire(process.cwd())('./lib/creation/image-presets');

function preset(id, label, prompt, icon = '✦') {
  return {
    id,
    label,
    description: '自定义图片预设',
    icon,
    prompt,
    builtin: false,
  };
}

test('custom image preset package round trips without built-in flags', () => {
  const serialized = imagePresets.serializeCustomImagePresetPackage(
    [preset('custom_test_01', '电影色调', '保留主体，调整光线。')],
    '2026-11-16T00:00:00.000Z',
  );
  const packageValue = JSON.parse(serialized);
  const parsed = imagePresets.parseCustomImagePresetPackage(packageValue);

  assert.equal(packageValue.schema, imagePresets.IMAGE_PRESET_PACKAGE_SCHEMA);
  assert.equal(packageValue.version, 1);
  assert.equal(Object.hasOwn(packageValue.presets[0], 'builtin'), false);
  assert.deepEqual(parsed, {
    presets: [preset('custom_test_01', '电影色调', '保留主体，调整光线。')],
    skippedCount: 0,
  });
});

test('preset package parser rejects unknown formats and reports invalid or duplicate entries', () => {
  assert.equal(imagePresets.parseCustomImagePresetPackage({ schema: 'other', version: 1, presets: [] }), null);
  assert.equal(imagePresets.parseCustomImagePresetPackage({ schema: imagePresets.IMAGE_PRESET_PACKAGE_SCHEMA, version: 2, presets: [] }), null);

  const parsed = imagePresets.parseCustomImagePresetPackage({
    schema: imagePresets.IMAGE_PRESET_PACKAGE_SCHEMA,
    version: 1,
    presets: [
      preset('custom_test_01', '电影色调', '保留主体。'),
      preset('custom_test_01', '电影色调副本', '另一段提示词。'),
      { id: 'custom_test_02', label: '缺少提示词', prompt: ' ' },
    ],
  });

  assert.equal(parsed.presets.length, 1);
  assert.equal(parsed.skippedCount, 2);
});

test('preset import is idempotent, preserves differing ID conflicts, and reports name conflicts', () => {
  const current = [preset('custom_test_01', '电影色调', '原提示词。')];
  const plan = imagePresets.planCustomImagePresetImport(current, [
    preset('custom_test_01', '新色调', '不同内容。'),
    preset('custom_test_03', '电影色调', '另一段不同内容。'),
    preset('custom_test_04', '电影色调', '原提示词。'),
  ], 2, () => 'custom_rekey_0001');

  assert.equal(plan.importedCount, 2);
  assert.equal(plan.alreadyPresentCount, 1);
  assert.equal(plan.idConflictCount, 1);
  assert.equal(plan.nameConflictCount, 1);
  assert.equal(plan.skippedCount, 2);
  assert.deepEqual(plan.nextPresets.map((item) => item.id), [
    'custom_test_01',
    'custom_rekey_0001',
    'custom_test_03',
  ]);

  const repeated = imagePresets.planCustomImagePresetImport(plan.nextPresets, [
    preset('custom_test_01', '新色调', '不同内容。'),
    preset('custom_test_03', '电影色调', '另一段不同内容。'),
    preset('custom_test_04', '电影色调', '原提示词。'),
  ]);
  assert.equal(repeated.importedCount, 0);
  assert.equal(repeated.alreadyPresentCount, 3);
});

test('preset import refuses to truncate when the 50 item limit would be exceeded', () => {
  const current = Array.from({ length: 49 }, (_, index) => preset(`custom_local_${index}`, `本地 ${index}`, `本地提示词 ${index}`));
  const plan = imagePresets.planCustomImagePresetImport(current, [
    preset('custom_extra_01', '额外 1', '提示词 1'),
    preset('custom_extra_02', '额外 2', '提示词 2'),
  ]);

  assert.equal(plan.importedCount, 2);
  assert.equal(plan.nextPresets.length, 51);
  assert.equal(plan.exceedsLimit, true);
});
