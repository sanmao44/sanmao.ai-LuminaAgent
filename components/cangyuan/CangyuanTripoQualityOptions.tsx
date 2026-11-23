'use client';

import type { Cangyuan3DModelProfile, Cangyuan3DOptions } from '@/packages/contracts/cangyuan-media';
import CangyuanSuggestionInput from '@/components/cangyuan/CangyuanSuggestionInput';
import SelectMenu from '@/components/SelectMenu';

const TEXTURE_VERSION_FAST = 'v3.5-20260815';

const GEOMETRY_QUALITIES = [
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '精细' },
];
const TEXTURE_QUALITIES = [
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '精细' },
  { value: 'extreme', label: '极高' },
  { value: 'fast', label: '快速' },
];
const TEXTURE_VERSIONS = [
  { value: 'v3.5-20260815', label: 'V3.5' },
  { value: 'v3.0-20250812', label: 'V3.0' },
  { value: 'v2.5-20250123', label: 'V2.5' },
];

type TripoProfile = Extract<Cangyuan3DModelProfile, { family: 'tripo' }>

type Props = {
  profile: TripoProfile;
  options: Cangyuan3DOptions;
  onChange: (options: Cangyuan3DOptions) => void;
  alwaysVisible?: boolean;
};

export function tripoFaceLimitMaximum(profile: TripoProfile, options: Cangyuan3DOptions) {
  return profile.modelId === 'tripo3d-p2' && options.quad === true
    ? Math.min(profile.faceLimitRange[1], 25_000)
    : profile.faceLimitRange[1];
}

export function applyTripoQualityOptions(
  profile: TripoProfile,
  current: Cangyuan3DOptions,
  patch: Partial<Cangyuan3DOptions>,
): Cangyuan3DOptions {
  const next = { ...current, ...patch };
  if (next.textureQuality === 'fast') next.textureVersion = TEXTURE_VERSION_FAST;
  if (next.generateParts === true) {
    next.texture = false;
    next.pbr = false;
    next.quad = false;
  }
  if (next.faceLimit !== undefined) {
    next.faceLimit = Math.max(profile.faceLimitRange[0], Math.min(tripoFaceLimitMaximum(profile, next), next.faceLimit));
  }
  return next;
}

export default function CangyuanTripoQualityOptions({ profile, options, onChange, alwaysVisible = false }: Props) {
  const update = (patch: Partial<Cangyuan3DOptions>) => onChange(applyTripoQualityOptions(profile, options, patch));
  const maxFaceLimit = tripoFaceLimitMaximum(profile, options);
  const fields = <div className="cangyuan-trellis-grid">
        <div className="cangyuan-select-field">
          <span>贴图</span>
          <SelectMenu
            value={options.texture === undefined ? 'auto' : String(options.texture)}
            ariaLabel="贴图开关"
            className="cangyuan-field-select"
            menuClassName="cangyuan-field-select-menu"
            options={[{ value: 'auto', label: '模型决定' }, { value: 'true', label: '生成贴图' }, { value: 'false', label: '不生成贴图' }]}
            disabled={options.generateParts === true}
            onChange={(value) => update({ texture: value === 'auto' ? undefined : value === 'true' })}
          />
        </div>
      {profile.modelId === 'tripo3d-v3.1' && (
        <label className="cangyuan-music-text-field">
          <span>几何质量</span>
          <CangyuanSuggestionInput
            value={options.geometryQuality ?? ''}
            ariaLabel="几何质量"
            options={GEOMETRY_QUALITIES}
            placeholder="模型默认，也可输入其他服务支持值"
            onChange={(value) => update({ geometryQuality: value || undefined })}
          />
        </label>
      )}
      <label className="cangyuan-music-text-field">
        <span>贴图质量</span>
        <CangyuanSuggestionInput
          value={options.textureQuality ?? ''}
          ariaLabel="贴图质量"
          options={TEXTURE_QUALITIES}
          placeholder="模型默认，也可输入其他服务支持值"
          onChange={(value) => update({ textureQuality: value || undefined })}
        />
      </label>
      <label className="cangyuan-music-text-field">
        <span>贴图版本</span>
        {options.textureQuality === 'fast' ? <input aria-label="贴图版本" value="V3.5" readOnly /> : <CangyuanSuggestionInput
          value={options.textureVersion ?? ''}
          ariaLabel="贴图版本"
          options={TEXTURE_VERSIONS}
          placeholder="模型默认，也可输入其他服务支持值"
          onChange={(value) => update({ textureVersion: value || undefined })}
        />}
        {options.textureQuality === 'fast' && <small>快速质量固定使用 V3.5。</small>}
      </label>
      <label className="cangyuan-music-text-field">
        <span>面数上限（{profile.faceLimitRange[0]}–{maxFaceLimit.toLocaleString('en-US')}）</span>
        <input
          type="number"
          min={profile.faceLimitRange[0]}
          max={maxFaceLimit}
          step="1"
          value={options.faceLimit ?? ''}
          onChange={(event) => update({ faceLimit: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="模型默认"
        />
        <small>控制最终网格复杂度；数值越高，细节和文件体积通常越大。</small>
      </label>
        <label className="cangyuan-checkbox-field">
          <input type="checkbox" checked={options.pbr === true} disabled={options.generateParts === true} onChange={(event) => update({ pbr: event.target.checked })} />
          <span>PBR 材质（基于物理渲染）</span>
        </label>
        {profile.supportsGenerateParts && (
          <label className="cangyuan-checkbox-field">
            <input type="checkbox" checked={options.generateParts === true} onChange={(event) => update({ generateParts: event.target.checked })} />
            <span>分件生成</span>
          </label>
        )}
        {profile.supportsQuad && (
          <label className="cangyuan-checkbox-field">
            <input type="checkbox" checked={options.quad === true} disabled={options.generateParts === true} onChange={(event) => update({ quad: event.target.checked })} />
            <span>四边形网格（输出 FBX）</span>
          </label>
        )}
      </div>;
  const notes = <>
    {options.generateParts === true && <p className="cangyuan-model-note">分件生成会自动关闭贴图、PBR 材质和四边形网格。</p>}
    {profile.modelId === 'tripo3d-p2' && options.quad === true && <p className="cangyuan-model-note">P2 四边形网格模式的面数上限为 25,000，结果为 FBX 文件。</p>}
  </>;

  if (alwaysVisible) return <div className="cangyuan-3d-advanced is-always-visible">{fields}{notes}</div>;

  return (
    <details className="cangyuan-3d-advanced">
      <summary>更多生成选项</summary>
      {fields}
      {notes}
    </details>
  );
}
