"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from "react";
import ReferenceMentionEditor from "@/components/ReferenceMentionEditor";
import type { ReferenceMentionOption } from "@/components/ReferenceMentionMenu";
import { replaceNaturalReferenceLabels } from "@/lib/creative-references";
import type { CanvasMediaKind } from "@/lib/canvas/types";

function sanitizeVariantRequirementRow(value: string) {
  return String(value || "").replace(/\r\n?/g, " ");
}

function compactVariantRequirementRows(rows: readonly string[]) {
  const compacted: string[] = [];
  rows.forEach((row) => {
    const value = sanitizeVariantRequirementRow(row);
    if (!value.trim()) {
      if (!compacted.length || compacted[compacted.length - 1].trim()) {
        compacted.push("");
      }
      return;
    }
    compacted.push(value);
  });
  while (compacted.length > 1 && !compacted[compacted.length - 1].trim()) {
    compacted.pop();
  }
  return compacted.length ? compacted : [""];
}

function variantRequirementRowsForEditor(value: string) {
  const compacted = compactVariantRequirementRows(
    String(value || "").replace(/\r\n?/g, "\n").split("\n"),
  );
  const rows = compacted.slice();
  if (rows[rows.length - 1].trim()) {
    rows.push("");
  }
  return { rows };
}

function serializeVariantRequirementRows(rows: readonly string[]) {
  return compactVariantRequirementRows(rows).join("\n");
}

function focusContentEditableEnd(editor: HTMLDivElement | null) {
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

type CanvasVariantRequirementsEditorProps = {
  value: string;
  references: readonly ReferenceMentionOption[];
  onChange: (value: string) => void;
  onPasteFiles?: (files: File[]) => void;
  ariaLabel: string;
  className?: string;
  menuClassName?: string;
  menuPortal?: boolean;
  note?: ReactNode;
};

export const CanvasVariantRequirementsEditor = memo(function CanvasVariantRequirementsEditor({
  value,
  references,
  onChange,
  onPasteFiles,
  ariaLabel,
  className = "",
  menuClassName = "",
  menuPortal = false,
  note,
}: CanvasVariantRequirementsEditorProps) {
  const rowState = useMemo(
    () => variantRequirementRowsForEditor(value),
    [value],
  );
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const focusIndexRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusIndexRef.current === null) return;
    const index = Math.max(
      0,
      Math.min(focusIndexRef.current, rowState.rows.length - 1),
    );
    focusIndexRef.current = null;
    focusContentEditableEnd(rowRefs.current[index] || null);
  }, [rowState.rows]);

  const commitRows = useCallback((nextRows: readonly string[], focusIndex?: number) => {
    const serialized = serializeVariantRequirementRows(nextRows);
    if (typeof focusIndex === "number") {
      focusIndexRef.current = focusIndex;
    }
    onChange(serialized);
  }, [onChange]);

  const updateRow = useCallback((index: number, nextValue: string) => {
    const nextRows = rowState.rows.slice();
    nextRows[index] = sanitizeVariantRequirementRow(nextValue);
    commitRows(nextRows);
  }, [commitRows, rowState.rows]);

  const insertRowAfter = useCallback((index: number) => {
    const currentRows = rowState.rows;
    const nextRows = currentRows.slice();
    const currentRow = currentRows[index] || "";
    const isLastRow = index === currentRows.length - 1;
    const isPenultimateTailRow = index === currentRows.length - 2 && !currentRows[currentRows.length - 1]?.trim();

    if (isLastRow && !currentRow.trim()) return;
    if (isPenultimateTailRow) {
      focusContentEditableEnd(rowRefs.current[index + 1] || null);
      return;
    }
    nextRows.splice(index + 1, 0, "");
    commitRows(nextRows, index + 1);
  }, [commitRows, rowState.rows]);

  const moveRow = useCallback((index: number, direction: -1 | 1) => {
    const currentRows = rowState.rows;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= currentRows.length) return;
    const nextRows = currentRows.slice();
    const [moved] = nextRows.splice(index, 1);
    nextRows.splice(nextIndex, 0, moved);
    commitRows(nextRows, nextIndex);
  }, [commitRows, rowState.rows]);

  const deleteRow = useCallback((index: number) => {
    const currentRows = rowState.rows;
    if (currentRows.length === 1 && !currentRows[0].trim()) return;
    const nextRows = currentRows.slice();
    nextRows.splice(index, 1);
    commitRows(nextRows, Math.max(0, index - 1));
  }, [commitRows, rowState.rows]);

  const handlePaste = useCallback((index: number, event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      onPasteFiles?.(files);
      return;
    }
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) return;
    const normalizedText = pastedText.replace(/\r\n?/g, "\n");
    if (!normalizedText.includes("\n")) return;
    event.preventDefault();
    event.stopPropagation();
    const pastedRows = compactVariantRequirementRows(
      replaceNaturalReferenceLabels(normalizedText, references).value.split("\n"),
    );
    const nextRows = rowState.rows.slice();
    nextRows.splice(index, 1, ...pastedRows);
    commitRows(nextRows, index + pastedRows.length - 1);
  }, [commitRows, onPasteFiles, references, rowState.rows]);

  return (
    <div className={`canvas-variant-list-editor ${className}`.trim()}>
      <div className="canvas-variant-list">
        {rowState.rows.map((row, index) => {
          const isTailRow = index === rowState.rows.length - 1 && !row.trim();
          const isEmpty = !row.trim();
          return (
            <div
              className={`canvas-variant-list-row${isTailRow ? " is-tail" : ""}${isEmpty ? " is-empty" : ""}`}
              key={index}
            >
              <span className="canvas-variant-list-index">{index + 1}</span>
              <ReferenceMentionEditor
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                value={row}
                references={references}
                ariaLabel={`${ariaLabel} 第 ${index + 1} 条`}
                className="canvas-variant-list-row-editor"
                menuClassName={menuClassName}
                menuPortal={menuPortal}
                allowRichPaste={false}
                placeholder={isTailRow ? "按回车新增下一条" : `输入第 ${index + 1} 条`}
                transformPastedText={(text) => replaceNaturalReferenceLabels(text, references).value}
                onChange={(nextValue) => updateRow(index, nextValue)}
                onMentionSelect={(_candidateIndex, nextValue) => updateRow(index, nextValue)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    insertRowAfter(index);
                    return;
                  }
                  if (event.key === "Backspace" && isEmpty) {
                    event.preventDefault();
                    event.stopPropagation();
                    deleteRow(index);
                  }
                }}
                onPaste={(event) => handlePaste(index, event)}
              />
              <div className="canvas-variant-list-actions">
                {isTailRow ? (
                  <button
                    type="button"
                    aria-label={`继续添加第 ${index + 1} 条`}
                    title="继续添加"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      focusContentEditableEnd(rowRefs.current[index] || null);
                    }}
                  >
                    +
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`上移第 ${index + 1} 条`}
                      title="上移"
                      disabled={index === 0}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        moveRow(index, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`下移第 ${index + 1} 条`}
                      title="下移"
                      disabled={index === rowState.rows.length - 1}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        moveRow(index, 1);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`删除第 ${index + 1} 条`}
                      title="删除"
                      disabled={rowState.rows.length === 1 && !row.trim()}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteRow(index);
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {note && (
        <div className="canvas-variant-list-footer">
          {note && <small className="canvas-variant-list-note">{note}</small>}
        </div>
      )}
    </div>
  );
});

