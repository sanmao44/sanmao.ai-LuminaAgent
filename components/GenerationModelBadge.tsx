'use client';

import type { CSSProperties } from 'react';
import { generationLogModelHue } from '@/lib/generation-log-presentation';
import './GenerationModelBadge.css';

type Props = {
  modelId?: string;
  requestedModelId?: string;
  modelName?: string;
  providerName?: string;
};

export default function GenerationModelBadge({ modelId, requestedModelId, modelName, providerName }: Props) {
  const label = String(modelName || '').trim() || '自动选择模型';
  const hue = generationLogModelHue({ modelId, requestedModelId, modelName });
  const title = providerName ? `${label} · ${providerName}` : label;
  const style = hue === null ? undefined : ({ '--generation-model-hue': hue } as CSSProperties);

  return (
    <span
      className={`generation-model-badge${hue === null ? ' unresolved' : ''}`}
      style={style}
      title={title}
      aria-label={`生成模型：${title}`}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
