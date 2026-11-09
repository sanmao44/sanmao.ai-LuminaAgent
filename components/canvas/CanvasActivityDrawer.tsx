"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GenerationLog } from "@/lib/generation-log";
import { activityTaskFromGenerationLog } from "@/lib/task-activity/adapters";
import { deriveCanvasActivityEmptyState, resolveCanvasActivityNavigation, canvasTaskBelongsToProject, filterCanvasGenerationLogs, generationLogDisplayStatus, generationLogDuration, generationLogKind, generationLogKindLabel, generationLogNeedsAttention, generationLogOutputUrls, generationLogStatusLabel } from "@/lib/canvas/activity-log";
import { canvasNodeForGenerationLog } from "@/lib/canvas/task-recovery";
import { canPreserveCanvasAudioDraft, canRestoreCanvasTaskContext, restorableCanvasTaskLogs } from "@/lib/canvas/task-context-recovery";
import { deriveCanvasTaskNextAction } from "@/lib/canvas/task-next-action";
import { deriveCanvasTaskPrimaryAction } from "@/lib/canvas/task-log-actions";
import { canRetryCanvasVideoLog, canvasVideoRetryTaskId, retryableCanvasVideoLogs, type CanvasVideoRetryResult } from "@/lib/canvas/batch-video-retry";
import { canvasUpscaleRetryTaskId, retryableCanvasUpscaleLogs, type CanvasUpscaleRetryResult } from "@/lib/canvas/batch-upscale-retry";
import type { CanvasActivityLog } from "@/lib/canvas/activity-log";
import { canvasLineageForTask, type CanvasLineageRecord } from "@/lib/provenance/normalize";
import type { CanvasDocument, CanvasNodeCreationKind } from "@/lib/canvas/types";
import { CanvasPanelShell } from "@/components/canvas/CanvasPanels";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";
import CanvasProjectProgressPanel from "@/components/canvas/CanvasProjectProgressPanel";
import { deriveCanvasProjectProgress, type CanvasProjectProgressAction } from "@/lib/canvas/project-progress";
import { deriveCanvasProjectQuality } from "@/lib/canvas/project-quality";
import { deriveCanvasWorkspaceRecommendation } from "@/lib/canvas/workspace-recommendation";
import type { CreativeProjectBrief } from "@/packages/contracts/creative";

type TaskMediaFilter = "all" | "image" | "video" | "audio" | "llm";

const taskScopeOptions: SelectMenuOption<"project" | "all">[] = [
  { value: "project", label: "本项目" },
  { value: "all", label: "全部项目" },
];

