import type { BulkModelStateInput, BulkModelStateResult } from '@/packages/contracts/model-library';

export type ModelLibraryDependencies = {
  setModelsEnabled(ids: string[], enabled: boolean): Promise<BulkModelStateResult>;
};

export class ModelLibraryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelLibraryInputError';
  }
}

export function createModelLibraryApplication(dependencies: ModelLibraryDependencies) {
  return {
    async setBulkModelState(input: BulkModelStateInput): Promise<BulkModelStateResult> {
      const ids = Array.from(new Set(input.ids));
      if (!ids.length || ids.length > 5000 || ids.some((id) => !id.trim() || id.length > 512)) {
        throw new ModelLibraryInputError('模型列表为空或包含无效项目。');
      }
      return dependencies.setModelsEnabled(ids, input.enabled);
    },
  };
}
