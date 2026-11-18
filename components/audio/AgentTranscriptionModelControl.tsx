'use client';

import { useEffect, useMemo, useState } from 'react';
import SelectMenu from '@/components/SelectMenu';
import { supportedTranscriptionModels } from '@/components/audio/model-options';
import { isProviderModelLibraryEnabled } from '@/lib/provider-availability';
import { isAudioSubtitleRequest } from '@/packages/agent-core/audio-subtitle-intent';
import {
  LOCAL_AUDIO_TRANSCRIPTION_MODEL_ID,
  MOARK_AUDIO_TRANSCRIPTION_MODEL_ID,
} from '@/packages/contracts/audio-transcription';
import type { PublicState, RegistryModel } from '@/lib/types';

type TranscriptionOption = { value: string; label: string };

function isMoarkProvider(provider: PublicState['providers'][number]) {
  if (provider.platform === 'gitee') return true;
  try {
    const hostname = new URL(provider.baseUrl).hostname.toLowerCase();
    return hostname === 'moark.com' || hostname.endsWith('.moark.com');
  } catch {
    return false;
  }
}

export function agentTranscriptionModelOptions(state: PublicState | null): TranscriptionOption[] {
  const models = supportedTranscriptionModels(state);
  const moarkConfigured = Boolean(state?.providers.some((provider) => (
    provider.apiKeyConfigured
    && isProviderModelLibraryEnabled(provider)
    && isMoarkProvider(provider)
  )));
  const registeredModels = models.filter((model) => {
    const provider = state?.providers.find((item) => item.id === model.providerId);
    return !(provider && isMoarkProvider(provider) && /sense[-_ ]?voice/i.test(model.rawId));
  });

  return [
    { value: LOCAL_AUDIO_TRANSCRIPTION_MODEL_ID, label: '本地 Whisper Small' },
    ...(moarkConfigured
      ? [{ value: MOARK_AUDIO_TRANSCRIPTION_MODEL_ID, label: '模力方舟 SenseVoiceSmall（免费体验）' }]
      : []),
    ...registeredModels.map((model: RegistryModel) => ({
      value: model.id,
      label: `${model.displayName} · ${model.providerName}`,
    })),
  ];
}

export function resolveAgentTranscriptionModelSelection(options: readonly TranscriptionOption[], selectedModelId: string) {
  if (options.length === 0) return { required: false, modelId: undefined };
  if (options.length === 1) return { required: false, modelId: options[0].value };
  const selected = options.find((option) => option.value === selectedModelId);
  return { required: true, modelId: selected?.value };
}

export function useAgentTranscriptionModelSelection(state: PublicState, audioFileKey: string, prompt: string) {
  const options = useMemo(() => agentTranscriptionModelOptions(state), [state]);
  const [selection, setSelection] = useState<{ audioFileKey: string; modelId: string }>({ audioFileKey, modelId: '' });
  const [manualSubtitleMode, setManualSubtitleMode] = useState<{ audioFileKey: string; enabled: boolean }>({ audioFileKey, enabled: false });

  useEffect(() => {
    setSelection({ audioFileKey, modelId: '' });
    setManualSubtitleMode({ audioFileKey, enabled: false });
  }, [audioFileKey]);

  const modelId = selection.audioFileKey === audioFileKey ? selection.modelId : '';
  const manualEnabled = manualSubtitleMode.audioFileKey === audioFileKey && manualSubtitleMode.enabled;
  const subtitleRequested = Boolean(audioFileKey) && (manualEnabled || isAudioSubtitleRequest(prompt));
  const resolved = resolveAgentTranscriptionModelSelection(options, modelId);

  return {
    options,
    modelId: resolved.modelId || '',
    requiresSelection: subtitleRequested && resolved.required && !resolved.modelId,
    subtitleRequested,
    onChange: (nextModelId: string) => setSelection({ audioFileKey, modelId: nextModelId }),
    onToggleSubtitle: () => setManualSubtitleMode({ audioFileKey, enabled: !subtitleRequested }),
  };
}

export default function AgentTranscriptionModelControl({
  options,
  value,
  subtitleRequested,
  requiresSelection,
  onChange,
  onToggleSubtitle,
}: {
  options: readonly TranscriptionOption[];
  value: string;
  subtitleRequested: boolean;
  requiresSelection: boolean;
  onChange: (value: string) => void;
  onToggleSubtitle: () => void;
}) {
  return <div className="agent-transcription-model-control" role="group" aria-label="字幕生成">
    <button
      type="button"
      className={`agent-transcription-model-toggle${subtitleRequested ? ' is-active' : ''}`}
      aria-pressed={subtitleRequested}
      onClick={onToggleSubtitle}
      title={subtitleRequested ? '取消字幕生成' : '为音频生成字幕文件'}
    >
      <span>{subtitleRequested ? '字幕生成已启用' : '生成字幕'}</span>
    </button>
    {subtitleRequested && options.length > 1 && <>
      <span>转写方式</span>
      <SelectMenu
        value={value}
        options={[{ value: '', label: '请选择转写模型' }, ...options]}
        onChange={onChange}
        ariaLabel="选择转写模型"
        className="agent-transcription-model-select"
        menuClassName="agent-transcription-model-menu"
        menuWidth={320}
      />
      {requiresSelection && <small role="status">选择一种转写方式后即可生成字幕</small>}
    </>}
    {subtitleRequested && options.length === 1 && <span className="agent-transcription-model-default">本地 Whisper</span>}
  </div>;
}
