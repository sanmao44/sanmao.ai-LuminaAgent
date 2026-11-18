import { CANGYUAN_VIDEO_MODEL_CATALOG } from './cangyuan-video-model-catalog.generated';
import type { CangyuanVideoModelCatalogEntry, CangyuanVideoModelSpec, CangyuanVideoParameterSpec } from '@/packages/contracts/video-generation';
import { speechVoiceLabel } from '@/packages/contracts/audio-synthesis';

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
  camera_movement: '这是自由文本，不是固定选项列表。可描述镜头如何移动，也可使用建议中的运镜方式。不填写时会根据画面提示词决定。',
  character_bible: '填写人物设定说明。',
  custom_skill: '补充运镜预设之外的镜头调度要求。',
  custom_style: '补充画风预设之外的画面风格要求。',
  face_mode: '仅在上传素材的接口未返回 asset_id（素材编号）时开启。若素材已包含状态为 Active（已激活）的 asset:// 引用，请保持关闭。',
  language: '选择角色对谈使用的语言。不填写时，模型会根据提示词判断。',
  mute_voice: '默认关闭，人物正常配音。开启后仅让人物不出声；环境音、拟音和背景音乐仍会保留。',
  negative_prompt: '填写希望避免的瑕疵或画面元素，并与正向画面描述分开；例如模糊、水印或文字。',
  script: '填写剧本文本；适用于漫剧向任务。不要传入 script_file 字段。',
  script_url: '填写模型可访问的远程剧本链接。可只提供链接，也可同时提供剧本文本；不要传入 script_file 字段。',
  skill_preset: '可选择一个或多个内置运镜预设，多个值用英文逗号分隔。选择“不使用内置运镜”时不会注入内置运镜技能。',
  speakers: '按出场顺序填写说话人名称。可使用字符串数组，或用英文逗号分隔；人数和顺序必须与配音音色一致。',
  storyboard: '按镜头顺序填写分镜文本。',
  style: '填写画面风格描述；需要使用内置画风时，请在画风预设中选择。',
  style_preset: '选择内置画风预设；也接受“动漫”“写实”等别名。留空时由模型判断，选择“不使用内置画风”时不会注入内置预设。',
  voices: '按说话人顺序填写音色；音色数量和顺序必须与说话人一致。',
});

type VideoParameterOption = { value: string; label: string };

const PARAMETER_OPTIONS: Readonly<Record<string, readonly VideoParameterOption[]>> = {
  aspect_ratio: [
    { value: 'auto', label: '自动' },
    { value: 'adaptive', label: '自适应' },
    { value: '16:9', label: '16:9（横屏）' },
    { value: '9:16', label: '9:16（竖屏）' },
    { value: '1:1', label: '1:1（正方形）' },
    { value: '4:3', label: '4:3（横屏）' },
    { value: '3:4', label: '3:4（竖屏）' },
  ],
  camera_movement: [
    { value: 'pan_left', label: '向左摇镜' },
    { value: 'zoom_in', label: '向前推进' },
    { value: 'orbit', label: '环绕主体' },
    { value: 'tracking_shot', label: '跟拍主体' },
    { value: 'static', label: '固定机位' },
  ],
  language: [{ value: 'zh', label: '中文' }, { value: 'en', label: '英语' }],
  resolution: [
    { value: '480p', label: '480p（标清）' },
    { value: '720p', label: '720p（高清）' },
    { value: '1080p', label: '1080p（全高清）' },
    { value: '2k', label: '2K（超高清）' },
    { value: '4k', label: '4K（超高清）' },
  ],
  skill_preset: [
    { value: 'occlusion_wipe', label: '遮挡转场' },
    { value: 'micro_drama_hook', label: '短剧悬念' },
    { value: 'none', label: '不使用内置运镜' },
  ],
  style_preset: [
    { value: 'cinematic_realistic', label: '电影写实' },
    { value: '2d_anime', label: '二维动画' },
    { value: 'anime', label: '动漫（别名）' },
    { value: 'realistic', label: '写实（别名）' },
    { value: '3d_xianxia', label: '三维仙侠' },
    { value: 'american_comic', label: '美式漫画' },
    { value: 'cyberpunk_neon', label: '霓虹赛博朋克' },
    { value: 'cyberpunk_noir', label: '暗黑赛博朋克' },
    { value: 'dark_ink_wuxia', label: '暗调水墨武侠' },
    { value: 'ecommerce_ugc', label: '电商生活实拍' },
    { value: 'none', label: '不使用内置画风' },
  ],
  voices: ['alloy', 'aria', 'coral', 'nova', 'shimmer', 'sage', 'echo', 'helio', 'onyx', 'fable']
    .map((value) => ({ value, label: speechVoiceLabel(value, 'mu1-muse-tts') })),
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
    // Some upstream catalog entries expose generate_audio as an untyped string
    // without an enum. The dedicated video editor owns the documented boolean
    // control, so never turn this unresolved field into a free-text control.
    if (parameter.name === 'generate_audio' && parameter.type !== 'boolean') return false;
    return !UI_HANDLED_PARAMETERS.has(parameter.name) && parameter.name !== 'generate_audio';
  });
}

export function cangyuanVideoParameterLabel(parameter: CangyuanVideoParameterSpec): string {
  return PARAMETER_LABELS[parameter.name] || `待核实参数（${parameter.name}）`;
}

