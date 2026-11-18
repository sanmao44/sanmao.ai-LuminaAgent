import { getCangyuanCreativeGeneration } from '@/apps/worker/cangyuan-creative-task';
import { createModelArtifactPreviewApplication } from './model-artifact-preview-application';
import { modelArtifactPreviewReader } from '@/lib/model-artifact-preview-reader';

const modelArtifactPreviewApplication = createModelArtifactPreviewApplication({
  findTask: (taskId) => getCangyuanCreativeGeneration(taskId, '3d', false),
  reader: modelArtifactPreviewReader,
});

export function openThreeDModelOutputPreview(taskId: string, outputIndex: number) {
  return modelArtifactPreviewApplication.openThreeDOutput(taskId, outputIndex);
}
