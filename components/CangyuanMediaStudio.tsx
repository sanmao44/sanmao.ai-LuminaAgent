'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ThreeDModelPreview from '@/components/ThreeDModelPreview';
import ModelPicker from '@/components/ModelPicker';
import SelectMenu from '@/components/SelectMenu';
import CangyuanSuggestionInput from '@/components/cangyuan/CangyuanSuggestionInput';
import CangyuanMediaUploadField from '@/components/cangyuan/CangyuanMediaUploadField';
import CangyuanMusicOptionsFields, { cangyuanMusicTaskKindName } from '@/components/cangyuan/CangyuanMusicOptionsFields';
import AudioTranscription from '@/components/AudioTranscription';
import CangyuanThreeDScenarioPicker from '@/components/cangyuan/CangyuanThreeDScenarioPicker';
import CangyuanTripoQualityOptions, { applyTripoQualityOptions } from '@/components/cangyuan/CangyuanTripoQualityOptions';
import CangyuanReferenceImagePreview from '@/components/cangyuan/CangyuanReferenceImagePreview';
import { speechVoiceOptions } from '@/components/audio/voice-options';
import VoiceSampleButton from '@/components/audio/VoiceSampleButton';
import SpeechAdvancedOptions, { speechDialogueDraftError, type SpeechAdvancedDraft } from '@/components/audio/SpeechAdvancedOptions';
import { speechOutputFormatLabel } from '@/components/audio/speech-format-options';
import { supportedSpeechModels } from '@/components/audio/model-options';
import { GenerationLogAudioPlayer, GenerationLogAudioWorks } from '@/components/GenerationLogAudio';
import MediaTaskAudioOutput, { type MediaTaskAudioOutputValue } from '@/components/MediaTaskAudioOutput';
import { mediaTaskModeLabel, mediaTaskProviderStatusLabel } from '@/components/media-task-presentation';
import type { CangyuanThreeDScenario } from '@/components/cangyuan/three-d-presets';
import type {
  CangyuanMediaCreateInput,
  Cangyuan3DMode,
  Cangyuan3DOptions,
  Cangyuan3DView,
  CangyuanMediaKind,
  CangyuanMediaOutput,
  CangyuanMediaTask,
  CangyuanMusicOptions,
} from '@/packages/contracts/cangyuan-media';
import { CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL, getCangyuan3DModelProfile, getCangyuanMusicModelProfile, reconcileCangyuan3DMode } from '@/packages/contracts/cangyuan-media';
import type { SpeechOutputFormat } from '@/packages/contracts/audio-synthesis';
import { getSpeechModelAdvancedOptions, getSpeechModelProfile, getSpeechModelResponseFormats, getSpeechModelSpeedRange, SPEECH_PLATFORM_TEXT_LIMIT } from '@/packages/contracts/audio-synthesis';
import type { PublicState, RegistryModel } from '@/lib/types';
import { listGenerationLogs } from '@/lib/generation-log-client';
import type { GenerationLog } from '@/lib/generation-log';
import { isCangyuanProvider } from '@/lib/cangyuan-provider';
import { filterModelsByActiveProviders } from '@/lib/provider-availability';
import { CANGYUAN_3D_TASK_POLL_INTERVAL_MS, CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS, nextCangyuanTaskPollBatch } from '@/lib/cangyuan-media-task-polling';
import './CangyuanMediaStudio.css';

type StudioMode = 'speech' | 'transcription' | 'music' | 'sound-effect' | '3d';
type StudioNotice = { kind: 'error' | 'info' | 'success'; text: string } | null;
type SpeechResult = { url: string; name: string; modelName: string; contentType: string; extension: string };

const ACTIVE_TASK_STATUSES = new Set(['pending', 'queued', 'running', 'waiting']);

