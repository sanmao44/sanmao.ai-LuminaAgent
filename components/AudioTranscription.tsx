'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModelPicker from '@/components/ModelPicker';
import SelectMenu from '@/components/SelectMenu';
import { supportedTranscriptionModels } from '@/components/audio/model-options';
import type { AudioTranscriptionResult } from '@/packages/contracts/audio-transcription';
import type { GenerationLog } from '@/lib/generation-log';
import { listGenerationLogs } from '@/lib/generation-log-client';
import type { PublicState } from '@/lib/types';
import styles from './AudioTranscription.module.css';

const LANGUAGES = [
  { value: '', label: '自动识别' }, { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' }, { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' }, { value: 'fr', label: '法语' },
  { value: 'de', label: '德语' }, { value: 'es', label: '西班牙语' },
  { value: '__custom', label: '其他语言' },
];
const FORMATS = [
  { value: 'verbose_json', label: '文字与分段时间' },
  { value: 'json', label: '标准文字' },
  { value: 'text', label: '纯文本' },
];

export function audioTranscriptionModels(state: PublicState | null) {
  return supportedTranscriptionModels(state);
}

function downloadTranscript(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = (name.replace(/\.[^.]+$/, '') || '转写结果') + '.txt';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  return Math.floor(rounded / 60).toString().padStart(2, '0') + ':' + (rounded % 60).toString().padStart(2, '0');
}

export function AudioTranscriptionHistory({ logs, onCopy }: { logs: readonly GenerationLog[]; onCopy?: (text: string) => void }) {
  return <div className="cangyuan-task-list">{logs.map((log) => (
    <article className={'cangyuan-task-item ' + styles.result} key={log.id}>
      <div className="cangyuan-task-title-row">
        <div><strong>{log.sourceAudioName || '音频转写'}</strong><small>{log.modelName || '转写模型'} · {new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false })}</small></div>
        <span className="cangyuan-task-status succeeded">已完成</span>
      </div>
      <p className={styles.transcript}>{log.textResult || '未识别到可用的人声文字。'}</p>
      {Boolean(log.transcriptionSegments?.length) && <details className={styles.details}>
        <summary>查看分段时间</summary>
        <ol className={styles.segments}>{log.transcriptionSegments!.map((segment, index) => <li key={index}>
          <time>{timestamp(segment.start)}–{timestamp(segment.end)}</time><span>{segment.text}</span>
        </li>)}</ol>
      </details>}
      <div className="cangyuan-output-actions">
        <button type="button" disabled={!log.textResult} onClick={() => onCopy?.(log.textResult || '')}>复制文字</button>
        <button type="button" disabled={!log.textResult} onClick={() => downloadTranscript(log.textResult || '', log.sourceAudioName || '转写结果')}>下载文字</button>
      </div>
    </article>
  ))}</div>;
}

