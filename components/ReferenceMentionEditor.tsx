"use client";

import {
  forwardRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
    html += `<span class="reference-inline-mention" contenteditable="false" data-mention-index="${index}" title="${escapeHtml(`${reference.name} · @${index + 1}`)}"><span class="reference-inline-mention-thumb">${mentionThumbnailHtml(reference)}</span><span class="reference-inline-mention-label"><b>@${index + 1}</b><small>${escapeHtml(reference.name || `图片${index + 1}`)}</small></span></span>`;
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
  getLabel?: (reference: ReferenceMentionOption, index: number) => ReactNode;
  getDescription?: (reference: ReferenceMentionOption, index: number) => ReactNode;
  transformPastedText?: (value: string) => string;
  readOnly?: boolean;
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
  getLabel,
  getDescription,
  transformPastedText,
  readOnly = false,
}, forwardedRef) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const pendingCursor = useRef<number | null>(null);
  const forceRenderRef = useRef(false);
  const skipRenderRef = useRef(false);
  const hasRenderedRef = useRef(false);
  const renderedValueRef = useRef("");
  const renderedReferencesKeyRef = useRef("");
  const [mentionState, setMentionState] = useState<ReferenceMentionRange | null>(null);

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
    setMentionState(references.length ? referenceMentionRange(serialized, cursor) : null);
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
    skipRenderRef.current = true;
    onChange(serialized, cursor);
    setMentionState(references.length ? referenceMentionRange(serialized, cursor) : null);
  };

  const handleMentionSelect = (index: number) => {
    const activeMention = mentionState;
    if (!activeMention) return;
    const inserted = insertReferenceMention(value, activeMention.end, index);
    forceRenderRef.current = true;
    pendingCursor.current = inserted.cursor;
    setMentionState(null);
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
    forceRenderRef.current = true;
    pendingCursor.current = from + normalizedText.length;
    onChange(next, pendingCursor.current);
    setMentionState(references.length ? referenceMentionRange(next, pendingCursor.current) : null);
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
        onBlur={onBlur}
        onClick={(event) => { updateMentionState(); onClick?.(event); }}
        onKeyUp={(event) => { updateMentionState(); onKeyUp?.(event); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mentionState) {
            event.preventDefault();
            setMentionState(null);
          }
          onKeyDown?.(event);
        }}
        onPaste={handlePaste}
      />
      <ReferenceMentionMenu
        references={references}
        open={Boolean(mentionState)}
        query={mentionState?.query}
        onSelect={handleMentionSelect}
        className={menuClassName}
        title={menuTitle}
        getLabel={getLabel}
        getDescription={getDescription}
      />
    </div>
  );
});

ReferenceMentionEditor.displayName = "ReferenceMentionEditor";

export default ReferenceMentionEditor;
