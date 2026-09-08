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

test('camera interaction does not imply uncalibrated spatial movement', () => {
  assert.match(source, /controls\.enablePan = false/);
  assert.doesNotMatch(source, /enablePan = true/);
  assert.match(source, /相机策略/);
  assert.match(source, /未对齐原图/);
  assert.match(source, /当前三维预览不是原图的三维还原/);
  assert.match(source, /方向示意 · 未对齐原图/);
  assert.match(source, /导引画框 \{output\.width\}/);
  assert.doesNotMatch(source, /最终输出 \{output\.width\}/);
  assert.match(source, /mode: defaultViewMode\(subjectType\), modeSource: 'auto'/);
  assert.doesNotMatch(source, /viewpoint\.modeSource === 'auto' \? defaultViewMode\(subjectType\) : viewpoint\.mode/);
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
  assert.match(source, /系统自动选择/);
  assert.match(source, /主体保持策略/);
  assert.match(source, /空间保持策略/);
  assert.match(source, /使用空间导引/);
  assert.match(source, /光影控制/);
  assert.match(source, /LIGHTING_PRESETS/);
  assert.match(source, /光源水平/);
  assert.match(source, /色温/);
  assert.match(source, /光源基准/);
});

test('angle console uses unified non-native menus for every dropdown surface', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(source, /function AngleMenu</);
  assert.match(source, /role="listbox"/);
  assert.match(source, /angle-preview-object-menu/);
  assert.doesNotMatch(source, /<select/);
  assert.doesNotMatch(source, /<details className="angle-guide-display"/);
  assert.match(css, /\.angle-select-menu\{position:fixed/);
  assert.match(css, /\.angle-select-menu-scroll\{min-height:0;max-height:inherit;overflow-y:auto/);
  assert.match(css, /\.angle-select-option:hover/);
});

test('angle console provides a clear, responsive help document', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(source, /angle-top-help/);
  assert.match(source, /aria-label="角度控制台使用说明"/);
  assert.match(source, /三步掌握视角与光影/);
  assert.match(source, /放入原始参考图/);
  assert.match(source, /调整目标机位/);
  assert.match(source, /需要时重新布光，然后生成/);
  assert.match(source, /为什么不让你手动选“绕圈”或“换站位”/);
  assert.match(source, /你不需要判断这两个词/);
  assert.match(source, /起始画面没对齐，怎么知道相机移到哪/);
  assert.match(source, /不会让灰模自动对齐原图/);
  assert.match(source, /angle-help-scroll/);
  assert.match(source, /所有生成都以原始参考图为第一依据/);
  assert.match(css, /\.angle-help-dialog\{width:min\(880px/);
  assert.match(css, /\.angle-help-scroll\{min-height:0;overflow:auto/);
  assert.match(css, /@media\(max-width:680px\)[\s\S]*\.angle-help-dialog\{width:100%;height:calc\(100dvh - 18px\)/);
});

test('angle console keeps the light theme readable and layered', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-theme="light"\] \.angle-viewpoint-console\{/);
  assert.match(css, /--angle-stage:#e7eaf0/);
  assert.match(css, /--angle-muted:#667085/);
  assert.match(css, /html\[data-theme="light"\] \.angle-viewpoint-console \.angle-preview-pane\{/);
  assert.match(css, /html\[data-theme="light"\] \.angle-viewpoint-console \.angle-select-menu\{/);
  assert.match(css, /html\[data-theme="light"\] \.angle-viewpoint-console \.angle-panel-scroll\{/);
});
