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
