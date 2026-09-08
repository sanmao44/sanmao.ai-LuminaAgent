import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../components/AngleConsole.tsx', import.meta.url), 'utf8');

test('angle console exposes only edit-capable models', () => {
  assert.match(source, /model\.capabilities\.includes\('edit'\)/);
  assert.match(source, /<ModelPicker models=\{models\} value=\{camera\.modelId\} capability="edit"/);
  assert.doesNotMatch(source, /<ModelPicker models=\{models\} value=\{camera\.modelId\} capability="generate"/);
});

test('default guide is a neutral universal proxy', () => {
  assert.match(source, /const \[camera, setCamera\] = useState<AngleCameraState>\(\(\) => createViewpointCamera\(\)\)/);
  assert.match(source, /const \[humanMode, setHumanMode\] = useState<HumanMode>\('object'\)/);
  assert.match(source, /const isNeutral = mode === 'gray'/);
  assert.match(source, /anatomical-front-marker/);
  assert.match(source, /without adding eyes, a face, clothing or pose cues/);
  assert.match(source, /通用主体/);
});

test('angle console surfaces reprojection risk without blocking generation', () => {
  assert.match(source, /buildAngleTargetSemantic\(camera, angleOutput\)/);
  assert.match(source, /大角度机位/);
  assert.match(source, /原图未展示区域需要模型推断/);
  assert.match(source, /空间导引可选/);
  assert.doesNotMatch(source, /记录起始机位后生成/);
});

test('angle console provides a synchronized left-right direction calibration', () => {
  assert.match(source, /方向校准/);
  assert.match(source, /左右换向/);
  assert.match(source, /referenceViewLabel\(previewCamera\.yaw\)/);
  assert.match(source, /仅在参考图左右方向需要反转时使用/);
});

test('guide capture is optional, neutral, and restores preview resources even after failure', () => {
  assert.match(source, /viewpoint\.guide && viewpoint\.changeView\s*\? await guideCaptureApiRef/);
  assert.match(source, /lightMarker\.visible = false/);
  assert.match(source, /finally \{[\s\S]*key\.position\.copy\(savedLights\.keyPosition\)/);
  assert.match(source, /THREE\.PCFShadowMap/);
  assert.doesNotMatch(source, /THREE\.PCFSoftShadowMap/);
});

test('lighting interaction is reachable and the preview follows the effective request camera', () => {
  assert.match(source, /setInteractionMode\('light'\)/);
  assert.match(source, /ThreeCameraPreview camera=\{previewCamera\}/);
  assert.match(source, /generationCamera\(camera\)/);
  assert.match(source, /disabled=\{!viewpoint\.changeView\}/);
  assert.match(source, /viewedResult\?\.angle\?\.viewpoint\?\.version !== 2/);
});

test('submit row sizes to content, mobile footer remains visible, and original images use contain', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.angle-panel\{display:grid;grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.angle-panel-scroll\{min-height:0;min-width:0;overflow-y:auto/);
  assert.match(css, /\.angle-viewpoint-console \.angle-submit\{position:fixed;left:8px;right:8px;bottom:0/);
  assert.match(css, /\.angle-image-frame img\{width:100%;height:100%;object-fit:contain/);
});

test('page uses edit models, preserves the original and excludes unrelated local-edit state', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /isAngleGeneration \|\| hasLocalEditMask \? availableEditModels/);
  assert.match(page, /const taskMaskAsset = isAngleGeneration \? null/);
  assert.match(page, /const moveGuideDataUrl = !isAngleGeneration/);
  assert.match(page, /const originalUrl = item\.angle \? item\.references\?\.\[0\]\?\.url : item\.url/);
  assert.match(page, /setAngleResults\(previous => \[\.\.\.items, \.\.\.previous\]/);
  assert.doesNotMatch(source, /void onUseResult\(viewedResult\)/);
});

test('angle console exposes universal subject, view mode, guide and lighting controls', () => {
  assert.match(source, /SUBJECT_OPTIONS/);
  assert.match(source, /围绕主体/);
  assert.match(source, /移动镜头/);
  assert.match(source, /使用空间导引/);
  assert.match(source, /光影控制/);
  assert.match(source, /LIGHTING_PRESETS/);
  assert.match(source, /光源水平/);
  assert.match(source, /色温/);
  assert.match(source, /光源基准/);
});
