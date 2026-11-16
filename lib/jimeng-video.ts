import type { ModelCapability } from './types';

const jimengVideoCapabilities: ModelCapability[] = [
  'video-generate',
  'video-first-frame',
  'video-reference',
  'video-audio',
];

/**
 * The CLI does not expose a stable model-list endpoint. Keep the documented
 * model versions explicit so the UI can apply the correct duration and
 * resolution limits instead of silently treating every request as "auto".
 */
export const jimengVideoModels = [
  { id: 'jimeng-cli-video', name: '即梦 · CLI 视频自动选择', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance1.0fast', name: 'Seedance 1.0 Fast', capabilities: ['video-generate', 'video-first-frame'] as ModelCapability[] },
  { id: 'seedance1.5pro', name: 'Seedance 1.5 Pro', capabilities: ['video-generate', 'video-first-frame'] as ModelCapability[] },
  { id: 'seedance2.0', name: 'Seedance 2.0', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance2.0fast', name: 'Seedance 2.0 Fast', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance2.0mini', name: 'Seedance 2.0 Mini', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance2.0_vip', name: 'Seedance 2.0 VIP', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance2.0fast_vip', name: 'Seedance 2.0 Fast VIP', capabilities: [...jimengVideoCapabilities] },
  { id: 'seedance2.5', name: 'Seedance 2.5', capabilities: [...jimengVideoCapabilities] },
];
