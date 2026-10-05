"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GenerationLog } from "@/lib/generation-log";
import { activityTaskFromGenerationLog } from "@/lib/task-activity/adapters";
import { generationLogDuration, generationLogKind, generationLogKindLabel, generationLogOutputUrls, generationLogStatusLabel } from "@/lib/canvas/activity-log";
import type { CanvasActivityLog } from "@/lib/canvas/activity-log";
import { canvasLineageForTask, type CanvasLineageRecord } from "@/lib/provenance/normalize";
import type { CanvasDocument } from "@/lib/canvas/types";
import { CanvasPanelShell } from "@/components/canvas/CanvasPanels";


export default function CanvasActivityDrawer({
  taskLogs,
  activityLogs,
  canvasDocument,
  loading,
  onRefresh,
  onFocusTask,
  onFocusNode,
  onRetryTask,
  onClose,
  onNotify,
  restoreScrollTop,
  onRememberScrollPosition,
}: {
  taskLogs: GenerationLog[];
  activityLogs: CanvasActivityLog[];
  canvasDocument: CanvasDocument;
  loading: boolean;
  onRefresh: () => void;
  onFocusTask: (log: GenerationLog, openMedia?: boolean) => void;
  onFocusNode: (nodeId: string, openMedia?: boolean) => void;
  onRetryTask: (log: GenerationLog) => void;
  onClose: () => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  restoreScrollTop: number | null;
  onRememberScrollPosition: (scrollTop: number) => void;
}) {
  const [tab, setTab] = useState<"tasks" | "activity">("tasks");
  const [status, setStatus] = useState<"all" | GenerationLog["status"]>("all");
  const [media, setMedia] = useState<"all" | "image" | "video" | "llm">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return taskLogs.filter((log) => {
      const matchesStatus = status === "all" || log.status === status;
      const kind = generationLogKind(log);
      const matchesMedia = media === "all" || kind === media;
      const matchesQuery =
        !normalized ||
        `${log.prompt} ${log.presetName || ""} ${log.modelName || ""} ${log.providerName || ""}`
          .toLowerCase()
          .includes(normalized);
      return matchesStatus && matchesMedia && matchesQuery;
    });
  }, [media, query, status, taskLogs]);
  const selected = taskLogs.find((log) => log.id === selectedId);
  const summary = useMemo(
    () => ({
      total: taskLogs.length,
      pending: taskLogs.filter((log) => log.status === "pending").length,
      success: taskLogs.filter((log) => log.status === "success").length,
      error: taskLogs.filter((log) => log.status === "error").length,
    }),
    [taskLogs],
  );

  return (
    <CanvasPanelShell
      title="任务日志"
      subtitle="与主界面统一的生成任务记录"
      onClose={onClose}
      className="canvas-activity-panel canvas-task-log-panel"
      bodyRef={scrollBodyRef}
    >
      <div className="canvas-log-tabs" role="tablist" aria-label="日志类型">
        <button type="button" className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务 <b>{summary.total}</b></button>
         <button type="button" className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>活动 <b>{activityLogs.length}</b></button>
      </div>
      {tab === "tasks" ? (
        <>
          <div className="canvas-log-summary-grid">
            <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><b>{summary.total}</b><small>全部</small></button>
            <button type="button" className={status === "pending" ? "active pending" : "pending"} onClick={() => setStatus("pending")}><b>{summary.pending}</b><small>进行中</small></button>
            <button type="button" className={status === "success" ? "active success" : "success"} onClick={() => setStatus("success")}><b>{summary.success}</b><small>成功</small></button>
            <button type="button" className={status === "error" ? "active error" : "error"} onClick={() => setStatus("error")}><b>{summary.error}</b><small>失败</small></button>
          </div>
          <div className="canvas-log-toolbar">
            <label className="canvas-log-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、模型或服务商…" /></label>
            <div className="canvas-log-filter-row" role="group" aria-label="任务媒体类型">
              <button type="button" className={media === "all" ? "active" : ""} onClick={() => setMedia("all")}>全部</button>
              <button type="button" className={media === "image" ? "active" : ""} onClick={() => setMedia("image")}>图片</button>
       <button type="button" className={media === "video" ? "active" : ""} onClick={() => setMedia("video")}>视频</button>
       <button type="button" className={media === "llm" ? "active" : ""} onClick={() => setMedia("llm")}>LLM</button>
              <button type="button" className="refresh" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "↻ 刷新"}</button>
            </div>
          </div>
          {loading && !taskLogs.length ? <div className="canvas-side-empty"><span>◌</span><b>正在读取任务日志</b><small>与主界面服务端日志保持同步。</small></div> : filteredTasks.length ? <div className="canvas-task-log-list">
            {filteredTasks.map((log) => {
              const urls = generationLogOutputUrls(log);
              const kind = generationLogKind(log);
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
              const relationLabel = (relation: string) => ({
                edited_from: "编辑自",
                upscaled_from: "超分自",
                converted_to_video: "转为视频",
                generated_from: "生成自",
                derived_from: "派生自",
                referenced: "引用",
              }[relation] || "来源");
              return <article className={`canvas-task-log-card ${log.status} ${selectedId === log.id ? "selected" : ""}`} key={log.id} onClick={() => setSelectedId((value) => value === log.id ? null : log.id)}>
                {lineage.length > 0 && <div className="canvas-task-log-detail canvas-task-log-lineage" onClick={(event) => event.stopPropagation()}>
                  <div><b>结果与来源</b><small>统一活动：{activityTask.kind} · {activityTask.status} · {activityTask.sourceId || log.id}{log.projectId ? ` · 项目 ${log.projectId}` : ""}{log.chatId ? ` · 对话 ${log.chatId}` : ""}</small></div>
                  {lineage.map((record: CanvasLineageRecord) => <div key={record.resultNodeId} className="canvas-task-log-lineage-row canvas-task-log-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => { const openMedia = canOpenNode(record.resultNodeId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(record.resultNodeId, openMedia); }}>结果：{nodeLabel(record.resultNodeId)}</button>
                    <span>← {relationLabel(record.edges[0]?.relation || "derived_from")}</span>
                    {record.sourceNodeIds.map((sourceId) => <button type="button" key={sourceId} onClick={() => { const openMedia = canOpenNode(sourceId); rememberScrollBeforeMediaOpen(openMedia); onFocusNode(sourceId, openMedia); }}>来源：{nodeLabel(sourceId)}</button>)}
                  </div>)}
                </div>}
                <div className="canvas-task-log-preview">
                  {kind === "video" && urls[0] ? <video src={urls[0]} muted playsInline preload="metadata" /> : urls.length ? <div className="canvas-task-log-images">{urls.slice(0, 3).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${generationLogKindLabel(log)}结果 ${index + 1}`} />)}</div> : <span className={log.status === "pending" ? "loading" : "placeholder"}>{log.status === "pending" ? "◌" : kind === "video" ? "▶" : "▣"}</span>}
                </div>
                <div className="canvas-task-log-status">{generationLogStatusLabel(log.status)}</div>
                <div className="canvas-task-log-main"><strong>{log.prompt || "未填写提示词"}</strong><small>{log.presetName ? `预设：${log.presetName} · ` : ""}{log.source === "agent" ? "Agent" : "画布生成"} · {log.modelName || "自动选择模型"} · {log.providerName || "等待服务商响应"}</small>{log.status === "pending" && <small className="pending-note">任务正在后台生成，可继续使用画布</small>}{log.error && <small className="error-note">{log.error}</small>}</div>
                <div className="canvas-task-log-meta"><span className="canvas-task-log-meta-count">{kind === "llm" ? `${log.llmCallCount || 0} 次调用` : kind === "video" ? `${urls.length || (log.status === "pending" ? 1 : 0)} 段视频` : `${log.status === "pending" ? log.count || 1 : log.imageCount || urls.length} 张`}</span><span className="canvas-task-log-meta-duration">{generationLogDuration(log)}</span><span className="canvas-task-log-meta-size">{kind === "llm" ? `${log.task || "普通对话"} · ${log.responseChars || 0} 字响应 · 联网 ${log.webSearchStatus || "未检索"}` : kind === "video" ? `${log.operation === "edit" ? "编辑" : log.operation === "extend" ? "扩展" : "生成"} · ${log.resolution || "自动"}` : `${log.outputSize || "自动尺寸"} · ${log.aspectRatio || "自动比例"}`}</span><time>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>
                <div className="canvas-task-log-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId((value) => value === log.id ? null : log.id); }}>{selectedId === log.id ? "收起详情" : "查看详情"}</button>{log.status === "error" && kind !== "llm" && <button type="button" onClick={(event) => { event.stopPropagation(); onRetryTask(log); }}>重试</button>}{kind !== "llm" && <button type="button" onClick={(event) => { event.stopPropagation(); const openMedia = Boolean(urls.length); rememberScrollBeforeMediaOpen(openMedia); onFocusTask(log, openMedia); }}>{urls.length ? "打开结果" : "定位节点"}</button>}</div>
                {selectedId === log.id && <div className="canvas-task-log-detail"><div><b>任务详情</b><small>{log.id}</small></div><p>{log.prompt || "未填写提示词"}</p>{kind === "llm" && <small>模型调用：{log.llmCallCount || 0} 次 · 响应：{log.responseChars || 0} 字 · 联网：{log.webSearchStatus || "未检索"}</small>}{log.references?.length ? <small>参考图：{log.references.map((reference) => reference.name || "参考素材").join("、")}</small> : null}{log.providerTaskId && <small>服务商任务：{log.providerTaskId}</small>}{log.error && <strong className="error-note">失败原因：{log.error}</strong>}</div>}
                </article>;
            })}
          </div> : <div className="canvas-side-empty"><span>▱</span><b>{taskLogs.length ? "没有符合条件的任务" : "还没有生成任务"}</b><small>{taskLogs.length ? "调整状态、媒体类型或搜索条件。" : "从画布生成图片、视频或 Agent 结果后会出现在这里。"}</small></div>}
        </>
      ) : (
        <>
          <div className="canvas-activity-summary"><b>{activityLogs.length}</b><span>条画布操作</span></div>
          {activityLogs.length ? <div className="canvas-activity-list">{activityLogs.map((log) => <button type="button" className={log.status} key={log.id} onClick={() => onNotify("这条活动记录没有可定位的节点或任务详情") }><time>{new Date(log.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span className="canvas-activity-dot">●</span><p>{log.message}</p><small>{log.type === "generation" ? "生成" : log.type === "agent" ? "Agent" : log.type === "asset" ? "资产" : log.type === "project" ? "项目" : log.type === "canvas" ? "画布" : "系统"}</small></button>)}</div> : <div className="canvas-side-empty"><span>≡</span><b>暂无活动</b><small>生成、导入或整理画布后会记录在这里。</small></div>}
        </>
      )}
    </CanvasPanelShell>
  );
}

