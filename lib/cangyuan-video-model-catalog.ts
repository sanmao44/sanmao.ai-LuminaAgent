import { CANGYUAN_VIDEO_MODEL_CATALOG } from './cangyuan-video-model-catalog.generated';
import type { CangyuanVideoModelCatalogEntry, CangyuanVideoModelSpec, CangyuanVideoParameterSpec } from '@/packages/contracts/video-generation';

const catalog = CANGYUAN_VIDEO_MODEL_CATALOG as readonly CangyuanVideoModelCatalogEntry[];
const byModel = new Map(catalog.map((entry) => [entry.publicModel, entry]));

const PARAMETER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  aspect_ratio: '画面比例',
  camera_movement: '镜头运镜',
  character_bible: '角色设定',
  custom_skill: '运镜补充说明',
  custom_style: '画风补充说明',
  duration: '视频时长',
  face_mode: '人脸处理',
  first_image_url: '首帧图片',
  generate_audio: '生成声音',
  language: '输出语言',
  last_image_url: '尾帧图片',
  mode: '生成方式',
  model: '模型',
  mute_voice: '人物静音',
  negative_prompt: '不希望出现的内容',
  prompt: '画面描述',
  reference_audios: '参考音频',
  reference_image_urls: '参考图片',
  reference_videos: '参考视频',
  resolution: '画面清晰度',
  script: '剧本内容',
  script_url: '剧本文件链接',
  seed: '随机种子',
  skill_preset: '运镜预设',
  speakers: '说话人',
  storyboard: '分镜表',
  style: '风格描述',
  style_preset: '画风预设',
  video: '源视频',
  voices: '配音音色',
});

const PARAMETER_HELP: Readonly<Record<string, string>> = Object.freeze({
  camera_movement: '例如向左摇镜、推近、环绕、跟拍或固定机位；也可以直接用自然语言描述。',
  character_bible: '描述需要保持一致的人物外观与性格特征。',
  custom_skill: '补充运镜预设之外的镜头调度要求。',
  custom_style: '补充画风预设之外的画面风格要求。',
  face_mode: '决定人物如何参考上传素材；不确定时保留模型默认值。',
  language: '选择输出语言，例如中文或英文。',
  negative_prompt: '描述希望避免的画面元素或瑕疵。',
  script: '按剧本内容生成；适合需要明确对白或情节的创作。',
  script_url: '可填写模型能够访问的远程剧本链接。',
  skill_preset: '可选择建议运镜，也可用逗号组合多个；留空时根据画面描述决定。',
  speakers: '填写说话人姓名，顺序需与配音音色一致。',
  storyboard: '按镜头顺序填写分镜内容。',
  style: '描述想要的画面风格，也可以直接在画面描述中说明。',
  style_preset: '留空时由模型根据画面描述确定画风。',
  voices: '可选择中文音色；多人对谈用逗号分隔，数量和顺序需与说话人一致。',
});

type VideoParameterOption = { value: string; label: string };

const PARAMETER_OPTIONS: Readonly<Record<string, readonly VideoParameterOption[]>> = {
  camera_movement: [
    { value: 'pan_left', label: '向左摇镜' },
    { value: 'zoom_in', label: '向前推进' },
    { value: 'orbit', label: '环绕主体' },
    { value: 'tracking_shot', label: '跟拍主体' },
    { value: 'static', label: '固定机位' },
  ],
  language: [{ value: 'zh', label: '中文' }, { value: 'en', label: '英文' }],
  skill_preset: [
    { value: 'occlusion_wipe', label: '遮挡转场' },
    { value: 'micro_drama_hook', label: '短剧悬念' },
    { value: 'none', label: '不使用内置运镜' },
  ],
  style_preset: [
    { value: 'cinematic_realistic', label: '电影写实' },
    { value: '2d_anime', label: '二维动画' },
    { value: '3d_xianxia', label: '三维仙侠' },
    { value: 'american_comic', label: '美式漫画' },
    { value: 'cyberpunk_neon', label: '霓虹赛博朋克' },
    { value: 'cyberpunk_noir', label: '暗黑赛博朋克' },
    { value: 'dark_ink_wuxia', label: '暗调水墨武侠' },
    { value: 'ecommerce_ugc', label: '电商生活实拍' },
    { value: 'none', label: '不使用内置画风' },
  ],
  voices: [
    { value: 'alloy', label: '清亮女声一' },
    { value: 'aria', label: '清亮女声二' },
    { value: 'coral', label: '清亮女声三' },
    { value: 'nova', label: '温暖女声一' },
    { value: 'shimmer', label: '温暖女声二' },
    { value: 'sage', label: '温暖女声三' },
    { value: 'echo', label: '沉稳男声一' },
    { value: 'helio', label: '沉稳男声二' },
    { value: 'onyx', label: '沉稳男声三' },
    { value: 'fable', label: '叙事男声' },
  ],
};