export function cangyuanVideoParameterLabelByName(name: string): string {
  return PARAMETER_LABELS[name] || `待核实参数（${name}）`;
}

export function cangyuanVideoParameterValueLabel(name: string, value: string): string {
  const normalizedValue = value.toLowerCase();
  return PARAMETER_OPTIONS[name]?.find((option) => option.value.toLowerCase() === normalizedValue)?.label
    || (name === 'mode' ? ({ edit: '编辑视频', extend: '续写视频' } as Record<string, string>)[normalizedValue] : undefined)
    || value;
}

export function cangyuanVideoParameterEnumLabel(name: string, value: string): string {
  const localized = cangyuanVideoParameterValueLabel(name, value);
  if (localized !== value || /^\d+(?:p|k)$/iu.test(value) || /^\d+:\d+$/u.test(value)) return localized;
  return `待按官方说明核实（${value}）`;
}

export function getCangyuanVideoParameterSuggestions(parameter: CangyuanVideoParameterSpec): VideoParameterOption[] {
  const documented = Array.isArray(parameter.suggestions) ? parameter.suggestions : [];
  if (documented.length) {
    return documented.map((value) => ({ value, label: cangyuanVideoParameterEnumLabel(parameter.name, value) }));
  }
  // These values are examples in the official text, not a closed set of allowed values.
  return [...(PARAMETER_OPTIONS[parameter.name] || [])]
    .filter((option) => parameter.description?.includes(option.value));
}

export function cangyuanVideoParameterDescription(parameter: CangyuanVideoParameterSpec): string | undefined {
  const curated = PARAMETER_HELP[parameter.name];
  if (curated) return curated;
  let description = parameter.description?.trim() || '';
  if (!description) return `该字段尚无经核实的中文说明，请按官方文档确认用途、可选值和限制后再填写。官方字段名：${parameter.name}`;
  const prefix = `${parameter.name}`;
  if (description.startsWith(prefix)) {
    description = description.slice(prefix.length).replace(/^[。.:：\s]+/u, '').trim();
  }
  if (!description) return `该字段尚无经核实的中文说明，请按官方文档确认用途、可选值和限制后再填写。官方字段名：${parameter.name}`;
  if (!/[\u3400-\u9fff]/u.test(description)) {
    return `官方说明尚未完成中文核实，请按官方文档确认字段含义、可选值和全部限制后再填写。官方原文：${description}`;
  }
  return description;
}

export function cangyuanVideoModelConstraintNotes(spec: CangyuanVideoModelSpec): Array<{ title: string; items: string[] }> {
  return (spec.sections || []).flatMap((section) => {
    const items = (section.items || []).map(localizeVideoConstraint).filter((item): item is string => Boolean(item));
    if (!items.length) return [];
    return [{
      title: section.title === '参数组合与素材要求' ? '素材与参数限制' : `官方补充说明（标题待核实：${section.title || '未命名'}）`,
      items: [...new Set(items)],
    }];
  });
}

function localizeVideoConstraint(item: string): string {
  const normalized = item.trim();
  if (!normalized) return '';
  if (normalized === '首尾帧须成对提供。') return '首帧与尾帧必须同时提供。';
  if (normalized === '首尾帧不能与参考图、参考视频或参考音频同时使用。') return '首尾帧模式与参考图、参考视频、参考音频互斥，不能同时使用。';
  if (normalized === '可以只提供首帧；提供尾帧时必须同时提供首帧。') return '可以只提供首帧；若提供尾帧，必须同时提供首帧。';
  if (normalized === '需要提供参考素材；编辑请求请同时提供参考图。') return '此型号需要参考素材；使用编辑模式时还需提供参考图片。';

  const unsupportedResolution = normalized.match(/^resolution\s*不支持\s*(.+?)。?$/iu);
  if (unsupportedResolution) {
    const values = [...new Set(unsupportedResolution[1].split('/').map((value) => value.trim().toUpperCase()).filter(Boolean))];
    return values.length ? `不支持以下画面清晰度：${values.join('、')}。` : '';
  }

  const unsupportedDurations = normalized.match(/^当\s*resolution\s*=\s*(\d+p)\s*时，\s*duration\s*不支持\s*(.+?)。?$/iu);
  if (unsupportedDurations) {
    const resolution = unsupportedDurations[1].toLowerCase();
    const durations = unsupportedDurations[2].split('/').map((value) => Number(value.trim())).filter(Number.isInteger).sort((a, b) => a - b);
    if (durations.length > 1 && durations.every((value, index) => index === 0 || value === durations[index - 1] + 1)) {
      return `画面清晰度选择 ${resolution} 时，视频时长不能设为 ${durations[0]}–${durations[durations.length - 1]} 秒（含首尾）。`;
    }
    if (durations.length) return `画面清晰度选择 ${resolution} 时，不支持 ${durations.join('、')} 秒的视频时长。`;
  }

  if (/当\s*resolution\s*=\s*1080p\s*时，\s*resolution\s*不支持\s*1080p/iu.test(normalized)) {
    return '官方限制说明存在冲突：文档称清晰度选择 1080P 时又不支持 1080P，请按厂商官方说明核实后使用。';
  }

  return /[a-z]{3,}|_[a-z]+|\/[a-z]{2,}/iu.test(normalized)
    ? `官方限制说明待中文核实：${normalized}`
    : normalized;
}
