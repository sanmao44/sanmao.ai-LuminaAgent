"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  BUILTIN_IMAGE_PRESETS,
  IMAGE_PRESET_ICONS,
  type CustomImagePreset,
  type ImagePreset,
} from "@/lib/creation/image-presets";

export type CanvasImagePresetControlProps = {
  enabled: boolean;
  hasReferenceImage: boolean;
  selectedPresetId: string;
  imagePresets: CustomImagePreset[];
  onSelect: (preset: ImagePreset | CustomImagePreset) => void;
  onClear: () => void;
  onSave: (preset: CustomImagePreset) => void;
  onDelete: (presetId: string) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
};

const EMPTY_PRESET: CustomImagePreset = {
  id: "custom_new",
  label: "",
  description: "自定义图片预设",
  icon: "✦",
  prompt: "",
  builtin: false,
};

export function CanvasImagePresetBadge({
  preset,
  onClear,
}: {
  preset: ImagePreset | CustomImagePreset;
  onClear: () => void;
}) {
  return (
    <div className="canvas-image-preset-reference" role="status">
      <span className="canvas-preset-icon" aria-hidden="true">{preset.icon}</span>
      <span><b>{preset.label}</b><small>已引用预设 · 生成时自动应用</small></span>
      <button type="button" aria-label="移除图片预设引用" title="移除预设引用" onClick={onClear}>×</button>
    </div>
  );
}

