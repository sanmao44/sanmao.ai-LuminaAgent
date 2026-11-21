import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasAudioDraft, CanvasAudioGenerationMeta, CanvasAudioMusicDraft, CanvasAudioMusicTask, CanvasAudioTranscriptionDraft, CanvasAudioTranscriptionMeta, CanvasNode } from "@/lib/canvas/types";
import type { ProviderConnection, RegistryModel } from "@/lib/types";
import { selectAutomaticModel } from "@/lib/model-selection";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { canvasAudioMusicModels, canvasAudioMusicTaskStatusLabel, canvasAudioSoundEffectModels, canvasAudioSpeechModels, canvasAudioTranscriptionModels, buildCanvasMusicRequest, canvasMusicTaskSnapshot, canvasTranscriptionResult } from "@/lib/canvas/audio-tools";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import ModelPicker from "@/components/ModelPicker";
import SelectMenu from "@/components/SelectMenu";
import { getSpeechModelAdvancedOptions, getSpeechModelProfile, getSpeechModelResponseFormats, getSpeechModelSpeedRange, SPEECH_PLATFORM_TEXT_LIMIT, speechVoiceLabel, type SpeechOutputFormat } from "@/packages/contracts/audio-synthesis";
import SpeechAdvancedOptions, { speechDialogueDraftError, type SpeechAdvancedDraft } from "@/components/audio/SpeechAdvancedOptions";
import type { AudioTranscriptionResponseFormat } from "@/packages/contracts/audio-transcription";
import { getCangyuanMusicModelProfile, type CangyuanMediaOutput, type CangyuanMediaTask, type CangyuanMusicOptions } from "@/packages/contracts/cangyuan-media";
import { speechVoiceOptions } from "@/components/audio/voice-options";
import { speechOutputFormatLabel } from "@/components/audio/speech-format-options";
import VoiceSampleButton from "@/components/audio/VoiceSampleButton";
import { isCangyuanProvider } from "@/lib/cangyuan-provider";
import { buildCanvasSpeechRequest } from "@/components/canvas/audio-speech-request";
import CangyuanMusicOptionsFields, { cangyuanMusicTaskKindName } from "@/components/cangyuan/CangyuanMusicOptionsFields";
import { CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS, nextCangyuanTaskPollBatch } from "@/lib/cangyuan-media-task-polling";

const SPEECH_TEXT_LIMIT = SPEECH_PLATFORM_TEXT_LIMIT;
const TRANSCRIPTION_MAX_BYTES = 50 * 1024 * 1024;
const TRANSCRIPTION_ACCEPT = ".mp3,.wav,.ogg,.m4a,.flac,.webm,.pcm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/webm";
const TRANSCRIPTION_LANGUAGES = [
  { value: "", label: "自动识别" }, { value: "zh", label: "中文" }, { value: "en", label: "英语" },
  { value: "ja", label: "日语" }, { value: "ko", label: "韩语" }, { value: "fr", label: "法语" },
  { value: "de", label: "德语" }, { value: "es", label: "西班牙语" }, { value: "__custom", label: "其他语言" },
];
const TRANSCRIPTION_FORMATS = [
  { value: "verbose_json", label: "文字与分段时间" }, { value: "json", label: "标准文字" }, { value: "text", label: "纯文本" },
];

