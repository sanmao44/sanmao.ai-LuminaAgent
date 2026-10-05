import type { ClipboardEvent as ReactClipboardEvent, FocusEvent, PointerEvent } from "react";
import type { CanvasGenerationStatus, CanvasNode } from "@/lib/canvas/types";
import AgentOrb from "@/components/AgentOrb";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";
import ReferenceMentionEditor from "@/components/ReferenceMentionEditor";
import type { ReferenceMentionOption } from "@/components/ReferenceMentionMenu";
import { canvasPromptOrbState } from "@/components/canvas/CanvasContextMenu";

export type CanvasAgentNodeCardProps = {
  node: CanvasNode;
  status: CanvasGenerationStatus;
  pending: boolean;
  role?: string;
  model?: string;
  statusLabel?: string;
  agentInput: string;
  agentResponse: string;
  processingLabel: string;
  processingProgress?: number;
  processingKind: CanvasProcessingKind;
  processingStartedAt?: number;
  editing: boolean;
  references: ReferenceMentionOption[];
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onPromptChange: (value: string) => void;
  onEdit: (value: boolean) => void;
  onUseAsImagePrompt: () => void;
  onTextPreview: () => void;
};

export default function CanvasAgentNodeCard({
  node,
  status,
  pending,
  role,
  model,
  statusLabel,
  agentInput,
  agentResponse,
  processingLabel,
  processingProgress,
  processingKind,
  processingStartedAt,
  editing,
  references,
  onPaste,
  onPromptChange,
  onEdit,
  onUseAsImagePrompt,
  onTextPreview,
}: CanvasAgentNodeCardProps) {
  return (
    <div className="canvas-prompt-card">
      <div className="canvas-node-kicker">
        <span><AgentOrb state={canvasPromptOrbState(status)} size={16} label="" /></span>
        <b>{String(role || "Agent 节点")}</b>
      </div>
      {pending && (
        <CanvasProcessingIndicator
          label={processingLabel}
          progress={processingProgress}
          kind={processingKind}
          startedAt={processingStartedAt}
          waiting={status === "queued"}
        />
      )}
      {editing ? (
        <ReferenceMentionEditor
          value={agentInput}
          references={references}
          className="canvas-card-agent-editor"
          menuClassName="canvas-node-mention-menu"
          allowRichPaste={false}
          onPaste={onPaste}
          ariaLabel="Agent 任务"
          placeholder="输入要交给 Agent 的任务…"
          autoFocus
          onChange={onPromptChange}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            const next = event.relatedTarget;
            if (next instanceof HTMLElement && next.closest(".canvas-node-editor-popover")) return;
            onEdit(false);
          }}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => event.stopPropagation()}
        />
      ) : (
        <div className="canvas-prompt-preview">{String(node.data.text || "双击输入 Agent 任务")}</div>
      )}
      <small>
        {status === "running"
          ? "Agent 正在思考…"
          : status === "failed"
            ? String(statusLabel || "Agent 请求失败，可在下方重试")
            : model
              ? `对话模型 · ${String(model)}`
              : "可连接为对话上下文，也可作为图片或视频提示词"}
      </small>
      {agentResponse && status === "completed" && (
        <div className="canvas-agent-response-tools">
          <span>{agentResponse.length.toLocaleString()} 字</span>
          <button
            type="button"
            title="将 Agent 回复填入图片提示词"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onUseAsImagePrompt();
            }}
          >
            ↗ 转图片
          </button>
          <button
            type="button"
            title="放大查看 Agent 回复"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onTextPreview();
            }}
          >
            ⛶ 放大查看
          </button>
        </div>
      )}
    </div>
  );
}
