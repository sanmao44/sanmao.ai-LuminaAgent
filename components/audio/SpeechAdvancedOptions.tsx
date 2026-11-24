'use client';

import { useMemo } from 'react';
import SelectMenu from '@/components/SelectMenu';
import MiniMaxVoicePicker from '@/components/audio/MiniMaxVoicePicker';
import SpeechVoiceRegistration from '@/components/audio/SpeechVoiceRegistration';
import type { SpeechAdvancedOptions as SpeechAdvancedOptionsValue, SpeechDialogueLine, SpeechModelProfile, SpeechOutputFormat } from '@/packages/contracts/audio-synthesis';

export type SpeechAdvancedDraft = Omit<SpeechAdvancedOptionsValue, 'dialogue'> & { dialogue?: SpeechDialogueLine[]; dialogueText?: string };

const SPEECH_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  auto: '自动识别', zh: '中文', en: '英语', ja: '日语', ko: '韩语', de: '德语', fr: '法语',
  es: '西班牙语', it: '意大利语', pt: '葡萄牙语', pl: '波兰语', uk: '乌克兰语', tr: '土耳其语', ru: '俄语',
};

const MINIMAX_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  auto: '自动识别', Chinese: '中文', 'Chinese,Yue': '粤语', English: '英语', Japanese: '日语', Korean: '韩语',
  Spanish: '西班牙语', French: '法语', German: '德语', Italian: '意大利语', Portuguese: '葡萄牙语', Russian: '俄语',
  Arabic: '阿拉伯语', Turkish: '土耳其语', Dutch: '荷兰语', Ukrainian: '乌克兰语', Vietnamese: '越南语',
  Indonesian: '印度尼西亚语', Thai: '泰语', Polish: '波兰语', Romanian: '罗马尼亚语', Greek: '希腊语', Czech: '捷克语',
  Finnish: '芬兰语', Hindi: '印地语', Bulgarian: '保加利亚语', Danish: '丹麦语', Hebrew: '希伯来语', Malay: '马来语',
  Persian: '波斯语', Slovak: '斯洛伐克语', Swedish: '瑞典语', Croatian: '克罗地亚语', Filipino: '菲律宾语',
  Hungarian: '匈牙利语', Norwegian: '挪威语', Slovenian: '斯洛文尼亚语', Catalan: '加泰罗尼亚语',
  Nynorsk: '新挪威语', Tamil: '泰米尔语', Afrikaans: '南非荷兰语',
};

const MINIMAX_EMOTION_LABELS: Readonly<Record<string, string>> = {
  happy: '开心', sad: '悲伤', angry: '生气', fearful: '害怕', disgusted: '厌恶',
  surprised: '惊讶', calm: '平静', fluent: '流畅表达', whisper: '耳语',
};

export function parseSpeechDialogueDraft(value: string): SpeechDialogueLine[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('|');
    if (separator < 1) return null;
    const voice = line.slice(0, separator).trim();
    const text = line.slice(separator + 1).trim();
    return voice && text ? { voice, text } : null;
  }).filter((line): line is SpeechDialogueLine => Boolean(line));
}

export function speechDialogueDraftError(value: string): string | null {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 50) return '最多填写 50 句对白。';
  if (parseSpeechDialogueDraft(value).length !== lines.length) return '每行都需按“音色 | 台词”填写完整。';
  return null;
}

function dialogueDraftFromValue(lines: readonly SpeechDialogueLine[] | undefined) {
  return lines?.map((line) => `${line.voice} | ${line.text}`).join('\n') || '';
}

type Props = {
  profile: SpeechModelProfile;
  value: SpeechAdvancedDraft;
  onChange: (value: SpeechAdvancedDraft) => void;
  disabled?: boolean;
  compact?: boolean;
  alwaysVisible?: boolean;
  modelId?: string;
  format?: SpeechOutputFormat;
};

