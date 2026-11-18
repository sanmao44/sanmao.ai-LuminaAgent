import type { Cangyuan3DOptions } from '@/packages/contracts/cangyuan-media';

export type CangyuanThreeDScenario = {
  id: string;
  label: string;
  guidance: string;
  tripo?: { texture: 'no' | 'standard' | 'HD'; pbr: boolean };
  trellis?: Pick<Cangyuan3DOptions, 'textureSize' | 'meshSimplify' | 'slatGuidanceStrength'>;
};

const TRIPO_SCENARIOS: readonly CangyuanThreeDScenario[] = [
  { id: 'game', label: '游戏资产', guidance: '图生时用角色或道具参考图；没有图时切换文生并写清形状、材质和风格。', tripo: { texture: 'standard', pbr: false } },
  { id: 'product', label: '商品形体', guidance: '以商品图为准，只需要几何、后续自行绘制贴图时选择无贴图。', tripo: { texture: 'no', pbr: false } },
  { id: 'ar', label: 'AR 展示', guidance: '用于会打光的场景时开启 PBR，标准贴图兼顾效果和体积。', tripo: { texture: 'standard', pbr: true } },
  { id: 'concept', label: '概念模型', guidance: '文生时把外形、材质和风格写具体；更清晰的 HD 贴图生成较慢。', tripo: { texture: 'HD', pbr: false } },
];

const TRELLIS_SCENARIOS: readonly CangyuanThreeDScenario[] = [
  { id: 'game', label: '游戏资产', guidance: '用角色或道具图；网格简化设为 0.98 可让模型更轻，但会减少一些细节。', trellis: { meshSimplify: 0.98 } },
  { id: 'product', label: '商品可视化', guidance: '提高细节引导可让表面和颜色更贴近商品图；7 是可继续微调的起始值。', trellis: { slatGuidanceStrength: 7 } },
  { id: 'ar', label: 'AR 展示', guidance: '2048 贴图更清晰，文件也更大；确认目标平台能承受较大的模型。', trellis: { textureSize: '2048' } },
  { id: 'concept', label: '概念建模', guidance: '概念图作为输入；固定随机种子可以让重复生成的网格更接近。', trellis: {} },
];

export function cangyuanThreeDScenarios(modelId: string) {
  return modelId === 'trellis' ? TRELLIS_SCENARIOS : modelId === 'tripo3d' ? TRIPO_SCENARIOS : [];
}

export function findCangyuanThreeDScenario(modelId: string, scenarioId: string) {
  return cangyuanThreeDScenarios(modelId).find((scenario) => scenario.id === scenarioId) || null;
}
