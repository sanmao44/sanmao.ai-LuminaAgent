'use client';

import { useMemo } from 'react';
import SelectMenu from '@/components/SelectMenu';
import type { SpeechAdvancedOptions as SpeechAdvancedOptionsValue, SpeechDialogueLine, SpeechModelProfile } from '@/packages/contracts/audio-synthesis';

export type SpeechAdvancedDraft = Omit<SpeechAdvancedOptionsValue, 'dialogue'> & { dialogue?: SpeechDialogueLine[]; dialogueText?: string };

const SPEECH_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  auto: '自动识别', zh: '中文', en: '英语', ja: '日语', ko: '韩语', de: '德语', fr: '法语',
  es: '西班牙语', it: '意大利语', pt: '葡萄牙语', pl: '波兰语', uk: '乌克兰语', tr: '土耳其语', ru: '俄语',
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
};

export default function SpeechAdvancedOptions({ profile, value, onChange, disabled = false, compact = false }: Props) {
  const dialogueText = value.dialogueText ?? dialogueDraftFromValue(value.dialogue);
  const dialogueError = speechDialogueDraftError(dialogueText);
  const update = (patch: Partial<SpeechAdvancedDraft>) => onChange({ ...value, ...patch });
  const languageOptions = useMemo(() => [
    ...(profile.languageCodes || []).map((code) => ({ value: code, label: SPEECH_LANGUAGE_LABELS[code] || code })),
  ], [profile.languageCodes]);
  if (!profile.supportsAdvancedControls && !profile.supportsDialogue && !profile.supportsVoiceId) return null;

  return <details className="cangyuan-speech-advanced" open={!compact}>
    <summary>更多语音设置</summary>
    <div className="cangyuan-speech-advanced-grid">
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
      {profile.supportsVoiceId && <label className="cangyuan-speech-field">
        <span>{profile.requiresVoiceId ? '已登记音色编号（必填）' : '自备音色编号（可选）'}</span>
        <input value={value.voiceId ?? ''} disabled={disabled} placeholder="粘贴登记音色返回的编号" onChange={(event) => update({ voiceId: event.target.value || undefined })} />
      </label>}
      {profile.publicModel === 'elevenlabs-v4-tts' && <>
        <div className="cangyuan-speech-field"><span>语音引擎</span><SelectMenu value={value.engine ?? ''} ariaLabel="语音引擎" options={[{ value: '', label: '标准 v4（默认）' }, ...(profile.engineOptions || []).map((engine) => ({ value: engine, label: engine === 'turbo' ? '加速模式 Turbo' : '标准模式 v4' }))]} onChange={(next) => update({ engine: next || undefined })} /><small>加速模式约为标准模式的一半价格。</small></div>
        <div className="cangyuan-speech-field"><span>数字与日期读法</span><SelectMenu value={value.applyTextNormalization ?? ''} ariaLabel="数字与日期读法" options={[{ value: '', label: '自动' }, { value: 'auto', label: '自动' }, { value: 'on', label: '按规范读出' }, { value: 'off', label: '保留原样' }]} onChange={(next) => update({ applyTextNormalization: next ? next as SpeechAdvancedDraft['applyTextNormalization'] : undefined })} /></div>
        <div className="cangyuan-speech-field"><span>朗读语言</span><SelectMenu value={value.languageCode ?? ''} ariaLabel="朗读语言" options={languageOptions} onChange={(next) => update({ languageCode: next || undefined })} /></div>
      </>}
      {profile.publicModel === 'voice-clone-tts' && <>
        <div className="cangyuan-speech-field"><span>声音引擎</span><SelectMenu value={value.engine ?? ''} ariaLabel="克隆声音引擎" options={[{ value: '', label: '通义千问 3（默认）' }, ...(profile.engineOptions || []).map((engine) => ({ value: engine, label: ({ qwen3: '通义千问 3', chatterbox: 'Chatterbox', 'minimax-speech-02-hd': 'MiniMax 02 高清', 'minimax-speech-02-turbo': 'MiniMax 02 加速', 'minimax-speech-2.6-hd': 'MiniMax 2.6 高清', 'minimax-speech-2.6-turbo': 'MiniMax 2.6 加速', 'minimax-speech-2.8-hd': 'MiniMax 2.8 高清', 'minimax-speech-2.8-turbo': 'MiniMax 2.8 加速', 'elevenlabs-v4': 'ElevenLabs v4', 'elevenlabs-v4-turbo': 'ElevenLabs v4 加速' } as Record<string, string>)[engine] || engine }))]} onChange={(next) => update({ engine: next || undefined })} /><small>生成价格随引擎变化；语言和格式不会改变价格。</small></div>
        <div className="cangyuan-speech-field"><span>语言</span><SelectMenu value={value.language ?? ''} ariaLabel="克隆音色语言" options={languageOptions} onChange={(next) => update({ language: next || undefined })} /></div>
        <div className="cangyuan-speech-field"><span>情绪</span><SelectMenu value={value.emotion ?? ''} ariaLabel="克隆音色情绪" options={[{ value: '', label: '由正文自动判断' }, ...((profile.emotionOptions || []).map((emotion) => ({ value: emotion, label: ({ neutral: '自然', happy: '开心', sad: '悲伤', angry: '生气', fearful: '害怕', disgusted: '厌恶', surprised: '惊讶' } as Record<string, string>)[emotion] || emotion })))]} onChange={(next) => update({ emotion: next || undefined })} /></div>
        <label className="cangyuan-speech-field"><span>语气说明</span><input value={value.instruct ?? ''} disabled={disabled} placeholder="例如：平静、温柔、坚定" onChange={(event) => update({ instruct: event.target.value || undefined })} /></label>
      </>}
      {profile.publicModel === 'elevenlabs-dialogue' && <label className="cangyuan-speech-field"><span>稳定度</span><input type="number" min={0} max={1} step={0.05} value={value.stability ?? ''} disabled={disabled} placeholder="0–1，留空使用默认" onChange={(event) => update({ stability: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
      {(profile.publicModel === 'elevenlabs-v4-tts' || profile.publicModel === 'voice-clone-tts') && <>
        <label className="cangyuan-speech-field"><span>随机种子（可选）</span><input type="number" min={0} step="any" value={value.seed ?? ''} disabled={disabled} placeholder="留空则不固定" onChange={(event) => update({ seed: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>大于或等于 0；相同正文和种子可尽量复现。</small></label>
        <label className="cangyuan-speech-field"><span>音色相似度</span><input type="number" min={0} max={1} step={0.05} value={value.similarityBoost ?? ''} disabled={disabled} placeholder={profile.publicModel === 'voice-clone-tts' ? '留空使用官方默认值 0.75' : '0–1，留空使用服务默认'} onChange={(event) => update({ similarityBoost: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>0–1；声音克隆默认 0.75。</small></label>
        <label className="cangyuan-speech-field"><span>稳定度</span><input type="number" min={0} max={1} step={0.05} value={value.stability ?? ''} disabled={disabled} placeholder={profile.publicModel === 'voice-clone-tts' ? '留空使用官方默认值 0.5' : '0–1，留空使用服务默认'} onChange={(event) => update({ stability: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>0–1；声音克隆默认 0.5。</small></label>
      </>}
    </div>
  </details>;
}
