"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode } from "@/lib/canvas/types";

export default function CanvasTextLightbox({
  node,
  onClose,
  onNotify,
  onUpdate,
  onCreateAgentNode,
  onUseAsImagePrompt,
  onUseAsVideoPrompt,
}: {
  node?: CanvasNode;
  onClose: () => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  onUpdate: (node: CanvasNode, value: string) => void;
  onCreateAgentNode: (node: CanvasNode, value: string) => void;
  onUseAsImagePrompt: (node: CanvasNode, value: string) => void;
  onUseAsVideoPrompt: (node: CanvasNode, value: string) => void;
}) {
  const text =
    node?.type === "prompt"
      ? String(node.data.agentResponse || node.data.text || "")
      : node?.type === "generator"
        ? String(node.data.prompt || node.data.agentPrompt || node.data.variantRequirementsText || "")
        : "";
  const editable = node?.type === "prompt";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setDraft(text), [text]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }, []);

  const updateSelection = useCallback(() => {
    const body = bodyRef.current;
    if (editing || !body) {
      setSelection(null);
      return;
    }
    const current = window.getSelection();
    if (
      !current ||
      current.isCollapsed ||
      !current.rangeCount ||
      !current.anchorNode ||
      !current.focusNode ||
      !body.contains(current.anchorNode) ||
      !body.contains(current.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const selectedText = current.toString().trim();
    const rect = current.getRangeAt(0).getBoundingClientRect();
    if (!selectedText || (!rect.width && !rect.height)) {
      setSelection(null);
      return;
    }
    const toolbarWidth = Math.min(420, Math.max(260, window.innerWidth - 24));
    const halfWidth = toolbarWidth / 2;
    const center = rect.left + rect.width / 2;
    const x = Math.min(
      window.innerWidth - halfWidth - 12,
      Math.max(halfWidth + 12, center),
    );
    const showBelow =
      rect.top < 62 && window.innerHeight - rect.bottom > rect.top;
    setSelection({
      text: selectedText,
      x,
      y: showBelow ? rect.bottom + 10 : rect.top - 10,
      placement: showBelow ? "below" : "above",
    });
  }, [editing]);

  const cancelEdit = useCallback(() => {
    setDraft(text);
    setEditing(false);
    clearSelection();
  }, [clearSelection, text]);

  const saveEdit = useCallback(() => {
    if (!node || !editable) return;
    const value = draft;
    if (!value.trim()) {
      onNotify("回复内容不能为空。", "error");
      return;
    }
    onUpdate(node, value);
    setDraft(value);
    setEditing(false);
    clearSelection();
  }, [clearSelection, draft, editable, node, onNotify, onUpdate]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => editRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!node) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [node, onClose]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || editing) return;
    const handleViewportChange = () => updateSelection();
    const handleBodyScroll = () => updateSelection();
    window.addEventListener("resize", handleViewportChange);
    body.addEventListener("scroll", handleBodyScroll);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      body.removeEventListener("scroll", handleBodyScroll);
    };
  }, [editing, updateSelection]);

  useEffect(() => {
    if (!selection || editing) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".canvas-text-selection-toolbar")) return;
      if (!bodyRef.current?.contains(target)) clearSelection();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [clearSelection, editing, selection]);

  if (!node || (node.type !== "prompt" && node.type !== "generator") || !text) return null;
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Agent 回复已复制");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限", "error");
    }
  };
  const copySelection = async () => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    try {
      await navigator.clipboard.writeText(value);
      onNotify("已复制选中的文本");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限", "error");
    }
  };
  const runSelectionAction = (action: (value: string) => void) => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    action(value);
  };
  return (
    <div
      className="canvas-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "编辑文本引用" : "文本引用"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`canvas-text-lightbox${editing ? " is-editing" : ""}`}>
        <header>
          <div>
            <b>{editing ? "编辑文本引用" : node.type === "generator" ? "生成器文本引用" : "Agent 回复"}</b>
            <small>
              {editing
                ? "保存后保留为 Agent 回复"
                : node.type === "generator"
                  ? "生成器共同提示词"
                  : node.data.model
                  ? `对话模型 · ${String(node.data.model)}`
                  : "对话模型"}
              {!editing && node.type === "prompt" && node.data.agentPrompt ? " · 已保留原始任务" : ""}
            </small>
          </div>
          <div className="canvas-text-lightbox-actions">
            {!editing && editable && <button className="canvas-text-edit-trigger" type="button" onClick={() => { setDraft(text); clearSelection(); setEditing(true); }}>编辑</button>}
            {!editing && <button type="button" onClick={() => void copyText()}>复制全文</button>}
            <button type="button" onClick={onClose} aria-label="关闭 Agent 回复">
              ×
            </button>
          </div>
        </header>
        {editing ? (
          <div className="canvas-text-edit-stage">
            <div className="canvas-text-edit-heading">
              <span>编辑内容</span>
              <button type="button" onClick={() => setDraft(text)} disabled={draft === text}>恢复原文</button>
            </div>
            <textarea ref={editRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="编辑 Agent 文本" />
          </div>
        ) : (
          <>
            {node.data.agentPrompt && (
              <div className="canvas-text-lightbox-prompt">
                <span>任务</span>
                <p>{String(node.data.agentPrompt)}</p>
              </div>
            )}
            <div
              ref={bodyRef}
              className="canvas-text-lightbox-body"
              onMouseUp={updateSelection}
              onKeyUp={updateSelection}
              onTouchEnd={updateSelection}
            >
              {text}
            </div>
            {selection && (
              <div
                className={`canvas-text-selection-toolbar ${selection.placement}`}
                style={{ left: selection.x, top: selection.y }}
                role="toolbar"
                aria-label="选中文本操作"
                onMouseDown={(event) => event.preventDefault()}
                onTouchStart={(event) => event.preventDefault()}
              >
                <span>{selection.text.length.toLocaleString()} 字</span>
                <button type="button" onClick={() => void copySelection()}>复制选段</button>
                {editable && <button type="button" className="primary" onClick={() => runSelectionAction((value) => onCreateAgentNode(node, value))}>创建 Agent 节点</button>}
                {editable && <button type="button" onClick={() => runSelectionAction((value) => onUseAsImagePrompt(node, value))}>转图片</button>}
                {editable && <button type="button" onClick={() => runSelectionAction((value) => onUseAsVideoPrompt(node, value))}>转视频</button>}
              </div>
            )}
          </>
        )}
        <footer className={editing ? "is-editing" : ""}>
          {editing ? (
            <>
              <span>{draft.length.toLocaleString()} 字 · 修改后仍保留为 Agent 回复</span>
              <div>
                <button type="button" onClick={cancelEdit}>取消编辑</button>
                <button type="button" className="primary" onClick={saveEdit}>保存修改</button>
              </div>
            </>
          ) : (
            <>
              <span>{text.length.toLocaleString()} 字</span>
              <span>{editable ? "选中文字可生成新节点 · 按 Esc 关闭" : "点击关闭 · 按 Esc 关闭"}</span>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