function isActiveTask(task: CangyuanMediaTask) {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

function taskStatusLabel(task: CangyuanMediaTask) {
  if (task.status === 'succeeded') return '已完成';
  if (task.status === 'failed') return '失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'waiting') return '等待中';
  if (task.status === 'queued' || task.status === 'pending') return '排队中';
  return '生成中';
}

function taskSort(left: CangyuanMediaTask, right: CangyuanMediaTask) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function isSoundEffectTask(task: CangyuanMediaTask) {
  const profile = getCangyuanMusicModelProfile(task.providerModel);
  return profile?.family === 'suno-sfx' || profile?.family === 'elevenlabs-sfx';
}

function cangyuanTaskModels(state: PublicState | null, capability: 'music-generate' | 'sound-effect' | '3d-generate') {
  if (!state) return [];
  const providers = state.providers.filter(isCangyuanProvider);
  return filterModelsByActiveProviders(state.models, providers, { capability });
}

function supportedMusicModels(state: PublicState | null) {
  return cangyuanTaskModels(state, 'music-generate').filter((model) => {
    const profile = getCangyuanMusicModelProfile(model.rawId);
    return profile !== null && profile.family !== 'suno-sfx' && profile.family !== 'elevenlabs-sfx';
  });
}

function supportedSoundEffectModels(state: PublicState | null) {
  return cangyuanTaskModels(state, 'sound-effect').filter((model) => {
    const profile = getCangyuanMusicModelProfile(model.rawId);
    return profile?.family === 'suno-sfx' || profile?.family === 'elevenlabs-sfx';
  });
}

function threeDModels(state: PublicState | null) {
  return cangyuanTaskModels(state, '3d-generate').filter((model) => getCangyuan3DModelProfile(model.rawId) !== null);
}

function isLegacyTripoModel(model: RegistryModel | undefined) {
  return model?.rawId.trim().toLowerCase() === 'tripo3d';
}

function isTripoModel(model: RegistryModel | undefined) {
  const profile = model ? getCangyuan3DModelProfile(model.rawId.trim()) : null;
  return profile?.modelId === 'tripo3d' || profile?.family === 'tripo';
}

function isTrellisModel(model: RegistryModel | undefined) {
  return model?.rawId.trim().toLowerCase() === 'trellis';
}

function formatCreatedAt(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : value;
}

function clampSpeechSpeed(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type CangyuanMediaStudioProps = {
  onOpenModels?: () => void;
  onNotify?: (message: string) => void;
};

export default function CangyuanMediaStudio({ onOpenModels, onNotify }: CangyuanMediaStudioProps) {
  const [mode, setMode] = useState<StudioMode>('speech');
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [stateError, setStateError] = useState('');
  const [speechModelId, setSpeechModelId] = useState('');
  const [musicModelId, setMusicModelId] = useState('');
  const [soundEffectModelId, setSoundEffectModelId] = useState('');
  const [model3dId, setModel3dId] = useState('');
  const [speechText, setSpeechText] = useState('');
  const [speechVoiceChoice, setSpeechVoiceChoice] = useState('');
  const [speechCustomVoice, setSpeechCustomVoice] = useState('');
  const [speechFormat, setSpeechFormat] = useState<SpeechOutputFormat>('mp3');
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [speechAdvanced, setSpeechAdvanced] = useState<SpeechAdvancedDraft>({});
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicOptions, setMusicOptions] = useState<CangyuanMusicOptions>({});
  const [prompt3d, setPrompt3d] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [multiviewImages, setMultiviewImages] = useState<Partial<Record<Cangyuan3DView, string>>>({});
  const [trellisAdvancedOpen, setTrellisAdvancedOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<Cangyuan3DMode>('image-to-3d');
  const [texture, setTexture] = useState<'no' | 'standard' | 'HD'>('standard');
  const [pbr, setPbr] = useState(false);
  const [tripoOptions, setTripoOptions] = useState<Cangyuan3DOptions>({});
  const [trellisTextureSize, setTrellisTextureSize] = useState('');
  const [trellisSeed, setTrellisSeed] = useState('');
  const [trellisMeshSimplify, setTrellisMeshSimplify] = useState('');
  const [trellisSsGuidance, setTrellisSsGuidance] = useState('');
  const [trellisSsSteps, setTrellisSsSteps] = useState('');
  const [trellisSlatGuidance, setTrellisSlatGuidance] = useState('');
  const [trellisSlatSteps, setTrellisSlatSteps] = useState('');
  const [musicTasks, setMusicTasks] = useState<CangyuanMediaTask[]>([]);
  const [threeTasks, setThreeTasks] = useState<CangyuanMediaTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadingMediaFields, setUploadingMediaFields] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<StudioNotice>(null);
  const [speechResult, setSpeechResult] = useState<SpeechResult | null>(null);
  const [speechLogs, setSpeechLogs] = useState<GenerationLog[]>([]);
  const [speechHistoryLoading, setSpeechHistoryLoading] = useState(true);
  const [speechHistoryError, setSpeechHistoryError] = useState('');
  const [continuation, setContinuation] = useState<{ uploadUrl: string; continueAt?: string; title: string } | null>(null);
  const [previewOutput, setPreviewOutput] = useState<{ taskId: string; output: CangyuanMediaOutput; outputIndex: number; modelName: string } | null>(null);
  const speechUrlRef = useRef('');
  const musicPollRef = useRef(false);
  const threePollRef = useRef(false);
  const musicPollCursorRef = useRef<string | null>(null);
  const threePollCursorRef = useRef<string | null>(null);

  const handleMediaUploadState = useCallback((fieldId: string, uploading: boolean) => {
    setUploadingMediaFields((current) => {
      const next = new Set(current);
      if (uploading) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }, []);

  const speechModels = useMemo(() => supportedSpeechModels(publicState), [publicState]);
  const musicModels = useMemo(() => supportedMusicModels(publicState), [publicState]);
  const soundEffectModels = useMemo(() => supportedSoundEffectModels(publicState), [publicState]);
  const models3d = useMemo(() => threeDModels(publicState), [publicState]);
  const speechModel = useMemo(() => speechModels.find((model) => model.id === speechModelId) || speechModels[0], [speechModelId, speechModels]);
  const speechProfile = useMemo(() => getSpeechModelProfile(speechModel?.rawId || ''), [speechModel]);
  const speechFormats = speechProfile ? getSpeechModelResponseFormats(speechProfile.publicModel, speechAdvanced.engine) : [];
  const speechSpeedRange = speechProfile ? getSpeechModelSpeedRange(speechProfile.publicModel, speechAdvanced.engine) : undefined;
  const selectedSpeechFormat = speechFormats.includes(speechFormat) ? speechFormat : speechFormats[0];
  const speechTextLimit = speechProfile?.textMaxLength ?? SPEECH_PLATFORM_TEXT_LIMIT;
  const dialogueDraftText = speechAdvanced.dialogueText ?? speechAdvanced.dialogue?.map((line) => `${line.voice} | ${line.text}`).join('\n') ?? '';
  const dialogueDraftError = speechDialogueDraftError(dialogueDraftText);
  const displayedSpeechSpeed = speechSpeedRange ? clampSpeechSpeed(speechSpeed, speechSpeedRange.min, speechSpeedRange.max) : speechSpeed;
  const musicModel = useMemo(() => musicModels.find((model) => model.id === musicModelId) || musicModels[0], [musicModelId, musicModels]);
  const musicProfile = useMemo(() => getCangyuanMusicModelProfile(musicModel?.rawId || ''), [musicModel]);
  const soundEffectModel = useMemo(() => soundEffectModels.find((model) => model.id === soundEffectModelId) || soundEffectModels[0], [soundEffectModelId, soundEffectModels]);
  const soundEffectProfile = useMemo(() => getCangyuanMusicModelProfile(soundEffectModel?.rawId || ''), [soundEffectModel]);
  const isCreativeAudioMode = mode === 'music' || mode === 'sound-effect';
  const creativeAudioModel = mode === 'sound-effect' ? soundEffectModel : musicModel;
  const creativeAudioProfile = mode === 'sound-effect' ? soundEffectProfile : musicProfile;
  const creativeAudioKindName = mode === 'sound-effect' ? '音效' : cangyuanMusicTaskKindName(creativeAudioProfile);
  const model3d = useMemo(() => models3d.find((model) => model.id === model3dId) || models3d[0], [model3dId, models3d]);
  const previewUrl = previewOutput
    ? `/api/media/model-preview/${encodeURIComponent(previewOutput.taskId)}/${previewOutput.outputIndex}`
    : '';
  const selectedTasks = mode === 'music' ? musicTasks.filter((task) => !isSoundEffectTask(task))
    : mode === 'sound-effect' ? musicTasks.filter(isSoundEffectTask)
      : mode === '3d' ? threeTasks : [];
  const sortedMusicTasks = useMemo(() => [...musicTasks].sort(taskSort), [musicTasks]);
  const sortedThreeTasks = useMemo(() => [...threeTasks].sort(taskSort), [threeTasks]);

  const loadPublicState = useCallback(async () => {
    setLoadingState(true);
    setStateError('');
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const data = await response.json() as PublicState & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取模型配置失败');
      setPublicState(data);
    } catch (error) {
      setStateError(error instanceof Error ? error.message : '读取模型配置失败');
    } finally {
      setLoadingState(false);
    }
  }, []);

  const loadTasks = useCallback(async (kind: CangyuanMediaKind) => {
    try {
      const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}`, { cache: 'no-store' });
      const data = await response.json() as { tasks?: CangyuanMediaTask[]; error?: string };
      if (!response.ok) throw new Error(data.error || '读取生成记录失败');
      const tasks = Array.isArray(data.tasks) ? data.tasks.filter((task) => task.kind === kind) : [];
      if (kind === 'music') setMusicTasks(tasks);
      else setThreeTasks(tasks);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '读取生成记录失败' });
    }
  }, []);

  const loadSpeechHistory = useCallback(async () => {
    setSpeechHistoryLoading(true);
    setSpeechHistoryError('');
    try {
      const logs = await listGenerationLogs(200);
      setSpeechLogs(logs.filter((log) => log.mode === 'audio' && log.status === 'success' && Boolean(log.audioUrl)));
    } catch (error) {
      setSpeechHistoryError(error instanceof Error ? error.message : '读取配音记录失败');
    } finally {
      setSpeechHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPublicState();
    void loadTasks('music');
    void loadTasks('3d');
    void loadSpeechHistory();
  }, [loadPublicState, loadTasks, loadSpeechHistory]);

  useEffect(() => {
    if (!speechUrlRef.current) return;
    URL.revokeObjectURL(speechUrlRef.current);
    speechUrlRef.current = '';
    setSpeechResult(null);
  }, [speechModelId]);

  useEffect(() => {
    setSpeechVoiceChoice('');
    setSpeechCustomVoice('');
    setSpeechFormat('mp3');
    setSpeechSpeed(1);
    setSpeechAdvanced({});
  }, [speechModel?.id]);

  useEffect(() => {
    if (mode === 'music' && continuation && creativeAudioModel?.rawId === 'suno-extend-audio') {
      setMusicOptions({ uploadUrl: continuation.uploadUrl, ...(continuation.continueAt ? { continueAt: continuation.continueAt } : {}) });
      return;
    }
    setMusicOptions({});
  }, [creativeAudioModel?.id, mode]);

  useEffect(() => {
    const profile = model3d ? getCangyuan3DModelProfile(model3d.rawId) : null;
    setGenerationMode(profile?.defaultMode || 'image-to-3d');
    setImageUrl('');
    setMultiviewImages({});
    setTexture('standard');
    setPbr(false);
    setTripoOptions({});
    setTrellisTextureSize('');
    setTrellisSeed('');
    setTrellisMeshSimplify('');
    setTrellisSsGuidance('');
    setTrellisSsSteps('');
    setTrellisSlatGuidance('');
    setTrellisSlatSteps('');
    setTrellisAdvancedOpen(false);
  }, [model3d?.rawId]);

  useEffect(() => () => {
    if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
  }, []);

  const pollTasks = useCallback(async (kind: CangyuanMediaKind) => {
    const busyRef = kind === 'music' ? musicPollRef : threePollRef;
    if (busyRef.current) return;
    const currentTasks = kind === 'music' ? musicTasks : threeTasks;
    const cursorRef = kind === 'music' ? musicPollCursorRef : threePollCursorRef;
    const batch = nextCangyuanTaskPollBatch(currentTasks, cursorRef.current, 4);
    if (!batch.tasks.length) return;
    cursorRef.current = batch.lastTaskId;
    busyRef.current = true;
    try {
      const updated = await Promise.all(batch.tasks.map(async (task) => {
        const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}/tasks/${encodeURIComponent(task.id)}`, { cache: 'no-store' });
        const data = await response.json() as { task?: CangyuanMediaTask; error?: string };
        if (!response.ok || !data.task) throw new Error(data.error || '查询任务状态失败');
        return data.task;
      }));
      if (kind === 'music') setMusicTasks((current) => current.map((task) => updated.find((item) => item.id === task.id) || task));
      else setThreeTasks((current) => current.map((task) => updated.find((item) => item.id === task.id) || task));
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '查询任务状态失败' });
    } finally {
      busyRef.current = false;
    }
  }, [musicTasks, threeTasks]);

  useEffect(() => {
    if (!musicTasks.some(isActiveTask)) return;
    const timer = window.setInterval(() => void pollTasks('music'), CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [musicTasks, pollTasks]);

  useEffect(() => {
    if (!threeTasks.some(isActiveTask)) return;
    const timer = window.setInterval(() => void pollTasks('3d'), CANGYUAN_3D_TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [threeTasks, pollTasks]);

  async function submitSpeech() {
    const text = speechText.trim();
    if (!text || !speechModel || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          modelId: speechModel.id,
          source: 'workspace',
          ...(speechProfile && !speechProfile.supportsDialogue && !speechProfile.requiresVoiceId && speechVoiceChoice === 'custom'
            ? (speechCustomVoice.trim() ? { voice: speechCustomVoice.trim() } : {})
            : (speechProfile && !speechProfile.supportsDialogue && !speechProfile.requiresVoiceId && speechVoiceChoice ? { voice: speechVoiceChoice } : {})),
          ...(speechFormats.includes(speechFormat) ? { format: speechFormat } : {}),
          ...(speechSpeedRange ? { speed: clampSpeechSpeed(speechSpeed, speechSpeedRange.min, speechSpeedRange.max) } : {}),
          ...getSpeechModelAdvancedOptions(speechProfile?.publicModel || '', speechAdvanced),
        }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(readError(payload, `配音生成失败（${response.status}）`));
      }
      const blob = await response.blob();
      const persistedUrl = response.headers.get('X-Audio-Url');
      const url = persistedUrl || URL.createObjectURL(blob);
      if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = persistedUrl ? '' : url;
      const extension = response.headers.get('X-Audio-Extension') || 'mp3';
      setSpeechResult({
        url,
        name: `speech-${Date.now()}.${extension}`,
        modelName: response.headers.get('X-Audio-Model') || speechModel.displayName,
        contentType: blob.type || 'audio/mpeg',
        extension,
      });
      await loadSpeechHistory();
      setNotice({ kind: 'success', text: '配音已生成。' });
      const storageError = response.headers.get('X-Audio-Storage-Error');
      if (storageError) {
        let message = storageError;
        try { message = decodeURIComponent(storageError); } catch { /* Keep the encoded transport value as a fallback. */ }
        setNotice({ kind: 'info', text: message });
      }
      onNotify?.('配音已生成');
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '配音生成失败' });
    } finally {
      setBusy(false);
    }
  }

  async function submitMedia(kind: CangyuanMediaKind) {
    const selectedModel = kind === 'music' ? creativeAudioModel : model3d;
    const prompt = (kind === 'music' ? musicPrompt : prompt3d).trim();
    const profile3d = kind === '3d' && selectedModel ? getCangyuan3DModelProfile(selectedModel.rawId) : null;
    const promptRequired = kind === 'music' ? creativeAudioProfile?.promptRequired !== false : profile3d?.modelId === 'tripo3d' || generationMode === 'text-to-3d';
    const requiresSingleImage = kind === '3d' && (profile3d?.family === 'trellis' || generationMode === 'image-to-3d');
    if (!selectedModel || promptRequired && !prompt || busy) return;
    if (kind === 'music' && mode === 'music' && continuation && (selectedModel.rawId !== 'suno-extend-audio' || musicOptions.uploadUrl !== continuation.uploadUrl)) {
      setNotice({ kind: 'error', text: '请使用续写工作流和所选音频来源，或清除续写来源后继续。' });
      return;
    }
    if (requiresSingleImage && !isPublicHttpsUrl(imageUrl)) {
      setNotice({ kind: 'error', text: '图生 3D 需要可公开访问的图片 URL。' });
      return;
    }
    if (kind === '3d' && generationMode === 'multiview-to-3d') {
      const presentViews = Object.entries(multiviewImages).filter(([, url]) => Boolean(url?.trim()));
      if (presentViews.length < 2 || !multiviewImages.front?.trim()) {
        setNotice({ kind: 'error', text: '多视图生成至少上传 2 张图片，并且必须包含正面图。' });
        return;
      }
    }
    setBusy(true);
    setNotice(null);
    try {
      let input: CangyuanMediaCreateInput;
      if (kind === 'music') {
        const supportedOptions = creativeAudioProfile?.allowedOptions.reduce<CangyuanMusicOptions>((result, key) => {
          const value = (musicOptions as Record<string, unknown>)[key];
          if (value !== undefined) {
            Object.assign(result, { [key]: value });
          }
          return result;
        }, {}) || {};
        input = {
          kind: 'music',
          modelId: selectedModel.id,
          prompt,
          options: {
            ...supportedOptions,
          },
        };
      } else if (isLegacyTripoModel(selectedModel)) {
        input = {
          kind: '3d',
          modelId: selectedModel.id,
          prompt,
          options: {
            mode: generationMode,
            ...(generationMode === 'image-to-3d' ? { imageUrl: imageUrl.trim() } : {}),
            texture,
            pbr,
          },
        };
      } else if (profile3d?.family === 'tripo') {
        const views = Object.fromEntries(Object.entries(multiviewImages).filter(([, url]) => Boolean(url?.trim()))) as Partial<Record<Cangyuan3DView, string>>;
        input = {
          kind: '3d',
          modelId: selectedModel.id,
          prompt,
          options: {
            mode: generationMode,
            ...(generationMode === 'image-to-3d' ? { imageUrl: imageUrl.trim() } : {}),
            ...(generationMode === 'multiview-to-3d' ? { multiviewImages: views } : {}),
            ...tripoOptions,
          },
        };
      } else if (isTrellisModel(selectedModel)) {
        const seed = trellisSeed.trim();
        input = {
          kind: '3d',
          modelId: selectedModel.id,
          prompt,
          options: {
            imageUrl: imageUrl.trim(),
            ...(trellisTextureSize.trim() ? { textureSize: trellisTextureSize.trim() } : {}),
            ...(seed ? { seed } : {}),
            ...(trellisMeshSimplify !== '' ? { meshSimplify: Number(trellisMeshSimplify) } : {}),
            ...(trellisSsGuidance !== '' ? { ssGuidanceStrength: Number(trellisSsGuidance) } : {}),
            ...(trellisSsSteps !== '' ? { ssSamplingSteps: Number(trellisSsSteps) } : {}),
            ...(trellisSlatGuidance !== '' ? { slatGuidanceStrength: Number(trellisSlatGuidance) } : {}),
            ...(trellisSlatSteps !== '' ? { slatSamplingSteps: Number(trellisSlatSteps) } : {}),
          },
        };
      } else {
        setNotice({ kind: 'error', text: '当前三维型号尚未接入。' });
        return;
      }
      const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(input),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; task?: CangyuanMediaTask; error?: string } | null;
      if (!payload?.task) throw new Error(readError(payload, '生成任务提交失败。'));
      const submittedTask = payload.task;
      if (kind === 'music') setMusicTasks((current) => [submittedTask, ...current.filter((task) => task.id !== submittedTask.id)]);
      else setThreeTasks((current) => [submittedTask, ...current.filter((task) => task.id !== submittedTask.id)]);
      if (!response.ok || payload.ok === false || submittedTask.status === 'failed') {
        setNotice({ kind: 'error', text: submittedTask.error || readError(payload, '生成任务提交失败。') });
        return;
      }
      if (kind === 'music') {
        setMusicPrompt('');
        setContinuation(null);
      } else {
        setPrompt3d('');
      }
      setNotice({ kind: 'info', text: '任务已提交，正在按服务商状态更新。' });
      onNotify?.('生成任务已提交');
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '生成任务提交失败。' });
    } finally {
      setBusy(false);
    }
  }

  function applyThreeDScenario(scenario: CangyuanThreeDScenario) {
    if (scenario.tripo) {
      setTexture(scenario.tripo.texture);
      setPbr(scenario.tripo.pbr);
    }
    if (scenario.trellis) {
      setTrellisTextureSize('');
      setTrellisSeed('');
      setTrellisMeshSimplify('');
      setTrellisSsGuidance('');
      setTrellisSsSteps('');
      setTrellisSlatGuidance('');
      setTrellisSlatSteps('');
      const options = scenario.trellis;
      if (options.meshSimplify !== undefined || options.slatGuidanceStrength !== undefined) setTrellisAdvancedOpen(true);
      if (options.textureSize !== undefined) setTrellisTextureSize(options.textureSize);
      if (options.meshSimplify !== undefined) setTrellisMeshSimplify(String(options.meshSimplify));
      if (options.slatGuidanceStrength !== undefined) setTrellisSlatGuidance(String(options.slatGuidanceStrength));
      if (scenario.id === 'concept' && !trellisSeed.trim()) {
        setNotice({ kind: 'info', text: '概念建模建议固定随机种子；输入同一个种子可复现接近的网格。' });
      }
    }
  }

  function chooseContinuation(task: CangyuanMediaTask, output: MediaTaskAudioOutputValue) {
    if (!output.url || !isPublicHttpsUrl(output.url) || output.artifactType === 'midi' || output.artifactType === 'wav' || output.artifactType === 'text') {
      setNotice({ kind: 'error', text: '该结果没有可供续写的公开音频地址。' });
      return;
    }
    const continuationModel = musicModels.find((model) => model.rawId === 'suno-extend-audio');
    if (!continuationModel) {
      setNotice({ kind: 'error', text: '请先在模型库启用音乐续写模型。' });
      return;
    }
    setMusicModelId(continuationModel.id);
    const continueAt = output.duration && output.duration > 0 ? String(output.duration) : undefined;
    setContinuation({ uploadUrl: output.url, ...(continueAt ? { continueAt } : {}), title: output.title || task.modelName });
    setMusicOptions({ uploadUrl: output.url, ...(continueAt ? { continueAt } : {}) });
    setMusicPrompt((current) => current.trim() ? current : '延续原曲风格，自然展开后续段落');
    setMode('music');
    setNotice({ kind: 'info', text: continueAt ? `已选中音频，续写位置预填为 ${continueAt} 秒，可在提交前调整。` : '已选中音频，请确认续写位置后生成。' });
  }

  async function copyTaskId(task: CangyuanMediaTask) {
    if (!task.providerTaskId) return;
    try {
      await navigator.clipboard.writeText(task.providerTaskId);
      setNotice({ kind: 'success', text: '任务编号已复制，可粘贴到其他创作工作流。' });
    } catch {
      setNotice({ kind: 'error', text: `复制失败，请手动复制任务编号：${task.providerTaskId}` });
    }
  }

  function clearContinuation() {
    setContinuation(null);
    setMusicOptions((current) => {
      const { uploadUrl: _uploadUrl, continueAt: _continueAt, ...remaining } = current;
      return remaining;
    });
  }

  const availableCount = mode === 'speech' ? speechModels.length : mode === 'music' ? musicModels.length : mode === 'sound-effect' ? soundEffectModels.length : models3d.length;
  const selectedModel = mode === 'speech' ? speechModel : isCreativeAudioMode ? creativeAudioModel : model3d;
  const currentTasks = isCreativeAudioMode ? sortedMusicTasks : sortedThreeTasks;
  const isTripo = mode === '3d' && isTripoModel(model3d);
  const isLegacyTripo = mode === '3d' && isLegacyTripoModel(model3d);
  const isTrellis = mode === '3d' && isTrellisModel(model3d);
  const profile3d = mode === '3d' && model3d ? getCangyuan3DModelProfile(model3d.rawId) : null;
  const threeDPromptRequired = profile3d?.modelId === 'tripo3d' || generationMode === 'text-to-3d';
  const threeDSingleImageRequired = isTrellis || generationMode === 'image-to-3d';
  const activeMultiviewCount = Object.values(multiviewImages).filter((url) => Boolean(url?.trim())).length;

  return (
    <main className="cangyuan-studio" aria-label="媒体生成">
      <header className="cangyuan-studio-header">
        <div>
          <p className="cangyuan-studio-eyebrow">创作工作台</p>
          <h1>媒体生成</h1>
          <p>配音、转写、音乐与三维模型在一个工作区中使用和管理。</p>
        </div>
        <nav className="cangyuan-studio-tabs" aria-label="生成类型">
          <button type="button" className={mode === 'speech' ? 'active' : ''} aria-pressed={mode === 'speech'} onClick={() => { setMode('speech'); setNotice(null); }}>配音</button>
          <button type="button" className={mode === 'transcription' ? 'active' : ''} aria-pressed={mode === 'transcription'} onClick={() => { setMode('transcription'); setNotice(null); }}>转写</button>
          <button type="button" className={mode === 'music' ? 'active' : ''} aria-pressed={mode === 'music'} onClick={() => { setMode('music'); setNotice(null); }}>音乐</button>
          <button type="button" className={mode === 'sound-effect' ? 'active' : ''} aria-pressed={mode === 'sound-effect'} onClick={() => { setMode('sound-effect'); setNotice(null); }}>音效</button>
          <button type="button" className={mode === '3d' ? 'active' : ''} aria-pressed={mode === '3d'} onClick={() => { setMode('3d'); setNotice(null); }}>三维</button>
        </nav>
        <div className="cangyuan-studio-header-meta">
          {onOpenModels && <button type="button" className="cangyuan-link-button" onClick={onOpenModels}>模型库</button>}
        </div>
      </header>

      {notice && <p className={`cangyuan-studio-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {stateError && <div className="cangyuan-studio-error" role="alert"><span>{stateError}</span><button type="button" onClick={() => void loadPublicState()}>重试</button></div>}
      {loadingState && <div className="cangyuan-studio-loading" role="status">正在读取可用模型…</div>}

      {!loadingState && !stateError && (
        mode === 'transcription' && publicState
          ? <AudioTranscription state={publicState} onOpenModels={onOpenModels} onNotify={onNotify} />
          : <div className="cangyuan-studio-layout">
          <section className="cangyuan-studio-form" aria-label={`${mode === 'speech' ? '配音' : isCreativeAudioMode ? creativeAudioKindName : '三维'}生成设置`}>
            <div className="cangyuan-form-heading">
              <div>
                <h2>{mode === 'speech' ? '文本配音' : isCreativeAudioMode ? `${creativeAudioKindName}生成` : '三维生成'}</h2>
                <p>{mode === 'speech' ? '提交文本并接收音频文件。' : isCreativeAudioMode ? mode === 'sound-effect' ? '描述声音本身，任务完成后可试听或下载。' : '输入音乐创作描述，任务完成后可试听、下载或续作。' : '按所选模型公开的参数生成 GLB。'}</p>
              </div>
              <span className="cangyuan-capability-count">{availableCount} 个模型</span>
            </div>

            <span className="cangyuan-field-label">生成模型</span>
            <ModelPicker
              models={mode === 'speech' ? speechModels : mode === 'music' ? musicModels : mode === 'sound-effect' ? soundEffectModels : models3d}
              value={mode === 'speech' ? speechModel?.id || 'auto' : isCreativeAudioMode ? creativeAudioModel?.id || 'auto' : model3d?.id || 'auto'}
              onChange={(value) => {
                if (mode === 'speech') setSpeechModelId(value === 'auto' ? speechModels[0]?.id || '' : value);
                else if (mode === 'music') {
                  const nextModel = musicModels.find((model) => model.id === value) || musicModels[0];
                  setMusicModelId(nextModel?.id || '');
                  if (continuation && nextModel?.rawId !== 'suno-extend-audio') clearContinuation();
                }
                else if (mode === 'sound-effect') setSoundEffectModelId(value === 'auto' ? soundEffectModels[0]?.id || '' : value);
                else {
                  const nextModelId = value === 'auto' ? models3d[0]?.id || '' : value;
                  const nextModel = models3d.find((model) => model.id === nextModelId);
                  const nextProfile = getCangyuan3DModelProfile(nextModel?.rawId || '');
                  setModel3dId(nextModelId);
                  if (nextProfile) setGenerationMode((current) => reconcileCangyuan3DMode(nextProfile.modelId, current));
                  if (nextProfile?.modelId !== CANGYUAN_TRIPO3D_V31_PUBLIC_MODEL) {
                    setTripoOptions((current) => current.geometryQuality === undefined
                      ? current
                      : { ...current, geometryQuality: undefined });
                  }
                }
              }}
              capability={mode === 'speech' ? 'speech' : mode === 'music' ? 'music-generate' : mode === 'sound-effect' ? 'sound-effect' : '3d-generate'}
              defaultProviderId={publicState?.settings.defaultProviderId}
              defaultModelId={mode === 'speech' ? speechModels[0]?.id : mode === 'music' ? musicModels[0]?.id : mode === 'sound-effect' ? soundEffectModels[0]?.id : models3d[0]?.id}
              placeholder="选择模型"
              triggerLabelMode="model"
              disabled={busy || availableCount === 0}
              className="cangyuan-model-picker"
            />

            {availableCount === 0 ? (
              <div className="cangyuan-empty-models">
                <p>没有可用的{mode === 'speech' ? '配音' : isCreativeAudioMode ? creativeAudioKindName : '三维'}模型。</p>
                <span>请在模型库同步并启用具备对应能力的模型。</span>
                {onOpenModels && <button type="button" onClick={onOpenModels}>打开模型库</button>}
              </div>
            ) : mode === 'speech' ? (
              <>
                {speechProfile && (
                  <div className="cangyuan-speech-options" aria-label="配音参数">
                    {!speechProfile.supportsDialogue && !speechProfile.requiresVoiceId && <div className="cangyuan-speech-field">
                      <span>音色</span>
                      <SelectMenu
                        value={speechVoiceChoice}
                        ariaLabel="配音音色"
                        className="cangyuan-field-select"
                        menuClassName="cangyuan-field-select-menu"
                        options={[
                          { value: '', label: '使用模型默认音色' },
                          ...speechVoiceOptions(speechProfile).map((option) => ({
                            ...option,
                            action: <VoiceSampleButton model={speechProfile.publicModel} voice={option.value} optionAction />,
                          })),
                          { value: 'custom', label: '自定义音色名称' },
                        ]}
                        onChange={setSpeechVoiceChoice}
                      />
                      {speechVoiceChoice && speechVoiceChoice !== 'custom' && <VoiceSampleButton model={speechProfile.publicModel} voice={speechVoiceChoice} />}
                    </div>}
                    {!speechProfile.supportsDialogue && !speechProfile.requiresVoiceId && speechVoiceChoice === 'custom' && (
                      <label className="cangyuan-speech-field" htmlFor="cangyuan-speech-custom-voice">
                        <span>自定义音色</span>
                        <input
                          id="cangyuan-speech-custom-voice"
                          type="text"
                          maxLength={100}
                          value={speechCustomVoice}
                          onChange={(event) => setSpeechCustomVoice(event.target.value)}
                          placeholder="输入服务商支持的音色名称"
                        />
                      </label>
                    )}
                    {speechFormats.length > 0 && <div className="cangyuan-speech-field">
                      <span>输出格式</span>
                      <SelectMenu
                        value={selectedSpeechFormat}
                        ariaLabel="配音输出格式"
                        className="cangyuan-field-select"
                        menuClassName="cangyuan-field-select-menu"
                        options={speechFormats.map((format) => ({ value: format, label: speechOutputFormatLabel(format) }))}
                        onChange={(format) => setSpeechFormat(format as SpeechOutputFormat)}
                      />
                    </div>}
                    {speechSpeedRange && (
                      <div className="cangyuan-speech-speed">
                        <label htmlFor="cangyuan-speech-speed-range">语速</label>
                        <input
                          id="cangyuan-speech-speed-range"
                          type="range"
                          min={speechSpeedRange.min}
                          max={speechSpeedRange.max}
                          step="0.05"
                          value={displayedSpeechSpeed}
                          onChange={(event) => setSpeechSpeed(clampSpeechSpeed(Number(event.target.value), speechSpeedRange.min, speechSpeedRange.max))}
                        />
                        <input
                          aria-label="语速数值"
                          type="number"
                          min={speechSpeedRange.min}
                          max={speechSpeedRange.max}
                          step="any"
                          value={displayedSpeechSpeed}
                          onChange={(event) => setSpeechSpeed(clampSpeechSpeed(Number(event.target.value), speechSpeedRange.min, speechSpeedRange.max))}
                        />
                        <small>{speechProfile.publicModel === 'voice-clone-tts' && speechAdvanced.engine?.startsWith('elevenlabs-v4') ? '该引擎限制为 0.7–1.2' : `${speechSpeedRange.min}–${speechSpeedRange.max}，默认 1`}</small>
                      </div>
                    )}
                    <SpeechAdvancedOptions profile={speechProfile} value={speechAdvanced} onChange={setSpeechAdvanced} disabled={busy} />
                  </div>
                )}
                <label className="cangyuan-field-label" htmlFor="cangyuan-speech-text">配音文本</label>
                <textarea id="cangyuan-speech-text" className="cangyuan-prompt" value={speechText} maxLength={speechTextLimit} onChange={(event) => setSpeechText(event.target.value)} placeholder={speechProfile?.supportsDialogue ? '填写对白说明，并在更多语音设置中逐行添加角色台词' : '输入要朗读的文本'} rows={8} />
                <div className="cangyuan-field-foot"><span>{speechProfile?.supportsDialogue ? '多人对白字段按逐句角色对象提交；官方目录的字段类型定义存在冲突' : speechProfile?.textMaxLength ? `当前型号正文上限 ${speechProfile.textMaxLength} 字符` : `平台输入上限 ${SPEECH_PLATFORM_TEXT_LIMIT} 字符；官方未列该型号专属上限`}</span><span>{speechText.length}/{speechTextLimit}</span></div>
                <div className="cangyuan-submit-row">
                  <span>{speechModel?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || !speechText.trim() || !speechModel || speechVoiceChoice === 'custom' && !speechCustomVoice.trim() || speechProfile?.requiresVoiceId && !speechAdvanced.voiceId?.trim() || speechProfile?.supportsDialogue && (!speechAdvanced.dialogue?.length || Boolean(dialogueDraftError))} onClick={() => void submitSpeech()}>{busy ? '正在生成…' : speechProfile?.supportsDialogue ? '生成对白' : '生成配音'}</button>
                </div>
              </>
            ) : isCreativeAudioMode ? (
              <>
                {mode === 'music' && continuation && <div className="cangyuan-continuation-banner"><span>续写来源：{continuation.title}</span><button type="button" aria-label="清除续写来源" onClick={clearContinuation}>清除</button></div>}
                <label className="cangyuan-field-label" htmlFor="cangyuan-music-prompt">{mode === 'sound-effect' ? '音效描述' : '音乐提示词'}{creativeAudioProfile?.promptRequired ? '（必填）' : '（可选）'}</label>
                <textarea id="cangyuan-music-prompt" className="cangyuan-prompt" value={musicPrompt} maxLength={creativeAudioProfile?.promptMaxLength} onChange={(event) => setMusicPrompt(event.target.value)} placeholder={creativeAudioProfile?.family === 'su2' ? '直接描述希望生成的音乐' : creativeAudioProfile?.family === 'suno-sfx' || creativeAudioProfile?.family === 'elevenlabs-sfx' ? '描述单个声音，例如关门声、雨打窗户' : creativeAudioProfile?.family === 'elevenlabs-music' ? '描述音乐内容、情绪与场景' : creativeAudioProfile?.family === 'suno-workflow' && !creativeAudioProfile.promptRequired ? '此工作流可根据来源素材处理，无需额外提示词' : mode === 'sound-effect' ? '描述想生成的声音效果' : '描述曲风、情绪、乐器与场景'} rows={8} />
                <div className="cangyuan-field-foot"><span>{creativeAudioProfile?.family === 'su2' ? '仅使用提示词；每次固定生成 1 首' : creativeAudioProfile?.family === 'lyria' ? '一次生成 1 首；时长与节奏速度（每分钟拍数）为目标值，成片以实际结果为准' : creativeAudioProfile?.family === 'suno-sfx' ? '用于短音效，不是完整歌曲；结果可能包含多段音频' : creativeAudioProfile?.family === 'elevenlabs-sfx' ? '短音效用途；参数按所选型号的时长限制生效' : creativeAudioProfile?.family === 'elevenlabs-music' ? '默认时长 30 秒；高码率 MP3 会增加费用' : '歌词、风格与续作字段按所选型号发送'}</span><span>{creativeAudioProfile?.promptMaxLength ? `${musicPrompt.length}/${creativeAudioProfile.promptMaxLength}` : `${musicPrompt.length} 字`}</span></div>
                {creativeAudioProfile && <CangyuanMusicOptionsFields profile={creativeAudioProfile} options={musicOptions} onChange={setMusicOptions} onUploadStateChange={handleMediaUploadState} />}
                <div className="cangyuan-submit-row">
                  <span>{creativeAudioModel?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || uploadingMediaFields.size > 0 || Boolean(creativeAudioProfile?.promptRequired && !musicPrompt.trim()) || !creativeAudioModel} onClick={() => void submitMedia('music')}>{uploadingMediaFields.size > 0 ? '正在上传素材…' : busy ? '正在提交…' : creativeAudioProfile?.family === 'suno-workflow' ? '运行音乐工具' : `生成${creativeAudioKindName}`}</button>
                </div>
              </>
            ) : (
              <>
                {isTripo && profile3d && (
                  <div className="cangyuan-mode-control" role="group" aria-label="三维生成方式">
                    {profile3d.supportedModes.map((supportedMode) => (
                      <button key={supportedMode} type="button" aria-pressed={generationMode === supportedMode} className={generationMode === supportedMode ? 'active' : ''} onClick={() => setGenerationMode(supportedMode)}>
                        {supportedMode === 'text-to-3d' ? '文生 3D' : supportedMode === 'image-to-3d' ? '图生 3D' : '多视图 3D'}
                      </button>
                    ))}
                  </div>
                )}
                {(isLegacyTripo || isTrellis) && <CangyuanThreeDScenarioPicker key={model3d?.rawId || ''} modelId={model3d?.rawId || ''} onApply={applyThreeDScenario} />}
                <label className="cangyuan-field-label" htmlFor="cangyuan-3d-prompt">物体描述{threeDPromptRequired ? '（必填）' : '（可选）'}</label>
                <textarea id="cangyuan-3d-prompt" className="cangyuan-prompt" value={prompt3d} onChange={(event) => setPrompt3d(event.target.value)} placeholder="描述模型的形状、材质与风格" rows={6} />
                {threeDSingleImageRequired && (
                  <div className="cangyuan-image-url-field">
                    <CangyuanMediaUploadField fieldId="cangyuan-3d-reference-image" kind="image" label="参考图片" value={imageUrl} onChange={setImageUrl} onUploadingChange={handleMediaUploadState} note="Trellis 必须提供图片；图生任务需要可公开访问的图片链接。" />
                    <CangyuanReferenceImagePreview url={imageUrl} />
                  </div>
                )}
                {isTripo && generationMode === 'multiview-to-3d' && (
                  <div className="cangyuan-image-url-field">
                    <div className="cangyuan-trellis-grid">
                      {(['front', 'back', 'left', 'right'] as const).map((view) => (
                        <div className="cangyuan-image-url-field" key={view}>
                          <CangyuanMediaUploadField
                            fieldId={`cangyuan-3d-view-${view}`}
                            kind="image"
                            label={view === 'front' ? '正面（必需）' : view === 'back' ? '背面' : view === 'left' ? '左侧' : '右侧'}
                            value={multiviewImages[view] || ''}
                            onChange={(url) => setMultiviewImages((current) => ({ ...current, [view]: url || undefined }))}
                            onUploadingChange={handleMediaUploadState}
                          />
                          <CangyuanReferenceImagePreview url={multiviewImages[view] || ''} />
                        </div>
                      ))}
                    </div>
                    <small>至少提交 2 张不同方向的公网图片，并且必须包含正面。参考图越清晰、背景越干净，网格通常越稳定。</small>
                  </div>
                )}
                {isLegacyTripo && (
                  <div className="cangyuan-3d-options">
                    <div className="cangyuan-select-field"><span>贴图质量</span><SelectMenu value={texture} ariaLabel="三维贴图质量" className="cangyuan-field-select" menuClassName="cangyuan-field-select-menu" options={[{ value: 'no', label: '无贴图' }, { value: 'standard', label: '标准' }, { value: 'HD', label: '高清（HD）' }]} onChange={(value) => setTexture(value as typeof texture)} /></div>
                    <label className="cangyuan-checkbox-field"><input type="checkbox" checked={pbr} onChange={(event) => setPbr(event.target.checked)} /><span>物理渲染材质（PBR）</span></label>
                  </div>
                )}
                {profile3d?.family === 'tripo' && (
                  <CangyuanTripoQualityOptions profile={profile3d} options={tripoOptions} onChange={setTripoOptions} />
                )}
                {isTrellisModel(model3d) && (
                  <div className="cangyuan-3d-trellis-options">
                    <div className="cangyuan-trellis-grid">
                      <label className="cangyuan-music-text-field"><span>贴图边长</span><CangyuanSuggestionInput ariaLabel="贴图边长" inputMode="numeric" value={trellisTextureSize} onChange={setTrellisTextureSize} options={['512', '1024', '2048']} placeholder="默认 1024" /><small>2048 更清晰，模型文件也更大。</small></label>
                    </div>
                    <details className="cangyuan-3d-advanced" open={trellisAdvancedOpen} onToggle={(event) => setTrellisAdvancedOpen(event.currentTarget.open)}>
                      <summary>质量与网格</summary>
                      <div className="cangyuan-trellis-grid">
                        <label className="cangyuan-music-text-field"><span>随机种子</span><input type="text" inputMode="numeric" value={trellisSeed} onChange={(event) => setTrellisSeed(event.target.value)} placeholder="可选" /><small>相同参考图搭配同一种子，通常会生成相近的模型。</small></label>
                        <label className="cangyuan-music-text-field"><span>网格简化 0.9–0.98</span><input type="number" min="0.9" max="0.98" step="0.01" value={trellisMeshSimplify} onChange={(event) => setTrellisMeshSimplify(event.target.value)} placeholder="模型默认" /><small>数值越大模型越轻，细节会减少。</small></label>
                        <label className="cangyuan-music-text-field"><span>结构引导 0–10</span><input type="number" min="0" max="10" step="0.1" value={trellisSsGuidance} onChange={(event) => setTrellisSsGuidance(event.target.value)} placeholder="模型默认" /><small>控制轮廓与体积贴合参考图的程度。</small></label>
                        <label className="cangyuan-music-text-field"><span>结构步数 1–50</span><input type="number" min="1" max="50" step="1" value={trellisSsSteps} onChange={(event) => setTrellisSsSteps(event.target.value)} placeholder="模型默认" /><small>步数增加会改善轮廓细节，也会变慢。</small></label>
                        <label className="cangyuan-music-text-field"><span>细节引导 0–10</span><input type="number" min="0" max="10" step="0.1" value={trellisSlatGuidance} onChange={(event) => setTrellisSlatGuidance(event.target.value)} placeholder="模型默认" /><small>控制表面与颜色贴近参考图的程度。</small></label>
                        <label className="cangyuan-music-text-field"><span>细节步数 1–50</span><input type="number" min="1" max="50" step="1" value={trellisSlatSteps} onChange={(event) => setTrellisSlatSteps(event.target.value)} placeholder="模型默认" /><small>步数增加会细化表面，也会变慢。</small></label>
                      </div>
                    </details>
                    <p className="cangyuan-model-note">Trellis 仅支持图生。增加采样步数会变慢；简化值越大，网格越轻、细节越少。参数不填时交由模型默认处理。</p>
                  </div>
                )}
                {!isTripo && !isTrellis && <p className="cangyuan-model-note">当前模型未提供已核对的专属参数。</p>}
                <div className="cangyuan-submit-row">
                  <span>{model3d?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || uploadingMediaFields.size > 0 || (!prompt3d.trim() && threeDPromptRequired) || !model3d || threeDSingleImageRequired && !imageUrl.trim() || generationMode === 'multiview-to-3d' && (activeMultiviewCount < 2 || !multiviewImages.front?.trim())} onClick={() => void submitMedia('3d')}>{uploadingMediaFields.size > 0 ? '正在上传素材…' : busy ? '正在提交…' : '生成 3D 模型'}</button>
                </div>
              </>
            )}
          </section>

          {mode !== 'speech' ? (
            <section className="cangyuan-studio-results" aria-label="生成任务">
              <div className="cangyuan-results-header">
                <div><h2>{mode === 'music' ? '音乐任务' : mode === 'sound-effect' ? '音效任务' : '三维任务'}</h2><p>最近 {currentTasks.length} 条 · 状态自动更新</p></div>
                <button type="button" className="cangyuan-refresh-button" aria-label="刷新任务列表" title="刷新任务列表" onClick={() => void loadTasks(isCreativeAudioMode ? 'music' : '3d')}>刷新</button>
              </div>
              {selectedTasks.length === 0 ? (
                <div className="cangyuan-task-empty"><strong>还没有生成任务</strong><span>提交一次生成后，任务与结果会显示在这里。</span></div>
              ) : (
                <div className="cangyuan-task-list">
                  {(isCreativeAudioMode ? selectedTasks : sortedThreeTasks).map((task) => (
                    <article className="cangyuan-task-item" key={task.id}>
                      <div className="cangyuan-task-title-row">
                        <div><strong>{task.modelName}</strong><small>{formatCreatedAt(task.createdAt)}</small></div>
                        <span className={`cangyuan-task-status ${isActiveTask(task) ? 'active' : task.status}`}>{taskStatusLabel(task)}</span>
                      </div>
                      <p className="cangyuan-task-prompt">{task.input.prompt || (task.kind === '3d' ? mediaTaskModeLabel(task.input.mode) : '音乐生成任务')}</p>
                      {task.providerTaskId && task.status === 'succeeded' && <div className="cangyuan-output-actions"><button type="button" onClick={() => void copyTaskId(task)}>复制任务编号</button></div>}
                      {isActiveTask(task) && <p className="cangyuan-task-progress">{mediaTaskProviderStatusLabel(task.providerStatus, task.status)}</p>}
                      {task.error && <p className="cangyuan-task-error" role="alert">{task.error}</p>}
                      {task.status === 'succeeded' && task.outputs.length === 0 && <p className="cangyuan-task-error">任务完成，但服务商没有返回结果地址。</p>}
                      {task.outputs.map((output, index) => isCreativeAudioMode ? (
                        <MediaTaskAudioOutput
                          key={`${task.id}-${output.audioId || index}`}
                          output={output}
                          index={index}
                          canContinue={mode === 'music' && Boolean(output.url && isPublicHttpsUrl(output.url) && output.artifactType !== 'midi' && output.artifactType !== 'wav' && output.artifactType !== 'text' && output.artifactType !== 'file')}
                          onContinue={(selectedOutput) => chooseContinuation(task, selectedOutput)}
                        />
                      ) : (
                        <div className="cangyuan-3d-output" key={`${task.id}-${index}`}>
                          <div className="cangyuan-output-meta"><b>{output.artifactType === 'fbx' ? `FBX 模型 ${index + 1}` : `GLB 模型 ${index + 1}`}</b><span>{output.artifactType === 'fbx' ? 'FBX 网格文件' : 'GLB（二进制 glTF）'}</span></div>
                          <div className="cangyuan-output-actions">
                            {output.url ? <>
                              {output.artifactType !== 'fbx' && <button type="button" onClick={() => setPreviewOutput({ taskId: task.id, output, outputIndex: index, modelName: task.modelName })}>预览</button>}
                              <a href={output.url} download target="_blank" rel="noreferrer">下载 {output.artifactType === 'fbx' ? 'FBX' : 'GLB'}</a>
                            </> : <span className="cangyuan-model-note">服务商未返回可下载的模型地址。</span>}
                          </div>
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="cangyuan-studio-results" aria-label="配音结果">
              {speechHistoryLoading ? <div className="cangyuan-task-empty" role="status">正在读取配音记录…</div>
                : speechHistoryError ? <div className="cangyuan-studio-error" role="alert"><span>{speechHistoryError}</span><button type="button" onClick={() => void loadSpeechHistory()}>重试</button></div>
                  : speechLogs.length ? <GenerationLogAudioWorks logs={speechLogs} />
                    : <div className="cangyuan-task-empty"><strong>还没有配音记录</strong><span>成功生成并保存的配音会显示在这里。</span></div>}
              {speechResult && !speechLogs.some((log) => log.audioUrl === speechResult.url) && (
                <div className="cangyuan-speech-result">
                  <div className="cangyuan-result-heading"><b>本次生成</b><span>{speechResult.modelName} · {speechResult.contentType}</span></div>
                  {speechResult.extension.toLowerCase() === 'pcm'
                    ? <><p className="cangyuan-pcm-note">PCM 已生成。此格式通常需要导入音频编辑软件。</p><a className="cangyuan-download-link" href={speechResult.url} download={speechResult.name}>下载音频</a></>
                    : <GenerationLogAudioPlayer src={speechResult.url} fileName={speechResult.name} />}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {previewOutput && previewUrl && <div className="cangyuan-preview-modal" role="dialog" aria-modal="true" aria-label="三维模型预览" onClick={() => setPreviewOutput(null)}>
        <div className="cangyuan-preview-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="cangyuan-preview-header"><div><strong>{previewOutput.modelName}</strong><span>GLB 三维预览</span></div><button type="button" aria-label="关闭预览" onClick={() => setPreviewOutput(null)}>关闭</button></div>
          <ThreeDModelPreview url={previewUrl} label={previewOutput.modelName} variant="dialog" />
          <div className="cangyuan-preview-footer"><span>任务 {previewOutput.taskId.slice(0, 8)}</span><a href={previewOutput.output.url} download target="_blank" rel="noreferrer">下载 GLB</a></div>
        </div>
      </div>}
    </main>
  );
}
