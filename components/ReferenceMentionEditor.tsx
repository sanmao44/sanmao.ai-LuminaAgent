"use client";

import {
  forwardRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  insertReferenceMention,
  referenceMentionRange,
  type ReferenceMentionRange,
} from "@/lib/creative-references";
import ReferenceMentionMenu, {
  type ReferenceMentionOption,
} from "@/components/ReferenceMentionMenu";

function mentionTokenLength(index: number) {
  return `@${index + 1}`.length;
}

function serializedLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (!(node instanceof HTMLElement)) return 0;
  const mentionIndex = Number(node.dataset.mentionIndex);
  if (Number.isInteger(mentionIndex) && mentionIndex >= 0) return mentionTokenLength(mentionIndex);
  if (node.tagName === "BR") return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + serializedLength(child), 0);
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof HTMLElement)) return "";
  const mentionIndex = Number(node.dataset.mentionIndex);
  if (Number.isInteger(mentionIndex) && mentionIndex >= 0) return `@${mentionIndex + 1}`;
  if (node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(serializeNode).join("");
  if (node.tagName === "DIV" || node.tagName === "P") return content;
  return content;
}

function serializeEditor(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  let value = "";
  children.forEach((child, index) => {
    const isBlock = child instanceof HTMLElement && (child.tagName === "DIV" || child.tagName === "P");
    if (isBlock && index > 0 && !value.endsWith("\n")) value += "\n";
    value += serializeNode(child);
    if (isBlock && index < children.length - 1 && !value.endsWith("\n")) value += "\n";
  });
  return value;
}

function caretOffset(root: HTMLElement, container: Node, offset: number) {
  let total = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.max(0, Math.min(offset, node.textContent?.length || 0));
      } else {
        const children = Array.from(node.childNodes);
        children.slice(0, Math.max(0, Math.min(offset, children.length))).forEach((child) => {
          total += serializedLength(child);
        });
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length || 0;
      return;
    }
    if (node instanceof HTMLElement) {
      const mentionIndex = Number(node.dataset.mentionIndex);
      if (Number.isInteger(mentionIndex) && mentionIndex >= 0) {
        total += mentionTokenLength(mentionIndex);
        return;
      }
    }
    node.childNodes.forEach(visit);
    if (node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P") && !String(total).endsWith("\n")) {
      // Block separators are handled by the root serializer. Normal typing
      // keeps the caret inside a text node, so no extra offset is needed here.
    }
  };
  visit(root);
  return found ? total : serializeEditor(root).length;
}

function setCaretOffset(root: HTMLElement, target: number) {
  const selection = window.getSelection();
  if (!selection) return;
  let remaining = Math.max(0, target);
  let placed = false;
  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= length;
      return false;
    }
    if (node instanceof HTMLElement) {
      const mentionIndex = Number(node.dataset.mentionIndex);
      if (Number.isInteger(mentionIndex) && mentionIndex >= 0) {
        const length = mentionTokenLength(mentionIndex);
        if (remaining <= length) {
          const parent = node.parentNode;
          if (!parent) return false;
          const range = document.createRange();
          const index = Array.prototype.indexOf.call(parent.childNodes, node);
          range.setStart(parent, remaining >= length ? index + 1 : index);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
        remaining -= length;
        return false;
      }
    }
    for (const child of Array.from(node.childNodes)) {
      if (place(child)) return true;
    }
    return false;
  };
  placed = place(root);
  if (!placed) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function isMentionTriggerAtCaret(root: HTMLElement, container: Node, offset: number) {
  if (!root.contains(container)) return false;
  if (container instanceof HTMLElement && container.dataset.mentionIndex !== undefined) return false;

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent || "";
    return /@([^\s@]*)$/.test(text.slice(0, Math.max(0, Math.min(offset, text.length))));
  }

  if (container instanceof HTMLElement) {
    const children = Array.from(container.childNodes);
    const previous = children[Math.max(0, Math.min(offset, children.length)) - 1];
    if (previous instanceof HTMLElement && previous.dataset.mentionIndex !== undefined) return false;
    if (previous?.nodeType === Node.TEXT_NODE) return /@([^\s@]*)$/.test(previous.textContent || "");
  }
  return false;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mentionThumbnailHtml(reference: ReferenceMentionOption) {
  const thumbnailUrl = reference.thumbnailUrl || reference.url;
  if (thumbnailUrl && (reference.thumbnailKind === "video" || reference.kind === "video")) {
    return `<video src="${escapeHtml(thumbnailUrl)}" muted playsinline preload="metadata" aria-hidden="true"></video>`;
  }
  if (thumbnailUrl) return `<img src="${escapeHtml(thumbnailUrl)}" alt="">`;
  if (reference.kind === "text") {
    return `<span class="reference-mention-text-thumbnail"><b>TXT</b><small>${escapeHtml((reference.text || "").replace(/\s+/g, " ").trim().slice(0, 42) || "文本引用")}</small></span>`;
  }
  return `<span class="reference-mention-fallback-thumbnail">${reference.kind === "video" ? "▶" : "✦"}</span>`;
}

