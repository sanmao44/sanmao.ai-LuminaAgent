import type { CangyuanMediaTask } from '@/packages/contracts/cangyuan-media';
import type { ModelArtifactPreviewAsset, ModelArtifactPreviewPort } from '@/packages/contracts/model-artifact-preview';

export type ModelArtifactPreviewErrorCode = 'not-found' | 'not-ready' | 'unsupported';

export class ModelArtifactPreviewError extends Error {
  constructor(readonly code: ModelArtifactPreviewErrorCode, message: string) {
    super(message);
    this.name = 'ModelArtifactPreviewError';
  }
}

export type ModelArtifactPreviewDependencies = {
  findTask(taskId: string): Promise<CangyuanMediaTask | null>;
  reader: ModelArtifactPreviewPort;
};

export function createModelArtifactPreviewApplication(dependencies: ModelArtifactPreviewDependencies) {
  return {
    async openThreeDOutput(taskId: string, outputIndex: number): Promise<ModelArtifactPreviewAsset> {
      const task = await dependencies.findTask(taskId);
      if (!task || task.kind !== '3d') {
        throw new ModelArtifactPreviewError('not-found', '模型任务不存在。');
      }
      if (task.status !== 'succeeded') {
        throw new ModelArtifactPreviewError('not-ready', '模型尚未生成完成。');
      }
      if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) {
        throw new ModelArtifactPreviewError('unsupported', '模型结果序号无效。');
      }
      const output = task.outputs[outputIndex];
      if (!output?.url || output.artifactType === 'fbx' || output.artifactType && output.artifactType !== 'glb') {
        throw new ModelArtifactPreviewError('unsupported', '当前结果不是可在线预览的 GLB 模型。');
      }
      return dependencies.reader.open(output.url);
    },
  };
}
