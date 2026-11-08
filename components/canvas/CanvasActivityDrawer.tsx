"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GenerationLog } from "@/lib/generation-log";
import { activityTaskFromGenerationLog } from "@/lib/task-activity/adapters";
import { resolveCanvasActivityNavigation, canvasTaskBelongsToProject, filterCanvasGenerationLogs, generationLogDisplayStatus, generationLogDuration, generationLogKind, generationLogKindLabel, generationLogOutputUrls, generationLogStatusLabel } from "@/lib/canvas/activity-log";
import { canvasNodeForGenerationLog } from "@/lib/canvas/task-recovery";
import { canPreserveCanvasAudioDraft, canRestoreCanvasTaskContext, restorableCanvasTaskLogs } from "@/lib/canvas/task-context-recovery";
import { deriveCanvasTaskNextAction } from "@/lib/canvas/task-next-action";
import { canRetryCanvasVideoLog, canvasVideoRetryTaskId, retryableCanvasVideoLogs, type CanvasVideoRetryResult } from "@/lib/canvas/batch-video-retry";
import { canvasUpscaleRetryTaskId, retryableCanvasUpscaleLogs, type CanvasUpscaleRetryResult } from "@/lib/canvas/batch-upscale-retry";
import type { CanvasActivityLog } from "@/lib/canvas/activity-log";
import { canvasLineageForTask, type CanvasLineageRecord } from "@/lib/provenance/normalize";
import type { CanvasDocument, CanvasNodeCreationKind } from "@/lib/canvas/types";
import { CanvasPanelShell } from "@/components/canvas/CanvasPanels";
import CanvasProjectProgressPanel from "@/components/canvas/CanvasProjectProgressPanel";
import { deriveCanvasProjectProgress, type CanvasProjectProgressAction } from "@/lib/canvas/project-progress";
import { deriveCanvasProjectQuality } from "@/lib/canvas/project-quality";
import type { CreativeProjectBrief } from "@/packages/contracts/creative";