const UI_HANDLED_PARAMETERS = new Set([
  'aspect_ratio', 'duration', 'first_image_url', 'last_image_url', 'model', 'mode', 'prompt', 'reference_audios',
  'reference_image_urls', 'reference_videos', 'resolution', 'seed', 'video',
]);

export function getCangyuanVideoModelCatalog() {
  return catalog;
}

export function getCangyuanVideoModelSpec(publicModel: string): CangyuanVideoModelSpec | null {
  return byModel.get(publicModel)?.spec || null;
}

export function getCangyuanVideoModelCatalogEntry(publicModel: string) {
  return byModel.get(publicModel) || null;
}

export function getCangyuanVideoParameter(spec: CangyuanVideoModelSpec, name: string): CangyuanVideoParameterSpec | undefined {
  return spec.params.find((parameter) => parameter.name === name);
}

export function getCangyuanVideoAdvancedParameters(spec: CangyuanVideoModelSpec): CangyuanVideoParameterSpec[] {
  return spec.params.filter((parameter) => {
    if (parameter.name === 'generate_audio' && parameter.type !== 'boolean') return true;
    return !UI_HANDLED_PARAMETERS.has(parameter.name) && parameter.name !== 'generate_audio';
  });
}

export function cangyuanVideoParameterLabel(parameter: CangyuanVideoParameterSpec): string {
  return PARAMETER_LABELS[parameter.name] || '模型设置';
}

export function cangyuanVideoParameterLabelByName(name: string): string {
  return PARAMETER_LABELS[name] || '模型设置';
}

export function cangyuanVideoParameterValueLabel(name: string, value: string): string {
  return PARAMETER_OPTIONS[name]?.find((option) => option.value === value)?.label
    || (name === 'mode' ? ({ edit: '编辑视频', extend: '续写视频' } as Record<string, string>)[value] : undefined)
    || value;
}

export function getCangyuanVideoParameterSuggestions(parameter: CangyuanVideoParameterSpec): VideoParameterOption[] {
  const documented = Array.isArray(parameter.suggestions) ? parameter.suggestions : [];
  if (documented.length) {
    return documented.map((value) => ({ value, label: cangyuanVideoParameterValueLabel(parameter.name, value) }));
  }
  // These values are examples in the official text, not a closed set of allowed values.
  return [...(PARAMETER_OPTIONS[parameter.name] || [])]
    .filter((option) => parameter.description?.includes(option.value));
}

export function cangyuanVideoParameterDescription(parameter: CangyuanVideoParameterSpec): string | undefined {
  const curated = PARAMETER_HELP[parameter.name];
  if (curated) return curated;
  let description = parameter.description?.trim() || '';
  if (!description) return undefined;
  const prefix = `${parameter.name}`;
  if (description.startsWith(prefix)) {
    description = description.slice(prefix.length).replace(/^[。.:：\s]+/u, '').trim();
  }
  if (!description || /(?:^|\s)[a-z][a-z0-9]*_[a-z0-9_]+\b|asset:\/\/|\bActive\b/u.test(description)) return undefined;
  return description;
}
