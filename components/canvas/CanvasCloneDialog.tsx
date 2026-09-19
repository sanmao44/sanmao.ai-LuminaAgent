"use client";

/**
 * 「一键克隆出片」弹窗：选参考视频 → 一句话要求 → 后台跑管线 → 放入画布。
 * 只做窄管线（不贴脸、不换脸、不做数字人）：参考视频只用来拆结构与节奏，画面全部重生成。
 */
import { useEffect, useMemo, useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
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
  /** 弹窗内直接导入参考视频（复用画布的导入流程，省得用户先关弹窗再去找工具栏）。 */
  onImportReference?: () => void;
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
/** 失败任务只在 24 小时内自动接回：陈年失败任务否则会永远顶掉向导，每次打开弹窗都得先关掉它。 */
const RESTORE_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;
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
  onImportReference,
  onClose,
  onApply,
}: CanvasCloneDialogProps) {
  const [step, setStep] = useState(preselectedReferenceId ? 2 : 1);
  const [referenceId, setReferenceId] = useState(preselectedReferenceId || "");
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState<CloneOptions["aspect"]>("9:16");
  const [maxShots, setMaxShots] = useState(CLONE_DEFAULT_MAX_SHOTS);
  const [maxSeconds, setMaxSeconds] = useState(CLONE_DEFAULT_MAX_SECONDS);
  // 默认留空：OpenAI 系用默认音色，Gitee 这类没有 voice 参数的服务商也不至于被拒。
  const [voice, setVoice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState({ chat: "auto", image: "auto", video: "auto", speech: "auto" });
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<CloneJob | null>(null);
  // 服务端是否有本机离线配音兜底（Windows / macOS 的系统语音合成）；只在没有在线配音模型时才用得上。
  const [offlineSpeech, setOfflineSpeech] = useState(false);
  const [applied, setApplied] = useState(false);
  // 打开弹窗时先看看有没有上次没跑完 / 还没放进画布的任务：有就接着显示，而不是甩个向导。
  const [restoring, setRestoring] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const flags = useMemo(() => cloneCapabilityFlags(models), [models]);
  const reference = references.find((item) => item.nodeId === referenceId) || null;
  const overBudget = maxShots > CLONE_DEFAULT_MAX_SHOTS || maxSeconds > CLONE_DEFAULT_MAX_SECONDS;
  const running = Boolean(job) && !TERMINAL_STAGES.includes(job!.stage);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (!disposed && data?.offlineSpeech) setOfflineSpeech(true); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  /**
   * 关掉弹窗不等于任务停了：说清楚，免得用户以为白跑一趟。
   * 重开弹窗会自动接回这条任务（见下面的恢复逻辑）。
   */
  function closeDialog() {
    if (running) notify("克隆任务在后台继续跑，重开「克隆出片」可查看进度或放入画布", "ok");
    onClose();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /**
   * 接回最近一条「还在跑」或「出片了但没放进画布」的任务。
   * 没有这一步，用户关掉弹窗后任务就只剩一个看不见的后台，重开还以为得从头再来。
   */
  useEffect(() => {
    // 用户是从画布某条视频直接点进来的（右键 → 克隆出片）：他要的就是这条新视频，
    // 别拿一条旧成片顶掉他刚选好的参考素材。
    if (preselectedReferenceId) {
      setRestoring(false);
      return;
    }
    let disposed = false;
    const restore = async () => {
      try {
        const listResponse = await fetch("/api/clone/jobs", { cache: "no-store" });
        const listData = await listResponse.json().catch(() => ({}));
        const summaries = Array.isArray(listData?.jobs) ? (listData.jobs as { id: string; stage: CloneJob["stage"]; appliedAt?: string; updatedAt?: string; createdAt?: string }[]) : [];
        // 列表按最新在前：跳过已取消的、已经放入画布的（appliedAt = 已处理过），
        // 失败任务只接回最近 24 小时的。
        const pending = summaries.find((item) => {
          if (item.appliedAt) return false;
          if (!TERMINAL_STAGES.includes(item.stage)) return true;
          if (item.stage === "done") return true;
          if (item.stage !== "failed") return false;
          const stamp = Date.parse(item.updatedAt || item.createdAt || "");
          return Number.isFinite(stamp) && Date.now() - stamp < RESTORE_FAILED_WINDOW_MS;
        });
        if (!pending) return;
        const response = await fetch(`/api/clone/jobs/${pending.id}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (disposed || !response.ok || !data?.job) return;
        const restored = data.job as CloneJob;
        setJob(restored);
        setApplied(Boolean(restored.appliedAt));
      } catch {
        // 接不回来就走正常的向导流程，不打断用户。
      } finally {
        if (!disposed) setRestoring(false);
      }
    };
    void restore();
    return () => { disposed = true; };
  }, [preselectedReferenceId]);

  // 画布里只有一条视频素材时直接选中并进第二步，用户点一下「开始」就能跑（弹窗内新导入也走这条）。
  useEffect(() => {
    if (referenceId || job || restoring || references.length !== 1) return;
    setReferenceId(references[0].nodeId);
    setStep(2);
  }, [references, referenceId, job, restoring]);

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
            voice: voice.trim(),
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

  /**
   * 标记这条任务「已处理」：放进画布，或者用户主动说不要了。
   * 重开弹窗、画布顶栏的提示都靠它判断，免得同一条旧任务反复来问。
   */
  function markHandled() {
    if (!job) return;
    void fetch(`/api/clone/jobs/${job.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "applied" }),
    }).catch(() => undefined);
  }

  function applyResult() {
    if (!job) return;
    onApply(job);
    setApplied(true);
    markHandled();
  }

  /** 继续任务：沿用同一条任务接着跑，已经生成好的镜头和配音会跳过，不重复计费。 */
  async function resume() {
    if (!job || resuming) return;
    setResuming(true);
    setError("");
    try {
      const response = await fetch(`/api/clone/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "继续任务失败。");
      setJob((data.job as CloneJob) || job);
      notify("已接着跑这条克隆任务", "ok");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "继续任务失败。");
    } finally {
      setResuming(false);
    }
  }

  /**
   * 删除任务：出片了但不想要、失败或取消之后，把它从弹窗里清掉，免得每次打开都被顶到眼前。
   * 只删任务记录，已经放进画布的素材与成片节点都不受影响。
   */
  async function removeJob() {
    if (!job || deleting) return;
    if (!window.confirm(`删除这条克隆任务？已经放进画布的素材不受影响。`)) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/clone/jobs/${job.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "删除失败。");
      setJob(null);
      setApplied(false);
      notify("已删除该克隆任务", "ok");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "删除失败。");
    } finally {
      setDeleting(false);
    }
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
        if (event.target === event.currentTarget) closeDialog();
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
          <button type="button" className="clone-close" onClick={closeDialog} aria-label="关闭">×</button>
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
                <button type="button" className="clone-button ghost" onClick={closeDialog}>关闭</button>
              )}
              {/* 删除按钮靠左放：它是破坏性操作，不要和「放入画布」挤在一起让人点错。 */}
              {!running && (
                <button type="button" className="clone-button danger" onClick={removeJob} disabled={deleting}>
                  {deleting ? "删除中…" : "删除任务"}
                </button>
              )}
              {job.stage === "done" && readyShots > 0 && (
                <button type="button" className="clone-button primary" onClick={applyResult} disabled={applied}>
                  {applied ? "已放入画布" : `放入画布（${readyShots} 个镜头 + 成片节点）`}
                </button>
              )}
              {job.stage === "failed" && (
                <>
                  <button
                    type="button"
                    className="clone-button ghost"
                    onClick={() => { markHandled(); setJob(null); setApplied(false); setError(""); }}
                  >
                    重新设置
                  </button>
                  <button type="button" className="clone-button primary" onClick={resume} disabled={resuming}>
                    {resuming ? "正在继续…" : "继续任务"}
                  </button>
                </>
              )}
            </div>
            {job.stage === "done" && !applied && (
              <p className="clone-hint">成片时长 {formatSeconds(job.timeline.duration)}，可在视频编辑节点里直接微调再导出。</p>
            )}
            {job.stage === "failed" && (
              <p className="clone-hint">「继续任务」会沿用这条任务接着跑：已经生成好的配音和镜头会跳过，不会重复计费。</p>
            )}
          </div>
        ) : restoring ? (
          <div className="clone-body">
            <p className="clone-empty">正在读取最近的克隆任务…</p>
          </div>
        ) : (
          <div className="clone-body">
            <ol className="clone-steps">
              <li className={step === 1 ? "active" : "done"}><i>1</i>选参考视频</li>
              <li className={step === 2 ? "active" : ""}><i>2</i>一句话要求</li>
            </ol>

            {step === 1 ? (
              references.length ? (
                <div className="clone-reference-stack">
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
                  {onImportReference && (
                    <div className="clone-import-row">
                      <button type="button" className="clone-button ghost" onClick={onImportReference}>＋ 导入新的参考视频</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="clone-form">
                  <p className="clone-empty">画布里还没有视频素材。可以直接导入一条参考视频（也可以用工具栏的「＋ 导入素材」）。</p>
                  {onImportReference && (
                    <div className="clone-import-row">
                      <button type="button" className="clone-button primary" onClick={onImportReference}>＋ 导入参考视频</button>
                    </div>
                  )}
                </div>
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
                    <span>参考时长上限（秒）</span>
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
                      <input list="clone-voice-presets" value={voice} maxLength={40} placeholder="留空用服务商默认音色" onChange={(event) => setVoice(event.target.value)} />
                      <datalist id="clone-voice-presets">
                        {VOICE_PRESETS.map((preset) => <option key={preset} value={preset} />)}
                      </datalist>
                    </label>
                  )}
                </div>

                {!flags.hasSpeechModel && offlineSpeech && (
                  <p className="clone-hint">没有在线配音模型：本次用系统自带语音合成出声（免费、离线、不用联网、零配置），音色偏机械；想要更好听，可在「模型库」把 TTS 模型类型改成「配音」并启用。</p>
                )}

                <div className="clone-cost">
                  <b>预计最多 {maxShots} 次生图{flags.hasVideoModel ? ` + ${maxShots} 次生视频` : ""}{flags.hasSpeechModel ? ` + ${maxShots} 次配音` : ""}</b>
                  <small>按镜头数上限估算，实际按拆解结果决定；只拆解参考视频前 {formatSeconds(maxSeconds)}，成片长度按配音实际时长排（文案写长了会略长，任务里会提示）。</small>
                </div>

                <div className="clone-capabilities">
                  <span className={flags.hasVisionModel ? "ok" : "warn"}>画面拆解：{flags.hasVisionModel ? "可用" : "缺视觉对话模型（按镜头数平均分配时长）"}</span>
                  <span className={flags.hasChatModel ? "ok" : "warn"}>文案与字幕：{flags.hasChatModel ? "可用" : "缺对话模型，成片只有画面"}</span>
                  <span className={flags.hasImageModel ? "ok" : "warn"}>生图：{flags.hasImageModel ? "可用" : "缺少生图模型，无法开始"}</span>
                  <span className={flags.hasVideoModel ? "ok" : "warn"}>图生视频：{flags.hasVideoModel ? "可用" : "没有视频模型，镜头用静态图"}</span>
                  <span className={flags.hasSpeechModel || offlineSpeech ? "ok" : "warn"}>配音：{flags.hasSpeechModel ? "可用" : offlineSpeech ? "可用（本机离线配音，免费，音色偏机械）" : "没有配音模型，成片无声 + 字幕（到「模型库」把 TTS 模型类型改成「配音」并启用）"}</span>
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
                    <label><span>拆解模型（需要视觉）</span>
                      <ModelPicker models={models} capability="vision" value={selectedModels.chat} onChange={(value) => setSelectedModels((current) => ({ ...current, chat: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} portalZIndex={CANVAS_Z_INDEX.modalPopover} dialogPortalZIndex={CANVAS_Z_INDEX.modalPopover} />
                    </label>
                    <label><span>生图模型</span>
                      <ModelPicker models={models} capability="generate" value={selectedModels.image} onChange={(value) => setSelectedModels((current) => ({ ...current, image: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} portalZIndex={CANVAS_Z_INDEX.modalPopover} dialogPortalZIndex={CANVAS_Z_INDEX.modalPopover} />
                    </label>
                    <label><span>图生视频模型</span>
                      <ModelPicker models={models} capability="video-generate" value={selectedModels.video} onChange={(value) => setSelectedModels((current) => ({ ...current, video: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} portalZIndex={CANVAS_Z_INDEX.modalPopover} dialogPortalZIndex={CANVAS_Z_INDEX.modalPopover} />
                    </label>
                    <label><span>配音模型</span>
                      <ModelPicker models={models} capability="speech" value={selectedModels.speech} onChange={(value) => setSelectedModels((current) => ({ ...current, speech: value }))} defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} portalZIndex={CANVAS_Z_INDEX.modalPopover} dialogPortalZIndex={CANVAS_Z_INDEX.modalPopover} placeholder={flags.hasSpeechModel ? undefined : "未配置配音模型"} />
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
              <button type="button" className="clone-button ghost" onClick={closeDialog}>取消</button>
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