export default function CanvasActivityDrawer({
  taskLogs,
  activityLogs,
  canvasDocument,
  loading,
  onRefresh,
  onFocusTask,
  onFocusNode,
  onRestoreTaskContext,
  onPreserveAudioDraft,
  onCheckTaskRecord,
  onRetryTask,
  onBatchRetryVideoTasks,
  onBatchRetryUpscaleTasks,
  onContinueTask,
  onCancelTask,
  cancellableImageTaskIds,
  onClose,
  onNotify,
  restoreScrollTop,
  onRememberScrollPosition,
  creativeProjectId,
  canvasId,
  canvasNodeIds,
  canvasTaskIds,
  projectName,
  projectBrief,
  projectVersionCount,
  onOpenProjectBrief,
  onDraftProject,
  onCreateProjectNode,
  onSaveProjectVersion,
  onExportProjectPackage,
  onScaffoldProject,
}: {
  taskLogs: GenerationLog[];
  activityLogs: CanvasActivityLog[];
  canvasDocument: CanvasDocument;
  loading: boolean;
  onRefresh: () => void;
  onFocusTask: (log: GenerationLog, openMedia?: boolean) => void;
  onFocusNode: (nodeId: string, openMedia?: boolean) => void;
  onRestoreTaskContext: (log: GenerationLog) => void;
  onPreserveAudioDraft: (log: GenerationLog) => void;
  onCheckTaskRecord: (log: GenerationLog) => Promise<void>;
  onRetryTask: (log: GenerationLog) => Promise<void>;
  onBatchRetryVideoTasks: (
    logs: GenerationLog[],
    onProgress: (completed: number, total: number) => void,
  ) => Promise<CanvasVideoRetryResult>;
  onBatchRetryUpscaleTasks: (
    logs: GenerationLog[],
    onProgress: (completed: number, total: number) => void,
  ) => Promise<CanvasUpscaleRetryResult>;
  onContinueTask: (log: GenerationLog) => void;
  onCancelTask: (log: GenerationLog) => Promise<void>;
  cancellableImageTaskIds: ReadonlySet<string>;
  onClose: () => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  restoreScrollTop: number | null;
  onRememberScrollPosition: (scrollTop: number) => void;
  creativeProjectId?: string;
  canvasId?: string;
  canvasNodeIds: ReadonlySet<string>;
  canvasTaskIds: ReadonlySet<string>;
  projectName: string;
  projectBrief: CreativeProjectBrief | null;
  projectVersionCount: number;
  onOpenProjectBrief: () => void;
  onDraftProject: () => void;
  onCreateProjectNode: (kind: CanvasNodeCreationKind, sourceNodeIds?: string[]) => void;
  onSaveProjectVersion: () => void;
  onExportProjectPackage: () => void;
  onScaffoldProject: () => void;
}) {
  const [tab, setTab] = useState<"project" | "tasks" | "activity">("project");
  const [status, setStatus] = useState<"all" | GenerationLog["status"] | "recoverable">("all");
  const [media, setMedia] = useState<"all" | "image" | "video" | "audio" | "llm">("all");
  const [query, setQuery] = useState("");
  const [projectOnly, setProjectOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [checkingTaskId, setCheckingTaskId] = useState<string | null>(null);
  const [batchRetryConfirm, setBatchRetryConfirm] = useState<"video" | "upscale" | null>(null);
  const [batchRetryRunning, setBatchRetryRunning] = useState(false);
  const [batchRetryKind, setBatchRetryKind] = useState<"video" | "upscale" | null>(null);
  const [batchRetryProgress, setBatchRetryProgress] = useState<{ completed: number; total: number } | null>(null);
  const [batchRetryResult, setBatchRetryResult] = useState<CanvasVideoRetryResult | CanvasUpscaleRetryResult | null>(null);
  const [batchRetryResultKind, setBatchRetryResultKind] = useState<"video" | "upscale" | null>(null);
  const [batchRetriedTaskIds, setBatchRetriedTaskIds] = useState<ReadonlySet<string>>(new Set());
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (restoreScrollTop === null) return;
    const frame = requestAnimationFrame(() => {
      scrollBodyRef.current?.scrollTo({ top: restoreScrollTop, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreScrollTop]);
  const rememberScrollBeforeMediaOpen = (openMedia: boolean) => {
    if (openMedia) onRememberScrollPosition(scrollBodyRef.current?.scrollTop || 0);
  };
  const scopedTasks = useMemo(() => projectOnly
    ? taskLogs.filter((log) => canvasTaskBelongsToProject(log, {
      projectId: creativeProjectId,
      canvasId,
      nodeIds: canvasNodeIds,
      taskIds: canvasTaskIds,
    }))
    : taskLogs, [canvasId, canvasNodeIds, canvasTaskIds, creativeProjectId, projectOnly, taskLogs]);
  const restorableTaskIds = useMemo(
    () => new Set(restorableCanvasTaskLogs(scopedTasks).map((log) => log.id)),
    [scopedTasks],
  );
  const matchingTasks = useMemo(
    () => filterCanvasGenerationLogs(scopedTasks, { media, query }),
    [media, query, scopedTasks],
  );
  const filteredTasks = useMemo(
    () => filterCanvasGenerationLogs(scopedTasks, { media, query, status, recoverableTaskIds: restorableTaskIds }),
    [media, query, restorableTaskIds, scopedTasks, status],
  );
  const selected = scopedTasks.find((log) => log.id === selectedId);
  const batchRetryCandidates = useMemo(
    () => retryableCanvasVideoLogs(scopedTasks, batchRetriedTaskIds),
    [batchRetriedTaskIds, scopedTasks],
  );
  const batchUpscaleRetryCandidates = useMemo(
    () => retryableCanvasUpscaleLogs(scopedTasks, batchRetriedTaskIds),
    [batchRetriedTaskIds, scopedTasks],
  );
  const nextAction = useMemo(() => deriveCanvasTaskNextAction(scopedTasks), [scopedTasks]);
  const summary = useMemo(
    () => ({
      total: scopedTasks.length,
      matching: matchingTasks.length,
      pending: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "pending").length,
      success: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "success").length,
      error: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "error").length,
    }),
    [matchingTasks, scopedTasks],
  );
  const progress = useMemo(() => deriveCanvasProjectProgress({
    document: canvasDocument,
    brief: projectBrief,
    versionCount: projectVersionCount,
    taskLogs,
    projectId: creativeProjectId,
    canvasId,
  }), [canvasDocument, canvasId, creativeProjectId, projectBrief, projectVersionCount, taskLogs]);
  const quality = useMemo(() => deriveCanvasProjectQuality({
    document: canvasDocument,
    brief: projectBrief,
    versionCount: projectVersionCount,
    taskLogs,
    projectId: creativeProjectId,
    canvasId,
  }), [canvasDocument, canvasId, creativeProjectId, projectBrief, projectVersionCount, taskLogs]);
  const runNextAction = (action: CanvasProjectProgressAction) => {
    if (action.kind === "review-task") {
      setTab("tasks");
      setStatus(action.taskStatus);
      setMedia("all");
      setProjectOnly(true);
      setQuery("");
      setSelectedId(action.taskId);
      return;
    }
    if (action.kind === "edit-brief") onOpenProjectBrief();
    else if (action.kind === "draft-content") onDraftProject();
    else if (action.kind === "create-node") onCreateProjectNode(action.nodeKind, action.sourceNodeIds);
    else if (action.kind === "save-version") onSaveProjectVersion();
    else onFocusNode(action.nodeId);
  };
  const runTaskNextAction = () => {
    if (!nextAction.filter) return;
    setQuery("");
    setMedia("all");
    setProjectOnly(true);
    setStatus(nextAction.filter);
    setSelectedId(null);
  };
  const runBatchVideoRetry = async () => {
    if (!batchRetryCandidates.length || batchRetryRunning) return;
    setBatchRetryRunning(true);
    setBatchRetryKind("video");
    setBatchRetryProgress({ completed: 0, total: batchRetryCandidates.length });
    setBatchRetryResult(null);
    setBatchRetryResultKind(null);
    try {
      const result = await onBatchRetryVideoTasks(batchRetryCandidates, (completed, total) => {
        setBatchRetryProgress({ completed, total });
      });
      setBatchRetryResult(result);
      setBatchRetryResultKind("video");
      setBatchRetriedTaskIds((current) => new Set([
        ...current,
        ...result.succeeded.map(canvasVideoRetryTaskId).filter((taskId): taskId is string => Boolean(taskId)),
      ]));
      setBatchRetryConfirm(null);
      onNotify(
        `批量重试完成：${result.succeeded.length} 项已创建，${result.failed.length} 项未能启动。原任务记录已保留。`,
        result.failed.length ? "error" : "ok",
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量重试失败", "error");
    } finally {
      setBatchRetryRunning(false);
      setBatchRetryKind(null);
    }
  };
  const runBatchUpscaleRetry = async () => {
    if (!batchUpscaleRetryCandidates.length || batchRetryRunning) return;
    setBatchRetryRunning(true);
    setBatchRetryKind("upscale");
    setBatchRetryProgress({ completed: 0, total: batchUpscaleRetryCandidates.length });
    setBatchRetryResult(null);
    setBatchRetryResultKind(null);
    try {
      const result = await onBatchRetryUpscaleTasks(batchUpscaleRetryCandidates, (completed, total) => {
        setBatchRetryProgress({ completed, total });
      });
      setBatchRetryResult(result);
      setBatchRetryResultKind("upscale");
      setBatchRetriedTaskIds((current) => new Set([
        ...current,
        ...result.succeeded.map(canvasUpscaleRetryTaskId).filter((taskId): taskId is string => Boolean(taskId)),
      ]));
      setBatchRetryConfirm(null);
      onNotify(
        `批量重试完成：${result.succeeded.length} 项已创建，${result.failed.length} 项未能启动。原任务记录已保留。`,
        result.failed.length ? "error" : "ok",
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量重试失败", "error");
    } finally {
      setBatchRetryRunning(false);
      setBatchRetryKind(null);
    }
  };

  return (
    <CanvasPanelShell
      title="项目工作台"
      subtitle={`${projectName || "当前项目"} · 进度、任务与活动`}
      onClose={onClose}
      className="canvas-activity-panel canvas-task-log-panel"
      bodyRef={scrollBodyRef}
    >
      <div className="canvas-log-sticky-header">
        <div className="canvas-log-tabs" role="tablist" aria-label="项目工作台视图">
          <button type="button" role="tab" aria-selected={tab === "project"} className={tab === "project" ? "active" : ""} onClick={() => setTab("project")}>进度</button>
          <button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务 <b>{summary.total}</b></button>
          <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>活动 <b>{activityLogs.length}</b></button>
        </div>
        {tab === "tasks" && <>
          <div className="canvas-log-summary-grid">
            <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><b>{summary.matching}</b><small>{media === "all" && !query.trim() ? "全部" : "筛选结果"}</small></button>
            <button type="button" className={status === "pending" ? "active pending" : "pending"} onClick={() => setStatus("pending")}><b>{summary.pending}</b><small>进行中</small></button>
            <button type="button" className={status === "success" ? "active success" : "success"} onClick={() => setStatus("success")}><b>{summary.success}</b><small>成功</small></button>
            <button type="button" className={status === "error" ? "active error" : "error"} onClick={() => setStatus("error")}><b>{summary.error}</b><small>失败</small></button>
          </div>
          <div className="canvas-log-toolbar">
            <label className="canvas-log-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、模型或服务商…" /></label>
            <div className="canvas-log-filter-row" role="group" aria-label="任务媒体类型">
              <button type="button" className={projectOnly ? "active" : ""} onClick={() => setProjectOnly(true)}>本项目</button>
              <button type="button" className={!projectOnly ? "active" : ""} onClick={() => setProjectOnly(false)}>全部项目</button>
              <button type="button" className={media === "all" ? "active" : ""} onClick={() => setMedia("all")}>全部</button>
              <button type="button" className={media === "image" ? "active" : ""} onClick={() => setMedia("image")}>图片</button>
              <button type="button" className={media === "video" ? "active" : ""} onClick={() => setMedia("video")}>视频</button>
              <button type="button" className={media === "audio" ? "active" : ""} onClick={() => setMedia("audio")}>音频</button>
              <button type="button" className={media === "llm" ? "active" : ""} onClick={() => setMedia("llm")}>LLM</button>
              <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "↻ 刷新"}</button>
            </div>
          </div>
        </>}
      </div>
      {tab === "project" ? (
        <CanvasProjectProgressPanel
          projectName={projectName}
          progress={progress}
          quality={quality}
          canExport={Boolean(creativeProjectId)}
          onAction={runNextAction}
          onOpenNode={onFocusNode}
          onExportPackage={onExportProjectPackage}
          onScaffold={onScaffoldProject}
        />
      ) : tab === "tasks" ? (
        <>
          <div className={`canvas-task-next-action ${nextAction.kind}`} role="status" aria-live="polite">
            <div><strong>{nextAction.title}</strong><small>{nextAction.detail}</small></div>
            {nextAction.filter && <button type="button" onClick={runTaskNextAction}>{nextAction.buttonLabel}</button>}
          </div>
          {(batchRetryCandidates.length > 0 || batchRetryResultKind === "video") && <section className="canvas-batch-video-retry" aria-label="批量重试视频任务">
            <div className="canvas-batch-video-retry-copy">
              <strong>批量重试视频失败项 <span>{batchRetryCandidates.length}</span></strong>
              <small>最多处理 8 项，并发 2 项；按原参数新建任务，可能产生费用。</small>
            </div>
            {batchRetryRunning && batchRetryKind === "video" && batchRetryProgress ? <div className="canvas-batch-video-retry-progress" role="status" aria-live="polite">
              <span>正在提交 {batchRetryProgress.completed} / {batchRetryProgress.total}</span>
              <progress value={batchRetryProgress.completed} max={batchRetryProgress.total} aria-label="批量重试进度" />
            </div> : batchRetryConfirm === "video" ? <div className="canvas-batch-video-retry-confirm">
              <span>将按原任务参数创建新视频任务；每项可能产生费用，原失败记录会保留。</span>
              <div>
                <button type="button" onClick={() => setBatchRetryConfirm(null)}>返回</button>
                <button type="button" className="primary" onClick={() => void runBatchVideoRetry()}>确认重试 {batchRetryCandidates.length} 项</button>
              </div>
            </div> : batchRetryCandidates.length > 0 ? <button type="button" disabled={batchRetryRunning || batchRetryConfirm !== null} className="canvas-batch-video-retry-trigger" onClick={() => setBatchRetryConfirm("video")}>批量重试</button> : null}
            {batchRetryResultKind === "video" && batchRetryResult && !batchRetryRunning && <div className="canvas-batch-video-retry-result" role="status" aria-live="polite">
              <span>已创建 {batchRetryResult.succeeded.length} 项，失败 {batchRetryResult.failed.length} 项。</span>
              {batchRetryResult.failed.length > 0 && <ul>{batchRetryResult.failed.map(({ log, message }) => <li key={log.id}><b title={log.prompt || log.id}>{log.prompt || log.id}</b><small>{message}</small></li>)}</ul>}
            </div>}
          </section>}
          {(batchUpscaleRetryCandidates.length > 0 || batchRetryResultKind === "upscale") && <section className="canvas-batch-upscale-retry" aria-label="批量重试超分任务">
            <div className="canvas-batch-upscale-retry-copy">
              <strong>批量重试已确认拒绝的超分失败项 <span>{batchUpscaleRetryCandidates.length}</span></strong>
              <small>仅处理无服务商任务编号和结果的失败项；最多 8 项，并发 2 项。</small>
            </div>
            {batchRetryRunning && batchRetryKind === "upscale" && batchRetryProgress ? <div className="canvas-batch-upscale-retry-progress" role="status" aria-live="polite">
              <span>正在提交 {batchRetryProgress.completed} / {batchRetryProgress.total}</span>
              <progress value={batchRetryProgress.completed} max={batchRetryProgress.total} aria-label="超分批量重试进度" />
            </div> : batchRetryConfirm === "upscale" ? <div className="canvas-batch-upscale-retry-confirm">
              <span>将按原任务参数新建超分任务，可能产生费用；原失败记录会保留。</span>
              <div>
                <button type="button" onClick={() => setBatchRetryConfirm(null)}>返回</button>
                <button type="button" className="primary" onClick={() => void runBatchUpscaleRetry()}>确认重试 {batchUpscaleRetryCandidates.length} 项</button>
              </div>
            </div> : batchUpscaleRetryCandidates.length > 0 ? <button type="button" disabled={batchRetryRunning || batchRetryConfirm !== null} className="canvas-batch-upscale-retry-trigger" onClick={() => setBatchRetryConfirm("upscale")}>批量重试</button> : null}
            {batchRetryResultKind === "upscale" && batchRetryResult && !batchRetryRunning && <div className="canvas-batch-upscale-retry-result" role="status" aria-live="polite">
              <span>已创建 {batchRetryResult.succeeded.length} 项，失败 {batchRetryResult.failed.length} 项。</span>
              {batchRetryResult.failed.length > 0 && <ul>{batchRetryResult.failed.map(({ log, message }) => <li key={log.id}><b title={log.prompt || log.id}>{log.prompt || log.id}</b><small>{message}</small></li>)}</ul>}
            </div>}
          </section>}
          {loading && !scopedTasks.length ? <div className="canvas-side-empty"><span>◌</span><b>正在读取任务日志</b><small>与主界面服务端日志保持同步。</small></div> : filteredTasks.length ? <div className="canvas-task-log-list">
            {filteredTasks.map((log) => {
              const urls = generationLogOutputUrls(log);
              const kind = generationLogKind(log);
              const taskNode = kind === "llm" ? undefined : canvasNodeForGenerationLog(canvasDocument, log);
              const taskId = String(log.taskId || log.id);
              const canStopTask = log.status === "pending" && (
                kind === "video" || (kind === "image" && cancellableImageTaskIds.has(taskId))
              );
              const retryTaskId = canvasVideoRetryTaskId(log);
              const canRetryTask = canRetryCanvasVideoLog(log) && (!retryTaskId || !batchRetriedTaskIds.has(retryTaskId));
              const canRestoreTaskContext = canRestoreCanvasTaskContext(log);
              const canContinueTask = log.status === "success" && urls.length > 0 && (kind === "image" || kind === "video");
              const displayStatus = generationLogDisplayStatus(log);
              const resultUnconfirmed = displayStatus === "pending" && log.errorCode === "provider_result_unconfirmed";
              const needsRecordCheck = kind === "image" && resultUnconfirmed;
              const canPreserveAudio = canPreserveCanvasAudioDraft(log);
              const activityTask = activityTaskFromGenerationLog(log);
              const lineage = canvasLineageForTask(canvasDocument, activityTask.sourceId || log.id);
              const nodeLabel = (nodeId: string) => {
                const node = canvasDocument.nodes.find((item) => item.id === nodeId);
                return String(node?.data.name || node?.data.generation?.prompt || node?.data.prompt || nodeId).slice(0, 72);
              };
              const canOpenNode = (nodeId: string) => {
                const node = canvasDocument.nodes.find((item) => item.id === nodeId);
                return node?.type === "media" && Boolean(node.data.url);
              };
              const canOpenTaskMedia = Boolean(taskNode?.type === "media" && taskNode.data.url);
              const relationLabel = (relation: string) => ({
                edited_from: "编辑自",
                upscaled_from: "超分自",
                converted_to_video: "转为视频",
                generated_from: "生成自",
                derived_from: "派生自",
                referenced: "引用",
              }[relation] || "来源");
              return <article className={`canvas-task-log-card ${displayStatus} ${selectedId === log.id ? "selected" : ""}`} key={log.id} onClick={() => setSelectedId((value) => value === log.id ? null : log.id)}>
                {lineage.length > 0 && <div className="canvas-task-log-detail canvas-task-log-lineage" onClick={(event) => event.stopPropagation()}>
                  <div><b>结果与来源</b><small>统一活动：{activityTask.kind} · {activityTask.status} · {activityTask.sourceId || log.id}{log.projectId ? ` · 项目 ${log.projectId}` : ""}{log.chatId ? ` · 对话 ${log.chatId}` : ""}</small></div>
                  {lineage.map((record: CanvasLineageRecord) => <div key={record.resultNodeId} className="canvas-task-log-lineage-row canvas-task-log-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => { const openMedia = canOpenNode(record.resultNodeId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(record.resultNodeId, openMedia); }}>结果：{nodeLabel(record.resultNodeId)}</button>
                    <span>← {relationLabel(record.edges[0]?.relation || "derived_from")}</span>
                    {record.sourceNodeIds.map((sourceId) => <button type="button" key={sourceId} onClick={() => { const openMedia = canOpenNode(sourceId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(sourceId, openMedia); }}>来源：{nodeLabel(sourceId)}</button>)}
                  </div>)}
                </div>}
                <div className="canvas-task-log-preview">
                  {kind === "video" && urls[0] ? <video src={urls[0]} muted playsInline preload="metadata" /> : urls.length ? <div className="canvas-task-log-images">{urls.slice(0, 3).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${generationLogKindLabel(log)}结果 ${index + 1}`} />)}</div> : <span className={displayStatus === "pending" ? "loading" : "placeholder"}>{displayStatus === "pending" ? "◌" : kind === "video" ? "▶" : "▣"}</span>}
                </div>
                <div className="canvas-task-log-status">{resultUnconfirmed ? "结果待确认" : generationLogStatusLabel(log.status)}</div>
                <div className="canvas-task-log-main"><strong>{log.prompt || "未填写提示词"}</strong><small>{log.presetName ? `预设：${log.presetName} · ` : ""}{log.source === "agent" ? "Agent" : "画布生成"} · {log.modelName || "自动选择模型"} · {log.providerName || "等待服务商响应"}</small>{displayStatus === "pending" && <small className="pending-note">{resultUnconfirmed ? kind === "image" ? "服务商可能已接收，结果待核对；不会重复提交" : "服务商可能已接收，请先检查音频素材和生成记录，再决定是否重试" : "任务正在后台生成，可继续使用画布"}</small>}{log.error && !resultUnconfirmed && <small className="error-note">{log.error}</small>}</div>
                <div className="canvas-task-log-meta"><span className="canvas-task-log-meta-count">{kind === "llm" ? `${log.llmCallCount || 0} 次调用` : kind === "video" ? `${urls.length || (log.status === "pending" ? 1 : 0)} 段视频` : kind === "audio" ? "1 条音频" : `${log.status === "pending" ? log.count || 1 : log.imageCount || urls.length} 张`}</span><span className="canvas-task-log-meta-duration">{generationLogDuration(log)}</span><span className="canvas-task-log-meta-size">{kind === "llm" ? `${log.task || "普通对话"} · ${log.responseChars || 0} 字响应 · 联网 ${log.webSearchStatus || "未检索"}` : kind === "video" ? `${log.operation === "edit" ? "编辑" : log.operation === "extend" ? "扩展" : "生成"} · ${log.resolution || "自动"}` : kind === "audio" ? `${log.modelName || "本机语音"} · 配音` : `${log.outputSize || "自动尺寸"} · ${log.aspectRatio || "自动比例"}`}</span><time>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>
                <div className="canvas-task-log-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId((value) => value === log.id ? null : log.id); }}>{selectedId === log.id ? "收起详情" : "查看详情"}</button>{needsRecordCheck && <button type="button" disabled={checkingTaskId === log.id} title="只读取原任务记录并回填已确认结果，不会重新提交。" onClick={(event) => { event.stopPropagation(); setCheckingTaskId(log.id); void onCheckTaskRecord(log).catch((error) => onNotify(error instanceof Error ? error.message : "核对任务记录失败", "error")).finally(() => setCheckingTaskId((current) => current === log.id ? null : current)); }}>{checkingTaskId === log.id ? "正在核对…" : "核对任务记录"}</button>}{canPreserveAudio && <button type="button" title="只保留本地可编辑草稿，不会查询、重试或重新提交原配音请求。" onClick={(event) => { event.stopPropagation(); onPreserveAudioDraft(log); }}>保留配音草稿</button>}{canContinueTask && <button type="button" title="沿用当前结果的参数和参考素材创建下一条分支。" onClick={(event) => { event.stopPropagation(); onContinueTask(log); }}>继续创作</button>}{canRetryTask && <button type="button" disabled={batchRetryConfirm !== null || batchRetryRunning || retryingTaskId === log.id} title="保留原任务记录，并按原参数创建一条新任务。" onClick={(event) => { event.stopPropagation(); setRetryingTaskId(log.id); void onRetryTask(log).catch((error) => onNotify(error instanceof Error ? error.message : "重试任务失败", "error")).finally(() => setRetryingTaskId((current) => current === log.id ? null : current)); }}>{retryingTaskId === log.id ? "正在重试…" : "重试任务"}</button>}{canStopTask && <button type="button" disabled={cancellingTaskId === log.id} title={kind === "video" ? "停止本地视频任务跟踪；服务商可能仍在生成或计费。" : "停止等待图片结果；服务商若已受理，仍可能继续生成或计费。"} onClick={(event) => { event.stopPropagation(); setCancellingTaskId(log.id); void onCancelTask(log).catch((error) => onNotify(error instanceof Error ? error.message : "停止任务失败", "error")).finally(() => setCancellingTaskId((current) => current === log.id ? null : current)); }}>{cancellingTaskId === log.id ? "正在停止…" : kind === "video" ? "停止跟踪" : "停止等待"}</button>}{canRestoreTaskContext && <button type="button" onClick={(event) => { event.stopPropagation(); onRestoreTaskContext(log); }}>恢复上下文</button>}{kind !== "llm" && <button type="button" onClick={(event) => { event.stopPropagation(); const openMedia = Boolean(urls.length) || canOpenTaskMedia; rememberScrollBeforeMediaOpen(openMedia); onFocusTask(log, openMedia); }}>{Boolean(urls.length) || canOpenTaskMedia ? "打开结果" : "定位节点"}</button>}</div>
                {selectedId === log.id && <div className="canvas-task-log-detail"><div><b>任务详情</b><small>{log.id}</small></div><p>{log.prompt || "未填写提示词"}</p>{kind === "llm" && <small>模型调用：{log.llmCallCount || 0} 次 · 响应：{log.responseChars || 0} 字 · 联网：{log.webSearchStatus || "未检索"}</small>}{log.references?.length ? <small>参考图：{log.references.map((reference) => reference.name || "参考素材").join("、")}</small> : null}{log.providerTaskId && <small>服务商任务：{log.providerTaskId}</small>}{log.error && <strong className="error-note">失败原因：{log.error}</strong>}</div>}
                </article>;
            })}
          </div> : <div className="canvas-side-empty"><span>▱</span><b>{scopedTasks.length ? "没有符合条件的任务" : projectOnly ? "当前项目还没有任务" : "还没有生成任务"}</b><small>{scopedTasks.length ? "当前筛选针对生成任务记录；画布中的全部素材请从顶部“资产”面板查看。" : projectOnly ? "切换到“全部项目”可查看其它项目的历史任务。" : "从画布生成图片、视频或 Agent 结果后会出现在这里。"}</small></div>}
        </>
      ) : (
        <>
          <div className="canvas-activity-summary"><b>{activityLogs.length}</b><span>条画布操作</span></div>
          {activityLogs.length ? <div className="canvas-activity-list">{activityLogs.map((log) => {
            const navigation = resolveCanvasActivityNavigation(log, taskLogs);
            const targetLabel = navigation.kind === "node" ? "定位节点" : navigation.kind === "task" ? "定位任务" : "查看记录";
            return <button type="button" className={log.status} key={log.id} aria-label={`${log.message} · ${targetLabel}`} onClick={() => {
              if (navigation.kind === "node") return onFocusNode(navigation.nodeId);
              if (navigation.kind === "task") return onFocusTask(navigation.log);
              onNotify("这条活动记录没有可定位的节点或任务详情");
            }}><time>{new Date(log.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span className="canvas-activity-dot">●</span><p>{log.message}</p><small>{targetLabel} · {log.type === "generation" ? "生成" : log.type === "agent" ? "Agent" : log.type === "asset" ? "资产" : log.type === "project" ? "项目" : log.type === "canvas" ? "画布" : "系统"}</small></button>;
          })}</div> : <div className="canvas-side-empty"><span>≡</span><b>暂无活动</b><small>生成、导入或整理画布后会记录在这里。</small></div>}
        </>
      )}
    </CanvasPanelShell>
  );
}

