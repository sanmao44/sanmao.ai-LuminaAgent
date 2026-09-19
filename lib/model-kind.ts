import type { ModelCapability, ModelKind } from './types';

export type ModelKindSignals = {
  rawId?: string;
  displayName?: string;
  capabilities?: ModelCapability[];
};

/**
 * Known image-edit model families require a source image and must not be
 * offered as pure text-to-image models.
 */
export function isImageEditOnlyModel({ rawId = '', displayName = '' }: ModelKindSignals) {
  const text = `${rawId} ${displayName}`.toLowerCase();
  return /\bimage[-_ ]?edit\b/.test(text);
}

/**
 * 语音合成（TTS）模型家族的命名差异很大：tts-1 / GLM-TTS / Qwen3-TTS 走 -tts 后缀，
 * 而 ChatTTS、IndexTTS、TeleTTS、VoxCPM、AudioFly、FunAudioLLM/CosyVoice2 这类
 * 把关键词黏在词尾或带厂商路径前缀。原来的「必须用分隔符」写法会漏掉一半，
 * 结果是模型库里明明有配音模型，克隆弹窗的配音下拉框却是空的。
 */
const SPEECH_MODEL_PATTERN = /(?:^|[-_.\/\s+:])(?:tts|text[-_ ]?to[-_ ]?speech|speech[-_ ]?(?:synth|synthesis|model|generation|v\d)|speech|cosyvoice|elevenlabs|fish[-_ ]?speech|mimo[-_ ]?(?:tts|audio)|audio[-_ ]?speech|sovits|vits|xtts|melo[-_ ]?tts|index[-_ ]?tts|chat[-_ ]?tts|tele[-_ ]?tts|spark[-_ ]?tts|kitten[-_ ]?tts|voxcpm|mega[-_ ]?tts|f5[-_ ]?tts|qwen[-_ ]?tts|hunyuan[-_ ]?tts|kokoro|orpheus|higgs[-_ ]?audio|audiofly|vibevoice)/;
/** 转写 / 实时语音这类模型虽然带 audio、speech 字样，但不是配音模型，必须排除。 */
const SPEECH_HOST_PATTERN = /whisper|transcri|\basr\b|\bstt\b|realtime|audio[-_ ]?preview|speech[-_ ]?to[-_ ]?text|sense[-_ ]?voice/;

/**
 * 视频模型家族。原来的 \b…\b 写法在带版本号后缀时会失效：
 * veo3 / hailuo02 / Wan2.2 / ViduQ3 都因为「词边界后直接跟数字」而漏判，
 * 结果这些视频模型被归成对话模型，克隆出片的「图生视频」下拉里选不到它们。
 */
const VIDEO_FAMILY_PATTERN = /(?:^|[^a-z0-9])(?:video|sora|veo|seedance|kling|hailuo|runway|wan|minimax[-_ ]?video|hunyuan[-_ ]?video|cogvideo|mochi|ltx|pixverse|vidu[a-z]?|lumalabs?|pika|omnihuman|infinite[-_ ]?talk)(?![a-z_])|text[-_ ]?to[-_ ]?video|image[-_ ]?to[-_ ]?video|(?:t2v|i2v)(?:[-_.]|$)/;

/**
 * 明确不是对话模型的家族：向量、重排、OCR、内容审核、语音转写与识别。
 * 只用来把它们标成「未分类」，不参与任何生成任务。
 */
const NON_CONVERSATIONAL_PATTERN = /embedding|embed[-_ ]?model|reranker|rerank|ocr(?![a-z])|moderation|classifier|whisper|transcri|asr(?![a-z])|sense[-_ ]?voice|resnet|yolo|clip[-_ ]?vit|bge[-_]|jina[-_ ]?(?:clip|embedding)/;

/** 判断这个模型是不是「非生成类」（向量、OCR、ASR 等），不该出现在对话/生成下拉里。 */
export function isNonConversationalModelId(value: unknown) {
  return NON_CONVERSATIONAL_PATTERN.test(String(value ?? '').toLowerCase());
}

/** 判断一个模型 id / 展示名是不是「念台词」的配音模型。 */
export function isSpeechModelId(value: unknown) {
  const text = String(value ?? '').toLowerCase();
  return SPEECH_MODEL_PATTERN.test(text) && !SPEECH_HOST_PATTERN.test(text);
}

/**
 * Infer the primary model category from provider metadata and common model
 * family names. This is deliberately conservative: embeddings, speech and
 * other models without a recognizable generation/chat signal stay unknown.
 */
export function inferModelKind({ rawId = '', displayName = '', capabilities = [] }: ModelKindSignals): ModelKind {
  const text = `${rawId} ${displayName}`.toLowerCase();
  if (isSpeechModelId(text)) return 'audio';
  if (capabilities.some((capability) => capability.startsWith('video-')) || VIDEO_FAMILY_PATTERN.test(text)) return 'video';
  // 向量 / 重排 / OCR / 语音转写这类模型命中对话家族关键词（qwen3-embedding 里有 qwen），
  // 不先拦掉就会一股脑塞进「对话模型」下拉，把真正能聊天的模型淹掉。
  if (isNonConversationalModelId(text)) return 'unknown';
  if (capabilities.includes('generate') || capabilities.includes('upscale') || /image|imagen|flux|sdxl|stable[-_ ]?diffusion|dall[-_ ]?e|ideogram|recraft|seedream|nano[-_ ]?banana|pixart|kolors|midjourney|upscal|super[-_ ]?resolution|real[-_ ]?esrgan|swinir/.test(text)) return 'image';
  const chatFamily = /(?:gpt|codex|gemini|claude|deepseek|qwen|llama|mistral|glm|kimi|command[-_ ]?r|o[134](?:[-_.]|$)|sonar|perplexity|intern|step[-_.]?\d|(?:hiy|hy)\d*|hunyuan|chatglm|yi|baichuan|minimax|longcat|ernie|doubao|phi|gemma|nemotron|jamba|cohere|aya|llava|pixtral|granite|smollm|falcon|wizardlm|agnes(?:[-_.]|$))/.test(text);
  const chatRole = /\b(?:instruct|instruction|chat|thinking|reasoning|coder|assistant)\b/.test(text);
  if (capabilities.includes('chat') || chatFamily || chatRole) return 'chat';
  return 'unknown';
}

/**
 * Resolve a model's primary category without overwriting a user's choice.
 *
 * The registry may report capabilities that overlap (for example, a model can
 * expose both chat and image endpoints). Once a category has been selected in
 * the model library, that explicit value must remain authoritative. Inference
 * is only used for newly discovered/unclassified models.
 */
export function resolveModelKind(
  selectedKind: ModelKind,
  inferredKind: ModelKind,
  capabilities: ModelCapability[],
): ModelKind {
  if (selectedKind !== 'unknown') return selectedKind;
  if (capabilities.includes('speech')) return 'audio';
  if (capabilities.some((capability) => capability.startsWith('video-'))) return 'video';
  if (inferredKind !== 'unknown') return inferredKind;
  if (capabilities.includes('generate') || capabilities.includes('upscale')) return 'image';
  if (capabilities.includes('chat')) return 'chat';
  return 'unknown';
}
