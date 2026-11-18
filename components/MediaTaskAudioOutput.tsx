'use client';

import { GenerationLogAudioPlayer } from '@/components/GenerationLogAudio';

export type MediaTaskAudioOutputValue = {
  url?: string;
  text?: string;
  artifactType?: string;
  name?: string;
  title?: string;
  audioId?: string;
  duration?: number;
};

type Props = {
  output: MediaTaskAudioOutputValue;
  index: number;
  canContinue?: boolean;
  onContinue?: (output: MediaTaskAudioOutputValue) => void;
};

export default function MediaTaskAudioOutput({ output, index, canContinue = false, onContinue }: Props) {
  const isText = output.artifactType === 'text';
  const isMidi = output.artifactType === 'midi';
  const isFile = isMidi || output.artifactType === 'file';
  const title = output.title || (isText ? '文本结果' : isMidi ? `MIDI 文件 ${index + 1}` : output.audioId ? `曲目 ${index + 1}` : `音乐 ${index + 1}`);
  const details = [output.duration ? `${output.duration} 秒` : '', output.audioId ? `曲目编号 ${output.audioId}` : ''].filter(Boolean).join(' · ');
  const downloadName = output.name || `SANMAO-${isMidi ? `曲目-${index + 1}.mid` : `文件-${index + 1}`}`;

  return (
    <div className="cangyuan-music-output">
      <div className="cangyuan-output-meta"><b>{title}</b><span>{details || (isMidi ? 'MIDI 音乐文件' : isText ? '文本内容' : '音频结果')}</span></div>
      {isText && output.text && <pre className="media-task-output-text">{output.text}</pre>}
      {isFile && output.url && <div className="media-task-output-file"><span>{output.name || (isMidi ? 'MIDI 音乐文件' : '生成文件')}</span><a href={output.url} download={downloadName}>下载文件</a></div>}
      {!isText && !isFile && output.url && <GenerationLogAudioPlayer src={output.url} />}
      {!output.url && !output.text && <p className="cangyuan-task-error">服务商未返回可播放或可读取的结果。</p>}
      {isText && output.url && <div className="cangyuan-output-actions"><a href={output.url} download={downloadName}>下载文本</a></div>}
      {canContinue && !isText && !isFile && <div className="cangyuan-output-actions"><button type="button" disabled={!output.url || !canContinue} title={!output.url ? '需要服务商返回公开可访问的音频地址' : '将音频带入续写工作流'} onClick={() => onContinue?.(output)}>续写此曲</button></div>}
    </div>
  );
}
