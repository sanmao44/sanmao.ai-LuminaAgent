'use client';

import { useEffect, useMemo, useState } from 'react';
import SelectMenu from '@/components/SelectMenu';
import { supportedTranscriptionModels } from '@/components/audio/model-options';
import type { PublicState, RegistryModel } from '@/lib/types';

export function resolveAgentTranscriptionModelSelection(models: readonly RegistryModel[], selectedModelId: string) {
  if (models.length === 0) return { required: false, modelId: undefined };
  if (models.length === 1) return { required: false, modelId: models[0].id };
  const selected = models.find((model) => model.id === selectedModelId);
  return { required: true, modelId: selected?.id };
}

export function agentTranscriptionModelOptions(models: readonly RegistryModel[]) {
  return [
    { value: '', label: '请选择转写模型' },
    ...models.map((model) => ({ value: model.id, label: `${model.displayName} · ${model.providerName}` })),
  ];
}

export function useAgentTranscriptionModelSelection(state: PublicState, audioFileKey: string) {
  const models = useMemo(() => supportedTranscriptionModels(state), [state]);
  const [selection, setSelection] = useState<{ audioFileKey: string; modelId: string }>(() => ({ audioFileKey, modelId: '' }));

  useEffect(() => {
    setSelection({ audioFileKey, modelId: '' });
  }, [audioFileKey]);

  const modelId = selection.audioFileKey === audioFileKey ? selection.modelId : '';
  const resolved = resolveAgentTranscriptionModelSelection(models, modelId);

  return {
    models,
    modelId: resolved.modelId || '',
    requiresSelection: Boolean(audioFileKey) && resolved.required,
    onChange: (nextModelId: string) => setSelection({ audioFileKey, modelId: nextModelId }),
  };
}

export default function AgentTranscriptionModelControl({
  models,
  value,
  onChange,
}: {
  models: readonly RegistryModel[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (models.length <= 1) return null;

  return <div className="agent-transcription-model-control" role="group" aria-label="字幕转写模型">
    <span>字幕识别</span>
    <SelectMenu
      value={value}
      options={agentTranscriptionModelOptions(models)}
      onChange={onChange}
      ariaLabel="选择字幕转写模型"
      className="agent-transcription-model-select"
      menuClassName="agent-transcription-model-menu"
      menuWidth={300}
    />
    {!value && <small role="status">选择模型后才能发送</small>}
  </div>;
}
