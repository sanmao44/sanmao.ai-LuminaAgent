"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { type AssetRecord, type AssetSource } from "@/lib/assets";
import { DEFAULT_ASSET_COLLECTIONS, type AssetCollection } from "@/lib/client-history";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { ASSET_SOURCE_LABELS, canvasAssetCollectionNameConflicts, canvasAssetSelectionSummary, filterCanvasAssets, isAssignableCanvasAssetCollection } from "@/lib/canvas/asset-library";
import {
  collectionIdsAfterAddition,
  collectionIdsAfterRemoval,
  hideCanvasAsset,
  loadCanvasAssetCollections,
  loadCanvasAssets,
  persistCanvasAssetCollections,
  setCanvasAssetFavorite,
  tagsAfterAddition,
  updateCanvasAssetMetadata,
} from "@/lib/canvas/asset-library-service";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import SelectMenu from "@/components/SelectMenu";
import { projectVisualReferenceAssetId } from "@/lib/canvas/project-visual-references";

type Notice = { message: string; kind: "ok" | "error" };
type AssetActionDialog =
  | { kind: "delete-collection"; collectionId: string }
  | { kind: "rename-collection"; collectionId: string; value: string }
  | { kind: "add-tag"; assetId: string; value: string };

export default function CanvasAssetDrawer({
  extraAssets,
  creativeProjectId,
  refresh,
  collectionSelection,
  onCollectionSelectionChange,
  canReference,
  onAdd,
  onReference,
  projectReferenceAssetIds = [],
  onSetProjectReference,
  onLocate,
  onAddNodeToCollection,
  onClose,
  onOpenWorkbench,
  onNotify,
}: {
  extraAssets: AssetRecord[];
  creativeProjectId?: string;
  refresh: number;
  collectionSelection: string;
  onCollectionSelectionChange: (collectionId: string) => void;
  canReference: boolean;
  onAdd: (asset: AssetRecord) => void;
  onReference: (asset: AssetRecord) => void;
  projectReferenceAssetIds?: readonly string[];
  onSetProjectReference: (asset: AssetRecord) => void;
  onLocate: (asset: AssetRecord) => void;
  onAddNodeToCollection: (nodeId: string, collectionId: string) => void;
  onClose: () => void;
  onOpenWorkbench: () => void;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const extraAssetsRef = useRef(extraAssets);
  extraAssetsRef.current = extraAssets;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const hasLoadedAssetsRef = useRef(false);
  const assetLoadVersionRef = useRef(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video" | "audio">("all");
  const [source, setSource] = useState<"all" | AssetSource>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [projectOnly, setProjectOnly] = useState(true);
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [preview, setPreview] = useState<AssetRecord | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [collections, setCollections] = useState<AssetCollection[]>(DEFAULT_ASSET_COLLECTIONS);
  const [collection, setCollection] = useState(collectionSelection || "all");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [nodeDropActive, setNodeDropActive] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [savingCollection, setSavingCollection] = useState(false);
  const [assetActionDialog, setAssetActionDialog] = useState<AssetActionDialog | null>(null);
  const [savingAssetAction, setSavingAssetAction] = useState(false);
  const assetDialogFormRef = useRef<HTMLFormElement | null>(null);
  const assetDialogInputRef = useRef<HTMLInputElement | null>(null);
  const assetDialogTriggerRef = useRef<HTMLElement | null>(null);
  const assetDialogWasOpenRef = useRef(false);

  useEffect(() => {
    if (!preview) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [preview]);

  useEffect(() => {
    if (!assetActionDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!savingAssetAction) setAssetActionDialog(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [assetActionDialog, savingAssetAction]);

  useEffect(() => {
    if (assetActionDialog) {
      if (!assetDialogWasOpenRef.current) {
        assetDialogWasOpenRef.current = true;
        if (assetDialogInputRef.current) assetDialogInputRef.current.focus();
        else assetDialogFormRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      } else if (!savingAssetAction && document.activeElement === document.body) {
        if (assetDialogInputRef.current) assetDialogInputRef.current.focus();
        else assetDialogFormRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      }
      return;
    }
    if (!assetDialogWasOpenRef.current) return;
    assetDialogWasOpenRef.current = false;
    assetDialogTriggerRef.current?.focus();
    assetDialogTriggerRef.current = null;
  }, [assetActionDialog, savingAssetAction]);

  useEffect(() => {
    let active = true;
    void loadCanvasAssetCollections().then((items) => {
      if (!active) return;
      setCollections(items);
      const valid = collectionSelection === "all" || items.some((item) => item.id === collectionSelection);
      const next = valid ? collectionSelection : "all";
      setCollection(next);
      onCollectionSelectionChange(next);
    });
    return () => {
      active = false;
    };
  }, [collectionSelection, onCollectionSelectionChange]);

  useEffect(() => {
    setCollection((current) => current === collectionSelection ? current : collectionSelection);
  }, [collectionSelection]);

  const changeCollection = (next: string) => {
    setCollection(next);
    onCollectionSelectionChange(next);
  };

  const reload = useCallback(() => {
    const loadVersion = ++assetLoadVersionRef.current;
    if (!hasLoadedAssetsRef.current) setLoading(true);
    void loadCanvasAssets(extraAssetsRef.current)
      .then((nextAssets) => {
        if (loadVersion !== assetLoadVersionRef.current) return;
        setAssets(nextAssets);
        setSelectedAssetIds((current) => {
          const available = new Set(nextAssets.map((asset) => asset.id));
          const next = new Set([...current].filter((id) => available.has(id)));
          return next.size === current.size ? current : next;
        });
        hasLoadedAssetsRef.current = true;
      })
      .catch(() => {
        if (loadVersion === assetLoadVersionRef.current)
          onNotifyRef.current("资产中心读取失败，请稍后重试。", "error");
      })
      .finally(() => {
        if (loadVersion !== assetLoadVersionRef.current) return;
        hasLoadedAssetsRef.current = true;
        setLoading(false);
      });
  }, []);

  useEffect(reload, [refresh, reload]);

  useEffect(() => {
    const clearNodeDropState = () => setNodeDropActive(false);
    window.addEventListener("dragend", clearNodeDropState);
    window.addEventListener("drop", clearNodeDropState);
    return () => {
      window.removeEventListener("dragend", clearNodeDropState);
      window.removeEventListener("drop", clearNodeDropState);
    };
  }, []);

  const setDrawerCollapsed = (value: boolean) => {
    setCollapsed(value);
  };

  const openAssetActionDialog = (dialog: AssetActionDialog) => {
    assetDialogTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setAssetActionDialog(dialog);
  };

  const handleCanvasNodeDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setNodeDropActive(true);
  };

  const handleCanvasNodeDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setNodeDropActive(false);
  };

  const handleCanvasNodeDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    const nodeId = event.dataTransfer.getData(
      "application/x-sanmao-canvas-node",
    );
    setNodeDropActive(false);
    if (!nodeId) return;
    if (!isAssignableCanvasAssetCollection(collection)) {
      onNotify("请先选择未分类或自定义资产集合，再放入节点。", "error");
      return;
    }
    onAddNodeToCollection(nodeId, collection);
  };

  const filtered = filterCanvasAssets(assets, {
    collection,
    kind,
    source,
    favoritesOnly,
    query,
    tagFilter,
    sort,
    ...(projectOnly && creativeProjectId ? { projectId: creativeProjectId } : {}),
  });
  const selectedSummary = canvasAssetSelectionSummary(filtered, selectedAssetIds);
  const canBatchAssign = collection !== "uncategorized" && isAssignableCanvasAssetCollection(collection);
  const batchTargetName = collections.find((item) => item.id === collection)?.name;

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    if (savingCollection) return;
    if (canvasAssetCollectionNameConflicts(collections, name)) {
      onNotify("已经存在同名资产集合。", "error");
      return;
    }
    const now = Date.now();
    const item: AssetCollection = { id: `collection_${now.toString(36)}`, name, createdAt: now, updatedAt: now, builtin: false };
    const next = [...collections, item];
    setSavingCollection(true);
    try {
      await persistCanvasAssetCollections(next);
      setCollections(next);
      setNewCollectionName("");
      setCollection(item.id);
      onCollectionSelectionChange(item.id);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合创建失败。", "error");
    } finally {
      setSavingCollection(false);
    }
  };

  const deleteCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能删除。", "error");
      return;
    }
    openAssetActionDialog({ kind: "delete-collection", collectionId });
  };

  const confirmDeleteCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin || savingAssetAction) return;
    setSavingAssetAction(true);
    try {
      const affectedAssets = assets.filter((asset) => asset.collectionIds?.includes(collectionId));
      await Promise.all(
        affectedAssets.map((asset) =>
          updateCanvasAssetMetadata(asset, {
            collectionIds: collectionIdsAfterRemoval(asset, collectionId),
          }),
        ),
      );
      const next = collections.filter((item) => item.id !== collectionId);
      await persistCanvasAssetCollections(next);
      setCollections(next);
      setAssets((items) =>
        items.map((asset) =>
          asset.collectionIds?.includes(collectionId)
            ? { ...asset, collectionIds: asset.collectionIds.filter((id) => id !== collectionId) }
            : asset,
        ),
      );
      if (collection === collectionId) changeCollection("all");
      setAssetActionDialog(null);
      onNotify(`已删除资产集合“${target.name}”，其中的资产已保留。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合删除失败。", "error");
    } finally {
      setSavingAssetAction(false);
    }
  };

  const renameCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能重命名。", "error");
      return;
    }
    openAssetActionDialog({ kind: "rename-collection", collectionId, value: target.name });
  };

  const confirmRenameCollection = async (collectionId: string, rawName: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin || savingAssetAction) return;
    const nextName = rawName.trim();
    if (!nextName || nextName === target.name) {
      setAssetActionDialog(null);
      return;
    }
    if (canvasAssetCollectionNameConflicts(collections, nextName, collectionId)) {
      onNotify("已经存在同名资产集合，请换一个名称。", "error");
      return;
    }
    const next = collections.map((item) => item.id === collectionId ? { ...item, name: nextName, updatedAt: Date.now() } : item);
    setSavingAssetAction(true);
    try {
      await persistCanvasAssetCollections(next);
      setCollections(next);
      setAssetActionDialog(null);
      onNotify(`已将资产集合重命名为“${nextName}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合重命名失败。", "error");
    } finally {
      setSavingAssetAction(false);
    }
  };

  const confirmAddAssetTag = async (assetId: string, rawTag: string) => {
    const asset = assets.find((item) => item.id === assetId);
    const tag = rawTag.trim();
    if (!asset || !tag || savingAssetAction) return;
    setSavingAssetAction(true);
    try {
      await updateCanvasAssetMetadata(asset, { tags: tagsAfterAddition(asset, tag) });
      setAssetActionDialog(null);
      reload();
    } catch {
      onNotify("标签保存失败", "error");
    } finally {
      setSavingAssetAction(false);
    }
  };

  const submitAssetActionDialog = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assetActionDialog || savingAssetAction) return;
    if (assetActionDialog.kind === "delete-collection") {
      void confirmDeleteCollection(assetActionDialog.collectionId);
    } else if (assetActionDialog.kind === "rename-collection") {
      void confirmRenameCollection(assetActionDialog.collectionId, assetActionDialog.value);
    } else {
      void confirmAddAssetTag(assetActionDialog.assetId, assetActionDialog.value);
    }
  };

  const trapAssetDialogFocus = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)',
    ));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const addSelectedAssetsToCollection = async () => {
    if (collection === "all" || collection === "uncategorized" || collection === "favorite" || collection === "recent" || collection === "generated" || collection === "reference" || collection === "image" || collection === "video" || collection === "audio") {
      onNotify("请先在集合筛选中选择一个自定义集合，再批量归类。", "error");
      return;
    }
    const selected = assets.filter((asset) => selectedAssetIds.has(asset.id));
    if (!selected.length) return;
    try {
      await Promise.all(selected.map((asset) => updateCanvasAssetMetadata(asset, { collectionIds: collectionIdsAfterAddition(asset, collection) })));
      setAssets((items) => items.map((asset) => selectedAssetIds.has(asset.id) ? { ...asset, collectionIds: collectionIdsAfterAddition(asset, collection) } : asset));
      setSelectedAssetIds(new Set());
      onNotify(`已将 ${selected.length} 个资产加入“${collections.find((item) => item.id === collection)?.name || "当前集合"}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量归类失败。", "error");
    }
  };

  const toggleFavorite = async (asset: AssetRecord) => {
    try {
      await setCanvasAssetFavorite(asset, !asset.favorite);
      setAssets((items) =>
        items.map((item) =>
          item.id === asset.id ? { ...item, favorite: !item.favorite } : item,
        ),
      );
    } catch {
      onNotify("收藏状态保存失败。", "error");
    }
  };

  const hideAsset = async (asset: AssetRecord) => {
    try {
      await hideCanvasAsset(asset);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      if (preview?.id === asset.id) setPreview(null);
      onNotify("已从资产索引隐藏，画布引用和磁盘文件保持不变。");
    } catch {
      onNotify("暂时无法隐藏这个资产。", "error");
    }
  };

  if (collapsed)
    return (
      <button
        type="button"
        className="canvas-asset-drawer-collapsed"
        onClick={() => setDrawerCollapsed(false)}
        aria-label={`展开全局资产中心，共 ${assets.length} 个资产`}
        title="展开全局资产中心"
      >
        <span>◈</span>
        <b>{assets.length}</b>
      </button>
    );

  return (
    <>
      <aside
        className={`canvas-asset-drawer ${nodeDropActive ? "is-node-drop-target" : ""}`}
        aria-label="全局资产中心"
        onDragOver={handleCanvasNodeDragOver}
        onDragLeave={handleCanvasNodeDragLeave}
        onDrop={handleCanvasNodeDrop}
      >
        <header>
          <div>
            <span>◈</span>
            <span>
              <b>全局资产中心</b>
              <small>历史、视频任务与所有画布</small>
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDrawerCollapsed(true)}
              aria-label="收起资产中心"
              title="收起为窄轨"
            >
              —
            </button>
            <button type="button" onClick={onClose} aria-label="关闭资产中心">
              ×
            </button>
          </div>
        </header>
        <div className="canvas-asset-toolbar">
          <label className="canvas-asset-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、提示词或模型…"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")}>
                ×
              </button>
            )}
          </label>
          <label className="canvas-asset-search"><span>#</span><input value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} placeholder="按标签筛选…" /></label>
          <div className="canvas-asset-kind" role="group" aria-label="资产类型">
            <button
              type="button"
              className={kind === "all" ? "active" : ""}
              onClick={() => setKind("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={kind === "image" ? "active" : ""}
              onClick={() => setKind("image")}
            >
              图片
            </button>
            <button
              type="button"
              className={kind === "video" ? "active" : ""}
              onClick={() => setKind("video")}
            >
              视频
            </button>
            <button
              type="button"
              className={kind === "audio" ? "active" : ""}
              onClick={() => setKind("audio")}
            >
              音频
            </button>
            <button
              type="button"
              className={favoritesOnly ? "active favorite" : ""}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              ★ 收藏
            </button>
          </div>
          {creativeProjectId && (
            <div className="canvas-asset-project-filter">
              <button
                type="button"
                className={projectOnly ? "active" : ""}
                aria-pressed={projectOnly}
                onClick={() => setProjectOnly((value) => !value)}
              >
                本项目
              </button>
              <span>{projectOnly ? "仅显示当前项目资产" : "显示全部项目资产"}</span>
            </div>
          )}
          <div className="canvas-asset-filters">
            <div className="canvas-asset-collection-picker">
              <SelectMenu
                value={collection}
                portalZIndex={CANVAS_Z_INDEX.assetDrawer}
                onChange={changeCollection}
                onDelete={(id) => void deleteCollection(id)}
                ariaLabel="资产集合"
                options={collections.map((item) => ({
                  value: item.id,
                  label: item.name,
                  deletable: !item.builtin,
                }))}
              />
              <button type="button" disabled={collection === "all" || !collections.some((item) => item.id === collection && item.builtin !== true)} onClick={() => void renameCollection(collection)} title="重命名当前自定义集合" aria-label="重命名当前资产集合">✎</button>
            </div>
            <SelectMenu
              value={source}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSource}
              ariaLabel="资产来源"
              options={[
                { value: "all", label: "全部来源" },
                ...Object.entries(ASSET_SOURCE_LABELS).map(
                  ([value, label]) => ({ value: value as AssetSource, label }),
                ),
              ]}
            />
            <SelectMenu
              value={sort}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSort}
              ariaLabel="资产排序"
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "name", label: "按名称" },
              ]}
            />
          </div>
        </div>
        <div className={`canvas-asset-collection-dropzone ${isAssignableCanvasAssetCollection(collection) ? "" : "needs-collection"}`}>
          <span>⌘</span><b>{isAssignableCanvasAssetCollection(collection) ? "把画布节点拖到这里归类" : "先选择未分类或自定义集合"}</b><small>{isAssignableCanvasAssetCollection(collection) ? "拖动节点右上角 ↗，节点不会从画布移除" : "智能筛选视图不能作为归类目标"}</small>
        </div>
        <div className="canvas-asset-new-collection" aria-label="新建资产合集">
          <div className="canvas-asset-new-collection-head">
            <span className="canvas-asset-new-collection-icon" aria-hidden="true">＋</span>
            <span>
              <b>新建合集</b>
              <small>创建后自动切换到新合集</small>
            </span>
          </div>
          <div className="canvas-asset-new-collection-form">
            <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="输入合集名称，例如：灵感参考" aria-label="新合集名称" onKeyDown={(event) => { if (event.key === "Enter") void createCollection(); }} />
            <button type="button" onClick={() => void createCollection()} disabled={!newCollectionName.trim()} aria-busy={savingCollection}><span aria-hidden="true">＋</span>{savingCollection ? "保存中" : "创建"}</button>
          </div>
        </div>
        {selectedAssetIds.size > 0 && <div className="canvas-asset-bulk-bar">
          <b>已选 {selectedSummary.total} 个</b>
          <span className="canvas-asset-bulk-context" role="status">
            {selectedSummary.hidden > 0 ? `当前筛选隐藏 ${selectedSummary.hidden} 个 · ` : ""}
            目标：{canBatchAssign ? batchTargetName || "当前集合" : "请先选择自定义集合"}
          </span>
          <button type="button" disabled={!canBatchAssign} title={canBatchAssign ? `将已选 ${selectedSummary.total} 个资产加入“${batchTargetName || "当前集合"}”` : "请先选择自定义集合后再批量归类。"} onClick={() => void addSelectedAssetsToCollection()}>加入目标集合</button>
          <button type="button" onClick={() => setSelectedAssetIds(new Set())}>清除选择</button>
        </div>}
        <div className="canvas-asset-results">
          <div className="canvas-asset-summary">
            <b>{filtered.length} 个资产</b>
            <span>拖到空白画布创建节点，拖到对象组自动加入</span>
          </div>
          {loading ? (
            <div className="canvas-asset-loading">
              <span>✦</span>正在聚合资产…
            </div>
          ) : filtered.length ? (
            <div className="canvas-global-asset-grid">
              {filtered.map((asset) => {
                const referenceAssetId = projectVisualReferenceAssetId(asset);
                const isProjectReference = projectReferenceAssetIds.includes(referenceAssetId)
                  || projectReferenceAssetIds.includes(asset.id);
                return <article
                  key={asset.id}
                  className="canvas-global-asset-card"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      "application/x-sanmao-asset",
                      JSON.stringify(asset),
                    );
                  }}
                >
                  <button
                    type="button"
                    className="canvas-global-asset-preview"
                    onClick={() => setPreview(asset)}
                  >
                    {asset.kind === "video" ? (
                      <video
                        src={asset.url}
                        draggable={false}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : asset.kind === "audio" ? (
                      <div className="canvas-global-asset-audio-preview">
                        <span aria-hidden="true">♫</span>
                        <b>参考音频</b>
                      </div>
                    ) : (
                      <img src={asset.url} alt={asset.name} loading="lazy" draggable={false} />
                    )}
                    <span>{asset.kind === "video" ? "▶ 视频" : asset.kind === "audio" ? "♫ 音频" : "▣ 图片"}</span>
                  </button>
                  <div className="canvas-global-asset-copy">
                    <label className="canvas-asset-select"><input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={(event) => setSelectedAssetIds((current) => { const next = new Set(current); if (event.target.checked) next.add(asset.id); else next.delete(asset.id); return next; })} aria-label={`选择资产 ${asset.name}`} /><b title={asset.name}>{asset.name}</b></label>
                    <small>
                      {ASSET_SOURCE_LABELS[asset.source]} ·{" "}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleDateString("zh-CN")
                        : "当前画布"}
                    </small>
                    {asset.prompt && <p>{asset.prompt}</p>}
                  </div>
                  <div className="canvas-global-asset-actions">
                    <button
                      type="button"
                      title="添加到画布"
                      aria-label={`将${asset.name}添加到画布`}
                      onClick={() => onAdd(asset)}
                    >
                      ＋ 画布
                    </button>
                    <button
                      type="button"
                      disabled={!canReference}
                      title={canReference ? "作为当前节点或对象组的参考素材" : "请先选中一个节点或对象组，再添加参考"}
                      aria-label={canReference ? `将${asset.name}作为参考素材` : "添加参考前请先选择节点或对象组"}
                      onClick={() => onReference(asset)}
                    >
                      ⌁ 参考
                    </button>
                    {asset.kind === "image" && <button
                      type="button"
                      className={isProjectReference ? "active" : ""}
                      title="设为项目默认参考"
                      aria-pressed={isProjectReference}
                      aria-label={`${isProjectReference ? "移除" : "设为"}${asset.name}的项目默认参考`}
                      onClick={() => onSetProjectReference(asset)}
                    >{isProjectReference ? "★ 项目" : "☆ 项目"}</button>}
                    <button
                      type="button"
                      title="在画布中定位此资产"
                      aria-label={`在画布中定位${asset.name}`}
                      onClick={() => onLocate(asset)}
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      title="添加标签"
                      aria-label={`给${asset.name}添加标签`}
                      onClick={() => openAssetActionDialog({ kind: "add-tag", assetId: asset.id, value: "" })}
                    >#</button>
                    <button
                      type="button"
                      className={asset.favorite ? "active" : ""}
                      title={asset.favorite ? "取消收藏" : "加入收藏"}
                      aria-label={asset.favorite ? `取消收藏${asset.name}` : `收藏${asset.name}`}
                      onClick={() => void toggleFavorite(asset)}
                    >
                      ★
                    </button>
                    <a href={asset.url} download={asset.name} title="下载资产" aria-label={`下载${asset.name}`}>
                      ↓
                    </a>
                    <button
                      type="button"
                      className="danger"
                      title="从资产中心隐藏（不会删除画布节点或磁盘文件）"
                      aria-label={`隐藏${asset.name}`}
                      onClick={() => void hideAsset(asset)}
                    >
                      ×
                    </button>
                  </div>
                </article>;
              })}
            </div>
          ) : (
            <div className="canvas-asset-empty">
              <span>◇</span>
              <b>没有匹配的资产</b>
              <small>调整筛选，或从主界面生成、上传素材。</small>
            </div>
          )}
        </div>
      </aside>
      {assetActionDialog && typeof document !== "undefined" && createPortal(
        <div
          className="canvas-asset-action-backdrop"
          style={{ zIndex: CANVAS_Z_INDEX.modalPopover }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !savingAssetAction) setAssetActionDialog(null);
          }}
        >
          <form
            ref={assetDialogFormRef}
            className="canvas-asset-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-asset-action-title"
            aria-describedby="canvas-asset-action-description"
            onSubmit={submitAssetActionDialog}
            onKeyDown={trapAssetDialogFocus}
          >
            <header>
              <div>
                <span aria-hidden="true">{assetActionDialog.kind === "delete-collection" ? "⌫" : assetActionDialog.kind === "rename-collection" ? "✎" : "#"}</span>
                <h2 id="canvas-asset-action-title">
                  {assetActionDialog.kind === "delete-collection" ? "删除资产集合" : assetActionDialog.kind === "rename-collection" ? "重命名资产集合" : "添加资产标签"}
                </h2>
              </div>
              <button type="button" aria-label="关闭对话框" disabled={savingAssetAction} onClick={() => setAssetActionDialog(null)}>×</button>
            </header>
            <p id="canvas-asset-action-description">
              {assetActionDialog.kind === "delete-collection"
                ? `确定删除“${collections.find((item) => item.id === assetActionDialog.collectionId)?.name || "此集合"}”吗？集合中的资产不会被删除。`
                : assetActionDialog.kind === "rename-collection"
                  ? "更新集合名称后，已归类的资产仍会保留在此集合中。"
                  : `为“${assets.find((item) => item.id === assetActionDialog.assetId)?.name || "此资产"}”添加一个标签。`}
            </p>
            {assetActionDialog.kind !== "delete-collection" && (
              <label className="canvas-asset-action-field">
                <span>{assetActionDialog.kind === "rename-collection" ? "集合名称" : "标签名称"}</span>
                <input
                  ref={assetDialogInputRef}
                  autoFocus
                  value={assetActionDialog.value}
                  onChange={(event) => setAssetActionDialog((current) => current && "value" in current ? { ...current, value: event.target.value } : current)}
                  placeholder={assetActionDialog.kind === "rename-collection" ? "输入集合名称" : "输入标签"}
                  aria-label={assetActionDialog.kind === "rename-collection" ? "集合名称" : "标签名称"}
                />
              </label>
            )}
            <footer>
              <button type="button" className="canvas-asset-action-secondary" disabled={savingAssetAction} onClick={() => setAssetActionDialog(null)}>取消</button>
              <button
                type="submit"
                className={assetActionDialog.kind === "delete-collection" ? "canvas-asset-action-danger" : "canvas-asset-action-primary"}
                disabled={savingAssetAction || ("value" in assetActionDialog && !assetActionDialog.value.trim())}
              >
                {savingAssetAction ? "保存中" : assetActionDialog.kind === "delete-collection" ? "删除集合" : assetActionDialog.kind === "rename-collection" ? "保存名称" : "添加标签"}
              </button>
            </footer>
          </form>
        </div>,
        document.body,
      )}
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="canvas-asset-preview-backdrop"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="canvas-asset-preview-modal">
            <header>
              <div>
                <b>{preview.name}</b>
                <small>
                  {ASSET_SOURCE_LABELS[preview.source]}
                  {preview.modelName ? ` · ${preview.modelName}` : ""}
                </small>
              </div>
              <button type="button" onClick={() => setPreview(null)}>
                ×
              </button>
            </header>
            <div className="canvas-asset-preview-stage">
              {preview.kind === "video" ? (
                <video src={preview.url} controls autoPlay playsInline />
              ) : preview.kind === "audio" ? (
                <CanvasAudioPlayer src={preview.url} name={preview.name} autoPlay />
              ) : (
                <img src={preview.url} alt={preview.name} />
              )}
            </div>
            <footer>
              <button type="button" onClick={() => onAdd(preview)}>
                ＋ 添加到画布
              </button>
              <button
                type="button"
                disabled={!canReference}
                onClick={() => onReference(preview)}
              >
                ⌁ 作为参考
              </button>
              <a href={preview.url} download={preview.name}>
                ↓ 下载
              </a>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
