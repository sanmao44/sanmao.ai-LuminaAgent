import { getCangyuanMusicModelProfile } from '@/packages/contracts/cangyuan-media';

export type MediaTaskAudioKind = 'music' | 'sound-effect';

export function mediaTaskAudioKind(providerModel: string | undefined): MediaTaskAudioKind {
  const family = getCangyuanMusicModelProfile(providerModel || '')?.family;
  return family === 'suno-sfx' || family === 'elevenlabs-sfx' ? 'sound-effect' : 'music';
}

export function mediaTaskAudioOutputTitle(
  output: { title?: string; artifactType?: string; audioId?: string },
  index: number,
  kind: MediaTaskAudioKind = 'music',
) {
  if (output.title) return output.title;
  if (output.artifactType === 'text') return '文本结果';
  if (output.artifactType === 'midi') return `MIDI 文件 ${index + 1}`;
  if (output.artifactType === 'file') return `文件 ${index + 1}`;
  if (kind === 'sound-effect') return `音效 ${index + 1}`;
  return `${output.audioId ? '曲目' : '音乐'} ${index + 1}`;
}

export function mediaTaskErrorMessage(error: string, providerModel?: string) {
  if (!/\bmodel allowlist\b/iu.test(error) || !/\brequested model\b[\s\S]*\bis not in it\b/iu.test(error)) return error;
  const model = error.match(/\brequested model\s+["']([^"'\r\n]+)["']/iu)?.[1] || providerModel;
  return `当前服务连接的密钥未获准调用${model ? `模型“${model}”` : '此模型'}。请更换已授权的服务连接，或在服务商的 API 密钥页面将该模型加入允许列表后重试。`;
}

export function mediaTaskModeLabel(mode: string | undefined) {
  if (mode === 'text-to-3d') return '文生 3D';
  if (mode === 'image-to-3d') return '图生 3D';
  if (mode === 'multiview-to-3d') return '多视图 3D';
  return '三维生成任务';
}

export function mediaTaskProviderStatusLabel(providerStatus: string | undefined, taskStatus: string) {
  const status = String(providerStatus || '').trim().toLowerCase();
  if (/fail|error|reject/u.test(status)) return '服务商处理失败';
  if (/cancel/u.test(status)) return '服务商已取消';
  if (/(?:^|[_\s-])(?:complete|completed|success|succeeded|done|finished)(?:$|[_\s-])/u.test(status)) return '服务商已完成';
  if (/queue|pending|wait|accept|creat/u.test(status)) return '等待服务商处理…';
  if (/run|progress|process|generat|execut|start/u.test(status)) return '服务商正在生成…';
  if (taskStatus === 'pending' || taskStatus === 'queued' || taskStatus === 'waiting') return '等待服务商处理…';
  return '服务商正在处理…';
}
