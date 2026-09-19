"use client";

/**
 * 「一键克隆出片」弹窗：选参考视频 → 一句话要求 → 后台跑管线 → 放入画布。
 * 只做窄管线（不贴脸、不换脸、不做数字人）：参考视频只用来拆结构与节奏，画面全部重生成。
 */
import { useEffect, useMemo, useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import {
  CLONE_ASPECTS,
  CLONE_DEFAULT_MAX_SECONDS,
  CLONE_DEFAULT_MAX_SHOTS,
  CLONE_MAX_SECONDS,
  CLONE_MAX_SHOTS,
  CLONE_MIN_SECONDS,
  cloneCapabilityFlags,
  cloneStageProgress,
  describeCloneStage,
} from "@/lib/clone/plan";
import type { CloneJob, CloneOptions } from "@/lib/clone/types";
import type { RegistryModel } from "@/lib/types";

export type CanvasCloneReferenceOption = {
  nodeId: string;
  name: string;
  url: string;
  seconds: number;
};

type CanvasCloneDialogProps = {
  references: CanvasCloneReferenceOption[];
  models: RegistryModel[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  preselectedReferenceId?: string | null;
  notify: (message: string, tone?: "ok" | "error") => void;
  onClose: () => void;
  onApply: (job: CloneJob) => void;
};

const ASPECT_LABELS: Record<CloneOptions["aspect"], string> = {
  "9:16": "竖屏 9:16",
  "16:9": "横屏 16:9",
  "1:1": "方形 1:1",
};

const VOICE_PRESETS = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"];
const TERMINAL_STAGES: CloneJob["stage"][] = ["done", "failed", "cancelled"];
const SHOT_STATUS_LABELS: Record<string, string> = {
  pending: "等待",
  voicing: "配音",
  imaging: "生图",
  rendering: "生视频",
  done: "完成",
  failed: "失败",
};

function formatSeconds(value: number) {
  const seconds = Math.max(0, Number(value) || 0);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒` : `${Math.round(seconds)} 秒`;
}

/**
 * 把这次提交的参数压成一个短键：同样的参数重复点「开始」仍会命中同一个任务（防连点），
 * 但只要改了要求 / 镜头数 / 模型，就是一条新任务，不会静默拿回上一次的旧成片。
 */
function requestKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

export default function CanvasCloneDialog({
  references,
  models,
  defaultProviderId,
  defaultProviderName,
  preselectedReferenceId,
  notify,
  onClose,
  onApply,
}: CanvasCloneDialogProps) {
  const [step, setStep] = useState(preselectedReferenceId ? 2 : 1);
  const [referenceId, setReferenceId] = useState(preselectedReferenceId || "");
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState<CloneOptions["aspect"]>("9:16");
  const [maxShots, setMaxShots] = useState(CLONE_DEFAULT_MAX_SHOTS);
  const [maxSeconds, setMaxSeconds] = useState(CLONE_DEFAULT_MAX_SECONDS);
  const [voice, setVoice] = useState(VOICE_PRESETS[0]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState({ chat: "auto", image: "auto", video: "auto", speech: "auto" });
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<CloneJob | null>(null);
  const [applied, setApplied] = useState(false);

  const flags = useMemo(() => cloneCapabilityFlags(models), [models]);
  const reference = references.find((item) => item.nodeId === referenceId) || null;
  const overBudget = maxShots > CLONE_DEFAULT_MAX_SHOTS || maxSeconds > CLONE_DEFAULT_MAX_SECONDS;
  const running = Boolean(job) && !TERMINAL_STAGES.includes(job!.stage);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const jobId = job?.id || "";
  const jobStage = job?.stage || "";
  useEffect(() => {
    if (!jobId || TERMINAL_STAGES.includes(jobStage as CloneJob["stage"])) return;
    let disposed = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/clone/jobs/${jobId}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (disposed) return;
        if (!response.ok) throw new Error(data?.error || "读取克隆任务失败。");
        setJob(data.job as CloneJob);
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "读取克隆任务失败。");
      }
    };
    const timer = window.setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [jobId, jobStage]);

  async function start() {
    if (!reference) {
      setError("请先选择一条画布中的参考视频。");
      setStep(1);
      return;
    }
    if (!flags.hasImageModel) {
      setError("没有可用的生图模型：请先在模型库启用一个生图模型，再回来一键出片。");
      return;
    }
    if (overBudget && !costConfirmed) {
      setError("镜头数或时长超出默认成本闸门，请先确认预计消耗。");
      return;
    }
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/clone/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: { nodeId: reference.nodeId, name: reference.name, url: reference.url, seconds: reference.seconds },
          brief: brief.trim(),
          options: {
            brief: brief.trim(),
            maxShots,
            maxSeconds,
            aspect,
            voice: voice.trim() || VOICE_PRESETS[0],
          },
          chatModel: selectedModels.chat,
          imageModel: selectedModels.image,
          videoModel: selectedModels.video,
          speechModel: selectedModels.speech,
          idempotencyKey: `canvas-clone-${reference.nodeId}-${requestKey([
            brief.trim(), maxShots, maxSeconds, aspect, voice.trim(),
            selectedModels.chat, selectedModels.image, selectedModels.video, selectedModels.speech,
          ].join("|"))}`,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "创建克隆任务失败。");
      setJob(data.job as CloneJob);
      notify("已开始克隆出片，可关闭弹窗继续用画布", "ok");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "创建克隆任务失败。");
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/clone/jobs/${job.id}/cancel`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "取消失败。");
      setJob(data.job as CloneJob);
      notify("已取消克隆出片", "ok");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "取消失败。");
    } finally {
      setCancelling(false);
    }
  }

  function applyResult() {
    if (!job) return;
    onApply(job);
    setApplied(true);
  }

  const readyShots = job ? job.shots.filter((shot) => shot.videoUrl || shot.imageUrl).length : 0;
  const progress = job ? (job.stage === "done" ? 1 : cloneStageProgress(job.stage) || job.progress) : 0;

  return (
    <div
      className="clone-backdrop"
      role="presentation"
      // 弹窗挂在 document.body 上，是画布 stage 在 React 树里的子节点：
      // 不拦指针事件的话，画布的平移会接管 pointerdown 并抢走 pointer capture，
      // 结果按钮收不到 click（和智能一键变体弹窗同一处理）。
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <section className="clone-dialog" role="dialog" aria-modal="true" aria-label="一键克隆出片">
        <header className="clone-head">
          <div>
            <b>✦ 克隆出片</b>
            <small>拆解参考视频的结构与节奏，画面全部重新生成</small>
          </div>
          <button type="button" className="clone-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {job ? (
          <div className="clone-body">
            <div className="clone-progress">
              <div className="clone-progress-track"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} /></div>
              <div className="clone-progress-copy">
                <b>{describeCloneStage(job.stage) || job.message}</b>
                <small>{job.message}{job.shots.length ? ` · 共 ${job.shots.length} 个镜头` : ""}</small>
              </div>
            </div>

            {job.warnings.length > 0 && (
              <ul className="clone-warnings">
                {job.warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            )}
            {job.error && <p className="clone-error">{job.error}</p>}

            {job.shots.length > 0 && (
              <ol className="clone-shots">
                {job.shots.map((shot) => (
                  <li key={shot.index} className={shot.status}>
                    <span className="clone-shot-index">{shot.index + 1}</span>
                    <span className="clone-shot-copy">
                      <b>{shot.line || shot.visual || "待生成"}</b>
                      <small>
                        {shot.audioSeconds ? `配音 ${shot.audioSeconds.toFixed(1)}s · ` : ""}
                        {shot.videoUrl ? "视频镜头" : shot.imageUrl ? "静态图" : "待生成"} · {SHOT_STATUS_LABELS[shot.status] || shot.status}
                      </small>
                    </span>
                    {shot.imageUrl && <img className="clone-shot-thumb" src={shot.imageUrl} alt="" />}
                  </li>
                ))}
              </ol>
            )}

            <div className="clone-actions">
              {running ? (
                <button type="button" className="clone-button ghost" onClick={cancel} disabled={cancelling}>
                  {cancelling ? "取消中…" : "取消任务"}
                </button>
              ) : (
                <button type="button" className="clone-button ghost" onClick={onClose}>关闭</button>
              )}
              {job.stage === "done" && readyShots > 0 && (
                <button type="button" className="clone-button primary" onClick={applyResult} disabled={applied}>
                  {applied ? "已放入画布" : `放入画布（${readyShots} 个镜头 + 成片节点）`}
                </button>
              )}
              {job.stage === "failed" && (
                <button type="button" className="clone-button primary" onClick={() => { setJob(null); setError(""); }}>重新设置</button>
              )}
            </div>
            {job.stage === "done" && !applied && (
              <p className="clone-hint">成片时长 {formatSeconds(job.timeline.duration)}，可在视频编辑节点里直接微调再导出。</p>
            )}
          </div>
        ) : (
          <div className="clone-body">
            <ol className="clone-steps">
              <li className={step === 1 ? "active" : "done"}><i>1</i>选参考视频</li>
              <li className={step === 2 ? "active" : ""}><i>2</i>一句话要求</li>
            </ol>

            {step === 1 ? (
              references.length ? (
                <div className="clone-reference-grid">
                  {references.map((option) => (
                    <button
                      type="button"
                      key={option.nodeId}
                      className={`clone-reference-card ${option.nodeId === referenceId ? "active" : ""}`}
                      onClick={() => { setReferenceId(option.nodeId); setStep(2); }}
                    >
                      <video src={option.url} muted preload="metadata" playsInline />
                      <span>
                        <b>{option.name}</b>
                        <small>{option.seconds > 0 ? formatSeconds(option.seconds) : "时长待读取"}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="clone-empty">画布里还没有视频素材。先用「＋ 导入素材」导入一条参考视频，再回来一键出片。</p>
              )
            ) : (
              <div className="clone-form">
                <div className="clone-selected">
                  {reference ? (
                    <>
                      <video src={reference.url} muted preload="metadata" playsInline />
                      <span><b>{reference.name}</b><small>{reference.seconds > 0 ? formatSeconds(reference.seconds) : "时长待读取"}</small></span>
                      <button type="button" onClick={() => { setStep(1); }}>换一条</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setStep(1)}>重新选择参考视频</button>
                  )}
                </div>

                <label className="clone-field">
                  <span>想做成什么片子</span>
                  <textarea
                    value={brief}
                    maxLength={400}
                    placeholder="例如：把这条视频的节奏换成我家火锅店的探店口播，突出毛肚和锅底"
                    onChange={(event) => setBrief(event.target.value)}
                  />
                </label>

                <div className="clone-field">
                  <span>画幅</span>
                  <div className="clone-chips">
                    {CLONE_ASPECTS.map((value) => (
                      <button type="button" key={value} className={aspect === value ? "active" : ""} onClick={() => setAspect(value)}>
                        {ASPECT_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="clone-row">
                  <label className="clone-field">
                    <span>镜头数上限</span>
                    <input
                      type="number"
                      min={1}
                      max={CLONE_MAX_SHOTS}
                      value={maxShots}
                      onChange={(event) => setMaxShots(Math.max(1, Math.min(CLONE_MAX_SHOTS, Math.round(Number(event.target.value) || 1))))}
                    />
                  </label>
                  <label className="clone-field">
                    <span>成片时长上限（秒）</span>
                    <input
                      type="number"
                      min={CLONE_MIN_SECONDS}
                      max={CLONE_MAX_SECONDS}
                      value={maxSeconds}
                      onChange={(event) => setMaxSeconds(Math.max(CLONE_MIN_SECONDS, Math.min(CLONE_MAX_SECONDS, Math.round(Number(event.target.value) || CLONE_MIN_SECONDS))))}
                    />
                  </label>
                  {flags.hasSpeechModel && (
                    <label className="clone-field">
                      <span>配音音色</span>
                      <input list="clone-voice-presets" value={voice} maxLength={40} onChange={(event) => setVoice(event.target.value)} />
                      <datalist id="clone-voice-presets">
                        {VOICE_PRESETS.map((preset) => <option key={preset} value={preset} />)}
                      </datalist>
                    </label>
                  )}
                </div>

                <div className="clone-cost">
                  <b>预计最多 {maxShots} 次生图{flags.hasVideoModel ? ` + ${maxShots} 次生视频` : ""}{flags.hasSpeechModel ? ` + ${maxShots} 次配音` : ""}</b>
                  <small>按镜头数上限估算，实际按拆解结果决定；成片不超过 {formatSeconds(maxSeconds)}。</small>
                </div>

                <div className="clone-capabilities">
                  <span className={flags.hasVisionModel ? "ok" : "warn"}>画面拆解：{flags.hasVisionModel ? "可用" : "缺视觉对话模型（按镜头数平均分配时长）"}</span>
                  <span className={flags.hasImageModel ? "ok" : "warn"}>生图：{flags.hasImageModel ? "可用" : "缺少生图模型，无法开始"}</span>
                  <span className={flags.hasVideoModel ? "ok" : "warn"}>图生视频：{flags.hasVideoModel ? "可用" : "没有视频模型，镜头用静态图"}</span>
                  <span className={flags.hasSpeechModel ? "ok" : "warn"}>配音：{flags.hasSpeechModel ? "可用" : "没有配音模型，成片无声 + 字幕"}</span>
                </div>

                {overBudget && (
                  <label className="clone-confirm">
                    <input type="checkbox" checked={costConfirmed} onChange={(event) => setCostConfirmed(event.target.checked)} />
                    <span>超出默认成本闸门（默认 {CLONE_DEFAULT_MAX_SHOTS} 镜头 / {CLONE_DEFAULT_MAX_SECONDS} 秒），我已确认这次消耗。</span>
                  </label>
                )}

                <button type="button" className="clone-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
                  {advancedOpen ? "收起高级设置" : "高级设置（模型选择）"}
                </button>
                {advancedOpen && (
                  <div className="clone-advanced">
                    <label><span>对话 / 拆解模型</span>
                      <ModelPicker models={models} capability="chat" value={selectedModels.chat} onChange={(value) => setSelectedModels((current) => ({ ...current, chat: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} />
                    </label>
                    <label><span>生图模型</span>
                      <ModelPicker models={models} capability="generate" value={selectedModels.image} onChange={(value) => setSelectedModels((current) => ({ ...current, image: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} />
                    </label>
                    <label><span>图生视频模型</span>
                      <ModelPicker models={models} capability="video-generate" value={selectedModels.video} onChange={(value) => setSelectedModels((current) => ({ ...current, video: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} />
                    </label>
                    <label><span>配音模型</span>
                      <ModelPicker models={models} capability="speech" value={selectedModels.speech} onChange={(value) => setSelectedModels((current) => ({ ...current, speech: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} />
                    </label>
                  </div>
                )}

                <p className="clone-hint">一期只做「重生成 + 配音 + 字幕」：不贴脸、不换脸、不做数字人，成片不含原视频画面与人脸。</p>
              </div>
            )}

            {error && <p className="clone-error">{error}</p>}

            <div className="clone-actions">
              {step === 2 && (
                <button type="button" className="clone-button ghost" onClick={() => setStep(1)}>上一步</button>
              )}
              <button type="button" className="clone-button ghost" onClick={onClose}>取消</button>
              {step === 2 && (
                <button type="button" className="clone-button primary" onClick={start} disabled={starting || !reference || !flags.hasImageModel}>
                  {starting ? "正在创建任务…" : "开始克隆出片"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}