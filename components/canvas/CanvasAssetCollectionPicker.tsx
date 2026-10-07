"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CanvasNode } from "@/lib/canvas/types";
import { DEFAULT_ASSET_COLLECTIONS, type AssetCollection } from "@/lib/client-history";
import { listAssetCollections, saveAssetCollections } from "@/lib/assets";
import SelectMenu from "@/components/SelectMenu";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { CANVAS_ASSET_LAST_COLLECTION_KEY, CANVAS_ASSET_UNCATEGORIZED_ID, isAssignableCanvasAssetCollection } from "@/lib/canvas/asset-library";

type Notice = { message: string; kind: "ok" | "error" };

export default function CanvasAssetCollectionPicker({
  node,
  preferredCollectionId,
  onClose,
  onConfirm,
  onNotify,
}: {
  node: CanvasNode;
  preferredCollectionId?: string;
  onClose: () => void;
  onConfirm: (collectionId: string) => Promise<boolean>;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [collections, setCollections] = useState<AssetCollection[]>(
    DEFAULT_ASSET_COLLECTIONS,
  );
  const [collectionId, setCollectionId] = useState(() => {
    if (preferredCollectionId && isAssignableCanvasAssetCollection(preferredCollectionId))
      return preferredCollectionId;
    if (typeof window === "undefined") return CANVAS_ASSET_UNCATEGORIZED_ID;
    try {
      return (
        window.localStorage.getItem(CANVAS_ASSET_LAST_COLLECTION_KEY) ||
        CANVAS_ASSET_UNCATEGORIZED_ID
      );
    } catch {
      return CANVAS_ASSET_UNCATEGORIZED_ID;
    }
  });
  const [newCollectionName, setNewCollectionName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void listAssetCollections()
      .then((items) => {
        if (!active) return;
        setCollections(items);
        const assignableIds = new Set([
          CANVAS_ASSET_UNCATEGORIZED_ID,
          ...items.filter((item) => item.builtin === false).map((item) => item.id),
        ]);
        setCollectionId((current) =>
          assignableIds.has(current)
            ? current
            : CANVAS_ASSET_UNCATEGORIZED_ID,
        );
      })
      .catch(() => {
        if (active) onNotify("资产集合读取失败，请稍后重试。", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onNotify]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Smart collections are derived views, so they are not valid targets for
  // adding an asset and should not take up space in this picker.
  const collectionOptions = collections
    .filter((item) => isAssignableCanvasAssetCollection(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
    }));
  const selectedCollection =
    collectionOptions.find((item) => item.id === collectionId) ||
    collectionOptions.find((item) => item.id === CANVAS_ASSET_UNCATEGORIZED_ID);

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    if (collections.some((item) => item.name.trim() === name)) {
      onNotify("已经存在同名资产集合。", "error");
      return;
    }
    const now = Date.now();
    const item: AssetCollection = {
      id: `collection_${now.toString(36)}`,
      name,
      createdAt: now,
      updatedAt: now,
      builtin: false,
    };
    const next = [...collections, item];
    try {
      await saveAssetCollections(next);
      setCollections(next);
      setCollectionId(item.id);
      setNewCollectionName("");
      onNotify(`已创建资产集合“${name}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合创建失败。", "error");
    }
  };

  const confirm = async () => {
    if (saving || loading || !selectedCollection) return;
    setSaving(true);
    try {
      const success = await onConfirm(selectedCollection.id);
      if (!success) return;
      try {
        window.localStorage.setItem(
          CANVAS_ASSET_LAST_COLLECTION_KEY,
          selectedCollection.id,
        );
      } catch {
        /* 记忆失败不应阻断资产登记 */
      }
      onNotify(`已加入资产库 · ${selectedCollection.name}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const menu = (
    <div
      className="canvas-modal-backdrop canvas-asset-collection-picker-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="canvas-asset-target-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-asset-collection-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>＋</span>
            <div>
              <b id="canvas-asset-collection-picker-title">加入资产库</b>
              <small>{String(node.data.name || "画布素材")}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭加入资产弹窗">×</button>
        </header>
        <div className="canvas-asset-collection-picker-body">
          <label>
            <span>选择资产库分类</span>
            <SelectMenu
              value={collectionId}
              onChange={setCollectionId}
              ariaLabel="加入目标资产库分类"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              options={collectionOptions.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </label>
          <small className="canvas-asset-collection-picker-hint">
            加入后可在全局资产中心的“{selectedCollection?.name || "未分类"}”分类中筛选；已有归类会保留。
          </small>
          <div className="canvas-asset-collection-picker-new">
            <input
              value={newCollectionName}
              onChange={(event) => setNewCollectionName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createCollection();
              }}
              placeholder="新建集合…"
              aria-label="新建资产集合"
            />
            <button
              type="button"
              onClick={() => void createCollection()}
              disabled={!newCollectionName.trim()}
            >
              新建
            </button>
          </div>
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="primary" onClick={() => void confirm()} disabled={saving || loading}>
            {saving ? "加入中…" : `加入“${selectedCollection?.name || "未分类"}”分类`}
          </button>
        </footer>
      </div>
    </div>
  );
  return typeof document === "undefined" ? menu : createPortal(menu, document.body);
}