export default function AudioTranscription({ state, onOpenModels, onNotify }: { state: PublicState; onOpenModels?: () => void; onNotify?: (message: string) => void }) {
  const models = useMemo(() => audioTranscriptionModels(state), [state]);
  const [modelId, setModelId] = useState('');
  const model = models.find((item) => item.id === modelId) || models[0];
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState('verbose_json');
  const [temperature, setTemperature] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [unsavedResult, setUnsavedResult] = useState<GenerationLog | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const records = await listGenerationLogs(200);
      setLogs(records.filter((record) => record.mode === 'audio' && record.status === 'success' && record.textResult !== undefined));
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : '读取转写记录失败。');
    } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function chooseFile(candidate: File | undefined) {
    if (!candidate) return;
    setError('');
    if (!/\.(mp3|wav|ogg|m4a|flac|webm|pcm)$/i.test(candidate.name)) { setError('请选择 MP3、WAV、OGG、M4A、FLAC、WebM 或 PCM 音频。'); return; }
    if (!candidate.size || candidate.size > 50 * 1024 * 1024) { setError('音频文件应大于 0 且不超过 50 MiB。'); return; }
    setFile(candidate);
  }

  async function submit() {
    if (!file || !model || busy) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const form = new FormData();
    form.set('file', file);
    form.set('modelId', model.id);
    const requestedLanguage = language === '__custom' ? customLanguage.trim() : language;
    if (requestedLanguage) form.set('language', requestedLanguage);
    if (prompt.trim()) form.set('prompt', prompt.trim());
    form.set('responseFormat', format);
    form.set('temperature', String(temperature));
    try {
      const response = await fetch('/api/audio/transcriptions', { method: 'POST', body: form, signal: controller.signal });
      const payload = await response.json() as { result?: AudioTranscriptionResult; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || '音频转写失败。');
      const result = payload.result;
      if (result.historyError) {
        setHistoryError(result.historyError);
        setUnsavedResult({ id: 'transcript-' + Date.now(), createdAt: new Date().toISOString(), status: 'success', mode: 'audio', prompt: file.name, sourceAudioName: file.name, modelName: result.modelName, textResult: result.text, transcriptionSegments: result.segments });
      } else { setUnsavedResult(null); await loadHistory(); }
      onNotify?.('音频转写完成');
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '音频转写失败。');
    } finally { setBusy(false); abortRef.current = null; }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); onNotify?.('文字已复制'); }
    catch { setHistoryError('无法自动复制，请选中右侧文字后复制。'); }
  }

  return <div className="cangyuan-studio-layout">
    <section className="cangyuan-studio-form" aria-label="音频转写设置">
      <div className="cangyuan-form-heading"><div><h2>音频转文字</h2><p>上传录音，识别内容并保存文字记录。</p></div><span className="cangyuan-capability-count">{models.length} 个模型</span></div>
      <span className="cangyuan-field-label">识别模型</span>
      <ModelPicker models={models} value={model?.id || 'auto'} onChange={setModelId} capability="transcription" defaultProviderId={state.settings.defaultProviderId} defaultModelId={models[0]?.id} disabled={busy || !models.length} className="cangyuan-model-picker" />
      {!models.length ? <div className="cangyuan-empty-models"><p>没有可用的转写模型。</p><span>在模型库同步并启用支持音频转写的模型。</span>{onOpenModels && <button type="button" onClick={onOpenModels}>打开模型库</button>}</div> : <>
        <input ref={inputRef} type="file" accept=".mp3,.wav,.ogg,.m4a,.flac,.webm,.pcm" className={styles.fileInput} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} disabled={busy} />
        <button className={styles.upload} type="button" disabled={busy} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) chooseFile(event.dataTransfer.files[0]); }}>
          <strong>{file ? file.name : '上传或拖入音频'}</strong><span>{file ? (file.size / 1024 / 1024).toFixed(1) + ' MiB · 点击替换' : '支持 MP3、WAV、OGG、M4A、FLAC、WebM、PCM · 最大 50 MiB'}</span>
        </button>
        <div className="cangyuan-speech-field"><span>录音语言</span><SelectMenu value={language} onChange={setLanguage} ariaLabel="录音语言" options={LANGUAGES} className="cangyuan-field-select" menuClassName="cangyuan-field-select-menu" /></div>
        {language === '__custom' && <label className="cangyuan-speech-field"><span>语言代码</span><input value={customLanguage} onChange={(event) => setCustomLanguage(event.target.value)} placeholder="例如 it（意大利语）" maxLength={30} /></label>}
        <details className={styles.details}><summary>识别提示与更多设置</summary><div className={styles.advanced}>
          <label className="cangyuan-music-text-field"><span>专有名词提示（可选）</span><textarea rows={3} value={prompt} maxLength={12000} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：人名、品牌名、行业术语或口头禅" /><small>帮助准确识别，填写原音频中可能出现的词语。</small></label>
          <div className="cangyuan-speech-field"><span>结果内容</span><SelectMenu value={format} onChange={setFormat} ariaLabel="转写结果格式" options={FORMATS} className="cangyuan-field-select" menuClassName="cangyuan-field-select-menu" /></div>
          <label className={styles.temperature}><span>识别稳定性</span><input type="range" min={0} max={1} step={0.05} value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /><output>{temperature === 0 ? '最稳定' : temperature.toFixed(2)}</output><small>默认最稳定；提高后结果会更灵活。</small></label>
        </div></details>
        {error && <p className="cangyuan-task-error" role="alert">{error}</p>}
        <div className="cangyuan-submit-row"><span>{busy ? '正在上传并识别录音…' : '文字结果会保留在右侧'}</span><button type="button" className="cangyuan-primary-button" disabled={busy || !file || !model || language === '__custom' && !customLanguage.trim()} onClick={() => void submit()}>{busy ? '正在识别…' : '开始转写'}</button></div>
      </>}
    </section>
    <section className="cangyuan-studio-results" aria-label="音频转写结果">
      <div className="cangyuan-results-header"><div><h2>转写记录</h2><p>所有成功转写的文字均保存在这里</p></div><button className="cangyuan-refresh-button" type="button" disabled={historyLoading} onClick={() => void loadHistory()}>刷新</button></div>
      {historyError && <p className="cangyuan-task-error" role="alert">{historyError}</p>}
      {unsavedResult && <AudioTranscriptionHistory logs={[unsavedResult]} onCopy={(text) => void copy(text)} />}
      {historyLoading ? <div className="cangyuan-task-empty" role="status">正在读取转写记录…</div>
        : logs.length ? <AudioTranscriptionHistory logs={logs} onCopy={(text) => void copy(text)} />
          : <div className="cangyuan-task-empty"><strong>还没有转写记录</strong><span>上传录音并开始转写，结果可复制、下载和回看。</span></div>}
    </section>
  </div>;
}