export default function SpeechAdvancedOptions({ profile, value, onChange, disabled = false, compact = false, alwaysVisible = false, modelId, format }: Props) {
  const dialogueText = value.dialogueText ?? dialogueDraftFromValue(value.dialogue);
  const dialogueError = speechDialogueDraftError(dialogueText);
  const update = (patch: Partial<SpeechAdvancedDraft>) => onChange({ ...value, ...patch });
  const isMiniMaxSpeech = profile.publicModel === 'minimax-speech-2.8-hd-tts' || profile.publicModel === 'minimax-speech-2.8-turbo-tts';
  const languageOptions = useMemo(() => [
    ...(profile.languageCodes || []).map((code) => ({ value: code, label: SPEECH_LANGUAGE_LABELS[code] || code })),
  ], [profile.languageCodes]);
  const miniMaxLanguageOptions = useMemo(() => [
    ...(profile.languageCodes || []).map((code) => ({ value: code, label: MINIMAX_LANGUAGE_LABELS[code] || code })),
  ], [profile.languageCodes]);
  if (!profile.supportsAdvancedControls && !profile.supportsDialogue && !profile.supportsVoiceId) return null;

  const fields = <div className={`cangyuan-speech-advanced-grid${compact ? ' is-compact' : ''}`}>
      {profile.supportsDialogue && <label className="cangyuan-speech-field cangyuan-speech-dialogue-field">
        <span>多人对白</span>
        <textarea
          rows={5}
          value={dialogueText}
          disabled={disabled}
          placeholder="每行一条对白，格式：音色 | 台词\n例如：Rachel | 你好，欢迎回来。"
          onChange={(event) => {
            const nextText = event.target.value;
            update({ dialogueText: nextText, dialogue: parseSpeechDialogueDraft(nextText) });
          }}
        />
        <small>1–50 句；每行按“音色 | 台词”填写。</small>
        {dialogueError && <small role="alert">{dialogueError}</small>}
        <small role="note">官方目录的字段类型与逐句说明冲突；当前按说明中的结构化对白提交，接口行为尚未由官方调试示例确认。</small>
      </label>}
      {profile.supportsVoiceId && <>
        <label className="cangyuan-speech-field">
        <span>{isMiniMaxSpeech ? '音色' : profile.requiresVoiceId ? '已登记音色编号（必填）' : '自备音色编号（可选）'}</span>
        {isMiniMaxSpeech
          ? <MiniMaxVoicePicker model={profile.publicModel} providerKey={profile.providerKey} value={value.voiceId ?? ''} onChange={(voiceId) => update({ voiceId: voiceId || undefined })} disabled={disabled} />
          : <input value={value.voiceId ?? ''} disabled={disabled} placeholder="粘贴登记音色返回的编号" onChange={(event) => update({ voiceId: event.target.value || undefined })} />}
        </label>
        {isMiniMaxSpeech && <small className="cangyuan-mini-voice-note">系统音色无需登记；克隆音色可在下方管理。<a href="https://ai.cangyuansuanli.cn/docs/chapters/minimax-speech" target="_blank" rel="noreferrer">查看官方音色列表与说明</a></small>}
      </>}
      {profile.supportsVoiceId && <SpeechVoiceRegistration profile={profile} modelId={modelId} value={value.voiceId ?? ''} onChange={(voiceId) => update({ voiceId: voiceId || undefined })} disabled={disabled} />}
      {profile.publicModel === 'elevenlabs-v4-tts' && <>
        <div className="cangyuan-speech-field"><span>语音引擎</span><SelectMenu value={value.engine ?? ''} ariaLabel="语音引擎" options={[{ value: '', label: '标准 v4（默认）' }, ...(profile.engineOptions || []).map((engine) => ({ value: engine, label: engine === 'turbo' ? '加速模式 Turbo' : '标准模式 v4' }))]} onChange={(next) => update({ engine: next || undefined })} /><small>加速模式约为标准模式的一半价格。</small></div>
        <div className="cangyuan-speech-field"><span>数字与日期读法</span><SelectMenu value={value.applyTextNormalization ?? ''} ariaLabel="数字与日期读法" options={[{ value: '', label: '自动' }, { value: 'auto', label: '自动' }, { value: 'on', label: '按规范读出' }, { value: 'off', label: '保留原样' }]} onChange={(next) => update({ applyTextNormalization: next ? next as SpeechAdvancedDraft['applyTextNormalization'] : undefined })} /></div>
        <div className="cangyuan-speech-field"><span>朗读语言</span><SelectMenu value={value.languageCode ?? ''} ariaLabel="朗读语言" options={languageOptions} onChange={(next) => update({ languageCode: next || undefined })} /></div>
      </>}
      {profile.publicModel === 'voice-clone-tts' && <>
        <div className="cangyuan-speech-field"><span>声音引擎</span><SelectMenu value={value.engine ?? ''} ariaLabel="克隆声音引擎" options={[{ value: '', label: '通义千问 3（默认）' }, ...(profile.engineOptions || []).map((engine) => ({ value: engine, label: ({ qwen3: '通义千问 3', chatterbox: 'Chatterbox', 'elevenlabs-v4': 'ElevenLabs v4', 'elevenlabs-v4-turbo': 'ElevenLabs v4 加速' } as Record<string, string>)[engine] || engine }))]} onChange={(next) => update({ engine: next || undefined })} /><small>{/^elevenlabs-v4(?:-turbo)?$/.test(value.engine || '') ? '生成价格随引擎变化；语言和格式不会改变价格。' : '当前引擎使用原始语速，接口暂不接受语速调整。'}</small></div>
        {/^elevenlabs-v4(?:-turbo)?$/.test(value.engine || '') && <small className="cangyuan-mini-voice-note">ElevenLabs 引擎需要其兼容的已登记音色；普通克隆音色请使用通义千问 3 或 Chatterbox。</small>}
        <div className="cangyuan-speech-field"><span>语言</span><SelectMenu value={value.language ?? ''} ariaLabel="克隆音色语言" options={languageOptions} onChange={(next) => update({ language: next || undefined })} /></div>
        <div className="cangyuan-speech-field"><span>情绪</span><SelectMenu value={value.emotion ?? ''} ariaLabel="克隆音色情绪" options={[{ value: '', label: '由正文自动判断' }, ...((profile.emotionOptions || []).map((emotion) => ({ value: emotion, label: ({ neutral: '自然', happy: '开心', sad: '悲伤', angry: '生气', fearful: '害怕', disgusted: '厌恶', surprised: '惊讶' } as Record<string, string>)[emotion] || emotion })))]} onChange={(next) => update({ emotion: next || undefined })} /></div>
        <label className="cangyuan-speech-field"><span>语气说明</span><input value={value.instruct ?? ''} disabled={disabled} placeholder="例如：平静、温柔、坚定" onChange={(event) => update({ instruct: event.target.value || undefined })} /></label>
      </>}
      {(profile.publicModel === 'minimax-speech-2.8-hd-tts' || profile.publicModel === 'minimax-speech-2.8-turbo-tts') && <>
        <div className="cangyuan-speech-field"><span>生成水印</span><SelectMenu value={value.aigcWatermark === undefined ? '' : String(value.aigcWatermark)} ariaLabel="生成水印" options={[{ value: '', label: '使用服务默认' }, { value: 'true', label: '开启' }, { value: 'false', label: '关闭' }]} onChange={(next) => update({ aigcWatermark: next === '' ? undefined : next === 'true' })} /></div>
        <div className="cangyuan-speech-field"><span>MP3 比特率</span><SelectMenu value={format === 'mp3' ? value.bitrate ?? '' : ''} ariaLabel="MP3 比特率" options={[{ value: '', label: '使用服务默认' }, { value: '32000', label: '32 kbps' }, { value: '64000', label: '64 kbps' }, { value: '128000', label: '128 kbps' }, { value: '256000', label: '256 kbps' }]} onChange={(next) => update({ bitrate: (next || undefined) as SpeechAdvancedDraft['bitrate'] })} disabled={disabled || format !== 'mp3'} /><small>{format && format !== 'mp3' ? '当前格式不支持比特率；切回 MP3 后可设置。' : '仅 MP3 格式生效。'}</small></div>
        <div className="cangyuan-speech-field"><span>声道</span><SelectMenu value={value.channel ?? ''} ariaLabel="声道" options={[{ value: '', label: '使用服务默认' }, { value: '1', label: '单声道' }, { value: '2', label: '双声道' }]} onChange={(next) => update({ channel: (next || undefined) as SpeechAdvancedDraft['channel'] })} /></div>
        <label className="cangyuan-speech-field"><span>力度效果</span><input type="number" min={-100} max={100} step={1} value={value.effectIntensity ?? ''} disabled={disabled} placeholder="-100 到 100" onChange={(event) => update({ effectIntensity: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>负值更刚劲，正值更柔和。</small></label>
        <label className="cangyuan-speech-field"><span>音高效果</span><input type="number" min={-100} max={100} step={1} value={value.effectPitch ?? ''} disabled={disabled} placeholder="-100 到 100" onChange={(event) => update({ effectPitch: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>负值更低沉，正值更明亮。</small></label>
        <label className="cangyuan-speech-field"><span>音色效果</span><input type="number" min={-100} max={100} step={1} value={value.effectTimbre ?? ''} disabled={disabled} placeholder="-100 到 100" onChange={(event) => update({ effectTimbre: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>负值更浑厚，正值更清脆。</small></label>
        <div className="cangyuan-speech-field"><span>表达情绪</span><SelectMenu value={value.emotion ?? ''} ariaLabel="表达情绪" options={[{ value: '', label: '由正文自动判断' }, ...((profile.emotionOptions || []).map((emotion) => ({ value: emotion, label: MINIMAX_EMOTION_LABELS[emotion] || emotion })))]} onChange={(next) => update({ emotion: next || undefined })} /></div>
        <div className="cangyuan-speech-field"><span>朗读语言</span><SelectMenu value={value.language ?? ''} ariaLabel="MiniMax 朗读语言" options={miniMaxLanguageOptions} onChange={(next) => update({ language: next || undefined })} /></div>
        <div className="cangyuan-speech-field"><span>公式朗读</span><SelectMenu value={value.latexRead === undefined ? '' : String(value.latexRead)} ariaLabel="公式朗读" options={[{ value: '', label: '使用服务默认' }, { value: 'true', label: '朗读公式' }, { value: 'false', label: '跳过公式' }]} onChange={(next) => update({ latexRead: next === '' ? undefined : next === 'true' })} /></div>
        <label className="cangyuan-speech-field"><span>音高</span><input type="number" min={-12} max={12} step={1} value={value.pitch ?? ''} disabled={disabled} placeholder="-12 到 12" onChange={(event) => update({ pitch: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        <label className="cangyuan-speech-field"><span>发音标注</span><input value={value.pronunciationTone ?? ''} disabled={disabled} placeholder="按需填写发音提示" onChange={(event) => update({ pronunciationTone: event.target.value || undefined })} /><small>官方未限定填写格式。</small></label>
        <div className="cangyuan-speech-field"><span>采样率</span><SelectMenu value={value.sampleRate ?? ''} ariaLabel="采样率" options={[{ value: '', label: '使用服务默认（32 kHz）' }, ...(['8000', '16000', '22050', '24000', '32000', '44100'] as const).map((rate) => ({ value: rate, label: `${Number(rate) / 1000} kHz` }))]} onChange={(next) => update({ sampleRate: (next || undefined) as SpeechAdvancedDraft['sampleRate'] })} /></div>
        <div className="cangyuan-speech-field"><span>声音效果</span><SelectMenu value={value.soundEffects ?? ''} ariaLabel="声音效果" options={[{ value: '', label: '不添加效果' }, { value: 'spacious_echo', label: '空间混响' }, { value: 'auditorium_echo', label: '礼堂混响' }, { value: 'lofi_telephone', label: '电话音质' }, { value: 'robotic', label: '机器人音效' }]} onChange={(next) => update({ soundEffects: (next || undefined) as SpeechAdvancedDraft['soundEffects'] })} /></div>
        <div className="cangyuan-speech-field"><span>文本规范化方式</span><SelectMenu value={value.textNormalizationMode ?? ''} ariaLabel="文本规范化方式" options={[{ value: '', label: '使用服务默认' }, { value: 'basic', label: '基础模式（更快）' }, { value: 'quality', label: '高质量模式（更准确，较慢）' }]} onChange={(next) => update({ textNormalizationMode: (next || undefined) as SpeechAdvancedDraft['textNormalizationMode'] })} /></div>
        <label className="cangyuan-speech-field"><span>音量</span><input type="number" min={0.01} max={10} step={0.1} value={value.volume ?? ''} disabled={disabled} placeholder="0.01 到 10，默认 1" onChange={(event) => update({ volume: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      </>}
      {profile.publicModel === 'elevenlabs-dialogue' && <label className="cangyuan-speech-field"><span>稳定度</span><input type="number" min={0} max={1} step={0.05} value={value.stability ?? ''} disabled={disabled} placeholder="0–1，留空使用默认" onChange={(event) => update({ stability: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
      {(profile.publicModel === 'elevenlabs-v4-tts' || profile.publicModel === 'voice-clone-tts') && <>
        <label className="cangyuan-speech-field"><span>随机种子（可选）</span><input type="number" min={0} step={1} value={value.seed ?? ''} disabled={disabled} placeholder="留空则不固定" onChange={(event) => update({ seed: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>大于或等于 0 的整数；相同正文和种子可尽量复现。</small></label>
        <label className="cangyuan-speech-field"><span>音色相似度</span><input type="number" min={0} max={1} step={0.05} value={value.similarityBoost ?? ''} disabled={disabled} placeholder={profile.publicModel === 'voice-clone-tts' ? '留空使用官方默认值 0.75' : '0–1，留空使用服务默认'} onChange={(event) => update({ similarityBoost: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>0–1；声音克隆默认 0.75。</small></label>
        <label className="cangyuan-speech-field"><span>稳定度</span><input type="number" min={0} max={1} step={0.05} value={value.stability ?? ''} disabled={disabled} placeholder={profile.publicModel === 'voice-clone-tts' ? '留空使用官方默认值 0.5' : '0–1，留空使用服务默认'} onChange={(event) => update({ stability: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>0–1；声音克隆默认 0.5。</small></label>
      </>}
    </div>;

  if (alwaysVisible) return <section className="cangyuan-speech-advanced is-always-visible" aria-label="更多语音设置">
    <strong className="canvas-audio-settings-subheading">更多语音设置</strong>
    {fields}
  </section>;

  return <details className="cangyuan-speech-advanced" open={!compact}>
    <summary>更多语音设置</summary>
    {fields}
  </details>;
}
