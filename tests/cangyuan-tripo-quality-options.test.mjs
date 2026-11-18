import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loader = createTsRequire(process.cwd(), {
  '@/components/cangyuan/CangyuanSuggestionInput': {
    __esModule: true,
    default: ({ options, ariaLabel, value, placeholder }) => createElement('div', { 'aria-label': ariaLabel },
      createElement('input', { value, placeholder, readOnly: true }),
      ...options.map((option) => createElement('span', { key: option.value, 'data-value': option.value }, option.label))),
  },
  '@/components/SelectMenu': {
    __esModule: true,
    default: ({ options, ariaLabel }) => createElement('div', { 'aria-label': ariaLabel },
      ...options.map((option) => createElement('span', { key: option.value, 'data-value': option.value }, option.label))),
  },
});
const component = loader('./components/cangyuan/CangyuanTripoQualityOptions');
const contracts = loader('./packages/contracts/cangyuan-media');
const provider = loader('./lib/cangyuan-media-provider');

test('Tripo quick texture quality selects and locks the documented V3.5 version', () => {
  const profile = contracts.getCangyuan3DModelProfile('tripo3d-v3.1');
  const options = component.applyTripoQualityOptions(profile, { textureVersion: 'v3.0-20250812' }, { textureQuality: 'fast' });
  assert.equal(options.textureQuality, 'fast');
  assert.equal(options.textureVersion, 'v3.5-20260815');
  const markup = renderToStaticMarkup(createElement(component.default, { profile, options, onChange: () => undefined }));
  assert.match(markup, /data-value="standard">标准/);
  assert.match(markup, /data-value="fast">快速/);
  assert.match(markup, /aria-label="贴图版本"[^>]*readOnly=""[^>]*value="V3.5"/);
  assert.match(markup, /快速质量固定使用 V3.5/);
});

test('P2 quad mode clamps the existing and later face limit to 25,000', () => {
  const profile = contracts.getCangyuan3DModelProfile('tripo3d-p2');
  const selected = component.applyTripoQualityOptions(profile, { faceLimit: 48_000 }, { quad: true });
  assert.equal(selected.faceLimit, 25_000);
  assert.equal(component.tripoFaceLimitMaximum(profile, selected), 25_000);
  assert.equal(component.applyTripoQualityOptions(profile, selected, { faceLimit: 30_000 }).faceLimit, 25_000);
  const markup = renderToStaticMarkup(createElement(component.default, { profile, options: selected, onChange: () => undefined }));
  assert.match(markup, /面数上限（48–25,000）/);
  assert.match(markup, /max="25000"/);
});

test('Tripo recommended quality fields retain non-empty custom server values', () => {
  const profile = contracts.getCangyuan3DModelProfile('tripo3d-v3.1');
  const custom = component.applyTripoQualityOptions(profile, {}, {
    geometryQuality: 'future-geometry', textureQuality: 'future-texture', textureVersion: 'future-version',
  });
  assert.equal(custom.geometryQuality, 'future-geometry');
  assert.equal(custom.textureQuality, 'future-texture');
  assert.equal(custom.textureVersion, 'future-version');
  assert.deepEqual(provider.buildCangyuanThreeDPayload('tripo3d-v3.1', {
    prompt: 'A carved boat', mode: 'text-to-3d', ...custom,
  }), {
    model: 'tripo3d-v3.1', prompt: 'A carved boat', mode: 'text-to-3d',
    geometry_quality: 'future-geometry', texture_quality: 'future-texture', texture_version: 'future-version',
  });
});