function renderMentionHtml(value: string, references: readonly ReferenceMentionOption[]) {
  let html = "";
  const pattern = /@([0-9]+)\b/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const index = Number(match[1]) - 1;
    const reference = references[index];
    if (!reference) continue;
    if (match.index > cursor) html += escapeHtml(value.slice(cursor, match.index));
    html += `<span class="reference-inline-mention" contenteditable="false" data-mention-index="${index}" title="${escapeHtml(`引用 @${index + 1}`)}"><span class="reference-inline-mention-thumb">${mentionThumbnailHtml(reference)}</span><span class="reference-inline-mention-label"><b>@${index + 1}</b></span></span>`;
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) html += escapeHtml(value.slice(cursor));
  return html;
}

type ReferenceMentionEditorProps = {
  value: string;
  references: readonly ReferenceMentionOption[];
  onChange: (value: string, cursor: number) => void;
  onMentionSelect?: (index: number, value: string, cursor: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
  menuTitle?: ReactNode;
  transformPastedText?: (value: string) => string;
  readOnly?: boolean;
  /** Render the mention menu in a fixed-position portal anchored to the caret.
   * Used by canvas node editors so the menu escapes overflow clipping. */
  menuPortal?: boolean;
};

const ReferenceMentionEditor = forwardRef<HTMLDivElement, ReferenceMentionEditorProps>(function ReferenceMentionEditor({
  value,
  references,
  onChange,
  onMentionSelect,
  onKeyDown,
  onKeyUp,
  onClick,
  onPointerDown,
  onFocus,
  onBlur,
  onPaste,
  autoFocus,
  placeholder,
  ariaLabel,
  className = "",
  menuClassName = "",
  menuTitle,
  transformPastedText,
  readOnly = false,
  menuPortal = false,
}, forwardedRef) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const pendingCursor = useRef<number | null>(null);
  const forceRenderRef = useRef(false);
  const skipRenderRef = useRef(false);
  const hasRenderedRef = useRef(false);
  const renderedValueRef = useRef("");
  const renderedReferencesKeyRef = useRef("");
  const latestValueRef = useRef(value);
  const latestCursorRef = useRef(value.length);
  const mentionUpdateFrameRef = useRef<number | null>(null);
  const [mentionState, setMentionState] = useState<ReferenceMentionRange | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; top: number } | null>(null);

  const computeMenuAnchor = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const menuWidth = Math.min(320, vw - margin * 2);
    const menuHeight = 260;
    const gap = 6;
    const maxLeft = Math.max(margin, vw - menuWidth - margin);
    const maxTop = Math.max(margin, vh - menuHeight - margin);
    const left = Math.min(Math.max(rect.left, margin), maxLeft);
    let top = rect.bottom + gap;
    if (top + menuHeight > vh - margin) {
      const above = rect.top - menuHeight - gap;
      top = above >= margin ? above : maxTop;
    }
    return { left, top: Math.min(Math.max(top, margin), maxTop) };
  };

  const syncMenuAnchor = (next: ReferenceMentionRange | null) => {
    if (!menuPortal) return;
    setMenuAnchor(next ? computeMenuAnchor() : null);
  };

  useImperativeHandle(forwardedRef, () => editorRef.current as HTMLDivElement);

  const referencesKey = references
    .map((reference) => [
      reference.id,
      reference.name,
      reference.url,
      reference.thumbnailUrl,
      reference.thumbnailKind,
      reference.text,
    ].map((part) => String(part || "")).join("\u0001"))
    .join("\u0002");

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // contentEditable mutates its children outside React while the user types.
    // Keep it non-controlled and only rebuild the markup for the initial value,
    // an external value change, a mention insertion, or changed previews.
    const shouldRender =
      forceRenderRef.current ||
      !hasRenderedRef.current ||
      (!skipRenderRef.current && (
        renderedValueRef.current !== value ||
        renderedReferencesKeyRef.current !== referencesKey
      ));
    if (shouldRender) {
      editor.innerHTML = renderMentionHtml(value, references);
      hasRenderedRef.current = true;
      latestValueRef.current = value;
    } else {
      latestValueRef.current = serializeEditor(editor);
    }
    // The native DOM is already the source of truth after a typing/paste
    // event, so advance the bookkeeping even when a rebuild was skipped.
    renderedValueRef.current = value;
    renderedReferencesKeyRef.current = referencesKey;
    forceRenderRef.current = false;
    skipRenderRef.current = false;

    if (pendingCursor.current === null) return;
    const cursor = pendingCursor.current;
    pendingCursor.current = null;
    if (document.activeElement === editor) setCaretOffset(editor, cursor);
  }, [references, referencesKey, value]);

  useEffect(() => () => {
    if (mentionUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(mentionUpdateFrameRef.current);
    }
  }, []);

  const readEditorState = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return { value: latestValueRef.current, cursor: latestCursorRef.current };
    }
    const serialized = serializeEditor(editor);
    const range = selection.getRangeAt(0);
    const cursor = caretOffset(editor, range.startContainer, range.startOffset);
    latestValueRef.current = serialized;
    latestCursorRef.current = cursor;
    return { value: serialized, cursor };
  };

  const updateMentionState = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      setMentionState(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const serialized = serializeEditor(editor);
    const cursor = caretOffset(editor, range.startContainer, range.startOffset);
    latestValueRef.current = serialized;
    latestCursorRef.current = cursor;
    const nextMention = !readOnly && references.length && isMentionTriggerAtCaret(editor, range.startContainer, range.startOffset)
      ? referenceMentionRange(serialized, cursor)
      : null;
    setMentionState(nextMention);
    syncMenuAnchor(nextMention);
  };

  const scheduleMentionStateUpdate = () => {
    if (mentionUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(mentionUpdateFrameRef.current);
    }
    mentionUpdateFrameRef.current = window.requestAnimationFrame(() => {
      mentionUpdateFrameRef.current = null;
      updateMentionState();
    });
  };

  const handleInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const serialized = serializeEditor(editor);
    const anchorNode = selection?.anchorNode;
    const cursor = selection?.rangeCount && anchorNode && editor.contains(anchorNode)
      ? caretOffset(editor, anchorNode, selection.anchorOffset)
      : serialized.length;
    latestValueRef.current = serialized;
    latestCursorRef.current = cursor;
    skipRenderRef.current = true;
    onChange(serialized, cursor);
    const nextMention = !readOnly && references.length && selection?.rangeCount && anchorNode
      ? isMentionTriggerAtCaret(editor, anchorNode, selection.anchorOffset)
        ? referenceMentionRange(serialized, cursor)
        : null
      : null;
    setMentionState(nextMention);
    syncMenuAnchor(nextMention);
  };

  const handleMentionSelect = (index: number) => {
    const current = readEditorState();
    const activeMention = referenceMentionRange(current.value, current.cursor) || mentionState;
    if (!activeMention) return;
    const inserted = insertReferenceMention(current.value, activeMention.end, index);
    latestValueRef.current = inserted.value;
    latestCursorRef.current = inserted.cursor;
    forceRenderRef.current = true;
    pendingCursor.current = inserted.cursor;
    setMentionState(null);
    syncMenuAnchor(null);
    if (onMentionSelect) onMentionSelect(index, inserted.value, inserted.cursor);
    else onChange(inserted.value, inserted.cursor);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const pastedText = event.clipboardData.getData("text/plain");
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!pastedText || !editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    event.preventDefault();
    const range = selection.getRangeAt(0);
    const serialized = serializeEditor(editor);
    const start = caretOffset(editor, range.startContainer, range.startOffset);
    const end = caretOffset(editor, range.endContainer, range.endOffset);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const normalizedText = transformPastedText?.(pastedText.replace(/\r\n?/g, "\n")) ?? pastedText.replace(/\r\n?/g, "\n");
    const next = `${serialized.slice(0, from)}${normalizedText}${serialized.slice(to)}`;
    latestValueRef.current = next;
    latestCursorRef.current = from + normalizedText.length;
    forceRenderRef.current = true;
    pendingCursor.current = from + normalizedText.length;
    onChange(next, pendingCursor.current);
    const pastedMention = referenceMentionRange(next, pendingCursor.current);
    const mentionContinuesFromCaret = isMentionTriggerAtCaret(editor, range.startContainer, range.startOffset);
    const nextMention = !readOnly && references.length && pastedMention && (
      mentionContinuesFromCaret || (pastedMention.start >= from && normalizedText.includes("@"))
    )
      ? pastedMention
      : null;
    setMentionState(nextMention);
    syncMenuAnchor(nextMention);
  };

  return (
    <div className={`reference-mention-editor ${className}`.trim()}>
      <div
        ref={editorRef}
        className="reference-mention-editor-content"
        contentEditable={!readOnly}
        aria-readonly={readOnly || undefined}
        suppressContentEditableWarning
        role="textbox"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        data-placeholder={placeholder || ""}
        onInput={handleInput}
        onPointerDown={onPointerDown}
        onFocus={(event) => { updateMentionState(); onFocus?.(event); }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Element && next.closest(".reference-mention-menu"))) {
            setMentionState(null);
            syncMenuAnchor(null);
          }
          onBlur?.(event);
        }}
        onClick={(event) => { updateMentionState(); onClick?.(event); }}
        onKeyUp={(event) => { updateMentionState(); onKeyUp?.(event); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mentionState) {
            event.preventDefault();
            setMentionState(null);
            syncMenuAnchor(null);
          }
          if (event.key === "@") scheduleMentionStateUpdate();
          onKeyDown?.(event);
        }}
        onPaste={handlePaste}
      />
      {menuPortal ? (
        createPortal(
          <div
            className="reference-mention-menu-anchor"
            style={{
              left: menuAnchor?.left ?? -10000,
              top: menuAnchor?.top ?? -10000,
              visibility: menuAnchor ? "visible" : "hidden",
            }}
          >
            <ReferenceMentionMenu
              references={references}
              open={Boolean(mentionState) && !readOnly && references.length > 0}
              query={mentionState?.query}
              onSelect={handleMentionSelect}
              className={`${menuClassName}${menuClassName ? " " : ""}is-portaled`}
              title={menuTitle}
            />
          </div>,
          document.body,
        )
      ) : (
        <ReferenceMentionMenu
          references={references}
          open={Boolean(mentionState) && !readOnly && references.length > 0}
          query={mentionState?.query}
          onSelect={handleMentionSelect}
          className={menuClassName}
          title={menuTitle}
        />
      )}
    </div>
  );
});

ReferenceMentionEditor.displayName = "ReferenceMentionEditor";

export default ReferenceMentionEditor;
