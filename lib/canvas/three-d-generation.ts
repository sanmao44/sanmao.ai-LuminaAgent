import {
  getCangyuan3DModelProfile,
  reconcileCangyuan3DMode,
  validateCangyuan3DInput,
  type Cangyuan3DOptions,
} from "@/packages/contracts/cangyuan-media";

export type CanvasThreeDRequest = {
  kind: "3d";
  modelId: string;
  prompt: string;
  options: Cangyuan3DOptions;
};

export function buildCanvasThreeDRequest(input: {
  modelId: string;
  rawModelId: string;
  prompt: string;
  options: Cangyuan3DOptions;
}): CanvasThreeDRequest {
  const profile = getCangyuan3DModelProfile(input.rawModelId);
  if (!profile) throw new Error("当前三维模型尚未接入。");

  const mode = reconcileCangyuan3DMode(
    profile.modelId,
    input.options.mode || profile.defaultMode,
  );
  const options = optionsForProfile(profile.family, mode, input.options);
  const validated = validateCangyuan3DInput(profile.modelId, {
    prompt: input.prompt,
    ...options,
  });
  const { prompt, ...validatedOptions } = validated;

  return {
    kind: "3d",
    modelId: input.modelId,
    prompt,
    options: validatedOptions,
  };
}

export function canvasThreeDPreviewUrl(taskId: string, outputIndex: number) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId) || !Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex > 999) {
    throw new Error("模型任务或结果序号无效。");
  }
  return `/api/media/model-preview/${taskId}/${outputIndex}`;
}

function optionsForProfile(
  family: "tripo-legacy" | "trellis" | "tripo",
  mode: NonNullable<Cangyuan3DOptions["mode"]>,
  options: Cangyuan3DOptions,
): Cangyuan3DOptions {
  const commonMode = { mode };
  const image = mode === "image-to-3d" && options.imageUrl
    ? { imageUrl: options.imageUrl }
    : {};
  const multiview = mode === "multiview-to-3d" && options.multiviewImages
    ? { multiviewImages: options.multiviewImages }
    : {};

  if (family === "trellis") {
    return {
      ...commonMode,
      ...image,
      ...(options.textureSize ? { textureSize: options.textureSize } : {}),
      ...(options.seed ? { seed: options.seed } : {}),
      ...(options.meshSimplify !== undefined ? { meshSimplify: options.meshSimplify } : {}),
      ...(options.ssGuidanceStrength !== undefined ? { ssGuidanceStrength: options.ssGuidanceStrength } : {}),
      ...(options.ssSamplingSteps !== undefined ? { ssSamplingSteps: options.ssSamplingSteps } : {}),
      ...(options.slatGuidanceStrength !== undefined ? { slatGuidanceStrength: options.slatGuidanceStrength } : {}),
      ...(options.slatSamplingSteps !== undefined ? { slatSamplingSteps: options.slatSamplingSteps } : {}),
    };
  }

  if (family === "tripo-legacy") {
    return {
      ...commonMode,
      ...image,
      ...(options.texture !== undefined ? { texture: options.texture } : {}),
      ...(options.pbr !== undefined ? { pbr: options.pbr } : {}),
    };
  }

  return {
    ...commonMode,
    ...image,
    ...multiview,
    ...(options.texture !== undefined ? { texture: options.texture } : {}),
    ...(options.pbr !== undefined ? { pbr: options.pbr } : {}),
    ...(options.faceLimit !== undefined ? { faceLimit: options.faceLimit } : {}),
    ...(options.generateParts !== undefined ? { generateParts: options.generateParts } : {}),
    ...(options.geometryQuality ? { geometryQuality: options.geometryQuality } : {}),
    ...(options.textureQuality ? { textureQuality: options.textureQuality } : {}),
    ...(options.textureVersion ? { textureVersion: options.textureVersion } : {}),
    ...(options.quad !== undefined ? { quad: options.quad } : {}),
  };
}
