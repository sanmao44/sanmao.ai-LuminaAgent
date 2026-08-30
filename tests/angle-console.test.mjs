import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../components/AngleConsole.tsx', import.meta.url), 'utf8');

test('angle console exposes only edit-capable models', () => {
  assert.match(source, /model\.capabilities\.includes\('edit'\)/);
  assert.match(source, /<ModelPicker models=\{models\} value=\{camera\.modelId\} capability="edit"/);
  assert.doesNotMatch(source, /<ModelPicker models=\{models\} value=\{camera\.modelId\} capability="generate"/);
});

test('default guide is a neutral direction-and-composition proxy', () => {
  assert.match(source, /const \[humanMode, setHumanMode\] = useState<HumanMode>\('gray'\)/);
  assert.match(source, /const isNeutral = mode === 'gray'/);
  assert.match(source, /anatomical-front-marker/);
  assert.match(source, /without adding eyes, a face, clothing or pose cues/);
  assert.match(source, /中性轮廓（默认）/);
});

test('angle console surfaces reprojection risk without blocking generation', () => {
  assert.match(source, /buildAngleTargetSemantic\(camera, angleOutput\)/);
  assert.match(source, /大角度机位/);
  assert.match(source, /单次生成可能保留原始二维投影/);
  assert.match(source, /严格冻结姿态请导入匹配姿态的 GLB/);
  assert.match(source, /仅用于起始机位对齐和日志审计，不发送给图片模型/);
});