const taskMediaOptions: SelectMenuOption<TaskMediaFilter>[] = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "llm", label: "LLM" },
];


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
  cancellableCanvasTaskIds,
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
  cancellableCanvasTaskIds: ReadonlySet<string>;
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
  const [status, setStatus] = useState<"all" | GenerationLog["status"] | "recoverable" | "attention">("all");
  const [media, setMedia] = useState<TaskMediaFilter>("all");
  const [query, setQuery] = useState("");
  const [projectOnly, setProjectOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabOrder = ["project", "tasks", "activity"] as const;
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
    () => retryableCanvasVideoLogs(filteredTasks, batchRetriedTaskIds),
    [batchRetriedTaskIds, filteredTasks],
  );
  const batchUpscaleRetryCandidates = useMemo(
    () => retryableCanvasUpscaleLogs(filteredTasks, batchRetriedTaskIds),
    [batchRetriedTaskIds, filteredTasks],
  );
  const nextAction = useMemo(() => deriveCanvasTaskNextAction(scopedTasks), [scopedTasks]);
  const summary = useMemo(
    () => ({
      total: scopedTasks.length,
      matching: matchingTasks.length,
      pending: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "pending" && !generationLogNeedsAttention(log)).length,
      attention: matchingTasks.filter((log) => generationLogNeedsAttention(log)).length,
      success: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "success").length,
      error: matchingTasks.filter((log) => generationLogDisplayStatus(log) === "error").length,
    }),
    [matchingTasks, scopedTasks],
  );
  const activityEmptyState = deriveCanvasActivityEmptyState(scopedTasks.length, taskLogs.length);
  const activeFilterCount = Number(!projectOnly) + Number(media !== "all") + Number(status !== "all") + Number(Boolean(query.trim()));
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
  const recommendation = useMemo(
    () => deriveCanvasWorkspaceRecommendation(progress.nextAction, nextAction),
    [nextAction, progress.nextAction],
  );
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
  const runRecommendation = () => {
    if (recommendation.kind === "task") {
      setTab("tasks");
      setQuery("");
      setMedia("all");
      setProjectOnly(true);
      setStatus(recommendation.filter);
      setSelectedId(null);
      return;
    }
    runNextAction(recommendation.action);
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabOrder.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabOrder.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabOrder.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabOrder[nextIndex];
    setTab(nextTab);
    requestAnimationFrame(() => tabButtonRefs.current[nextIndex]?.focus());
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
          <button ref={(element) => { tabButtonRefs.current[0] = element; }} id="canvas-tab-project" type="button" role="tab" aria-selected={tab === "project"} aria-controls="canvas-tabpanel-project" tabIndex={tab === "project" ? 0 : -1} className={tab === "project" ? "active" : ""} onClick={() => setTab("project")} onKeyDown={handleTabKeyDown}>进度</button>
          <button ref={(element) => { tabButtonRefs.current[1] = element; }} id="canvas-tab-tasks" type="button" role="tab" aria-selected={tab === "tasks"} aria-controls="canvas-tabpanel-tasks" tabIndex={tab === "tasks" ? 0 : -1} className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")} onKeyDown={handleTabKeyDown}>任务 <b>{summary.total}</b></button>
          <button ref={(element) => { tabButtonRefs.current[2] = element; }} id="canvas-tab-activity" type="button" role="tab" aria-selected={tab === "activity"} aria-controls="canvas-tabpanel-activity" tabIndex={tab === "activity" ? 0 : -1} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")} onKeyDown={handleTabKeyDown}>活动 <b>{activityLogs.length}</b></button>
        </div>
        {tab === "tasks" && <>
          <div className="canvas-log-summary-grid">
            <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><b>{summary.matching}</b><small>{media === "all" && !query.trim() ? "全部" : "筛选结果"}</small></button>
            <button type="button" className={status === "pending" ? "active pending" : "pending"} onClick={() => setStatus("pending")}><b>{summary.pending}</b><small>进行中</small></button>
            <button type="button" className={status === "attention" ? "active attention" : "attention"} onClick={() => setStatus("attention")}><b>{summary.attention}</b><small>待确认</small></button>
            <button type="button" className={status === "success" ? "active success" : "success"} onClick={() => setStatus("success")}><b>{summary.success}</b><small>成功</small></button>
            <button type="button" className={status === "error" ? "active error" : "error"} onClick={() => setStatus("error")}><b>{summary.error}</b><small>失败</small></button>
          </div>
          <div className="canvas-log-toolbar">
            <div className="canvas-log-search-row">
              <label className="canvas-log-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、模型或服务商…" /></label>
              <button type="button" className={`canvas-log-filter-toggle${filtersOpen ? " active" : ""}`} aria-expanded={filtersOpen} aria-controls="canvas-task-filters" onClick={() => setFiltersOpen((open) => !open)}>
                筛选{activeFilterCount > 0 ? <b>{activeFilterCount}</b> : null}
              </button>
            </div>
            {filtersOpen && <div id="canvas-task-filters" className="canvas-log-filter-row">
              <div className="canvas-log-filter-control">
                <span>范围</span>
                <SelectMenu
                  className="canvas-log-filter-select"
                  menuClassName="canvas-log-filter-popover"
                  menuWidth={172}
                  ariaLabel="任务范围"
                  value={projectOnly ? "project" : "all"}
                  options={taskScopeOptions}
                  onChange={(value) => setProjectOnly(value === "project")}
                />
              </div>
              <div className="canvas-log-filter-control">
                <span>类型</span>
                <SelectMenu
                  className="canvas-log-filter-select"
                  menuClassName="canvas-log-filter-popover"
                  menuWidth={172}
                  ariaLabel="任务媒体类型"
                  value={media}
                  options={taskMediaOptions}
                  onChange={setMedia}
                />
              </div>
              <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "↻ 刷新"}</button>
            </div>}
          </div>
        </>}
      </div>
      {tab === "project" ? (
        <div id="canvas-tabpanel-project" role="tabpanel" aria-labelledby="canvas-tab-project" tabIndex={0}>
          <CanvasProjectProgressPanel
            projectName={projectName}
            progress={progress}
            quality={quality}
            recommendation={recommendation}
            canExport={Boolean(creativeProjectId)}
            onRecommendation={runRecommendation}
            onAction={runNextAction}
            onOpenNode={onFocusNode}
            onExportPackage={onExportProjectPackage}
            onScaffold={onScaffoldProject}
          />
        </div>
      ) : tab === "tasks" ? (
        <div id="canvas-tabpanel-tasks" role="tabpanel" aria-labelledby="canvas-tab-tasks" tabIndex={0}>
          <div className={`canvas-task-next-action ${recommendation.kind === "task" ? nextAction.kind : "ready"}`} role="status" aria-live="polite">
            <div><strong>{recommendation.title}</strong><small>{recommendation.detail}</small></div>
            <button type="button" onClick={runRecommendation}>{recommendation.kind === "task" ? recommendation.buttonLabel : "继续这一步"}</button>
          </div>
          {(batchRetryCandidates.length > 0 || batchRetryResultKind === "video") && <section className="canvas-batch-video-retry" aria-label="批量重试视频任务">
            <div className="canvas-batch-video-retry-copy">
              <strong>批量重试视频失败项 <span>{batchRetryCandidates.length}</span></strong>
              <small>仅处理当前筛选列表中的失败项，最多 8 项、并发 2 项；按原参数新建任务，可能产生费用。</small>
            </div>
            {batchRetryRunning && batchRetryKind === "video" && batchRetryProgress ? <div className="canvas-batch-video-retry-progress" role="status" aria-live="polite">
              <span>正在提交 {batchRetryProgress.completed} / {batchRetryProgress.total}</span>
              <progress value={batchRetryProgress.completed} max={batchRetryProgress.total} aria-label="批量重试进度" />
            </div> : batchRetryConfirm === "video" ? <div className="canvas-batch-video-retry-confirm">
              <span>将仅重试当前筛选列表中的失败项，按原参数创建新视频任务；每项可能产生费用，原失败记录会保留。</span>
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
              <small>仅处理当前筛选列表中无服务商任务编号和结果的失败项；最多 8 项、并发 2 项。</small>
            </div>
            {batchRetryRunning && batchRetryKind === "upscale" && batchRetryProgress ? <div className="canvas-batch-upscale-retry-progress" role="status" aria-live="polite">
              <span>正在提交 {batchRetryProgress.completed} / {batchRetryProgress.total}</span>
              <progress value={batchRetryProgress.completed} max={batchRetryProgress.total} aria-label="超分批量重试进度" />
            </div> : batchRetryConfirm === "upscale" ? <div className="canvas-batch-upscale-retry-confirm">
              <span>将仅重试当前筛选列表中符合条件的超分失败项，按原参数新建任务；可能产生费用，原失败记录会保留。</span>
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
              const taskId = String(log.taskId || log.id);
              const taskNode = canvasDocument.nodes.find((node) =>
                String(node.data.jobId || node.data.generation?.taskId || "") === taskId,
              ) || (kind === "llm" ? undefined : canvasNodeForGenerationLog(canvasDocument, log));
              const stale = generationLogNeedsAttention(log);
              const locallyStopped = taskNode?.data.taskTracking === "stopped";
              const displayStatus = generationLogDisplayStatus(log);
              const resultUnconfirmed = displayStatus === "pending" && log.errorCode === "provider_result_unconfirmed";
              const showPendingSpinner = displayStatus === "pending" && !stale && !locallyStopped;
              const canStopTask = displayStatus === "pending" && !locallyStopped && (
                kind === "video" || ((kind === "image" || kind === "llm")
                  && (cancellableCanvasTaskIds.has(taskId) || Boolean(taskNode)))
              );
              const retryTaskId = canvasVideoRetryTaskId(log);
              const canRetryTask = canRetryCanvasVideoLog(log) && (!retryTaskId || !batchRetriedTaskIds.has(retryTaskId));
              const canRestoreTaskContext = canRestoreCanvasTaskContext(log);
              const canContinueTask = log.status === "success" && urls.length > 0 && (kind === "image" || kind === "video");
              const needsRecordCheck = kind === "image" && (resultUnconfirmed || stale);
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
              const openMedia = Boolean(urls.length) || canOpenTaskMedia;
              const relationLabel = (relation: string) => ({
                edited_from: "编辑自",
                upscaled_from: "超分自",
                converted_to_video: "转为视频",
                generated_from: "生成自",
                derived_from: "派生自",
                referenced: "引用",
              }[relation] || "来源");
              const primaryAction = deriveCanvasTaskPrimaryAction({
                kind,
                needsRecordCheck,
                canPreserveAudio,
                canRestoreTaskContext,
                canRetryTask,
                canContinueTask,
                hasMediaResult: openMedia,
              });
              const hasSecondaryActions = canStopTask
                || (needsRecordCheck && primaryAction !== "check")
                || (canPreserveAudio && primaryAction !== "preserve-audio")
                || (canContinueTask && primaryAction !== "continue")
                || (canRetryTask && primaryAction !== "retry")
                || (canRestoreTaskContext && primaryAction !== "restore")
                || (kind !== "llm" && primaryAction !== "open" && primaryAction !== "focus");
              const toggleDetails = () => setSelectedId((value) => value === log.id ? null : log.id);
              const checkTaskRecord = () => {
                setCheckingTaskId(log.id);
                void onCheckTaskRecord(log)
                  .catch((error) => onNotify(error instanceof Error ? error.message : "核对任务记录失败", "error"))
                  .finally(() => setCheckingTaskId((current) => current === log.id ? null : current));
              };
              const retryTask = () => {
                setRetryingTaskId(log.id);
                void onRetryTask(log)
                  .catch((error) => onNotify(error instanceof Error ? error.message : "重试任务失败", "error"))
                  .finally(() => setRetryingTaskId((current) => current === log.id ? null : current));
              };
              const stopTask = () => {
                setCancellingTaskId(log.id);
                void onCancelTask(log)
                  .catch((error) => onNotify(error instanceof Error ? error.message : "停止任务失败", "error"))
                  .finally(() => setCancellingTaskId((current) => current === log.id ? null : current));
              };
              const focusTask = () => {
                rememberScrollBeforeMediaOpen(openMedia);
                onFocusTask(log, openMedia);
              };
              const primaryActionLabel = primaryAction === "check"
                ? checkingTaskId === log.id ? "正在核对…" : "核对结果"
                : primaryAction === "preserve-audio" ? "保留配音草稿"
                  : primaryAction === "restore" ? "恢复上下文"
                    : primaryAction === "retry" ? retryingTaskId === log.id ? "正在重试…" : "重试任务"
                      : primaryAction === "continue" ? "继续创作"
                        : primaryAction === "open" ? "打开结果"
                          : primaryAction === "focus" ? "定位节点"
                            : null;
              const runPrimaryAction = () => {
                if (primaryAction === "check") checkTaskRecord();
                else if (primaryAction === "preserve-audio") onPreserveAudioDraft(log);
                else if (primaryAction === "restore") onRestoreTaskContext(log);
                else if (primaryAction === "retry") retryTask();
                else if (primaryAction === "continue") onContinueTask(log);
                else if (primaryAction === "open" || primaryAction === "focus") focusTask();
              };
              return <article className={`canvas-task-log-card ${displayStatus} ${selectedId === log.id ? "selected" : ""}`} key={log.id}>
                {lineage.length > 0 && <div className="canvas-task-log-detail canvas-task-log-lineage" onClick={(event) => event.stopPropagation()}>
                  <div><b>结果与来源</b><small>统一活动：{activityTask.kind} · {activityTask.status} · {activityTask.sourceId || log.id}{log.projectId ? ` · 项目 ${log.projectId}` : ""}{log.chatId ? ` · 对话 ${log.chatId}` : ""}</small></div>
                  {lineage.map((record: CanvasLineageRecord) => <div key={record.resultNodeId} className="canvas-task-log-lineage-row canvas-task-log-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => { const openMedia = canOpenNode(record.resultNodeId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(record.resultNodeId, openMedia); }}>结果：{nodeLabel(record.resultNodeId)}</button>
                    <span>← {relationLabel(record.edges[0]?.relation || "derived_from")}</span>
                    {record.sourceNodeIds.map((sourceId) => <button type="button" key={sourceId} onClick={() => { const openMedia = canOpenNode(sourceId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(sourceId, openMedia); }}>来源：{nodeLabel(sourceId)}</button>)}
                  </div>)}
                </div>}
                <div className="canvas-task-log-preview">
                  {kind === "video" && urls[0] ? <video src={urls[0]} muted playsInline preload="metadata" /> : urls.length ? <div className="canvas-task-log-images">{urls.slice(0, 3).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${generationLogKindLabel(log)}结果 ${index + 1}`} />)}</div> : <span className={showPendingSpinner ? "loading" : "placeholder"}>{showPendingSpinner ? "◌" : kind === "video" ? "▶" : "▣"}</span>}
                </div>
                <div className="canvas-task-log-status">{locallyStopped ? "已停止等待" : resultUnconfirmed || stale ? "结果待确认" : generationLogStatusLabel(log.status)}</div>
                <div className="canvas-task-log-main"><strong>{log.prompt || "未填写提示词"}</strong><small>{log.presetName ? `预设：${log.presetName} · ` : ""}{log.source === "agent" ? "Agent" : "画布生成"} · {log.modelName || "自动选择模型"} · {log.providerName || "等待服务商响应"}</small>{displayStatus === "pending" && <small className="pending-note">{locallyStopped ? "已停止画布中的等待；服务商状态未知，稍后仍可能收到结果" : resultUnconfirmed ? kind === "image" ? "服务商可能已接收，结果待核对；不会重复提交" : "服务商可能已接收，请先检查音频素材和生成记录，再决定是否重试" : stale ? `${generationLogDuration(log)} 未收到完成回执；服务商可能仍在处理` : "正在等待服务商返回结果"}</small>}{log.error && !resultUnconfirmed && !stale && <small className="error-note">{log.error}</small>}</div>
                <div className="canvas-task-log-meta"><span className="canvas-task-log-meta-count">{kind === "llm" ? `${log.llmCallCount || 0} 次调用` : kind === "video" ? `${urls.length || (log.status === "pending" ? 1 : 0)} 段视频` : kind === "audio" ? "1 条音频" : `${log.status === "pending" ? log.count || 1 : log.imageCount || urls.length} 张`}</span><span className="canvas-task-log-meta-duration">{generationLogDuration(log)}</span><span className="canvas-task-log-meta-size">{kind === "llm" ? `${log.task || "普通对话"} · ${log.responseChars || 0} 字响应 · 联网 ${log.webSearchStatus || "未检索"}` : kind === "video" ? `${log.operation === "edit" ? "编辑" : log.operation === "extend" ? "扩展" : "生成"} · ${log.resolution || "自动"}` : kind === "audio" ? `${log.modelName || "本机语音"} · 配音` : `${log.outputSize || "自动尺寸"} · ${log.aspectRatio || "自动比例"}`}</span><time>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>
                <div className="canvas-task-log-actions">
                  <button type="button" className="canvas-task-log-details-toggle" aria-expanded={selectedId === log.id} onClick={toggleDetails}>{selectedId === log.id ? "收起详情" : "查看详情"}</button>
                  {primaryActionLabel && <button type="button" className="primary" disabled={(primaryAction === "check" && checkingTaskId === log.id) || (primaryAction === "retry" && (batchRetryConfirm !== null || batchRetryRunning || retryingTaskId === log.id))} onClick={runPrimaryAction}>{primaryActionLabel}</button>}
                  {hasSecondaryActions && <details className="canvas-task-log-more">
                    <summary aria-label={`更多任务操作：${generationLogKindLabel(log)}`}>更多</summary>
                    <div>
                      {needsRecordCheck && primaryAction !== "check" && <button type="button" disabled={checkingTaskId === log.id} title="只读取原任务记录并回填已确认结果，不会重新提交。" onClick={checkTaskRecord}>{checkingTaskId === log.id ? "正在核对…" : "核对任务记录"}</button>}
                      {canPreserveAudio && primaryAction !== "preserve-audio" && <button type="button" title="只保留本地可编辑草稿，不会查询、重试或重新提交原配音请求。" onClick={() => onPreserveAudioDraft(log)}>保留配音草稿</button>}
                      {canContinueTask && primaryAction !== "continue" && <button type="button" title="沿用当前结果的参数和参考素材创建下一条分支。" onClick={() => onContinueTask(log)}>继续创作</button>}
                      {canRetryTask && primaryAction !== "retry" && <button type="button" disabled={batchRetryConfirm !== null || batchRetryRunning || retryingTaskId === log.id} title="保留原任务记录，并按原参数创建一条新任务。" onClick={retryTask}>{retryingTaskId === log.id ? "正在重试…" : "重试任务"}</button>}
                      {canStopTask && <button type="button" disabled={cancellingTaskId === log.id} title={kind === "video" ? "停止本地视频任务跟踪；服务商可能仍在生成或计费。" : "只停止画布本机等待；服务商若已受理，仍可能继续生成或计费。"} onClick={stopTask}>{cancellingTaskId === log.id ? "正在停止…" : kind === "video" ? "停止跟踪" : "停止等待"}</button>}
                      {canRestoreTaskContext && primaryAction !== "restore" && <button type="button" onClick={() => onRestoreTaskContext(log)}>恢复上下文</button>}
                      {kind !== "llm" && primaryAction !== "open" && primaryAction !== "focus" && <button type="button" onClick={focusTask}>{openMedia ? "打开结果" : "定位节点"}</button>}
                    </div>
                  </details>}
                </div>
                {selectedId === log.id && <div className="canvas-task-log-detail" id={`canvas-task-details-${log.id}`}><div><b>任务详情</b><small>{log.id}</small></div><p>{log.prompt || "未填写提示词"}</p>{kind === "llm" && <small>模型调用：{log.llmCallCount || 0} 次 · 响应：{log.responseChars || 0} 字 · 联网：{log.webSearchStatus || "未检索"}</small>}{log.references?.length ? <small>参考图：{log.references.map((reference) => reference.name || "参考素材").join("、")}</small> : null}{log.providerTaskId && <small>服务商任务：{log.providerTaskId}</small>}{log.error && <strong className="error-note">失败原因：{log.error}</strong>}</div>}
                </article>;
            })}
          </div> : <div className="canvas-side-empty"><span>▱</span><b>{scopedTasks.length ? "没有符合条件的任务" : projectOnly ? "当前项目还没有任务" : "还没有生成任务"}</b><small>{scopedTasks.length ? "当前筛选针对生成任务记录；画布中的全部素材请从顶部“资产”面板查看。" : projectOnly ? "切换到“全部项目”可查看其它项目的历史任务。" : "从画布生成图片、视频或 Agent 结果后会出现在这里。"}</small></div>}
        </div>
      ) : (
        <div id="canvas-tabpanel-activity" role="tabpanel" aria-labelledby="canvas-tab-activity" tabIndex={0}>
          <div className="canvas-activity-summary"><b>{activityLogs.length}</b><span>条画布操作</span></div>
          {activityLogs.length ? <div className="canvas-activity-list">{activityLogs.map((log) => {
            const navigation = resolveCanvasActivityNavigation(log, taskLogs);
            const targetLabel = navigation.kind === "node" ? "定位节点" : navigation.kind === "task" ? "定位任务" : "查看记录";
            return <button type="button" className={log.status} key={log.id} aria-label={`${log.message} · ${targetLabel}`} onClick={() => {
              if (navigation.kind === "node") return onFocusNode(navigation.nodeId);
              if (navigation.kind === "task") return onFocusTask(navigation.log);
              onNotify("这条活动记录没有可定位的节点或任务详情");
            }}><time>{new Date(log.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span className="canvas-activity-dot">●</span><p>{log.message}</p><small>{targetLabel} · {log.type === "generation" ? "生成" : log.type === "agent" ? "Agent" : log.type === "asset" ? "资产" : log.type === "project" ? "项目" : log.type === "canvas" ? "画布" : "系统"}</small></button>;
          })}</div> : <div className="canvas-side-empty canvas-activity-empty"><span>≡</span><b>{activityEmptyState.title}</b><small>{activityEmptyState.detail}</small>{activityEmptyState.taskScope && <button type="button" className="canvas-activity-empty-action" onClick={() => {
            setStatus("all");
            setMedia("all");
            setQuery("");
            setProjectOnly(activityEmptyState.taskScope === "project");
            setSelectedId(null);
            setTab("tasks");
          }}>{activityEmptyState.taskScope === "project" ? "查看本项目任务" : "查看全部项目任务"}<span aria-hidden="true">→</span></button>}</div>}
        </div>
      )}
    </CanvasPanelShell>
  );
}