export default function CanvasImagePresetControl({
  enabled,
  hasReferenceImage,
  selectedPresetId,
  imagePresets,
  onSelect,
  onClear,
  onSave,
  onDelete,
  onNotify,
}: CanvasImagePresetControlProps) {
  const presetPanelRef = useRef<HTMLDivElement | null>(null);
  const presetEditorDialogRef = useRef<HTMLDivElement | null>(null);
  const presetNameInputRef = useRef<HTMLInputElement | null>(null);
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [presetDraft, setPresetDraft] = useState<CustomImagePreset>(EMPTY_PRESET);
  const activePreset = enabled
    ? [...BUILTIN_IMAGE_PRESETS, ...imagePresets].find((preset) => preset.id === selectedPresetId)
    : undefined;

  const closePresetEditor = () => setPresetEditorOpen(false);
  const openNewPresetEditor = () => {
    setPresetDraft({
      id: `custom_${Math.random().toString(36).slice(2, 10)}`,
      label: "",
      description: "自定义图片预设",
      icon: "✦",
      prompt: "",
      builtin: false,
    });
    setPresetEditorOpen(true);
  };
  const openEditPresetEditor = (preset: CustomImagePreset) => {
    setPresetDraft({ ...preset, builtin: false });
    setPresetEditorOpen(true);
  };
  const savePresetDraft = () => {
    const label = presetDraft.label.trim();
    const prompt = presetDraft.prompt.trim();
    if (!label) return onNotify("请输入预设名称。", "error");
    if (!prompt) return onNotify("请输入预设提示词。", "error");
    if (!/^custom_[a-z0-9_-]{4,80}$/.test(presetDraft.id)) return onNotify("预设 ID 无效，请重新创建。", "error");
    onSave({ ...presetDraft, label, prompt, description: "自定义图片预设", builtin: false });
    setPresetEditorOpen(false);
    onNotify("自定义预设已保存");
  };
  const choosePreset = (preset: ImagePreset | CustomImagePreset) => {
    if (!enabled) return;
    if (("requiresImage" in preset ? preset.requiresImage : true) && !hasReferenceImage) {
      onNotify("请先选择一张参考图片。", "error");
      return;
    }
    onSelect(preset);
    setPresetPanelOpen(false);
  };

  useEffect(() => {
    if (!presetPanelOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (presetPanelRef.current?.contains(target) || presetEditorDialogRef.current?.contains(target))) return;
      setPresetPanelOpen(false);
      closePresetEditor();
    };
    window.document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => window.document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [presetPanelOpen]);

  useEffect(() => {
    if (!presetEditorOpen) return;
    const frame = window.requestAnimationFrame(() => presetNameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [presetEditorOpen]);

  useEffect(() => {
    if (!presetEditorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePresetEditor();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [presetEditorOpen]);

  if (!enabled) return null;

  return (
    <>
      <div ref={presetPanelRef} className="canvas-node-editor-dock-preset-wrap">
        <button type="button" className="canvas-node-editor-dock-chip" onClick={() => setPresetPanelOpen((value) => !value)} aria-label="图片生成预设" aria-expanded={presetPanelOpen} aria-controls="canvas-image-dock-presets" data-tooltip="图片生成预设">
          <span aria-hidden="true">✦</span> 预设
        </button>
        {presetPanelOpen && (
          <div id="canvas-image-dock-presets" className="canvas-node-editor-dock-popover canvas-node-editor-dock-drawer is-presets" role="dialog" aria-label="图片生成预设" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="canvas-node-editor-dock-popover-head">
              <div><b>图片生成预设</b><small>点击后替换提示词，可继续编辑</small></div>
              <button type="button" aria-label="关闭预设" onClick={() => setPresetPanelOpen(false)}>×</button>
            </div>
            <div className="canvas-preset-columns">
              <section className="canvas-preset-column">
                <span className="canvas-preset-section-title">内置预设</span>
                <div className="canvas-preset-column-list">
                  <div className="canvas-preset-grid">
                    {BUILTIN_IMAGE_PRESETS.map((preset) => {
                      const disabled = preset.requiresImage && !hasReferenceImage;
                      return <button type="button" key={preset.id} className={`canvas-preset-item${selectedPresetId === preset.id ? " active" : ""}`} disabled={disabled} title={disabled ? "请先选择一张参考图片" : preset.description} onClick={() => choosePreset(preset)}><span className="canvas-preset-icon" aria-hidden="true">{preset.icon}</span><span><b>{preset.label}</b><small>{preset.description}</small></span></button>;
                    })}
                  </div>
                </div>
              </section>
              <section className="canvas-preset-column">
                <div className="canvas-preset-section-head"><span className="canvas-preset-section-title">我的预设</span><button type="button" className="canvas-preset-add" onClick={openNewPresetEditor}>＋ 新建</button></div>
                <div className="canvas-preset-column-list">
                  {imagePresets.length ? <div className="canvas-preset-grid">{imagePresets.map((preset) => <div className={`canvas-preset-item-row${selectedPresetId === preset.id ? " active" : ""}`} key={preset.id}><button type="button" className="canvas-preset-item" title={preset.description} onClick={() => choosePreset(preset)}><span className="canvas-preset-icon" aria-hidden="true">{preset.icon}</span><span><b>{preset.label}</b><small>{preset.description}</small></span></button><button type="button" className="canvas-preset-edit" aria-label={`编辑${preset.label}`} onClick={() => openEditPresetEditor(preset)}>✎</button><button type="button" className="canvas-preset-delete" aria-label={`删除${preset.label}`} onClick={() => onDelete(preset.id)}>×</button></div>)}</div> : <small className="canvas-preset-empty">还没有自定义预设</small>}
                </div>
              </section>
            </div>
            {!hasReferenceImage && <small className="canvas-preset-hint">部分预设需要参考图，请先选择一张参考图片</small>}
          </div>
        )}
      </div>
      {presetEditorOpen && createPortal(
        <div className="canvas-preset-editor-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closePresetEditor(); }}>
          <div ref={presetEditorDialogRef} className="canvas-preset-editor" role="dialog" aria-modal="true" aria-label="编辑图片预设" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="canvas-preset-editor-head">
              <div><b>{imagePresets.some((item) => item.id === presetDraft.id) ? "编辑我的预设" : "新建我的预设"}</b><small>保存后可在图片生成节点中一键引用</small></div>
              <button type="button" aria-label="关闭预设编辑" onClick={closePresetEditor}>×</button>
            </div>
            <label><span>名称</span><input ref={presetNameInputRef} value={presetDraft.label} maxLength={40} onChange={(event) => setPresetDraft((value) => ({ ...value, label: event.target.value }))} placeholder="例如：日系人像" /></label>
            <label><span>提示词</span><textarea value={presetDraft.prompt} maxLength={12000} onChange={(event) => setPresetDraft((value) => ({ ...value, prompt: event.target.value }))} placeholder="输入要保存的完整提示词" /></label>
            <div className="canvas-preset-icon-picker"><span>图标</span><div>{IMAGE_PRESET_ICONS.map((icon) => <button type="button" key={icon} className={presetDraft.icon === icon ? "active" : ""} onClick={() => setPresetDraft((value) => ({ ...value, icon }))}>{icon}</button>)}</div></div>
            <div className="canvas-preset-editor-actions"><button type="button" onClick={closePresetEditor}>取消</button><button type="button" className="primary" onClick={savePresetDraft}>保存预设</button></div>
          </div>
        </div>,
        window.document.body,
      )}
    </>
  );
}