CanvasVariantRequirementsEditor.displayName = "CanvasVariantRequirementsEditor";

export function CanvasGeneratorHelp({ kind }: { kind: CanvasMediaKind }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const panelId = `canvas-generator-help-${helpId.replace(/:/g, "")}`;
  const isVideo = kind === "video";
  const label = isVideo ? "视频变体生成器" : "图片变体生成器";

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="canvas-generator-help-trigger"
        data-kind={kind}
        title={`查看${label}使用方法`}
        aria-label={`查看${label}使用方法`}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ?
      </button>
      {open && (
        <div
          id={panelId}
          className="canvas-generator-help-popover"
          data-kind={kind}
          role="region"
          aria-label={`${label}使用方法`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="canvas-generator-help-title">
            <b>{label}怎么用</b>
            <button
              type="button"
              className="canvas-generator-help-close"
              aria-label="关闭使用帮助"
              title="关闭使用帮助"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <ol>
            <li>
              {isVideo
                ? "需要画面参考时，先连接图片或视频，再在生成方式中选择文生视频、首帧、首尾帧或参考图模式。"
                : "需要参考时，先连接已完成的图片；图片变体生成器不能接收视频作为图片参考。"}
            </li>
            <li>共同提示词会作为每一条变体要求的基础。</li>
            <li>逐条编辑、回车新增；空行会自动忽略，也可以继续添加更多条目。</li>
            <li>在每条里输入 @编号，可以指定要使用的引用素材。</li>
            <li>
              {isVideo
                ? "视频会按变体要求逐条串行生成，每条对应一段视频；输入方式要和当前模型支持的模式匹配。"
                : "图片会按每条变体要求和“生成数量”分别生成结果，预计数量 = 变体条数 × 每条图片数量。"}
            </li>
            <li>生成失败的变体可以单独重试，也可以一次重试全部失败项。</li>
          </ol>
        </div>
      )}
    </>
  );
}
