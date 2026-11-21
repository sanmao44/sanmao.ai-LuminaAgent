'use client';

import { useEffect, useState } from 'react';
import type { CangyuanMusicModelProfile, CangyuanMusicOptions } from '@/packages/contracts/cangyuan-media';
import SelectMenu from '@/components/SelectMenu';
import CangyuanSuggestionInput from '@/components/cangyuan/CangyuanSuggestionInput';
import CangyuanMediaUploadField from '@/components/cangyuan/CangyuanMediaUploadField';
import './CangyuanMusicOptionsFields.css';

const NOTES = [
  { value: 'C', label: 'C' }, { value: 'C#', label: '升 C' }, { value: 'D', label: 'D' },
  { value: 'D#', label: '升 D' }, { value: 'E', label: 'E' }, { value: 'F', label: 'F' },
  { value: 'F#', label: '升 F' }, { value: 'G', label: 'G' }, { value: 'G#', label: '升 G' },
  { value: 'A', label: 'A' }, { value: 'A#', label: '升 A' }, { value: 'B', label: 'B' },
];
export const SFX_KEY_OPTIONS = [
  { value: 'Any', label: '任意调性' },
  ...NOTES.map(({ value, label }) => ({ value: `${value}m`, label: `${label} 小调` })),
  ...NOTES.map(({ value, label }) => ({ value, label: `${label} 大调` })),
];
const SUNO_VERSIONS = [
  { value: 'v6', label: '自然人声' },
  { value: 'v6-wild', label: '大胆明亮' },
  { value: 'v6-mini', label: '快速轻量' },
];
const VOCAL_TYPES = [{ value: 'f', label: '女声' }, { value: 'm', label: '男声' }];
const STEM_TYPES = [
  { value: 'separate_vocal', label: '分离人声与伴奏' },
  { value: 'split_stem', label: '拆分多个音轨' },
  { value: 'split_stem_advanced', label: '提取指定音轨' },
];
const PERSONA_MODEL_CUSTOM = '__custom_persona_model__';
const PERSONA_MODEL_PRESETS = ['style_persona', 'voice_persona'] as const;

type Props = {
  profile: CangyuanMusicModelProfile;
  options: CangyuanMusicOptions;
  onChange: (options: CangyuanMusicOptions) => void;
  onUploadStateChange?: (fieldId: string, uploading: boolean) => void;
  alwaysVisible?: boolean;
};

export function cangyuanMusicTaskKindName(profile: Pick<CangyuanMusicModelProfile, 'family'> | null | undefined) {
  return profile?.family === 'suno-sfx' || profile?.family === 'elevenlabs-sfx' ? '音效' : '音乐';
}

