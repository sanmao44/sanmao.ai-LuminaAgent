type EditorModelOption = {
  id: string;
  scales?: readonly number[];
  outputFormats?: readonly string[];
};

export type EditorModelSelectionPatch = {
  modelId: string;
  scale?: number;
  upscaleOutputFormat?: string;
};

export function upscaleEditorSettingsPatch(
  currentScale: number,
  currentOutputFormat: string,
  model: EditorModelOption | null | undefined,
  fallbackScales: readonly number[],
) {
  const nextScales = model?.scales || fallbackScales;

  return {
    scale: nextScales.includes(currentScale)
      ? currentScale
      : nextScales.includes(2)
        ? 2
        : nextScales[0],
    upscaleOutputFormat: model?.outputFormats?.includes(currentOutputFormat)
      ? currentOutputFormat
      : model?.outputFormats?.[0] || currentOutputFormat,
  };
}

/** Keeps the controlled editor form valid when its model changes. */
export function editorModelSelectionPatch(
  mode: "edit" | "upscale",
  modelId: string,
  currentScale: number,
  currentOutputFormat: string,
  models: readonly EditorModelOption[],
  fallbackScales: readonly number[],
): EditorModelSelectionPatch {
  if (mode !== "upscale") return { modelId };

  const nextModel = models.find((model) => model.id === modelId);
  const settings = upscaleEditorSettingsPatch(currentScale, currentOutputFormat, nextModel, fallbackScales);

  return {
    modelId,
    ...settings,
  };
}

