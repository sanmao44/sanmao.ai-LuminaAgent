"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegistryModel } from "@/lib/types";
import type { CanvasNode, CanvasThreeDDraft, CanvasThreeDTaskSnapshot } from "@/lib/canvas/types";
import SelectMenu from "@/components/SelectMenu";
import CangyuanMediaUploadField from "@/components/cangyuan/CangyuanMediaUploadField";
import CangyuanThreeDScenarioPicker from "@/components/cangyuan/CangyuanThreeDScenarioPicker";
import CangyuanReferenceImagePreview from "@/components/cangyuan/CangyuanReferenceImagePreview";
import CangyuanTripoQualityOptions, { applyTripoQualityOptions } from "@/components/cangyuan/CangyuanTripoQualityOptions";
import ThreeDModelPreview from "@/components/ThreeDModelPreview";
import { buildCanvasThreeDRequest, canvasThreeDOutputDownload, canvasThreeDPreviewUrl, isCanvasThreeDModelOutput, isCanvasThreeDPreviewOutput } from "@/lib/canvas/three-d-generation";
import type { CangyuanThreeDScenario } from "@/components/cangyuan/three-d-presets";
import {
  getCangyuan3DModelProfile,
  reconcileCangyuan3DMode,
  type Cangyuan3DMode,
  type Cangyuan3DOptions,
  type Cangyuan3DView,
  type CangyuanMediaTask,
  type CangyuanMediaTaskStatus,
} from "@/packages/contracts/cangyuan-media";
import { CANGYUAN_3D_TASK_POLL_INTERVAL_MS } from "@/lib/cangyuan-media-task-polling";
import styles from "./CanvasThreeDNodePanel.module.css";
import { assignCanvasThreeDReference, canvasThreeDReferenceOptions, resolveCanvasThreeDReferences, swapCanvasThreeDViews, type CanvasThreeDReferenceSlot } from "@/lib/canvas/three-d-references";
import { publishCanvasThreeDReferences } from "@/lib/canvas/three-d-reference-upload";

const MODE_LABELS: Record<Cangyuan3DMode, string> = {
  "text-to-3d": "文字生成",
  "image-to-3d": "单图生成",
  "multiview-to-3d": "多视图生成",
};

const VIEWS: readonly { key: Cangyuan3DView; label: string }[] = [
  { key: "front", label: "正面（必需）" },
  { key: "back", label: "背面" },
  { key: "left", label: "左侧" },
  { key: "right", label: "右侧" },
];

const ACTIVE_STATUSES = new Set<CangyuanMediaTaskStatus>(["pending", "queued", "running", "waiting"]);

function taskStatusLabel(status: CangyuanMediaTaskStatus) {
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "生成失败";
  if (status === "cancelled") return "已取消";
  if (status === "waiting") return "等待服务处理";
  if (status === "pending" || status === "queued") return "排队中";
  return "生成中";
}

export type CanvasThreeDNodePanelProps = {
  nodeId: string;
  models: RegistryModel[];
  draft?: CanvasThreeDDraft;
  task?: CanvasThreeDTaskSnapshot;
  onDraftChange: (nodeId: string, draft: CanvasThreeDDraft) => void;
  onTaskChange: (nodeId: string, task: CanvasThreeDTaskSnapshot) => void;
  onNotify?: (message: string, kind?: "ok" | "error") => void;
  references?: readonly CanvasNode[];
  onPickFromCanvas?: (slot: CanvasThreeDReferenceSlot) => void;
};