export default function CangyuanMusicOptionsFields({ profile, options, onChange, onUploadStateChange, alwaysVisible = false }: Props) {
  const supports = (key: keyof CangyuanMusicOptions) => profile.allowedOptions.includes(key);
  const update = (patch: Partial<CangyuanMusicOptions>) => onChange({ ...options, ...patch });
  const [customPersonaModelSelected, setCustomPersonaModelSelected] = useState(() =>
    Boolean(options.personaModel && !PERSONA_MODEL_PRESETS.includes(options.personaModel as typeof PERSONA_MODEL_PRESETS[number])));
  const customPersonaModel = customPersonaModelSelected
    || Boolean(options.personaModel && !PERSONA_MODEL_PRESETS.includes(options.personaModel as typeof PERSONA_MODEL_PRESETS[number]));

  useEffect(() => {
    setCustomPersonaModelSelected(Boolean(options.personaModel && !PERSONA_MODEL_PRESETS.includes(options.personaModel as typeof PERSONA_MODEL_PRESETS[number])));
  }, [profile.modelId]);
  const numberField = (label: string, key: 'audioWeight' | 'styleWeight' | 'weirdnessConstraint') => supports(key) && (
    profile.weightRange && <label className="cangyuan-music-range-field" key={key}>
      <span>{label}</span>
      <input
        type="range"
        min={profile.weightRange[0]}
        max={profile.weightRange[1]}
        step="0.01"
        value={options[key] ?? 0}
        onChange={(event) => update({ [key]: Number(event.target.value) })}
      />
      <output>{(options[key] ?? 0).toFixed(2)}</output>
    </label>
  );

  if (profile.family === 'su2') {
    return (
      <div className="cangyuan-music-options">
        {supports('instrumental') && (
          <label className="cangyuan-checkbox-field">
            <input type="checkbox" checked={options.instrumental ?? false} onChange={(event) => update({ instrumental: event.target.checked })} />
            <span>纯音乐</span>
          </label>
        )}
        <p className="cangyuan-model-note">SU2 使用提示词生成，单次固定生成 1 首；不支持歌词、风格、时长或参考音频参数。</p>
      </div>
    );
  }

  if (profile.family === 'lyria') {
    const durationRange = profile.durationRange;
    const bpmRange = profile.bpmRange;
    const seedRange = profile.seedRange;
    const tempoAndOutput = <div className="cangyuan-music-fields-grid">
      <label className="cangyuan-music-text-field"><span>节奏速度</span><input aria-label="节奏速度，每分钟节拍数" type="number" min={bpmRange?.[0]} max={bpmRange?.[1]} step="1" value={options.bpm ?? ''} onChange={(event) => update({ bpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={bpmRange ? `自动，或填写 ${bpmRange[0]}–${bpmRange[1]}` : '自动'} /><small>每分钟的节拍数，越大节奏越快。</small></label>
      <label className="cangyuan-music-text-field"><span>固定生成编号</span><input aria-label="固定生成编号" type="number" min={seedRange?.[0]} max={seedRange?.[1]} step="1" value={options.seed ?? ''} onChange={(event) => update({ seed: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="留空则每次不同" /><small>相同描述使用相同编号，便于生成接近的结果。</small></label>
      <div className="cangyuan-music-text-field"><span>保存格式</span><SelectMenu value={options.audio_format ?? ''} ariaLabel="音乐输出格式" className="cangyuan-field-select" menuClassName="cangyuan-field-select-menu" options={[{ value: '', label: '自动选择' }, { value: 'mp3', label: 'MP3 · 通用播放' }, { value: 'wav', label: 'WAV · 后期编辑' }, { value: 'm4a', label: 'M4A · 便于分享' }]} onChange={(value) => update({ audio_format: value ? value as CangyuanMusicOptions['audio_format'] : undefined })} /></div>
    </div>;
    return (
      <div className="cangyuan-music-options cangyuan-music-options-lyria">
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field"><span>曲名</span><input value={options.title ?? ''} maxLength={profile.titleMaxLength} onChange={(event) => update({ title: event.target.value || undefined })} placeholder={profile.titleMaxLength ? `可选，最多 ${profile.titleMaxLength} 字符` : '可选'} /></label>
          <label className="cangyuan-music-text-field"><span>目标时长（秒）</span><input type="number" min={durationRange?.[0]} max={durationRange?.[1]} step="1" value={options.duration ?? ''} onChange={(event) => update({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={durationRange ? `自动，或填写 ${durationRange[0]}–${durationRange[1]}` : '自动'} /></label>
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.instrumental ?? false} onChange={(event) => update({ instrumental: event.target.checked })} /><span>纯音乐</span></label>
        <label className="cangyuan-music-text-field"><span>歌词</span><textarea value={options.lyrics ?? ''} maxLength={profile.lyricsMaxLength} rows={5} onChange={(event) => update({ lyrics: event.target.value || undefined })} placeholder={profile.lyricsMaxLength ? `可选，最多 ${profile.lyricsMaxLength.toLocaleString('zh-CN')} 字符；与创作描述分开填写` : '可选；与创作描述分开填写'} /></label>
        {alwaysVisible ? <section className="cangyuan-music-advanced is-always-visible" aria-label="节奏与输出">
          <strong>节奏与输出</strong>
          {tempoAndOutput}
        </section> : <details className="cangyuan-music-advanced">
          <summary>节奏与输出</summary>
          {tempoAndOutput}
        </details>}
        <p className="cangyuan-model-note">每次生成 1 首；时长与节奏速度是目标提示，实际成片以结果为准。{profile.modelId === 'lyria-3-pro' ? 'Lyria 3 Pro 的成片最长约 184 秒。' : ''}</p>
      </div>
    );
  }

  if (profile.family === 'elevenlabs-music') {
    const durationOptions = profile.durationValues || [];
    const formatOptions = (profile.outputFormatSuggestions || []).map((value) => ({
      value,
      label: value === 'mp3_hq' ? 'MP3 高码率（更高费用）' : 'MP3（通用播放）',
    }));
    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          <div className="cangyuan-music-text-field">
            <span>目标时长</span>
            <SelectMenu value={options.duration === undefined ? '' : String(options.duration)} ariaLabel="音乐目标时长" className="cangyuan-field-select" menuClassName="cangyuan-field-select-menu" options={[{ value: '', label: `默认（${profile.durationDefault ?? 30} 秒）` }, ...durationOptions.map((duration) => ({ value: String(duration), label: `${duration} 秒` }))]} onChange={(value) => update({ duration: value ? Number(value) : undefined })} />
          </div>
          <label className="cangyuan-music-text-field">
            <span>随机种子</span>
            <input aria-label="音乐随机种子" type="number" min={profile.seedRange?.[0]} max={profile.seedRange?.[1]} step="1" value={options.seed ?? ''} onChange={(event) => update({ seed: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="留空则随机" />
          </label>
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.force_instrumental ?? false} onChange={(event) => update({ force_instrumental: event.target.checked })} /><span>只生成伴奏</span></label>
        <div className="cangyuan-music-text-field">
          <span>输出格式</span>
          <CangyuanSuggestionInput value={options.output_format ?? ''} ariaLabel="音乐输出格式" options={formatOptions} placeholder="默认 MP3，也可输入其他服务支持格式" onChange={(value) => update({ output_format: value || undefined })} />
          <small>高码率 MP3 会增加费用；一次任务可能返回多段音频。</small>
        </div>
        <p className="cangyuan-model-note">提示词最多 4000 字符。时长只支持 10、30、60、120 或 180 秒；未指定时默认 30 秒。</p>
      </div>
    );
  }

  if (profile.family === 'elevenlabs-sfx') {
    const durationRange = profile.durationRange;
    const formatOptions = (profile.outputFormatSuggestions || []).map((value) => ({
      value,
      label: value === 'mp3_hq' ? 'MP3 高码率' : 'MP3（通用播放）',
    }));
    const durationNote = profile.modelId === 'elevenlabs-sound-effects-v2'
      ? '时长 0.5–22 秒，默认 5 秒。'
      : '最长 30 秒，默认 5 秒。';
    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field">
            <span>音效时长（秒）</span>
            <input aria-label="音效时长" type="number" min={durationRange?.[0]} max={durationRange?.[1]} step={profile.durationInteger === false ? 'any' : '1'} value={options.duration ?? ''} onChange={(event) => update({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={`默认 ${profile.durationDefault ?? 5} 秒`} />
            <small>{durationNote}</small>
          </label>
          {profile.promptInfluenceRange && (
            <label className="cangyuan-music-text-field">
              <span>描述影响度</span>
              <input aria-label="描述影响度" type="number" min={profile.promptInfluenceRange[0]} max={profile.promptInfluenceRange[1]} step="0.01" value={options.prompt_influence ?? ''} onChange={(event) => update({ prompt_influence: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="默认约 0.3" />
              <small>范围 0–1；留空使用模型默认值。</small>
            </label>
          )}
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.loop ?? false} onChange={(event) => update({ loop: event.target.checked })} /><span>生成可循环音效</span></label>
        <div className="cangyuan-music-text-field">
          <span>输出格式</span>
          <CangyuanSuggestionInput value={options.output_format ?? ''} ariaLabel="音效输出格式" options={formatOptions} placeholder="默认 MP3，也可输入其他服务支持格式" onChange={(value) => update({ output_format: value || undefined })} />
          <small>MP3 与高码率 MP3 不改变价格；提示词最多 4000 字符。</small>
        </div>
        <p className="cangyuan-model-note">{profile.modelId === 'elevenlabs-sound-effects-v2' ? '短音效模型，不适合生成完整歌曲。' : '短音效模型，适合生成较长音效，不适合生成完整歌曲。'}</p>
      </div>
    );
  }

  if (profile.family === 'suno-sfx') {
    const soundTempoRange = profile.soundTempoRange;
    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field"><span>调性</span><CangyuanSuggestionInput ariaLabel="音效调性" value={options.sound_key ?? ''} onChange={(value) => update({ sound_key: value || undefined })} options={SFX_KEY_OPTIONS} placeholder="自动" /></label>
          <label className="cangyuan-music-text-field"><span>节奏速度（每分钟拍数{soundTempoRange ? `，${soundTempoRange[0]}–${soundTempoRange[1]}` : ''}）</span><input type="number" min={soundTempoRange?.[0]} max={soundTempoRange?.[1]} step="any" value={options.sound_tempo ?? ''} onChange={(event) => update({ sound_tempo: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>生成风格</span><CangyuanSuggestionInput ariaLabel="音效生成版本" value={options.version ?? ''} onChange={(value) => update({ version: value || undefined })} options={SUNO_VERSIONS} placeholder="自动选择，也可输入服务支持的版本" /></label>
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.sound_loop ?? false} onChange={(event) => update({ sound_loop: event.target.checked })} /><span>循环音效</span></label>
        <p className="cangyuan-model-note">一次请求 n=1；任务结果常返回两段音效。调性与版本可输入文档推荐项之外的服务端支持值。</p>
      </div>
    );
  }

  if (profile.family === 'suno-workflow') {
    const modelId = profile.modelId;
    const taskIdField = (label = '源作品任务编号') => (
      <label className="cangyuan-music-text-field" key="sourceTaskId">
        <span>{label}</span>
        <input maxLength={200} value={options.sourceTaskId ?? ''} onChange={(event) => update({ sourceTaskId: event.target.value || undefined, sourceAudioId: undefined, sourceTrack: undefined })} placeholder="粘贴结果卡中的任务编号" />
      </label>
    );
    const uploadUrlField = (label = '参考音频') => (
      <CangyuanMediaUploadField
        key="uploadUrl"
        fieldId={`cangyuan-music-${modelId}-uploadUrl`}
        kind="audio"
        label={label}
        value={options.uploadUrl ?? ''}
        onChange={(value) => update({ uploadUrl: value || undefined, ...(value ? { sourceTaskId: undefined, sourceAudioId: undefined, sourceTrack: undefined } : {}) })}
        onUploadingChange={onUploadStateChange}
      />
    );
    const secondsField = (label: string, key: 'continueAt' | 'infillStartS' | 'infillEndS') => (
      <label className="cangyuan-music-text-field" key={key}>
        <span>{label}（秒）</span>
        <input type="text" inputMode="decimal" value={options[key] ?? ''} onChange={(event) => update({ [key]: event.target.value || undefined })} />
      </label>
    );
    const updateUploadUrls = (index: 0 | 1, value: string) => {
      const urls: [string, string] = [options.uploadUrls?.[0] ?? '', options.uploadUrls?.[1] ?? ''];
      urls[index] = value;
      update({ uploadUrls: urls.some(Boolean) ? urls : undefined });
    };

    const hasAdvancedOptions = profile.allowedOptions.some((key) => [
      'sourceAudioId', 'sourceTrack', 'title', 'style_text', 'lyrics', 'instrumental', 'customMode', 'tags',
      'audioWeight', 'negativeTags', 'personaId', 'styleWeight', 'version', 'vocalGender', 'weirdnessConstraint',
    ].includes(key));

    const advancedFields = <>
        <div className="cangyuan-music-fields-grid">
          {supports('sourceAudioId') && (modelId !== 'suno-cover-audio' || !options.uploadUrl) && <label className="cangyuan-music-text-field"><span>指定结果曲目编号</span><input maxLength={200} value={options.sourceAudioId ?? ''} onChange={(event) => update({ sourceAudioId: event.target.value || undefined, sourceTrack: undefined })} placeholder="可从作品记录中复制" /><small>需同时提供源作品任务编号</small></label>}
          {supports('sourceTrack') && (modelId !== 'suno-cover-audio' || !options.uploadUrl) && <label className="cangyuan-music-text-field"><span>曲目序号（从 0 开始）</span><input type="number" min="0" max="11" step="1" value={options.sourceTrack ?? ''} onChange={(event) => update({ sourceTrack: event.target.value === '' ? undefined : Number(event.target.value), sourceAudioId: undefined })} placeholder="自动选择" /><small>需同时提供源作品任务编号</small></label>}
          {supports('title') && <label className="cangyuan-music-text-field"><span>曲名</span><input value={options.title ?? ''} maxLength={profile.titleMaxLength} onChange={(event) => update({ title: event.target.value || undefined })} placeholder={profile.titleMaxLength ? `可选，最多 ${profile.titleMaxLength} 字符` : '可选'} /></label>}
          {supports('style_text') && <label className="cangyuan-music-text-field"><span>音乐风格</span><textarea value={options.style_text ?? ''} maxLength={profile.styleTextMaxLength} rows={3} onChange={(event) => update({ style_text: event.target.value || undefined })} placeholder={profile.styleTextMaxLength ? `曲风、编曲、乐器与氛围，最多 ${profile.styleTextMaxLength} 字符` : '曲风、编曲、乐器与氛围'} /></label>}
          {supports('lyrics') && <label className="cangyuan-music-text-field"><span>完整歌词</span><textarea value={options.lyrics ?? ''} maxLength={profile.lyricsMaxLength} rows={5} onChange={(event) => update({ lyrics: event.target.value || undefined })} placeholder={profile.lyricsMaxLength ? `包含替换片段的完整歌词，最多 ${profile.lyricsMaxLength.toLocaleString('zh-CN')} 字符` : '包含替换片段的完整歌词'} /></label>}
          {supports('customMode') && <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.customMode ?? false} onChange={(event) => update({ customMode: event.target.checked })} /><span>自定义曲名与风格</span></label>}
          {supports('instrumental') && <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.instrumental ?? false} onChange={(event) => update({ instrumental: event.target.checked })} /><span>仅生成伴奏</span></label>}
          {supports('tags') && <label className="cangyuan-music-text-field"><span>风格标签</span><input value={options.tags ?? ''} onChange={(event) => update({ tags: event.target.value || undefined })} placeholder="例如：轻松、钢琴" /></label>}
          {supports('negativeTags') && <label className="cangyuan-music-text-field"><span>排除风格</span><input value={options.negativeTags ?? ''} onChange={(event) => update({ negativeTags: event.target.value || undefined })} placeholder="用逗号分隔不希望出现的风格" /></label>}
          {supports('personaId') && <label className="cangyuan-music-text-field"><span>复用音色方案编号</span><input value={options.personaId ?? ''} onChange={(event) => update({ personaId: event.target.value || undefined })} placeholder="可选" /></label>}
          {supports('version') && <div className="cangyuan-music-text-field"><span>生成风格</span><CangyuanSuggestionInput value={options.version ?? ''} ariaLabel="音乐生成版本" options={SUNO_VERSIONS} placeholder="自动选择" onChange={(value) => update({ version: value || undefined })} /></div>}
          {supports('vocalGender') && <div className="cangyuan-music-text-field"><span>人声类型</span><CangyuanSuggestionInput value={options.vocalGender ?? ''} ariaLabel="音乐人声类型" options={VOCAL_TYPES} placeholder="自动选择" onChange={(value) => update({ vocalGender: value || undefined })} /></div>}
        </div>
        <div className="cangyuan-music-ranges">
          {numberField('参考音频影响', 'audioWeight')}
          {numberField('风格贴合度', 'styleWeight')}
          {numberField('创作变化程度', 'weirdnessConstraint')}
        </div>
    </>;
    const advancedOptions = hasAdvancedOptions && (alwaysVisible
      ? <section className="cangyuan-music-advanced is-always-visible" aria-label="更多设置">
          <strong>更多设置</strong>
          {advancedFields}
        </section>
      : <details className="cangyuan-music-advanced">
          <summary>更多设置</summary>
          {advancedFields}
        </details>);

    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          {modelId === 'suno-extend-audio' && <>{uploadUrlField('待续写音频')}{secondsField('从此位置续写', 'continueAt')}</>}
          {modelId === 'suno-add-instrumental' && uploadUrlField('添加伴奏的原音频')}
          {modelId === 'suno-add-vocals' && uploadUrlField('添加人声的原音频')}
          {modelId === 'suno-cover-audio' && <>{uploadUrlField('待翻唱音频（也可填任务 ID）')}{!options.uploadUrl && taskIdField()}</>}
          {modelId === 'suno-cover-generate' && taskIdField('源歌曲任务 ID')}
          {modelId === 'suno-mashup' && <>
            <CangyuanMediaUploadField fieldId="cangyuan-music-suno-mashup-audio-1" kind="audio" label="混合音频 1" value={options.uploadUrls?.[0] ?? ''} onChange={(value) => updateUploadUrls(0, value)} onUploadingChange={onUploadStateChange} />
            <CangyuanMediaUploadField fieldId="cangyuan-music-suno-mashup-audio-2" kind="audio" label="混合音频 2" value={options.uploadUrls?.[1] ?? ''} onChange={(value) => updateUploadUrls(1, value)} onUploadingChange={onUploadStateChange} />
          </>}
          {modelId === 'suno-replace-section' && <>{taskIdField('源歌曲任务 ID')}{secondsField('替换起点', 'infillStartS')}{secondsField('替换终点', 'infillEndS')}</>}
          {modelId === 'suno-stem' && <><CangyuanMediaUploadField fieldId="cangyuan-music-suno-stem-audio" kind="audio" label="待分轨音频" value={options.audioUrl ?? ''} onChange={(value) => update({ audioUrl: value || undefined })} onUploadingChange={onUploadStateChange} /><div className="cangyuan-music-text-field"><span>分离类型</span><CangyuanSuggestionInput value={options.stemType ?? ''} ariaLabel="音频分离类型" options={[{ value: '', label: '默认处理' }, ...STEM_TYPES]} placeholder="默认处理" onChange={(value) => update({ stemType: value || undefined, stemName: undefined })} /></div>{options.stemType === 'split_stem_advanced' && <label className="cangyuan-music-text-field"><span>要提取的音轨名称</span><input required value={options.stemName ?? ''} onChange={(event) => update({ stemName: event.target.value || undefined })} placeholder="例如：鼓、贝斯、人声" /></label>}</>}
          {modelId === 'suno-persona' && <>
            {taskIdField('源歌曲任务 ID')}
            <label className="cangyuan-music-text-field" key="personaName">
              <span>音色名称</span>
              <input required value={options.personaName ?? ''} onChange={(event) => update({ personaName: event.target.value || undefined })} placeholder="为提取的音色命名" />
            </label>
            <label className="cangyuan-music-text-field" key="personaDescription">
              <span>音色描述</span>
              <input required value={options.personaDescription ?? ''} onChange={(event) => update({ personaDescription: event.target.value || undefined })} placeholder="描述声音或风格特征" />
            </label>
          </>}
          {['suno-midi', 'suno-wav', 'suno-timestamped-lyrics'].includes(modelId) && taskIdField()}
        </div>
        {advancedOptions}
        <p className="cangyuan-model-note">{workflowNote(modelId)}</p>
      </div>
    );
  }

  return (
    <div className="cangyuan-music-options">
      {supports('title') && (
        <label className="cangyuan-music-text-field">
          <span>曲名</span>
          <input value={options.title ?? ''} maxLength={profile.titleMaxLength} onChange={(event) => update({ title: event.target.value || undefined })} placeholder={profile.titleMaxLength ? `可选，最多 ${profile.titleMaxLength} 字符` : '可选'} />
        </label>
      )}
      {supports('style_text') && (
        <label className="cangyuan-music-text-field">
          <span>风格描述</span>
          <textarea value={options.style_text ?? ''} maxLength={profile.styleTextMaxLength} rows={3} onChange={(event) => update({ style_text: event.target.value || undefined })} placeholder={profile.styleTextMaxLength ? `曲风、编曲、乐器与氛围，最多 ${profile.styleTextMaxLength} 字符` : '曲风、编曲、乐器与氛围'} />
        </label>
      )}
      {supports('duration') && (
        <label className="cangyuan-music-text-field cangyuan-music-duration">
          <span>时长（秒）</span>
          <input type="number" min={profile.durationRange?.[0]} max={profile.durationRange?.[1]} step={1} value={options.duration ?? ''} onChange={(event) => update({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={profile.durationRange ? `${profile.durationRange[0]}–${profile.durationRange[1]}` : '按模型默认'} />
        </label>
      )}
      {supports('instrumental') && (
        <label className="cangyuan-checkbox-field">
          <input type="checkbox" checked={options.instrumental ?? false} onChange={(event) => update({ instrumental: event.target.checked })} />
          <span>纯音乐</span>
        </label>
      )}
      <div className="cangyuan-music-ranges">
        {numberField('音频权重', 'audioWeight')}
        {numberField('风格权重', 'styleWeight')}
        {numberField('变化程度', 'weirdnessConstraint')}
      </div>
      {supports('negativeTags') && (
        <label className="cangyuan-music-text-field">
          <span>排除风格</span>
          <input value={options.negativeTags ?? ''} onChange={(event) => update({ negativeTags: event.target.value || undefined })} placeholder="用逗号分隔不希望出现的风格" />
        </label>
      )}
      {supports('personaId') && (
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field">
            <span>人格编号</span>
            <input value={options.personaId ?? ''} onChange={(event) => update({ personaId: event.target.value || undefined })} placeholder="可选" />
          </label>
          {supports('personaModel') && <div className="cangyuan-music-text-field">
            <span>人格类型</span>
            <SelectMenu
              value={customPersonaModel ? PERSONA_MODEL_CUSTOM : options.personaModel ?? ''}
              ariaLabel="人格类型"
              className="cangyuan-field-select"
              menuClassName="cangyuan-field-select-menu"
              options={[
                { value: '', label: '不指定' },
                { value: 'style_persona', label: '风格人格' },
                { value: 'voice_persona', label: '声音人格' },
                { value: PERSONA_MODEL_CUSTOM, label: '自定义' },
              ]}
              onChange={(value) => {
                const selectCustom = value === PERSONA_MODEL_CUSTOM;
                setCustomPersonaModelSelected(selectCustom);
                update({ personaModel: selectCustom ? customPersonaModel ? options.personaModel : undefined : value || undefined });
              }}
            />
            <small>推荐类型之外也可输入服务支持的值。</small>
          </div>}
          {supports('personaModel') && customPersonaModel && (
            <label className="cangyuan-music-text-field">
              <span>自定义人格类型</span>
              <input value={options.personaModel ?? ''} onChange={(event) => update({ personaModel: event.target.value || undefined })} placeholder="输入自定义类型" />
            </label>
          )}
        </div>
      )}
      <div className="cangyuan-music-fields-grid">
        {supports('version') && (
          <label className="cangyuan-music-text-field">
            <span>生成版本</span>
            <CangyuanSuggestionInput value={options.version ?? ''} ariaLabel="音乐生成版本" options={SUNO_VERSIONS} placeholder="自动选择" onChange={(value) => update({ version: value || undefined })} />
          </label>
        )}
        {supports('vocalGender') && (
          <label className="cangyuan-music-text-field">
            <span>人声类型</span>
            <CangyuanSuggestionInput value={options.vocalGender ?? ''} ariaLabel="音乐人声类型" options={VOCAL_TYPES} placeholder="自动选择" onChange={(value) => update({ vocalGender: value || undefined })} />
          </label>
        )}
      </div>
      <p className="cangyuan-model-note">请求数量参数固定为 1；实际结果通常返回 2 首。参考曲目的续作参数由结果操作自动附带。</p>
    </div>
  );
}

function workflowNote(modelId: string) {
  if (modelId === 'suno-extend-audio') return '上传本地音频后会生成服务商可访问的链接；续写位置以秒为单位。';
  if (modelId === 'suno-add-instrumental') return '上传要添加伴奏的原曲音频，或在高级选项中填写公网 URL。';
  if (modelId === 'suno-add-vocals') return '上传原曲音频；人声性别可选。';
  if (modelId === 'suno-cover-audio') return '可上传音频，或粘贴结果卡中的任务编号。';
  if (modelId === 'suno-cover-generate') return '请粘贴已完成作品结果卡中的任务编号。';
  if (modelId === 'suno-mashup') return '分别上传两段音频，或在各自的高级选项中填写公网 URL。';
  if (modelId === 'suno-replace-section') return '从已有曲目中替换指定区间，起止位置均以秒为单位。';
  if (modelId === 'suno-stem') return '上传待处理音频，并选择需要的人声或分轨类型。';
  if (modelId === 'suno-persona') return '请粘贴已完成作品结果卡中的任务编号。';
  if (modelId === 'suno-midi') return '导出已完成作品的 MIDI 文件，请粘贴结果卡中的任务编号。';
  if (modelId === 'suno-wav') return '导出已完成作品的 WAV 文件，请粘贴结果卡中的任务编号。';
  if (modelId === 'suno-timestamped-lyrics') return '为已完成作品对齐歌词时间戳，请粘贴结果卡中的任务编号。';
  if (modelId === 'suno-style-boost') return '提供风格描述文本以扩写为更详细的音乐风格提示。';
  return '将文字生成结构化歌词文本。';
}
