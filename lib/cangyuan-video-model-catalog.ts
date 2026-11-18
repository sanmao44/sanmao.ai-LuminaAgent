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
  skill_preset: '留空时由模型根据画面描述选择运镜方式。',
  speakers: '填写说话人姓名，顺序需与配音音色一致。',
  storyboard: '按镜头顺序填写分镜内容。',
  style: '描述想要的画面风格，也可以直接在画面描述中说明。',
  style_preset: '留空时由模型根据画面描述确定画风。',
  voices: '按说话人顺序填写配音音色。',
});

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