function snapshot(task: CangyuanMediaTask): CanvasThreeDTaskSnapshot {
  if (task.kind !== "3d") throw new Error("收到的不是三维生成任务。");
  return {
    id: task.id,
    modelId: task.modelId,
    modelName: task.modelName,
    prompt: task.input.prompt,
    status: task.status,
    outputs: task.outputs,
    error: task.error,
    providerStatus: task.providerStatus,
    createdAt: task.createdAt,
    updatedAt: task.completedAt || task.startedAt,
  };
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export default function CanvasThreeDNodePanel({
  nodeId,
  models,
  draft,
  task,
  onDraftChange,
  onTaskChange,
  onNotify,
  references = [],
  onPickFromCanvas,
}: CanvasThreeDNodePanelProps) {
  const availableModels = useMemo(() => models.filter((model) =>
    model.enabled && model.published && model.capabilities.includes("3d-generate") && getCangyuan3DModelProfile(model.rawId) !== null,
  ), [models]);
  const [localDraft, setLocalDraft] = useState<CanvasThreeDDraft>(() => draft || { prompt: "", options: {} });
  const latestDraftRef = useRef(localDraft);
  latestDraftRef.current = localDraft;
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadingFields, setUploadingFields] = useState<Set<string>>(() => new Set());
  const taskChangeRef = useRef(onTaskChange);
  const model = availableModels.find((item) => item.id === localDraft.modelId) || availableModels[0];
  const profile = model ? getCangyuan3DModelProfile(model.rawId) : null;
  const mode = profile
    ? reconcileCangyuan3DMode(profile.modelId, localDraft.options.mode || profile.defaultMode)
    : "image-to-3d";
  const resolvedReferences = resolveCanvasThreeDReferences(localDraft, references);
  const options = { ...canvasThreeDReferenceOptions(localDraft, references), mode };
  const promptRequired = profile?.modelId === "tripo3d" || mode === "text-to-3d";
  const singleImageRequired = profile?.family === "trellis" || mode === "image-to-3d";
  const multiviewImages = options.multiviewImages || {};
  const multiviewCount = Object.values(multiviewImages).filter((url) => Boolean(url?.trim())).length;
  const activeTask = Boolean(task && ACTIVE_STATUSES.has(task.status));
  const uploadPending = uploadingFields.size > 0;
  const canSubmit = Boolean(
    model && !busy && !activeTask && !uploadPending &&
    (!promptRequired || localDraft.prompt.trim()) &&
    (!singleImageRequired || options.imageUrl?.trim()) &&
    (mode !== "multiview-to-3d" || multiviewCount >= 2 && multiviewImages.front?.trim()),
  );

  useEffect(() => {
    taskChangeRef.current = onTaskChange;
  }, [onTaskChange]);

  useEffect(() => {
    const next = draft || { prompt: "", options: {} };
    latestDraftRef.current = next;
    setLocalDraft(next);
    setError("");
  }, [nodeId, draft]);

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) return;
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/cangyuan/3d/tasks/${encodeURIComponent(task.id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as { task?: CangyuanMediaTask; error?: string } | null;
        if (!response.ok || !payload?.task) throw new Error(payload?.error || "三维任务状态暂时无法读取。");
        const next = snapshot(payload.task);
        if (disposed) return;
        taskChangeRef.current(nodeId, next);
        if (ACTIVE_STATUSES.has(next.status)) timer = window.setTimeout(() => void poll(), CANGYUAN_3D_TASK_POLL_INTERVAL_MS);
      } catch (cause) {
        if (disposed || controller?.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "三维任务状态读取失败。");
        timer = window.setTimeout(() => void poll(), CANGYUAN_3D_TASK_POLL_INTERVAL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), CANGYUAN_3D_TASK_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [nodeId, task?.id, task?.status]);

  const commitDraft = useCallback((next: CanvasThreeDDraft) => {
    latestDraftRef.current = next;
    setLocalDraft(next);
    onDraftChange(nodeId, next);
  }, [nodeId, onDraftChange]);

  function updateOptions(patch: Partial<Cangyuan3DOptions>) {
    const current = latestDraftRef.current;
    commitDraft({ ...current, options: { ...current.options, ...patch } });
  }

  const handleUploadState = useCallback((fieldId: string, uploading: boolean) => {
    setUploadingFields((current) => {
      if (current.has(fieldId) === uploading) return current;
      const next = new Set(current);
      if (uploading) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }, []);

  async function submit() {
    if (!model || !canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const preparedOptions = await publishCanvasThreeDReferences(options);
      const request = buildCanvasThreeDRequest({
        modelId: model.id,
        rawModelId: model.rawId,
        prompt: localDraft.prompt,
        options: preparedOptions,
      });
      const response = await fetch("/api/cangyuan/3d", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(request),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; task?: CangyuanMediaTask; error?: string } | null;
      if (!payload?.task) throw new Error(readError(payload, "三维任务提交失败。"));
      const next = snapshot(payload.task);
      onTaskChange(nodeId, next);
      if (!response.ok || payload.ok === false || next.status === "failed") {
        throw new Error(next.error || readError(payload, "三维任务提交失败。"));
      }
      onNotify?.("三维任务已加入画布", "ok");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "三维任务提交失败。";
      setError(message);
      onNotify?.(message, "error");
    } finally {
      setBusy(false);
    }
  }

  function chooseModel(nextModelId: string) {
    const nextModel = availableModels.find((item) => item.id === nextModelId);
    const nextProfile = nextModel ? getCangyuan3DModelProfile(nextModel.rawId) : null;
    if (!nextModel || !nextProfile) return;
    const current = latestDraftRef.current;
    const nextOptions: Cangyuan3DOptions = { mode: nextProfile.defaultMode, imageUrl: current.options.imageUrl, multiviewImages: current.options.multiviewImages };
    commitDraft({ ...current, modelId: nextModel.id, options: nextOptions });
  }

  function applyScenario(scenario: CangyuanThreeDScenario) {
    const current = latestDraftRef.current;
    const nextOptions: Cangyuan3DOptions = { ...current.options, mode };
    if (scenario.tripo) {
      nextOptions.texture = scenario.tripo.texture;
      nextOptions.pbr = scenario.tripo.pbr;
    }
    if (scenario.trellis) {
      for (const key of ["textureSize", "seed", "meshSimplify", "ssGuidanceStrength", "ssSamplingSteps", "slatGuidanceStrength", "slatSamplingSteps"] as const) {
        delete nextOptions[key];
      }
      Object.assign(nextOptions, scenario.trellis);
    }
    commitDraft({ ...current, options: nextOptions });
  }

  function updateMultiview(view: Cangyuan3DView, url: string) {
    commitDraft(assignCanvasThreeDReference(latestDraftRef.current, referencesRef.current, view, url ? { url, name: "已添加图片" } : undefined));
  }

  function updateSingleImage(url: string) {
    commitDraft(assignCanvasThreeDReference(latestDraftRef.current, referencesRef.current, "image", url ? { url, name: "已添加图片" } : undefined));
  }

  function canvasPickButton(slot: CanvasThreeDReferenceSlot) {
    return onPickFromCanvas && <button type="button" className={styles.canvasPick} disabled={busy || activeTask} onClick={() => onPickFromCanvas(slot)} aria-label={`从画布选择${slot === "image" ? "参考图片" : VIEWS.find((view) => view.key === slot)?.label}`}>⌁ 画布点选</button>;
  }

  function referencePreview(slot: CanvasThreeDReferenceSlot) {
    const reference = slot === "image" ? resolvedReferences.image : resolvedReferences.multiview[slot];
    if (!reference) return null;
    return reference.nodeId
      ? <figure className={styles.connectedPreview}>
          <img src={reference.url} alt={`${slot === "image" ? "参考图片" : VIEWS.find((view) => view.key === slot)?.label}：${reference.name}`} />
          <figcaption><span title={reference.name}>画布引用 · {reference.name}</span><button type="button" className={styles.referenceClear} disabled={busy || activeTask} aria-label={`清空${slot === "image" ? "参考图" : VIEWS.find((view) => view.key === slot)?.label}`} onClick={() => commitDraft(assignCanvasThreeDReference(latestDraftRef.current, referencesRef.current, slot))}>{slot === "image" ? "清空参考图" : "清空视角"}</button></figcaption>
        </figure>
      : <CangyuanReferenceImagePreview url={reference.url} />;
  }

  function rangeField(label: string, key: "meshSimplify" | "ssGuidanceStrength" | "ssSamplingSteps" | "slatGuidanceStrength" | "slatSamplingSteps", min: number, max: number, step: number, help: string, compactHelp: string) {
    const value = options[key] ?? (key === "meshSimplify" ? 0.95 : key.endsWith("SamplingSteps") ? 12 : 5);
    return (
      <label className={styles.rangeField} key={key}>
        <span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => updateOptions({ [key]: Number(event.target.value) })} />
        <output>{Number(value).toFixed(step < 1 ? 2 : 0)}</output>
        <small role="note" aria-label={help} title={help}>{compactHelp}</small>
      </label>
    );
  }

  return (
    <section className={styles.panel} aria-label="三维生成">
      <div className={styles.workbench}>
        <div className={styles.toolbar}>
          <div className={`${styles.field} ${styles.modelField}`}>
            <span className={styles.label}>生成模型</span>
            {availableModels.length ? (
              <SelectMenu
                value={model?.id || ""}
                ariaLabel="选择三维生成模型"
                options={availableModels.map((item) => ({ value: item.id, label: item.displayName, description: item.providerName }))}
                onChange={chooseModel}
              />
            ) : <p className={styles.empty}>尚未配置支持三维生成的模型。</p>}
          </div>
          {profile?.supportedModes.length ? (
            <div className={styles.modeGroup} data-mode-count={profile.supportedModes.length} role="group" aria-label="三维生成方式">
              {profile.supportedModes.map((value) => (
                <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? styles.modeActive : ""} onClick={() => updateOptions({ mode: value })}>
                  {MODE_LABELS[value]}
                </button>
              ))}
            </div>
          ) : <div className={styles.modePlaceholder} aria-hidden="true" />}
        </div>

        {profile && (
          <>
            <div className={styles.editorColumns} data-mode={mode}>
              <div className={styles.inputColumn}>
                <label className={styles.field}>
                  <span className={styles.label}>物体描述{promptRequired ? " · 必填" : " · 可选"}</span>
                  <textarea value={localDraft.prompt} maxLength={5000} rows={3} placeholder="描述形状、材质、比例与风格" onChange={(event) => commitDraft({ ...latestDraftRef.current, prompt: event.target.value })} />
                </label>

                {singleImageRequired && (
                  <div className={styles.referenceImage}>
                    <CangyuanMediaUploadField
                      fieldId={`canvas-${nodeId}-3d-image`}
                      kind="image"
                      label="参考图片"
                      value={resolvedReferences.image?.nodeId ? "" : options.imageUrl || ""}
                      onChange={updateSingleImage}
                      onUploadingChange={handleUploadState}
                      disabled={busy || activeTask}
                      extraAction={canvasPickButton("image")}
                      note={profile.family === "trellis" ? "此模型必须提供图片；文件会通过项目中转服务生成可访问链接。" : "文件会通过项目中转服务生成可访问链接。"}
                    />
                    {referencePreview("image")}
                  </div>
                )}

                {profile.family === "trellis" && (
                  <section className={styles.settingsSection} aria-label="输出与复现参数">
                    <h3 className={styles.sectionTitle}>输出与复现</h3>
                    <div className={styles.optionGrid}>
                      <label className={styles.field}>
                        <span className={styles.label}>贴图边长</span>
                        <SelectMenu value={options.textureSize || "1024"} ariaLabel="贴图边长" options={[{ value: "512", label: "512 · 文件较小" }, { value: "1024", label: "1024 · 推荐" }, { value: "2048", label: "2048 · 细节更清晰" }]} onChange={(value) => updateOptions({ textureSize: value })} />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>随机种子</span>
                        <input inputMode="numeric" value={options.seed || ""} placeholder="模型自动选择" onChange={(event) => updateOptions({ seed: event.target.value || undefined })} />
                        <small>相同参考图可复现相近结果。</small>
                      </label>
                    </div>
                  </section>
                )}

                {mode === "multiview-to-3d" && (
                  <div className={styles.multiview}>
                    <div className={styles.sectionHeading}><strong>多视角参考</strong><span>{multiviewCount}/4 张</span></div>
                    <div className={styles.viewGrid}>
                      {VIEWS.map((view, index) => (
                        <div className={styles.referenceImage} key={view.key}>
                          <CangyuanMediaUploadField
                            fieldId={`canvas-${nodeId}-3d-${view.key}`}
                            kind="image"
                            label={view.label}
                            value={resolvedReferences.multiview[view.key]?.nodeId ? "" : multiviewImages[view.key] || ""}
                            onChange={(url) => updateMultiview(view.key, url)}
                            onUploadingChange={handleUploadState}
                            disabled={busy || activeTask}
                            extraAction={canvasPickButton(view.key)}
                            maxFileBytes={30 * 1024 * 1024}
                          />
                          {referencePreview(view.key)}
                          {multiviewImages[view.key] && <div className={styles.viewActions}>
                            <button type="button" aria-label={`${view.label}图片前移`} disabled={index === 0 || busy || activeTask} onClick={() => commitDraft(swapCanvasThreeDViews(latestDraftRef.current, referencesRef.current, view.key, VIEWS[index - 1].key))}>← 前移</button>
                            <button type="button" aria-label={`${view.label}图片后移`} disabled={index === VIEWS.length - 1 || busy || activeTask} onClick={() => commitDraft(swapCanvasThreeDViews(latestDraftRef.current, referencesRef.current, view.key, VIEWS[index + 1].key))}>后移 →</button>
                          </div>}
                        </div>
                      ))}
                    </div>
                    <p className={styles.hint}>至少需要 2 张不同方向的图片，并包含正面图。用箭头调整图片对应的视角。</p>
                  </div>
                )}
              </div>

              <div className={styles.settingsColumn} aria-label="模型参数">
                {(profile.modelId === "tripo3d" || profile.modelId === "trellis") && (
                  <div className={styles.scenarioPicker}>
                    <CangyuanThreeDScenarioPicker key={profile.modelId} modelId={profile.modelId} onApply={applyScenario} />
                  </div>
                )}

                {profile.family === "tripo-legacy" && (
                  <section className={styles.settingsSection} aria-label="材质与贴图参数">
                    <h3 className={styles.sectionTitle}>材质与贴图</h3>
                    <div className={styles.optionGrid}>
                      <label className={styles.field}>
                        <span className={styles.label}>贴图质量</span>
                        <SelectMenu value={typeof options.texture === "string" ? options.texture : "standard"} ariaLabel="贴图质量" options={[{ value: "no", label: "无贴图" }, { value: "standard", label: "标准" }, { value: "HD", label: "高清" }]} onChange={(value) => updateOptions({ texture: value as Cangyuan3DOptions["texture"] })} />
                      </label>
                      <SwitchField label="PBR 材质" checked={options.pbr === true} onChange={(value) => updateOptions({ pbr: value })} />
                    </div>
                  </section>
                )}

                {profile.family === "tripo" && (
                  <section className={styles.settingsSection} aria-label="生成质量参数">
                    <h3 className={styles.sectionTitle}>生成质量</h3>
                    <CangyuanTripoQualityOptions profile={profile} options={options} alwaysVisible onChange={(next) => commitDraft({ ...latestDraftRef.current, options: applyTripoQualityOptions(profile, latestDraftRef.current.options, next) })} />
                  </section>
                )}

                {profile.family === "trellis" && (
                  <section className={styles.settingsSection} aria-label="模型质量与网格参数">
                    <h3 className={styles.sectionTitle}>模型质量与网格</h3>
                    <div className={styles.trellisGrid}>
                      {rangeField("网格简化", "meshSimplify", 0.9, 0.98, 0.01, "越大模型越轻，表面细节会减少。", "数值越大，网格越轻")}
                      {rangeField("结构引导", "ssGuidanceStrength", 0, 10, 0.1, "提高后轮廓会更贴合参考图。", "提升轮廓贴合度")}
                      {rangeField("结构采样步数", "ssSamplingSteps", 1, 50, 1, "增加步数会改善轮廓，也会延长生成时间。", "步数越多，耗时越长")}
                      {rangeField("细节引导", "slatGuidanceStrength", 0, 10, 0.1, "控制表面细节和颜色对参考图的贴合度。", "提升细节贴合度")}
                      {rangeField("细节采样步数", "slatSamplingSteps", 1, 50, 1, "增加步数可细化表面，也会延长生成时间。", "步数越多，耗时越长")}
                    </div>
                  </section>
                )}
              </div>
            </div>

            <div className={styles.footer}>
              <div className={styles.footerMeta}>
                <span>{model?.displayName || profile.modelId} · {mode === "text-to-3d" ? "文字生成" : mode === "image-to-3d" ? "单图生成" : "多视图生成"}</span>
                {task && <small>{task.modelName} · {taskStatusLabel(task.status)}{task.providerStatus ? ` · ${task.providerStatus}` : ""}</small>}
                {task && ACTIVE_STATUSES.has(task.status) && <div className={styles.taskProgress} role="progressbar" aria-label="三维模型生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuetext={taskStatusLabel(task.status)}><span /></div>}
                {task?.error && <small className={styles.taskError} role="status">{task.error}</small>}
                {error && <small className={styles.taskError} role="alert">{error}</small>}
              </div>
              <button type="button" className={styles.submit} disabled={!canSubmit} onClick={() => void submit()}>
                {uploadPending ? "正在上传参考图…" : busy ? "正在提交…" : activeTask ? "任务处理中…" : "生成三维模型"}
              </button>
            </div>
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {task && (
          <section className={styles.task} aria-label="三维任务结果">
            <div className={styles.taskHeader}>
              <div><strong>{task.modelName}</strong><span>{taskStatusLabel(task.status)}</span></div>
              {task.providerStatus && <small>{task.providerStatus}</small>}
            </div>
            {ACTIVE_STATUSES.has(task.status) && <div className={styles.taskProgress} role="progressbar" aria-label="三维模型生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuetext={taskStatusLabel(task.status)}><span /></div>}
            {task.error && <p className={styles.error} role="status">{task.error}</p>}
            {task.outputs.filter(isCanvasThreeDModelOutput).map((output, index) => {
              const outputIndex = task.outputs.indexOf(output);
              const download = canvasThreeDOutputDownload({ taskId: task.id, outputIndex, output });
              let previewUrl = "";
              if (isCanvasThreeDPreviewOutput(output)) {
                try { previewUrl = canvasThreeDPreviewUrl(task.id, outputIndex); } catch { previewUrl = ""; }
              }
              return (
                <article className={styles.output} key={`${task.id}-${output.jobId || outputIndex}`}>
                  {previewUrl && <ThreeDModelPreview url={previewUrl} label={output.name || `模型结果 ${index + 1}`} />}
                  <div className={styles.outputMeta}>
                    <div><strong>{output.name || output.title || `模型结果 ${index + 1}`}</strong><span>{output.artifactType?.toUpperCase() || "模型文件"}</span></div>
                    {output.url && <a href={download.href} target={download.targetBlank ? "_blank" : undefined} rel={download.targetBlank ? "noreferrer" : undefined} download>{download.label}</a>}
                  </div>
                </article>
              );
            })}
            {!ACTIVE_STATUSES.has(task.status) && !task.outputs.some(isCanvasThreeDModelOutput) && !task.error && <p className={styles.hint}>任务已完成，但服务暂未返回可预览的模型文件。</p>}
          </section>
        )}
      </div>
    </section>
  );
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={styles.switchField}>
      <span className={styles.label}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={checked ? styles.switchOn : ""} onClick={() => onChange(!checked)}><span /></button>
      <small>{checked ? "开启" : "关闭"}</small>
    </div>
  );
}
