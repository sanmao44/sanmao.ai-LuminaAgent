'use client';

import type { CangyuanMusicModelProfile, CangyuanMusicOptions } from '@/packages/contracts/cangyuan-media';

type Props = {
  profile: CangyuanMusicModelProfile;
  options: CangyuanMusicOptions;
  onChange: (options: CangyuanMusicOptions) => void;
};

export default function CangyuanMusicOptionsFields({ profile, options, onChange }: Props) {
  const supports = (key: keyof CangyuanMusicOptions) => profile.allowedOptions.includes(key);
  const update = (patch: Partial<CangyuanMusicOptions>) => onChange({ ...options, ...patch });
  const numberField = (label: string, key: 'audioWeight' | 'styleWeight' | 'weirdnessConstraint') => supports(key) && (
    <label className="cangyuan-music-range-field" key={key}>
      <span>{label}</span>
      <input
        type="range"
        min="0"
        max="1"
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
    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field"><span>曲名（最多 160 字符）</span><input value={options.title ?? ''} maxLength={160} onChange={(event) => update({ title: event.target.value || undefined })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>目标时长（秒，5–300）</span><input type="number" min="5" max="300" step="1" value={options.duration ?? ''} onChange={(event) => update({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>BPM（30–300）</span><input type="number" min="30" max="300" step="1" value={options.bpm ?? ''} onChange={(event) => update({ bpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>随机种子</span><input type="number" min="0" max="2147483647" step="1" value={options.seed ?? ''} onChange={(event) => update({ seed: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>音频格式</span><select value={options.audio_format ?? ''} onChange={(event) => update({ audio_format: event.target.value ? event.target.value as CangyuanMusicOptions['audio_format'] : undefined })}><option value="">默认</option><option value="mp3">MP3</option><option value="wav">WAV</option><option value="m4a">M4A</option></select></label>
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.instrumental ?? false} onChange={(event) => update({ instrumental: event.target.checked })} /><span>纯音乐</span></label>
        <label className="cangyuan-music-text-field"><span>歌词（最多 20,000 字符）</span><textarea value={options.lyrics ?? ''} maxLength={20000} rows={5} onChange={(event) => update({ lyrics: event.target.value || undefined })} placeholder="可选；与提示词分开填写" /></label>
        <p className="cangyuan-model-note">每次生成 1 首；时长与 BPM 是目标提示，实际成片长度以结果为准。Lyria 3 Pro 的成片最长约 184 秒。</p>
      </div>
    );
  }

  if (profile.family === 'suno-sfx') {
    return (
      <div className="cangyuan-music-options">
        <div className="cangyuan-music-fields-grid">
          <label className="cangyuan-music-text-field"><span>调性</span><input list="cangyuan-sfx-keys" value={options.sound_key ?? ''} onChange={(event) => update({ sound_key: event.target.value || undefined })} placeholder="自动" /><datalist id="cangyuan-sfx-keys">{['Any', 'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((key) => <option key={key} value={key} />)}</datalist></label>
          <label className="cangyuan-music-text-field"><span>音效速度（BPM，1–300）</span><input type="number" min="1" max="300" step="any" value={options.sound_tempo ?? ''} onChange={(event) => update({ sound_tempo: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="可选" /></label>
          <label className="cangyuan-music-text-field"><span>生成版本</span><input list="cangyuan-sfx-versions" value={options.version ?? ''} onChange={(event) => update({ version: event.target.value || undefined })} placeholder="默认 v6" /><datalist id="cangyuan-sfx-versions"><option value="v6" /><option value="v6-wild" /><option value="v6-mini" /></datalist></label>
        </div>
        <label className="cangyuan-checkbox-field"><input type="checkbox" checked={options.sound_loop ?? false} onChange={(event) => update({ sound_loop: event.target.checked })} /><span>循环音效</span></label>
        <p className="cangyuan-model-note">一次请求 n=1；任务结果常返回两段音效。调性与版本可输入文档推荐项之外的服务端支持值。</p>
      </div>
    );
  }

  return (
    <div className="cangyuan-music-options">
      {supports('title') && (
        <label className="cangyuan-music-text-field">
          <span>曲名</span>
          <input value={options.title ?? ''} maxLength={80} onChange={(event) => update({ title: event.target.value || undefined })} placeholder="可选，最多 80 字符" />
        </label>
      )}
      {supports('style_text') && (
        <label className="cangyuan-music-text-field">
          <span>风格描述</span>
          <textarea value={options.style_text ?? ''} maxLength={1000} rows={3} onChange={(event) => update({ style_text: event.target.value || undefined })} placeholder="曲风、编曲、乐器与氛围" />
        </label>
      )}
      {supports('duration') && (
        <label className="cangyuan-music-text-field cangyuan-music-duration">
          <span>时长（秒）</span>
          <input type="number" min={10} max={360} step={1} value={options.duration ?? ''} onChange={(event) => update({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="10–360" />
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
            <span>Persona ID</span>
            <input value={options.personaId ?? ''} onChange={(event) => update({ personaId: event.target.value || undefined })} placeholder="可选" />
          </label>
          <label className="cangyuan-music-text-field">
            <span>Persona 模型</span>
            <input value={options.personaModel ?? ''} onChange={(event) => update({ personaModel: event.target.value || undefined })} placeholder="可选" />
          </label>
        </div>
      )}
      <div className="cangyuan-music-fields-grid">
        {supports('version') && (
          <label className="cangyuan-music-text-field">
            <span>生成版本</span>
            <select value={options.version ?? ''} onChange={(event) => update({ version: event.target.value ? event.target.value as CangyuanMusicOptions['version'] : undefined })}>
              <option value="">默认</option>
              <option value="v6">V6</option>
              <option value="v6-wild">V6 Wild</option>
              <option value="v6-mini">V6 Mini</option>
            </select>
          </label>
        )}
        {supports('vocalGender') && (
          <label className="cangyuan-music-text-field">
            <span>人声音色</span>
            <select value={options.vocalGender ?? ''} onChange={(event) => update({ vocalGender: event.target.value ? event.target.value as CangyuanMusicOptions['vocalGender'] : undefined })}>
              <option value="">默认</option>
              <option value="f">女声</option>
              <option value="m">男声</option>
            </select>
          </label>
        )}
      </div>
      <p className="cangyuan-model-note">单次固定生成 1 首；参考曲目的续作参数由结果操作自动附带。</p>
    </div>
  );
}
