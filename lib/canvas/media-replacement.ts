import type { CanvasAsset } from './api';
import type { CanvasDocument, CanvasNode, CanvasNodeData, CanvasNodeParams } from './types';

export function withoutCanvasMediaMask<T extends CanvasNodeParams | undefined>(params: T): T {
  if (!params || !('mask' in params)) return params;
  const next = { ...params };
  delete next.mask;
  return next;
}

/** An immutable operation submitted through the existing CanvasCore commit. */
export function replaceCanvasNodeMedia(
  document: CanvasDocument,
  source: CanvasNode,
  asset: CanvasAsset,
): CanvasDocument {
  const current = document.nodes.find((node) => node.id === source.id);
  if (
    !current || current.type !== 'media' ||
    current.data.kind !== source.data.kind || current.data.kind !== asset.kind ||
    current.data.url !== source.data.url || current.data.jobId !== source.data.jobId ||
    current.data.status !== source.data.status
  ) return document;

  const data: CanvasNodeData = { ...current.data };
  // These describe the old file, rather than the node's editing intent/history.
  for (const key of [
    'generation', 'model', 'providerName', 'jobId', 'recoveryTaskId', 'progress',
    'processingStartedAt', 'taskUpdatedAt', 'taskTracking', 'storageKey',
    'nativeWidth', 'nativeHeight', 'durationMs', 'sourceDurationMs', 'videoClip',
    'mask', 'maskApplied', 'maskSourceNodeId', 'imageOperation', 'depthVideo', 'resultSource',
  ]) delete data[key];
  data.params = withoutCanvasMediaMask(current.data.params || current.data.generation?.params);
  data.prompt = current.data.prompt ?? current.data.generation?.userPrompt ?? current.data.generation?.prompt;
  if (data.editor) {
    data.editor = { ...data.editor, draftParams: withoutCanvasMediaMask(data.editor.draftParams) };
  }
  const replacement: CanvasNode = {
    ...current,
    data: {
      ...data,
      url: asset.url,
      name: current.data.name || asset.name,
      assetId: asset.id,
      sourceAssetId: asset.id,
      ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
      mimeType: asset.mime,
      autoFit: false,
      role: '参考素材',
      status: 'completed',
      statusLabel: asset.kind === 'video' ? '视频素材' : '图片素材',
    },
  };
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === current.id ? replacement : node),
  };
}

/** Uploads through the media adapter and commits to the captured project only. */
export async function replaceCanvasMediaFile(options: {
  nodeId: string;
  file: File;
  readDocument(): CanvasDocument;
  commit(updater: (document: CanvasDocument) => CanvasDocument): boolean | Promise<boolean>;
  uploadAsset(file: File): Promise<CanvasAsset>;
  waitForPersistence?(): Promise<boolean>;
}) {
  const source = options.readDocument().nodes.find((node) => node.id === options.nodeId);
  if (!source || source.type !== 'media' || !['image', 'video'].includes(source.data.kind || '')) {
    throw new Error('原素材节点已不存在，请重新选择节点。');
  }
  const label = source.data.kind === 'video' ? '视频' : '图片';
  if (!options.file.type.startsWith(`${source.data.kind}/`)) {
    throw new Error(`请选择${label}文件，替换时需要保持素材类型一致。`);
  }
  if (source.data.status === 'queued' || source.data.status === 'running') {
    throw new Error('节点正在生成中，请等待完成后再替换。');
  }
  const asset = await options.uploadAsset(options.file);
  if (asset.kind !== source.data.kind || !asset.url) {
    throw new Error('上传结果与原素材类型不符，请重新选择文件。');
  }
  let replaced = false;
  const committed = await options.commit((document) => {
    const next = replaceCanvasNodeMedia(document, source, asset);
    replaced = next !== document;
    return next;
  });
  if (!committed) throw new Error('画布无法更新，请保留文件并重试。');
  if (!replaced) throw new Error('节点已删除或素材已更新，本次上传未覆盖当前内容。');
  if (options.waitForPersistence && !await options.waitForPersistence()) {
    throw new Error('素材已上传，但画布保存失败，请保留文件并重试。');
  }
  return asset;
}