export type CanvasAudioNodePanelProps = {
  node: CanvasNode;
  onReplaceAudio: (nodeId: string, file: File, generation?: CanvasAudioGenerationMeta) => Promise<boolean>;
  onSpeechDraftChange: (nodeId: string, draft: CanvasAudioDraft) => void;
  onTranscriptionDraftChange: (nodeId: string, draft: CanvasAudioTranscriptionDraft) => void;
  onTranscriptionChange: (nodeId: string, result: CanvasAudioTranscriptionMeta) => void;
  onMusicDraftChange: (nodeId: string, draft: CanvasAudioMusicDraft) => void;
  onSoundEffectDraftChange: (nodeId: string, draft: CanvasAudioMusicDraft) => void;
  onMusicTaskChange: (nodeId: string, task: CanvasAudioMusicTask) => void;
  onDurationChange: (nodeId: string, durationSeconds: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  models: RegistryModel[];
  providers: ProviderConnection[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  defaultModelId?: string | null;
  projectId?: string;
  canvasId?: string;
};

export default function CanvasAudioNodePanel({
  node,
  onReplaceAudio,
  onSpeechDraftChange,
  onTranscriptionDraftChange,
  onTranscriptionChange,
  onMusicDraftChange,
  onSoundEffectDraftChange,
  onMusicTaskChange,
  onDurationChange,
  onNotify,
  models,
  providers,
  defaultProviderId,
  defaultProviderName,
  defaultModelId,
  projectId,
  canvasId,
}: CanvasAudioNodePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptionInputRef = useRef<HTMLInputElement | null>(null);
  const soundEffectModels = canvasAudioSoundEffectModels(models, providers);
  const soundEffectModelIdKey = soundEffectModels.map((model) => model.id).join("|");
  const initialSoundEffectDraft = node.data.soundEffectDraft || (
    node.data.musicDraft?.modelId && soundEffectModels.some((model) => model.id === node.data.musicDraft?.modelId)
      ? node.data.musicDraft
      : { prompt: "", options: {} }
  );
  const [activeMode, setActiveMode] = useState<"speech" | "transcription" | "music" | "sound-effect">("speech");
  const [speechText, setSpeechText] = useState(() => node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
  const [voice, setVoice] = useState(() => node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
  const [customVoiceSelected, setCustomVoiceSelected] = useState(false);
  const [speechModelId, setSpeechModelId] = useState(() => node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
  const [speechFormat, setSpeechFormat] = useState<SpeechOutputFormat>(() => (node.data.speechDraft?.format || node.data.speechGeneration?.format || "mp3") as SpeechOutputFormat);
  const [speechSpeed, setSpeechSpeed] = useState(() => node.data.speechDraft?.speed ?? node.data.speechGeneration?.speed ?? 1);
  const [speechAdvanced, setSpeechAdvanced] = useState<SpeechAdvancedDraft>(() => ({
    applyTextNormalization: node.data.speechDraft?.applyTextNormalization,
    engine: node.data.speechDraft?.engine,
    languageCode: node.data.speechDraft?.languageCode,
    language: node.data.speechDraft?.language,
    seed: node.data.speechDraft?.seed,
    similarityBoost: node.data.speechDraft?.similarityBoost,
    stability: node.data.speechDraft?.stability,
    voiceId: node.data.speechDraft?.voiceId,
    emotion: node.data.speechDraft?.emotion,
    instruct: node.data.speechDraft?.instruct,
    dialogue: node.data.speechDraft?.dialogue,
    dialogueText: node.data.speechDraft?.dialogueText,
    aigcWatermark: node.data.speechDraft?.aigcWatermark,
    bitrate: node.data.speechDraft?.bitrate,
    channel: node.data.speechDraft?.channel,
    effectIntensity: node.data.speechDraft?.effectIntensity,
    effectPitch: node.data.speechDraft?.effectPitch,
    effectTimbre: node.data.speechDraft?.effectTimbre,
    latexRead: node.data.speechDraft?.latexRead,
    pitch: node.data.speechDraft?.pitch,
    pronunciationTone: node.data.speechDraft?.pronunciationTone,
    sampleRate: node.data.speechDraft?.sampleRate,
    soundEffects: node.data.speechDraft?.soundEffects,
    textNormalizationMode: node.data.speechDraft?.textNormalizationMode,
    volume: node.data.speechDraft?.volume,
  }));
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [transcriptionDraft, setTranscriptionDraft] = useState<CanvasAudioTranscriptionDraft>(() => node.data.transcriptionDraft || {});
  const [transcriptionFile, setTranscriptionFile] = useState<File | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const [musicDraft, setMusicDraft] = useState<CanvasAudioMusicDraft>(() => node.data.musicDraft || { prompt: "", options: {} });
  const [soundEffectDraft, setSoundEffectDraft] = useState<CanvasAudioMusicDraft>(() => initialSoundEffectDraft);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState("");
  const musicPollCursorRef = useRef<string | null>(null);
  const [materializingMusicOutput, setMaterializingMusicOutput] = useState("");
  const [uploadingMusicFields, setUploadingMusicFields] = useState<Set<string>>(() => new Set());
  const handleMusicUploadStateChange = useCallback((fieldId: string, uploading: boolean) => {
    setUploadingMusicFields((current) => {
      if (current.has(fieldId) === uploading) return current;
      const next = new Set(current);
      if (uploading) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }, []);
  const data = node.data;
  const musicHistory = useMemo(() => data.musicTasks?.length ? data.musicTasks : data.musicTask ? [data.musicTask] : [], [data.musicTasks, data.musicTask]);
  const currentMusicKindName = activeMode === "sound-effect" ? "音效" : "音乐";
  const currentMusicTask = musicHistory.find((task) => cangyuanMusicTaskKindName(getCangyuanMusicModelProfile(task.providerModel || "")) === currentMusicKindName);
  const currentTranscription = (data.transcriptions?.[0] || data.transcription) as CanvasAudioTranscriptionMeta | undefined;
  const transcriptionHistory = data.transcriptions?.length ? data.transcriptions : data.transcription ? [data.transcription] : [];
  const speechHistory = data.speechGenerations?.length ? data.speechGenerations : data.speechGeneration ? [data.speechGeneration] : [];
  const hasAudio = Boolean(data.url);
  const showAudioSource = hasAudio || speechHistory.length > 0 || transcriptionHistory.length > 0 || musicHistory.length > 0;
  const musicModels = canvasAudioMusicModels(models, providers);
  const transcriptionModels = canvasAudioTranscriptionModels(models, providers);
  const speechModels = canvasAudioSpeechModels(models, providers);
  const selectedModel = speechModelId !== "auto"
    ? speechModels.find((model) => model.id === speechModelId)
    : selectAutomaticModel(speechModels, defaultProviderId, defaultModelId);
  const speechSampleProviderKey = isCangyuanProvider(providers.find((provider) => provider.id === selectedModel?.providerId)) ? "cangyuan" : "";
  const speechProviderKey = speechSampleProviderKey || undefined;
  const speechProfile = getSpeechModelProfile(selectedModel?.rawId || "", speechProviderKey);
  const usesRegisteredVoice = Boolean(speechProfile?.supportsVoiceId && speechAdvanced.voiceId?.trim());
  const speechFormats = speechProfile
    ? getSpeechModelResponseFormats(speechProfile.publicModel, speechAdvanced.engine, speechProviderKey)
    : ['mp3', 'wav'] as const;
  const speechSpeedRange = speechProfile ? getSpeechModelSpeedRange(speechProfile.publicModel, speechAdvanced.engine, speechProviderKey) : undefined;
  const speechTextLimit = speechProfile?.textMaxLength ?? SPEECH_TEXT_LIMIT;
  const dialogueDraftText = speechAdvanced.dialogueText ?? speechAdvanced.dialogue?.map((line) => `${line.voice} | ${line.text}`).join("\n") ?? "";
  const dialogueDraftError = speechDialogueDraftError(dialogueDraftText);
  const knownVoice = Boolean(speechProfile?.suggestedVoices.includes(voice));
  const voiceChoice = knownVoice ? voice : customVoiceSelected || voice ? "custom" : "";
  const supportedFormat = speechFormats.includes(speechFormat)
    ? speechFormat
    : speechFormats[0];
  const speechSpeedValue = speechSpeedRange
    ? Math.min(speechSpeedRange.max, Math.max(speechSpeedRange.min, speechSpeed))
    : speechSpeed;
  const speechServiceLabel = data.speechGeneration?.engine === "offline"
    ? "本机离线语音"
    : data.speechGeneration?.modelName || "尚未生成";
  const selectedMusicModel = musicModels.find((model) => model.id === musicDraft.modelId) || musicModels[0];
  const selectedSoundEffectModel = soundEffectModels.find((model) => model.id === soundEffectDraft.modelId) || soundEffectModels[0];
  const selectedTranscriptionModel = transcriptionModels.find((model) => model.id === transcriptionDraft.modelId) || transcriptionModels[0];
  const musicProfile = selectedMusicModel ? getCangyuanMusicModelProfile(selectedMusicModel.rawId) : null;
  const activeMusicModel = activeMode === "sound-effect" ? selectedSoundEffectModel : selectedMusicModel;
  const activeMusicDraft = activeMode === "sound-effect" ? soundEffectDraft : musicDraft;
  const activeMusicProfile = activeMusicModel ? getCangyuanMusicModelProfile(activeMusicModel.rawId) : null;
  const musicTaskKindName = activeMode === "sound-effect" ? "音效" : cangyuanMusicTaskKindName(musicProfile);
  const activeMusicTaskKey = musicHistory
    .filter((task) => ["pending", "queued", "running", "waiting"].includes(task.status))
    .map((task) => `${task.id}:${task.status}`)
    .join("|");

  useEffect(() => {
    setSpeechText(node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
    setVoice(node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
    setSpeechModelId(node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
    setSpeechFormat((node.data.speechDraft?.format || node.data.speechGeneration?.format || "mp3") as SpeechOutputFormat);
    setSpeechSpeed(node.data.speechDraft?.speed ?? node.data.speechGeneration?.speed ?? 1);
    setSpeechAdvanced({
      applyTextNormalization: node.data.speechDraft?.applyTextNormalization,
      engine: node.data.speechDraft?.engine,
      languageCode: node.data.speechDraft?.languageCode,
      language: node.data.speechDraft?.language,
      seed: node.data.speechDraft?.seed,
      similarityBoost: node.data.speechDraft?.similarityBoost,
      stability: node.data.speechDraft?.stability,
      voiceId: node.data.speechDraft?.voiceId,
      emotion: node.data.speechDraft?.emotion,
      instruct: node.data.speechDraft?.instruct,
      dialogue: node.data.speechDraft?.dialogue,
      dialogueText: node.data.speechDraft?.dialogueText,
    });
    setSpeechError("");
  }, [node.id, node.data.speechDraft, node.data.speechGeneration]);

  useEffect(() => {
    setTranscriptionDraft(node.data.transcriptionDraft || {});
    setTranscriptionFile(null);
    setTranscriptionError("");
    setMusicDraft(node.data.musicDraft || { prompt: "", options: {} });
    setSoundEffectDraft(initialSoundEffectDraft);
    setMusicError("");
  }, [node.id, node.data.transcriptionDraft, node.data.musicDraft, node.data.soundEffectDraft, soundEffectModelIdKey]);

  useEffect(() => setCustomVoiceSelected(false), [node.id]);

  useEffect(() => {
    if (!activeMusicTaskKey) {
      musicPollCursorRef.current = null;
      return;
    }
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const poll = async () => {
      const requestController = new AbortController();
      controller = requestController;
      const batch = nextCangyuanTaskPollBatch(musicHistory, musicPollCursorRef.current, 4);
      if (!batch.tasks.length) return;
      musicPollCursorRef.current = batch.lastTaskId;
      try {
        const results = await Promise.allSettled(batch.tasks.map(async (task) => {
          const response = await fetch(`/api/cangyuan/music/tasks/${encodeURIComponent(task.id)}`, {
            cache: "no-store",
            signal: requestController.signal,
          });
          const payload = await response.json().catch(() => null) as { task?: CangyuanMediaTask; error?: string } | null;
          if (!response.ok || !payload?.task) throw new Error(payload?.error || "音乐任务状态暂时无法读取。");
          return canvasMusicTaskSnapshot(payload.task);
        }));
        if (disposed) return;
        for (const result of results) {
          if (result.status === "fulfilled") onMusicTaskChange(node.id, result.value);
          else if (!requestController.signal.aborted) setMusicError(result.reason instanceof Error ? result.reason.message : "音乐任务状态读取失败。");
        }
        if (!disposed) timer = window.setTimeout(() => void poll(), CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS);
      } catch (error) {
        if (disposed || requestController.signal.aborted) return;
        setMusicError(error instanceof Error ? error.message : "音乐任务状态读取失败。");
        timer = window.setTimeout(() => void poll(), CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [node.id, activeMusicTaskKey, musicHistory, onMusicTaskChange]);

  function saveSpeechDraft(next: Partial<CanvasAudioDraft> = {}) {
    onSpeechDraftChange(node.id, {
      text: next.text ?? speechText,
      voice: next.voice ?? voice,
      modelId: next.modelId ?? speechModelId,
      format: next.format ?? speechFormat,
      speed: next.speed ?? speechSpeed,
      ...speechAdvanced,
      ...next,
      updatedAt: Date.now(),
    });
  }

  function saveTranscriptionDraft(next: Partial<CanvasAudioTranscriptionDraft> = {}) {
    const draft: CanvasAudioTranscriptionDraft = {
      ...transcriptionDraft,
      ...next,
      updatedAt: Date.now(),
    };
    setTranscriptionDraft(draft);
    onTranscriptionDraftChange(node.id, draft);
  }

  function saveMusicDraft(next: Partial<CanvasAudioMusicDraft> = {}) {
    const draft: CanvasAudioMusicDraft = {
      ...musicDraft,
      ...next,
      prompt: next.prompt ?? musicDraft.prompt,
      options: next.options ?? musicDraft.options,
      updatedAt: Date.now(),
    };
    setMusicDraft(draft);
    onMusicDraftChange(node.id, draft);
  }

  function saveSoundEffectDraft(next: Partial<CanvasAudioMusicDraft> = {}) {
    const draft: CanvasAudioMusicDraft = {
      ...soundEffectDraft,
      ...next,
      prompt: next.prompt ?? soundEffectDraft.prompt,
      options: next.options ?? soundEffectDraft.options,
      updatedAt: Date.now(),
    };
    setSoundEffectDraft(draft);
    onSoundEffectDraftChange(node.id, draft);
  }

  function chooseTranscriptionFile(file: File | undefined) {
    if (!file) return;
    setTranscriptionError("");
    const allowed = /\.(mp3|wav|ogg|m4a|flac|webm|pcm)$/i.test(file.name);
    if (!allowed || file.size <= 0 || file.size > TRANSCRIPTION_MAX_BYTES) {
      setTranscriptionError("请选择有效音频文件，大小需大于 0 且不超过 50 MiB。");
      return;
    }
    setTranscriptionFile(file);
  }

  async function fileForTranscription() {
    if (transcriptionFile) return transcriptionFile;
    if (!data.url) throw new Error("请先导入音频素材，或选择一个音频文件。");
    let source: URL;
    try {
      source = new URL(String(data.url), window.location.origin);
    } catch {
      throw new Error("当前音频地址无效，请重新导入音频文件。");
    }
    if (source.origin !== window.location.origin) throw new Error("当前音频来自外部地址，请重新选择本地音频文件进行转写。");
    const response = await fetch(source.href, { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取当前音频，请重新选择本地音频文件。");
    const blob = await response.blob();
    if (!blob.size || blob.size > TRANSCRIPTION_MAX_BYTES) throw new Error("音频文件需大于 0 且不超过 50 MiB。");
    return new File([blob], String(data.name || "画布音频.wav"), { type: blob.type || String(data.mimeType || "audio/wav") });
  }

  async function transcribeAudio() {
    if (!selectedTranscriptionModel || transcriptionBusy) return;
    setTranscriptionError("");
    setTranscriptionBusy(true);
    try {
      const file = await fileForTranscription();
      const form = new FormData();
      form.set("file", file);
      form.set("modelId", selectedTranscriptionModel.id);
      const language = transcriptionDraft.language === "__custom"
        ? transcriptionDraft.customLanguage?.trim() || ""
        : transcriptionDraft.language?.trim() || "";
      if (language) form.set("language", language);
      if (transcriptionDraft.prompt?.trim()) form.set("prompt", transcriptionDraft.prompt.trim());
      form.set("responseFormat", transcriptionDraft.responseFormat || "verbose_json");
      form.set("temperature", String(transcriptionDraft.temperature ?? 0));
      const response = await fetch("/api/audio/transcriptions", { method: "POST", body: form, cache: "no-store" });
      const payload = await response.json().catch(() => null) as { result?: Record<string, unknown>; error?: string } | null;
      if (!response.ok || !payload?.result) throw new Error(payload?.error || `转写失败（${response.status}）`);
      const result = canvasTranscriptionResult(payload.result, file.name) as CanvasAudioTranscriptionMeta;
      onTranscriptionChange(node.id, result);
      onNotify("音频转写完成");
    } catch (error) {
      setTranscriptionError(error instanceof Error ? error.message : "音频转写失败，请重试。");
    } finally {
      setTranscriptionBusy(false);
    }
  }

  async function generateMusic() {
    if (!activeMusicModel || !activeMusicProfile || musicBusy || uploadingMusicFields.size > 0) return;
    setMusicError("");
    setMusicBusy(true);
    try {
      const input = buildCanvasMusicRequest(activeMusicModel.id, activeMusicModel.rawId, activeMusicDraft.prompt, activeMusicDraft.options);
      const response = await fetch("/api/cangyuan/music", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as { task?: CangyuanMediaTask; error?: string } | null;
      if (!response.ok || !payload?.task) throw new Error(payload?.error || `${musicTaskKindName}任务提交失败（${response.status}）`);
      const task = canvasMusicTaskSnapshot(payload.task);
      onMusicTaskChange(node.id, task);
      if (payload.task.status === "failed") throw new Error(payload.task.error || "音乐任务提交失败。");
      onNotify(`${musicTaskKindName}任务已提交`);
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : `${musicTaskKindName}任务提交失败，请重试。`);
    } finally {
      setMusicBusy(false);
    }
  }

  async function useMusicOutput(output: CangyuanMediaOutput, outputKey: string) {
    if (!output.url || materializingMusicOutput) return;
    setMusicError("");
    setMaterializingMusicOutput(outputKey);
    try {
      const response = await fetch(output.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`音乐结果读取失败（${response.status}）`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("音乐结果为空，无法写入音频节点。");
      const extension = output.artifactType === "wav"
        ? "wav"
        : output.artifactType === "audio"
          ? "mp3"
          : String(output.artifactType || "mp3").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp3";
      const file = new File([blob], output.name || output.title || `AI音乐-${Date.now()}.${extension}`, {
        type: blob.type || (extension === "wav" ? "audio/wav" : "audio/mpeg"),
      });
      if (!await onReplaceAudio(node.id, file)) throw new Error("音乐已读取，但写入当前音频节点失败。");
      onNotify("音乐结果已写入当前音频节点");
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : "音乐结果写入失败，请下载后重试。");
    } finally {
      setMaterializingMusicOutput("");
    }
  }

  async function generateSpeech() {
    const text = speechText.trim();
    if (!text || generatingSpeech) return;
    setSpeechError("");
    setGeneratingSpeech(true);
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCanvasSpeechRequest({
          text,
          voice,
          modelId: speechModelId,
          ...(selectedModel?.rawId ? { profileModelId: selectedModel.rawId } : {}),
          ...(speechProviderKey ? { providerKey: speechProviderKey } : {}),
          ...(supportedFormat ? { format: supportedFormat } : {}),
          ...(speechSpeedRange ? { speed: speechSpeedValue } : {}),
          ...getSpeechModelAdvancedOptions(speechProfile?.publicModel || "", speechAdvanced, speechProviderKey),
          projectId,
          canvasId,
          nodeId: node.id,
        })),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(String(body?.error || `配音生成失败（${response.status}）`));
      }
      const blob = await response.blob();
      const rawExtension = response.headers.get("X-Audio-Extension") || "mp3";
      const extension = /^[a-z0-9]{1,8}$/i.test(rawExtension) ? rawExtension : "mp3";
      const file = new File([blob], `AI配音-${Date.now()}.${extension}`, {
        type: blob.type || "audio/mpeg",
      });
      const engine: CanvasAudioGenerationMeta['engine'] = response.headers.get("X-Audio-Engine") === "offline" ? "offline" : "provider";
      const encodedModelName = response.headers.get("X-Audio-Model");
      let modelName = encodedModelName || undefined;
      if (encodedModelName) {
        try { modelName = decodeURIComponent(encodedModelName); } catch { /* Keep the transport value as a fallback. */ }
      }
      modelName = modelName?.trim().slice(0, 120);
      const modelId = response.headers.get("X-Audio-Model-Id")?.trim().slice(0, 160);
      const generation: CanvasAudioGenerationMeta = {
        text,
        engine,
        requestedModelId: speechModelId,
        ...(modelName ? { modelName } : {}),
        ...(modelId ? { modelId } : {}),
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        ...(supportedFormat ? { format: supportedFormat } : {}),
        ...(speechSpeedRange ? { speed: speechSpeedValue } : {}),
        advancedOptions: getSpeechModelAdvancedOptions(speechProfile?.publicModel || "", speechAdvanced, speechProviderKey),
        createdAt: Date.now(),
      };
      const replaced = await onReplaceAudio(node.id, file, generation);
      if (!replaced) setSpeechError("配音已生成，但写入画布失败。原音频保持不变，请重试。");
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "配音生成失败，请稍后重试。");
    } finally {
      setGeneratingSpeech(false);
    }
  }

  async function copySpeechText() {
    const text = speechText.trim();
    if (!text || generatingSpeech) return;
    try {
      await navigator.clipboard.writeText(text);
      onNotify("配音文案已复制");
    } catch {
      onNotify("复制失败，请检查剪贴板权限", "error");
    }
  }

  async function copyTranscription(result = currentTranscription) {
    const text = result?.text || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onNotify("转写文字已复制");
    } catch {
      onNotify("复制失败，请检查剪贴板权限", "error");
    }
  }

  function downloadTranscription(result = currentTranscription) {
    const text = result?.text || "";
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(result?.sourceAudioName || "转写结果").replace(/\.[^.]+$/, "") || "转写结果"}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div
      className="canvas-audio-panel"
      data-canvas-wheel-isolate
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className={`canvas-audio-panel-main${showAudioSource ? " has-source" : ""}`}>
        <div className="canvas-audio-panel-workbench">
          <nav className="canvas-audio-mode-tabs" aria-label="音频工具">
            <button type="button" className={activeMode === "speech" ? "active" : ""} aria-pressed={activeMode === "speech"} onClick={() => setActiveMode("speech")}>配音</button>
            <button type="button" className={activeMode === "music" ? "active" : ""} aria-pressed={activeMode === "music"} onClick={() => setActiveMode("music")}>音乐</button>
            <button type="button" className={activeMode === "sound-effect" ? "active" : ""} aria-pressed={activeMode === "sound-effect"} onClick={() => setActiveMode("sound-effect")}>音效</button>
            <button type="button" className={activeMode === "transcription" ? "active" : ""} aria-pressed={activeMode === "transcription"} onClick={() => setActiveMode("transcription")}>转写</button>
          </nav>
        {activeMode === "speech" && <section className={`canvas-audio-speech${speechProfile && (speechProfile.supportsDialogue || speechProfile.supportsVoiceId || speechProfile.supportsAdvancedControls) ? " canvas-audio-speech-complex" : ""}`} aria-label="文本转配音">
          <div className="canvas-audio-speech-heading">
            <div>
              <label htmlFor={`canvas-audio-speech-${node.id}`}>文本配音</label>
              <small>旁白、台词或解说词</small>
            </div>
            <div className="canvas-audio-speech-tools">
              <button
                type="button"
                className="canvas-audio-speech-copy"
                onClick={() => void copySpeechText()}
                disabled={!speechText.trim() || generatingSpeech}
                title="复制配音文案"
              >
                复制文案
              </button>
              <small className="canvas-audio-speech-count">{speechText.length} / {speechTextLimit}{speechProfile?.textMaxLength ? "" : "（平台上限）"}</small>
            </div>
          </div>
        <textarea
          id={`canvas-audio-speech-${node.id}`}
          value={speechText}
          maxLength={speechTextLimit}
          rows={8}
          placeholder="输入旁白、台词或解说词…"
          onChange={(event) => {
            const text = event.target.value;
            setSpeechText(text);
            setSpeechError("");
            saveSpeechDraft({ text });
          }}
          disabled={generatingSpeech}
        />
        <section className="canvas-audio-advanced" aria-label="配音参数">
          <strong className="canvas-audio-settings-subheading">配音参数</strong>
        {speechProfile ? <>
          {!speechProfile.supportsDialogue && !speechProfile.requiresVoiceId && !usesRegisteredVoice && <>
            <div className="canvas-audio-option-field">
              <span className="canvas-audio-option-label">音色</span>
              <SelectMenu
                value={voiceChoice}
                ariaLabel="配音音色"
                className="canvas-audio-option-select"
                menuClassName="canvas-audio-option-menu"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                options={[
                  { value: "", label: "使用模型默认音色" },
                  ...speechVoiceOptions(speechProfile, speechSampleProviderKey).map((option) => ({
                    ...option,
                    action: <VoiceSampleButton model={speechProfile.publicModel} voice={option.value} providerKey={speechSampleProviderKey} optionAction />,
                  })),
                  { value: "custom", label: "自定义音色名称" },
                ]}
                onChange={(value) => {
                  const nextVoice = value === "custom" ? "" : value;
                  setCustomVoiceSelected(value === "custom");
                  setVoice(nextVoice);
                  setSpeechError("");
                  saveSpeechDraft({ voice: nextVoice });
                }}
                disabled={generatingSpeech}
              />
              {voiceChoice === "custom" && <input
                id={`canvas-audio-voice-${node.id}`}
                value={voice}
                maxLength={100}
                placeholder="输入服务商支持的音色名称"
                onChange={(event) => {
                  const nextVoice = event.target.value;
                  setVoice(nextVoice);
                  setSpeechError("");
                  saveSpeechDraft({ voice: nextVoice });
                }}
                disabled={generatingSpeech}
              />}
            </div>
          </>}
          {speechFormats.length > 0 && <>
            <div className="canvas-audio-option-field">
              <span className="canvas-audio-option-label">输出格式</span>
              <SelectMenu
                value={supportedFormat || speechFormats[0]}
                ariaLabel="配音输出格式"
                className="canvas-audio-option-select"
                menuClassName="canvas-audio-option-menu"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                options={speechFormats.map((format) => ({ value: format, label: speechOutputFormatLabel(format) }))}
                onChange={(value) => {
                  const nextFormat = value as SpeechOutputFormat;
                  setSpeechFormat(nextFormat);
                  if (nextFormat !== 'mp3' && speechAdvanced.bitrate !== undefined) {
                    const nextAdvanced = { ...speechAdvanced, bitrate: undefined };
                    setSpeechAdvanced(nextAdvanced);
                    saveSpeechDraft({ ...nextAdvanced, format: nextFormat });
                  } else {
                    saveSpeechDraft({ format: nextFormat });
                  }
                }}
                disabled={generatingSpeech}
              />
            </div>
          </>}
          {speechSpeedRange && <div className="canvas-audio-option-speed">
              <label htmlFor={`canvas-audio-speed-${node.id}`}>语速</label>
              <input
                id={`canvas-audio-speed-${node.id}`}
                type="range"
                min={speechSpeedRange.min}
                max={speechSpeedRange.max}
                step="0.05"
                value={speechSpeedValue}
                onChange={(event) => {
                  const speed = Number(event.target.value);
                  setSpeechSpeed(speed);
                  saveSpeechDraft({ speed });
                }}
                disabled={generatingSpeech}
              />
              <input
                type="number"
                aria-label="语速数值"
                min={speechSpeedRange.min}
                max={speechSpeedRange.max}
                step="0.05"
                value={speechSpeedValue}
                onChange={(event) => {
                  const speed = Number(event.target.value);
                  if (!Number.isFinite(speed)) return;
                  const bounded = Math.max(speechSpeedRange.min, Math.min(speechSpeedRange.max, speed));
                  setSpeechSpeed(bounded);
                  saveSpeechDraft({ speed: bounded });
                }}
                disabled={generatingSpeech}
              />
            </div>}
          </> : <>
            <label className="canvas-audio-option-field" htmlFor={`canvas-audio-voice-${node.id}`}>
              <span className="canvas-audio-option-label">音色名称</span>
              <input
                id={`canvas-audio-voice-${node.id}`}
                value={voice}
                maxLength={100}
                placeholder="留空使用默认音色"
                onChange={(event) => {
                  const nextVoice = event.target.value;
                  setVoice(nextVoice);
                  setSpeechError("");
                  saveSpeechDraft({ voice: nextVoice });
                }}
                disabled={generatingSpeech}
              />
            </label>
          </>}
          {usesRegisteredVoice && <small className="canvas-audio-input-note">当前使用已登记的自备音色编号，预设音色与样音不会参与本次生成。清空编号即可恢复预设音色。</small>}
          {speechProfile && <SpeechAdvancedOptions profile={speechProfile} value={speechAdvanced} onChange={(next) => { setSpeechAdvanced(next); saveSpeechDraft(next); }} disabled={generatingSpeech} compact alwaysVisible modelId={selectedModel?.id} format={supportedFormat || speechFormats[0]} />}
          <div className="canvas-audio-voice-sample-row">
            {usesRegisteredVoice
              ? <span className="voice-sample-unavailable">已登记音色编号暂无预设样音</span>
              : speechProfile && voice.trim() && voiceChoice !== "custom"
              ? <VoiceSampleButton model={speechProfile.publicModel} voice={voice.trim()} providerKey={speechSampleProviderKey} />
              : speechProfile && voiceChoice === "custom"
              ? <span className="voice-sample-unavailable" title="自定义音色没有经过验证的本地样音">自定义音色暂无对应样音</span>
              : <span className="voice-sample-unavailable">{speechProfile?.requiresVoiceId ? '已登记音色暂无本地样音' : speechProfile?.supportsDialogue ? '请为每句对白选择音色' : '选择已收录音色后可播放样音'}</span>}
            <small>本地样音只播放精确匹配的预设音色，不消耗额度；自定义音色不会使用其他音色代替。</small>
          </div>
        </section>
        </section>}
        {activeMode === "transcription" && <section className="canvas-audio-speech canvas-audio-transcription" aria-label="音频转写">
          <div className="canvas-audio-speech-heading">
            <div><label>音频转文字</label><small>{transcriptionFile?.name || (hasAudio ? String(data.name || "使用当前节点音频") : "选择要识别的音频文件")}</small></div>
            <button type="button" className="canvas-audio-speech-copy" onClick={() => transcriptionInputRef.current?.click()} disabled={transcriptionBusy}>选择文件</button>
          </div>
          <div className="canvas-audio-transcription-options">
            <label className="canvas-audio-option-field">
              <span className="canvas-audio-option-label">识别语言</span>
              <SelectMenu
                value={transcriptionDraft.language || ""}
                ariaLabel="录音语言"
                className="canvas-audio-option-select"
                menuClassName="canvas-audio-option-menu"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                options={TRANSCRIPTION_LANGUAGES}
                onChange={(value) => saveTranscriptionDraft({ language: value })}
                disabled={transcriptionBusy}
              />
            </label>
            {transcriptionDraft.language === "__custom" && <label className="canvas-audio-option-field">
              <span className="canvas-audio-option-label">语言代码</span>
              <input value={transcriptionDraft.customLanguage || ""} maxLength={30} placeholder="例如 it" onChange={(event) => saveTranscriptionDraft({ customLanguage: event.target.value })} disabled={transcriptionBusy} />
            </label>}
            <label className="canvas-audio-option-field">
              <span className="canvas-audio-option-label">输出内容</span>
              <SelectMenu
                value={transcriptionDraft.responseFormat || "verbose_json"}
                ariaLabel="转写结果格式"
                className="canvas-audio-option-select"
                menuClassName="canvas-audio-option-menu"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                options={TRANSCRIPTION_FORMATS}
                onChange={(value) => saveTranscriptionDraft({ responseFormat: value as AudioTranscriptionResponseFormat })}
                disabled={transcriptionBusy}
              />
            </label>
          </div>
          <label className="canvas-audio-transcription-prompt">
            <span className="canvas-audio-option-label">辅助词语（选填）</span>
            <textarea
              value={transcriptionDraft.prompt || ""}
              maxLength={12000}
              rows={4}
              placeholder="填写人名、品牌或行业术语，帮助提高识别准确度"
              onChange={(event) => saveTranscriptionDraft({ prompt: event.target.value })}
              disabled={transcriptionBusy}
            />
          </label>
          <div className="canvas-audio-transcription-temperature">
            <label htmlFor={`canvas-audio-temperature-${node.id}`}>识别稳定性</label>
            <input id={`canvas-audio-temperature-${node.id}`} type="range" min="0" max="1" step="0.05" value={transcriptionDraft.temperature ?? 0} onChange={(event) => saveTranscriptionDraft({ temperature: Number(event.target.value) })} disabled={transcriptionBusy} />
            <output>{(transcriptionDraft.temperature ?? 0) === 0 ? "最稳定" : (transcriptionDraft.temperature ?? 0).toFixed(2)}</output>
            <small>默认最稳定；提高后结果会更灵活。</small>
          </div>
          <small className="canvas-audio-input-note">支持 MP3、WAV、OGG、M4A、FLAC、WebM、PCM，最大 50 MiB</small>
        </section>}
        {(activeMode === "music" || activeMode === "sound-effect") && <section className="canvas-audio-speech canvas-audio-music" data-model-id={activeMusicProfile?.modelId} aria-label={`${musicTaskKindName}生成`}>
          <div className="canvas-audio-speech-heading">
            <div><label htmlFor={`canvas-audio-music-${node.id}`}>{musicTaskKindName === "音效" ? "音效描述" : "音乐创作描述"}</label><small>{activeMusicProfile?.promptRequired ? musicTaskKindName === "音效" ? "描述声音本身，不是完整歌曲" : "描述曲风、情绪、乐器与场景" : "按所选模型填写创作描述或工作流素材"}</small></div>
            {activeMusicProfile && <span className="canvas-audio-speech-count">{activeMusicDraft.prompt.length}{activeMusicProfile.promptMaxLength ? ` / ${activeMusicProfile.promptMaxLength}` : " 字"}</span>}
          </div>
          <textarea
            id={`canvas-audio-music-${node.id}`}
            value={activeMusicDraft.prompt}
            maxLength={activeMusicProfile?.promptMaxLength}
            rows={6}
            placeholder={musicTaskKindName === "音效" ? "描述声音本身，例如关门声、雨打窗户…" : "描述曲风、情绪、乐器与场景…"}
            onChange={(event) => {
              const prompt = event.target.value;
              setMusicError("");
              (activeMode === "sound-effect" ? saveSoundEffectDraft : saveMusicDraft)({ prompt });
            }}
            disabled={musicBusy}
          />
          {activeMusicProfile && <CangyuanMusicOptionsFields
            profile={activeMusicProfile}
            options={activeMusicDraft.options}
            alwaysVisible
            onChange={(options: CangyuanMusicOptions) => (activeMode === "sound-effect" ? saveSoundEffectDraft : saveMusicDraft)({ options })}
            onUploadStateChange={handleMusicUploadStateChange}
          />}
          {!(activeMode === "sound-effect" ? soundEffectModels : musicModels).length && <p className="canvas-audio-input-note">当前没有已接入可运行接口的{musicTaskKindName}模型。启用模型前，请确认对应服务商已完成该任务类型的接口适配。</p>}
        </section>}
        </div>
        {showAudioSource && <aside className="canvas-audio-panel-source" aria-label="音频素材与生成记录">
          <div className="canvas-audio-panel-intro">
            <div className="canvas-audio-panel-intro-copy">
              <span className="canvas-audio-panel-icon" aria-hidden="true">♫</span>
              <div>
                <b>音频素材</b>
                <small>试听、替换或连接到视频节点</small>
              </div>
            </div>
            <span className={`canvas-audio-panel-state${hasAudio ? " ready" : " empty"}`}>
              {hasAudio ? "已就绪" : "待导入"}
            </span>
          </div>
          {hasAudio ? (
            <div className="canvas-audio-panel-player">
              <CanvasAudioPlayer
                src={String(data.url)}
                name={String(data.name || "音频素材")}
                onDuration={(duration) => onDurationChange(node.id, duration)}
              />
              <div className="canvas-audio-panel-meta">
                <b title={String(data.name || "音频素材")}>{String(data.name || "音频素材")}</b>
                <div className="canvas-audio-panel-meta-chips">
                  <span>{String(data.mimeType || "audio/*")}</span>
                  <span>{formatCanvasAudioDuration(data.durationMs)}</span>
                  {data.assetId && <span title={String(data.assetId)}>资产 {String(data.assetId)}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="canvas-audio-panel-empty">
              <span>还没有音频</span>
              <small>生成配音或导入素材后，可在此试听</small>
            </div>
          )}
          {speechHistory.length > 0 && <details className="canvas-audio-generation" open={activeMode === "speech"}>
            <summary>配音生成记录 · {speechHistory.length} 条</summary>
            <div className="canvas-audio-generation-list">
              {speechHistory.map((generation, index) => <article key={`${generation.createdAt}-${index}`}>
                <p>{generation.text}</p>
                {generation.url && <CanvasAudioPlayer src={generation.url} name={generation.name || "配音结果"} compact />}
                <small>
                  {generation.engine === "offline" ? "本机离线语音" : generation.modelName || "在线配音模型"}
                  {generation.voice ? ` · ${speechVoiceLabel(generation.voice, generation.modelId || generation.requestedModelId || generation.modelName || "")}` : ""}
                  {generation.format ? ` · ${speechOutputFormatLabel(generation.format as SpeechOutputFormat)}` : ""}
                  {` · ${new Date(generation.createdAt).toLocaleString("zh-CN", { hour12: false })}`}
                </small>
                {generation.url && <a className="canvas-audio-history-download" href={generation.url} target="_blank" rel="noreferrer" download>下载音频</a>}
              </article>)}
            </div>
          </details>}
          {transcriptionHistory.length > 0 && <details className="canvas-audio-generation" open={activeMode === "transcription"}>
            <summary>转写记录 · {transcriptionHistory.length} 条</summary>
            <div className="canvas-audio-generation-list">
              {transcriptionHistory.map((transcription, transcriptionIndex) => <article key={`${transcription.createdAt}-${transcriptionIndex}`}>
                <b>{transcription.sourceAudioName}</b>
                <p className="canvas-audio-transcript-text">{transcription.text || "未识别到可用文字。"}</p>
                <small>{transcription.modelName}{transcription.language ? ` · ${transcription.language}` : " · 自动识别语言"} · {new Date(transcription.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
                {Boolean(transcription.segments?.length) && <details className="canvas-audio-transcript-segments">
                  <summary>查看分段时间</summary>
                  <ol>{transcription.segments?.map((segment, index) => <li key={`${segment.start}-${index}`}><time>{Math.floor(segment.start / 60).toString().padStart(2, "0")}:{Math.floor(segment.start % 60).toString().padStart(2, "0")}–{Math.floor(segment.end / 60).toString().padStart(2, "0")}:{Math.floor(segment.end % 60).toString().padStart(2, "0")}</time><span>{segment.text}</span></li>)}</ol>
                </details>}
                <div className="canvas-audio-result-actions">
                  <button type="button" className="canvas-audio-speech-copy" onClick={() => void copyTranscription(transcription)} disabled={!transcription.text}>复制文字</button>
                  <button type="button" className="canvas-audio-speech-copy" onClick={() => downloadTranscription(transcription)} disabled={!transcription.text}>下载文字</button>
                </div>
              </article>)}
            </div>
          </details>}
          {musicHistory.length > 0 && <details className="canvas-audio-generation" open={activeMode === "music" || activeMode === "sound-effect"}>
            <summary>音乐与音效任务记录 · {musicHistory.length} 条</summary>
            <div className="canvas-audio-generation-list">
              {musicHistory.map((musicTask) => <article key={musicTask.id}>
                <p>{musicTask.prompt || (cangyuanMusicTaskKindName(getCangyuanMusicModelProfile(musicTask.providerModel || "")) === "音效" ? "音效处理任务" : "音乐处理任务")}</p>
                <small>{cangyuanMusicTaskKindName(getCangyuanMusicModelProfile(musicTask.providerModel || ""))} · {musicTask.modelName} · {canvasAudioMusicTaskStatusLabel(musicTask.status)} · {new Date(musicTask.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
                {musicTask.error && <small className="canvas-audio-error">{musicTask.error}</small>}
                {musicTask.outputs.map((output, index) => output.url ? <div className="canvas-audio-music-output" key={`${musicTask.id}-${index}`}>
                  <b>{output.name || output.title || output.artifactType?.toUpperCase() || `结果 ${index + 1}`}</b>
                  {output.artifactType === "audio" || output.artifactType === "wav" || !output.artifactType
                    ? <CanvasAudioPlayer src={output.url} name={output.name || output.title || "音乐结果"} compact />
                    : <small>此结果为 {output.artifactType.toUpperCase()} 文件，可下载保存。</small>}
                  <div className="canvas-audio-result-actions">
                    {(output.artifactType === "audio" || output.artifactType === "wav" || !output.artifactType) && <button type="button" className="canvas-audio-speech-copy" onClick={() => void useMusicOutput(output, `${musicTask.id}-${index}`)} disabled={Boolean(materializingMusicOutput)}>{materializingMusicOutput === `${musicTask.id}-${index}` ? "正在写入…" : "设为当前音频"}</button>}
                    <a href={output.url} target="_blank" rel="noreferrer" download>{output.artifactType === "audio" || output.artifactType === "wav" || !output.artifactType ? "下载音频" : `下载 ${output.artifactType.toUpperCase()}`}</a>
                  </div>
                </div> : output.text ? <p key={`${musicTask.id}-${index}`}>{output.text}</p> : null)}
              </article>)}
            </div>
          </details>}
        </aside>}
      </div>
      <div className="canvas-audio-panel-actions">
        {(activeMode === "speech" ? speechError : activeMode === "music" || activeMode === "sound-effect" ? musicError : transcriptionError) && <p className="canvas-audio-error" role="alert">{activeMode === "speech" ? speechError : activeMode === "music" || activeMode === "sound-effect" ? musicError : transcriptionError}</p>}
        <div className="canvas-audio-panel-service" title={activeMode === "speech" ? speechServiceLabel : activeMode === "music" || activeMode === "sound-effect" ? activeMusicModel?.displayName || `暂无${musicTaskKindName}模型` : selectedTranscriptionModel?.displayName || "暂无转写模型"}>
          <span className="canvas-audio-panel-service-dot" aria-hidden="true" />
          <div>
            <b>{activeMode === "speech" ? "配音模型" : activeMode === "music" ? "音乐模型" : activeMode === "sound-effect" ? "音效模型" : "转写模型"}</b>
            <ModelPicker
              models={activeMode === "speech" ? speechModels : activeMode === "music" ? musicModels : activeMode === "sound-effect" ? soundEffectModels : transcriptionModels}
              capability={activeMode === "speech" ? "speech" : activeMode === "music" ? "music-generate" : activeMode === "sound-effect" ? "sound-effect" : "transcription"}
              value={activeMode === "speech" ? speechModelId : activeMode === "music" ? selectedMusicModel?.id || "" : activeMode === "sound-effect" ? selectedSoundEffectModel?.id || "" : selectedTranscriptionModel?.id || ""}
              onChange={(modelId) => activeMode === "speech"
                ? (setSpeechModelId(modelId), setCustomVoiceSelected(false), setSpeechError(""), saveSpeechDraft({ modelId }))
                : activeMode === "music"
                  ? (setMusicError(""), saveMusicDraft({ modelId }))
                  : activeMode === "sound-effect"
                    ? (setMusicError(""), saveSoundEffectDraft({ modelId }))
                    : (setTranscriptionError(""), saveTranscriptionDraft({ modelId }))}
              defaultProviderId={defaultProviderId}
              defaultProviderName={defaultProviderName}
              placeholder={activeMode === "speech"
                ? speechModels.length ? undefined : "尚未启用配音模型"
                : activeMode === "music" ? musicModels.length ? undefined : "暂无已接入的音乐模型"
                  : activeMode === "sound-effect" ? soundEffectModels.length ? undefined : "暂无已接入的音效模型"
                    : transcriptionModels.length ? undefined : "尚未启用转写模型"}
              automaticHint={activeMode === "speech" ? "按默认服务商选择可用配音模型，无在线模型时使用本机语音" : undefined}
              triggerLabelMode="model"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
              disabled={generatingSpeech || transcriptionBusy || musicBusy}
              className="canvas-audio-model-picker"
            />
            <small>{activeMode === "speech" ? `上次生成：${speechServiceLabel}` : activeMode === "music" || activeMode === "sound-effect" ? currentMusicTask ? `最近${musicTaskKindName}任务：${canvasAudioMusicTaskStatusLabel(currentMusicTask.status)}` : "异步任务完成后结果会保留在此节点" : "识别结果会保存在当前节点"}</small>
          </div>
        </div>
        {activeMode === "speech" && <button type="button" className="canvas-audio-panel-upload" onClick={() => inputRef.current?.click()} disabled={generatingSpeech}>{hasAudio ? "替换音频" : "导入音频"}</button>}
        <button
          type="button"
          className="canvas-node-editor-generate canvas-audio-generate"
          onClick={() => activeMode === "speech" ? void generateSpeech() : activeMode === "music" || activeMode === "sound-effect" ? void generateMusic() : void transcribeAudio()}
          disabled={activeMode === "speech"
          ? !speechText.trim() || generatingSpeech || speechProfile?.requiresVoiceId && !speechAdvanced.voiceId?.trim() || speechProfile?.supportsDialogue && (!speechAdvanced.dialogue?.length || Boolean(dialogueDraftError))
            : activeMode === "music" || activeMode === "sound-effect"
              ? !activeMusicModel || !activeMusicProfile || musicBusy || uploadingMusicFields.size > 0
              : !selectedTranscriptionModel || transcriptionBusy || transcriptionDraft.language === "__custom" && !transcriptionDraft.customLanguage?.trim() || !transcriptionFile && !hasAudio}
          aria-busy={activeMode === "speech" ? generatingSpeech : activeMode === "music" || activeMode === "sound-effect" ? musicBusy : transcriptionBusy}
        >
          {activeMode === "speech"
            ? generatingSpeech ? "正在生成…" : speechError ? speechProfile?.supportsDialogue ? "重新生成对白" : "重新生成配音" : hasAudio ? "生成并替换" : speechProfile?.supportsDialogue ? "生成对白" : "生成配音"
            : activeMode === "music" || activeMode === "sound-effect"
              ? musicBusy ? "正在提交…" : currentMusicTask && ["pending", "queued", "running", "waiting"].includes(currentMusicTask.status) ? "提交新任务" : `生成${musicTaskKindName}`
              : transcriptionBusy ? "正在识别…" : currentTranscription ? "重新转写" : "开始转写"}
        </button>
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="audio/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onReplaceAudio(node.id, file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={transcriptionInputRef}
        hidden
        type="file"
        accept={TRANSCRIPTION_ACCEPT}
        onChange={(event) => {
          chooseTranscriptionFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
